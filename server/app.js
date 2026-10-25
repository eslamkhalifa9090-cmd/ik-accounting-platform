// الـ API بتاع المنصة — كل المسارات تحت /api
import {
  HttpError, json, fail, body, normalizePhone, normalizeEmail, toLatinDigits,
  hashPassword, verifyPassword, validatePassword, createSession, currentUser,
  sessionCookie, priceInfo, shuffle, randomToken,
} from "./lib.js";

const today = () => new Date().toISOString().slice(0, 10);
const parseJSON = (s, d) => { try { return JSON.parse(s); } catch { return d; } };

// ---------- راوتر بسيط ----------
const routes = [];
const route = (method, pattern, handler, guard = null) => {
  const keys = [];
  const re = new RegExp("^" + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), "([^/]+)")) + "$");
  routes.push({ method, re, keys, handler, guard });
};

export async function handle(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api/, "").replace(/\/$/, "") || "/";
  try {
    for (const r of routes) {
      if (r.method !== request.method) continue;
      const m = path.match(r.re);
      if (!m) continue;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const ctx = { request, env, db: env.DB, url, params, user: null };
      if (r.guard) {
        ctx.user = await currentUser(env.DB, request);
        if (!ctx.user) fail(401, "لازم تسجل دخول الأول.");
        if (r.guard === "admin" && ctx.user.role !== "admin") fail(403, "الصفحة دي للأدمن بس.");
      }
      return await r.handler(ctx);
    }
    return json({ error: "المسار ده مش موجود." }, 404);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error(e);
    const msg = String(e && e.message || e);
    if (/UNIQUE constraint failed: users\.(email|phone)/.test(msg)) return json({ error: "الميل أو رقم التليفون ده مستخدم لمتدرب تاني." }, 409);
    return json({ error: "حصلت مشكلة في السيرفر. جرب تاني بعد شوية." }, 500);
  }
}

// ---------- الملفات (صفحات الـ PDF وخلفية الشهادة) متخزنة جوه D1 علشان منحتاجش خدمة تخزين تانية ----------
const MAX_FILE = 1900 * 1024; // أقصى حجم لصف واحد في D1 حوالي 2 ميجا
const putFile = (db, key, type, data) =>
  db.prepare("INSERT INTO files (key, type, data) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET type = excluded.type, data = excluded.data")
    .bind(key, type, data).run();
async function getFile(db, key) {
  const f = await db.prepare("SELECT type, data FROM files WHERE key = ?").bind(key).first();
  return f && { type: f.type, data: new Uint8Array(f.data) };
}
const deletePrefix = (db, prefix) => db.prepare("DELETE FROM files WHERE key LIKE ? || '%'").bind(prefix).run();

// ---------- إعدادات ----------
async function getSettings(db) {
  const { results } = await db.prepare("SELECT key, value FROM settings").all();
  return Object.fromEntries(results.map((r) => [r.key, r.value]));
}
const PUBLIC_SETTINGS = ["whatsapp", "whatsapp_display", "lecturer_whatsapp", "brand_name", "footer_line1", "footer_line2",
  "subscribe_message", "follow_message", "notify_message", "cert_signature"];

function publicPlan(p) {
  const info = priceInfo(p);
  return {
    code: p.code, name: p.name, features: parseJSON(p.features, []), show_price: !!p.show_price,
    ...(p.show_price ? info : {}),
  };
}

// ---------- حالة المتدرب في كورس ----------
async function courseState(db, userId, course, plan) {
  const [{ results: levels }, { results: exams }, { results: materials }, { results: done }, { results: best }] = await Promise.all([
    db.prepare("SELECT id, num, title, topics, teaser FROM levels WHERE course_id = ? ORDER BY num").bind(course.id).all(),
    db.prepare(`SELECT e.id, e.kind, e.after_level, e.title, e.question_count, e.pass_pct,
                (SELECT COUNT(*) FROM questions q WHERE q.exam_id = e.id) AS bank
                FROM exams e WHERE e.course_id = ? ORDER BY e.after_level, e.kind DESC`).bind(course.id).all(),
    db.prepare(`SELECT m.id, m.level_id, m.kind, m.title, m.min_plan, m.pages, m.sort FROM materials m
                JOIN levels l ON l.id = m.level_id WHERE l.course_id = ? ORDER BY m.sort, m.id`).bind(course.id).all(),
    db.prepare(`SELECT p.material_id FROM progress p JOIN materials m ON m.id = p.material_id
                JOIN levels l ON l.id = m.level_id WHERE p.user_id = ? AND l.course_id = ?`).bind(userId, course.id).all(),
    db.prepare(`SELECT a.exam_id, MAX(a.score) AS best, MAX(a.passed) AS passed, COUNT(*) AS tries,
                (SELECT a2.score FROM attempts a2 WHERE a2.exam_id = a.exam_id AND a2.user_id = a.user_id AND a2.submitted_at IS NOT NULL ORDER BY a2.id LIMIT 1) AS first
                FROM attempts a JOIN exams e ON e.id = a.exam_id
                WHERE a.user_id = ? AND e.course_id = ? AND a.submitted_at IS NOT NULL GROUP BY a.exam_id`).bind(userId, course.id).all(),
  ]);
  const doneSet = new Set(done.map((d) => d.material_id));
  const bestBy = Object.fromEntries(best.map((b) => [b.exam_id, b]));
  // المستوى الجاي بيفتح بس لما المتدرب ينجح في امتحان المستوى اللي قبله (والتراكمي لو موجود)
  const examPassed = (e) => !e || !!(bestBy[e.id] && bestBy[e.id].passed);
  const levelExam = (n) => exams.find((e) => e.kind === "level" && e.after_level === n);
  const cumBefore = (n) => exams.filter((e) => e.kind === "cumulative" && e.after_level < n);

  const shapeExam = (e, available) => e && ({
    id: e.id, kind: e.kind, title: e.title, after_level: e.after_level, pass_pct: e.pass_pct,
    questions: Math.min(e.question_count, e.bank), ready: e.bank > 0, available,
    passed: !!(bestBy[e.id] && bestBy[e.id].passed), best: bestBy[e.id] ? bestBy[e.id].best : null,
    first: bestBy[e.id] ? bestBy[e.id].first : null, tries: bestBy[e.id] ? bestBy[e.id].tries : 0,
  });

  let doneCount = 0, total = 0, prevUnlocked = true;
  const outLevels = levels.map((l) => {
    const unlocked = l.num === 1 || (prevUnlocked && examPassed(levelExam(l.num - 1)) && cumBefore(l.num).every(examPassed));
    prevUnlocked = unlocked;
    const mats = materials.filter((m) => m.level_id === l.id).map((m) => {
      const allowed = m.min_plan === "basic" || plan === "pro";
      const isDone = doneSet.has(m.id);
      if (allowed) { total++; if (isDone) doneCount++; }
      return { id: m.id, kind: m.kind, title: m.title, min_plan: m.min_plan, pages: m.pages, allowed, done: isDone };
    });
    const ex = levelExam(l.num);
    if (ex) { total++; if (examPassed(ex)) doneCount++; }
    const cum = exams.find((e) => e.kind === "cumulative" && e.after_level === l.num);
    if (cum) { total++; if (examPassed(cum)) doneCount++; }
    const status = !unlocked ? "locked" : (ex && examPassed(ex) ? "done" : "open");
    return {
      ...l, unlocked, status, materials: mats,
      exam: shapeExam(ex, unlocked),
      cumulative: shapeExam(cum, unlocked && examPassed(ex) && cumBefore(l.num).every(examPassed)),
    };
  });
  const completed = levels.length > 0 && exams.length > 0 && exams.every(examPassed);
  const current = outLevels.filter((l) => l.unlocked).pop();
  return {
    levels: outLevels,
    progress: total ? Math.round((doneCount / total) * 100) : 0,
    completed,
    current_level: current ? current.num : 1,
  };
}

async function enrollmentFor(db, userId, courseId) {
  const e = await db.prepare("SELECT * FROM enrollments WHERE user_id = ? AND course_id = ?").bind(userId, courseId).first();
  if (!e) return null;
  return { ...e, active: !e.expires_at || e.expires_at >= today() };
}

async function requireEnrollment(db, user, courseId) {
  if (user.role === "admin") return { plan_code: "pro", active: true, admin: true };
  const e = await enrollmentFor(db, user.id, courseId);
  if (!e) fail(403, "إنت مش مشترك في الكورس ده.");
  if (!e.active) fail(403, "اشتراكك في الكورس ده انتهى. كلم المحاضر على واتساب علشان تجدده.");
  return e;
}

async function levelWithCourse(db, levelId) {
  const l = await db.prepare(`SELECT l.*, c.slug, c.title AS course_title, c.id AS cid, c.status AS course_status
                              FROM levels l JOIN courses c ON c.id = l.course_id WHERE l.id = ?`).bind(levelId).first();
  if (!l) fail(404, "المستوى ده مش موجود.");
  return l;
}

// =====================================================================
// عام (من غير دخول)
// =====================================================================
route("GET", "/public/site", async ({ db }) => {
  const s = await getSettings(db);
  const { results: courses } = await db.prepare("SELECT id, slug, title, subtitle, status, sort FROM courses WHERE status != 'hidden' ORDER BY sort, id").all();
  const { results: plans } = await db.prepare("SELECT * FROM plans WHERE visible = 1 ORDER BY code").all();
  const { results: counts } = await db.prepare("SELECT course_id, COUNT(*) AS n FROM levels GROUP BY course_id").all();
  const nBy = Object.fromEntries(counts.map((c) => [c.course_id, c.n]));
  return json({
    settings: Object.fromEntries(PUBLIC_SETTINGS.map((k) => [k, s[k] || ""])),
    has_cert_bg: !!s.cert_bg,
    courses: courses.map((c) => ({
      slug: c.slug, title: c.title, subtitle: c.subtitle, status: c.status, levels: nBy[c.id] || 0,
      plans: plans.filter((p) => p.course_id === c.id).map(publicPlan),
    })),
  });
});

route("GET", "/public/course/:slug", async ({ db, params }) => {
  const c = await db.prepare("SELECT * FROM courses WHERE slug = ? AND status != 'hidden'").bind(params.slug).first();
  if (!c) fail(404, "الكورس ده مش موجود.");
  const { results: levels } = await db.prepare("SELECT num, title, topics, teaser FROM levels WHERE course_id = ? ORDER BY num").bind(c.id).all();
  const { results: plans } = await db.prepare("SELECT * FROM plans WHERE course_id = ? AND visible = 1 ORDER BY code").bind(c.id).all();
  const { results: exams } = await db.prepare("SELECT kind, after_level, title, pass_pct FROM exams WHERE course_id = ? ORDER BY after_level, kind DESC").bind(c.id).all();
  return json({
    course: { slug: c.slug, title: c.title, subtitle: c.subtitle, intro: c.intro, audience: c.audience, status: c.status },
    levels, plans: plans.map(publicPlan), exams,
  });
});

route("GET", "/public/verify/:code", async ({ db, params }) => {
  const r = await db.prepare(`SELECT c.code, c.issued_at, u.name, co.title AS course FROM certificates c
                              JOIN users u ON u.id = c.user_id JOIN courses co ON co.id = c.course_id WHERE c.code = ?`)
    .bind(params.code.toUpperCase()).first();
  if (!r) fail(404, "مفيش شهادة بالكود ده.");
  return json(r);
});

route("GET", "/public/cert-bg", async ({ db }) => {
  const s = await getSettings(db);
  const f = s.cert_bg && (await getFile(db, s.cert_bg));
  if (!f) return new Response("", { status: 404 });
  return new Response(f.data, { headers: { "content-type": f.type || "image/png", "cache-control": "public, max-age=3600" } });
});

// ---------- أول تشغيل: إنشاء حساب الأدمن ----------
route("GET", "/setup/status", async ({ db }) => {
  const a = await db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").first();
  return json({ needed: a.n === 0 });
});

route("POST", "/setup", async ({ db, env, request }) => {
  const a = await db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").first();
  if (a.n > 0) fail(403, "حساب الأدمن معمول قبل كده.");
  const b = await body(request);
  if (!env.SETUP_KEY || b.key !== env.SETUP_KEY) fail(403, "كود الإعداد غلط.");
  const email = normalizeEmail(b.email);
  if (!email) fail(400, "اكتب ميل صحيح.");
  if (!String(b.name || "").trim()) fail(400, "اكتب الاسم.");
  validatePassword(b.password);
  await db.prepare("INSERT INTO users (name, email, phone, pass_hash, role, must_change) VALUES (?, ?, ?, ?, 'admin', 0)")
    .bind(String(b.name).trim(), email, normalizePhone(b.phone), await hashPassword(b.password)).run();
  return json({ ok: true });
});

// =====================================================================
// الدخول
// =====================================================================
route("POST", "/auth/login", async ({ db, request }) => {
  const b = await body(request);
  const id = String(b.id || "").trim();
  const email = normalizeEmail(id);
  const phone = email ? null : normalizePhone(id);
  if (!email && !phone) fail(400, "اكتب الميل أو رقم التليفون صح.");
  const u = await db.prepare(email ? "SELECT * FROM users WHERE email = ?" : "SELECT * FROM users WHERE phone = ?").bind(email || phone).first();
  if (!u || !(await verifyPassword(String(b.password || ""), u.pass_hash))) fail(401, "البيانات دي مش صحيحة. اتأكد من الميل أو الرقم والباسورد.");
  if (!u.active) fail(403, "الحساب ده موقوف. كلم المحاضر على واتساب.");
  const token = await createSession(db, u.id, request);
  await db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").bind(u.id).run();
  return json({ ok: true, role: u.role, must_change: !!u.must_change }, 200, { "set-cookie": sessionCookie(token, request) });
});

route("POST", "/auth/logout", async ({ db, request, user }) => {
  await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(user.token_hash).run();
  return json({ ok: true }, 200, { "set-cookie": sessionCookie(null, request) });
}, "user");

route("GET", "/auth/me", async ({ user }) => json({
  id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role, must_change: !!user.must_change,
}), "user");

route("POST", "/auth/password", async ({ db, request, user }) => {
  const b = await body(request);
  const u = await db.prepare("SELECT pass_hash FROM users WHERE id = ?").bind(user.id).first();
  if (!(await verifyPassword(String(b.current || ""), u.pass_hash))) fail(400, "الباسورد الحالي مش صحيح.");
  validatePassword(b.next);
  await db.prepare("UPDATE users SET pass_hash = ?, must_change = 0 WHERE id = ?").bind(await hashPassword(b.next), user.id).run();
  await db.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?").bind(user.id, user.token_hash).run();
  return json({ ok: true });
}, "user");

// =====================================================================
// المتدرب
// =====================================================================
route("GET", "/student/dashboard", async ({ db, user }) => {
  const { results: enr } = await db.prepare(`SELECT e.*, c.slug, c.title, c.subtitle, c.status FROM enrollments e
                                             JOIN courses c ON c.id = e.course_id WHERE e.user_id = ? ORDER BY c.sort`).bind(user.id).all();
  const courses = [];
  for (const e of enr) {
    const st = await courseState(db, user.id, { id: e.course_id }, e.plan_code);
    const cur = st.levels.find((l) => l.num === st.current_level);
    courses.push({
      slug: e.slug, title: e.title, subtitle: e.subtitle, plan: e.plan_code, expires_at: e.expires_at,
      active: !e.expires_at || e.expires_at >= today(), progress: st.progress, completed: st.completed,
      current_level: st.current_level, current_title: cur ? cur.title : "", levels: st.levels.length,
    });
  }
  return json({ user: { name: user.name, must_change: !!user.must_change }, courses });
}, "user");

route("GET", "/student/course/:slug", async ({ db, user, params }) => {
  const c = await db.prepare("SELECT * FROM courses WHERE slug = ?").bind(params.slug).first();
  if (!c) fail(404, "الكورس ده مش موجود.");
  const e = await requireEnrollment(db, user, c.id);
  const st = await courseState(db, user.id, c, e.plan_code);
  return json({ course: { slug: c.slug, title: c.title, subtitle: c.subtitle }, plan: e.plan_code, expires_at: e.expires_at || null, ...st });
}, "user");

route("GET", "/student/level/:id", async ({ db, user, params }) => {
  const l = await levelWithCourse(db, params.id);
  const e = await requireEnrollment(db, user, l.cid);
  const st = await courseState(db, user.id, { id: l.cid }, e.plan_code);
  const lv = st.levels.find((x) => x.id === l.id);
  if (!lv.unlocked && user.role !== "admin") fail(403, "المستوى ده لسه مقفول. اعدي امتحان المستوى اللي قبله الأول.");
  return json({ course: { slug: l.slug, title: l.course_title }, plan: e.plan_code, level: lv, total_levels: st.levels.length });
}, "user");

async function materialForUser(db, user, materialId) {
  const m = await db.prepare("SELECT * FROM materials WHERE id = ?").bind(materialId).first();
  if (!m) fail(404, "المادة دي مش موجودة.");
  const l = await levelWithCourse(db, m.level_id);
  const e = await requireEnrollment(db, user, l.cid);
  if (user.role !== "admin") {
    const st = await courseState(db, user.id, { id: l.cid }, e.plan_code);
    if (!st.levels.find((x) => x.id === l.id).unlocked) fail(403, "المستوى ده لسه مقفول.");
    if (m.min_plan === "pro" && e.plan_code !== "pro") fail(403, "المادة دي في باقة Pro.");
  }
  return m;
}

route("GET", "/student/materials/:id", async ({ db, user, params }) => {
  const m = await materialForUser(db, user, params.id);
  return json({ id: m.id, kind: m.kind, title: m.title, pages: m.pages, version: m.version, video_url: m.kind === "video" ? m.video_url : null });
}, "user");

route("GET", "/student/materials/:id/pages/:n", async ({ db, user, params }) => {
  const m = await materialForUser(db, user, params.id);
  const n = parseInt(params.n, 10);
  if (m.kind !== "pdf" || !(n >= 1 && n <= m.pages)) fail(404, "الصفحة دي مش موجودة.");
  const f = await getFile(db, `m/${m.id}/v${m.version}/${n}.webp`);
  if (!f) fail(404, "الصفحة دي مش موجودة.");
  return new Response(f.data, { headers: { "content-type": "image/webp", "cache-control": "private, no-store", "content-disposition": "inline" } });
}, "user");

route("POST", "/student/materials/:id/done", async ({ db, user, params }) => {
  const m = await materialForUser(db, user, params.id);
  await db.prepare("INSERT OR IGNORE INTO progress (user_id, material_id) VALUES (?, ?)").bind(user.id, m.id).run();
  return json({ ok: true });
}, "user");

async function examForUser(db, user, examId) {
  const ex = await db.prepare("SELECT * FROM exams WHERE id = ?").bind(examId).first();
  if (!ex) fail(404, "الامتحان ده مش موجود.");
  const e = await requireEnrollment(db, user, ex.course_id);
  const st = await courseState(db, user.id, { id: ex.course_id }, e.plan_code);
  const lv = st.levels.find((l) => l.num === ex.after_level);
  const shaped = lv && (ex.kind === "level" ? lv.exam : lv.cumulative);
  if (!shaped) fail(404, "الامتحان ده مش موجود.");
  if (!shaped.ready) fail(400, "أسئلة الامتحان ده لسه بتتجهز.");
  if (!shaped.available && user.role !== "admin") fail(403, "الامتحان ده لسه مقفول. خلص اللي قبله الأول.");
  const c = await db.prepare("SELECT slug, title FROM courses WHERE id = ?").bind(ex.course_id).first();
  return { ex, shaped, course: c, level: lv };
}

route("GET", "/student/exams/:id", async ({ db, user, params }) => {
  const { shaped, course, level } = await examForUser(db, user, params.id);
  return json({ exam: shaped, course, level: { id: level.id, num: level.num, title: level.title } });
}, "user");

route("POST", "/student/exams/:id/start", async ({ db, user, params }) => {
  const { ex, shaped } = await examForUser(db, user, params.id);
  const { results: bank } = await db.prepare("SELECT id, body, options FROM questions WHERE exam_id = ?").bind(ex.id).all();
  const picked = shuffle(bank).slice(0, shaped.questions);
  const plan = picked.map((q) => ({ id: q.id, order: shuffle(parseJSON(q.options, []).map((_, i) => i)) }));
  const r = await db.prepare("INSERT INTO attempts (user_id, exam_id, question_ids) VALUES (?, ?, ?) RETURNING id")
    .bind(user.id, ex.id, JSON.stringify(plan)).first();
  const byId = Object.fromEntries(picked.map((q) => [q.id, q]));
  return json({
    attempt: r.id,
    questions: plan.map((p, i) => {
      const opts = parseJSON(byId[p.id].options, []);
      return { n: i + 1, id: p.id, body: byId[p.id].body, options: p.order.map((k) => opts[k]) };
    }),
  });
}, "user");

route("POST", "/student/attempts/:id/submit", async ({ db, user, request, params }) => {
  const a = await db.prepare("SELECT * FROM attempts WHERE id = ? AND user_id = ?").bind(params.id, user.id).first();
  if (!a) fail(404, "المحاولة دي مش موجودة.");
  if (a.submitted_at) fail(400, "المحاولة دي اتسلمت قبل كده.");
  const b = await body(request);
  const answers = b.answers || {};
  const plan = parseJSON(a.question_ids, []);
  const ids = plan.map((p) => p.id);
  const { results: qs } = ids.length
    ? await db.prepare(`SELECT id, answer FROM questions WHERE id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all()
    : { results: [] };
  const correctBy = Object.fromEntries(qs.map((q) => [q.id, q.answer]));
  let correct = 0;
  for (const p of plan) {
    const chosen = answers[p.id];
    if (chosen === undefined || chosen === null) continue;
    if (p.order[Number(chosen)] === correctBy[p.id]) correct++;
  }
  const total = plan.length;
  const score = total ? Math.round((correct / total) * 1000) / 10 : 0;
  const ex = await db.prepare("SELECT pass_pct FROM exams WHERE id = ?").bind(a.exam_id).first();
  const passed = score > ex.pass_pct ? 1 : 0; // النجاح = أكتر من نسبة النجاح
  await db.prepare("UPDATE attempts SET score = ?, passed = ?, submitted_at = datetime('now') WHERE id = ?").bind(score, passed, a.id).run();
  return json({ score, passed: !!passed, correct, total, pass_pct: ex.pass_pct });
}, "user");

route("GET", "/student/certificate/:slug", async ({ db, user, params }) => {
  const c = await db.prepare("SELECT * FROM courses WHERE slug = ?").bind(params.slug).first();
  if (!c) fail(404, "الكورس ده مش موجود.");
  const e = await requireEnrollment(db, user, c.id);
  const st = await courseState(db, user.id, c, e.plan_code);
  if (!st.completed) fail(403, "الشهادة بتطلع بعد ما تعدي كل امتحانات الكورس.");
  let cert = await db.prepare("SELECT * FROM certificates WHERE user_id = ? AND course_id = ?").bind(user.id, c.id).first();
  if (!cert) {
    const code = "IK-" + randomToken(4).toUpperCase();
    await db.prepare("INSERT INTO certificates (code, user_id, course_id) VALUES (?, ?, ?)").bind(code, user.id, c.id).run();
    cert = { code, issued_at: today() };
  }
  const s = await getSettings(db);
  return json({ code: cert.code, issued_at: cert.issued_at, name: user.name, course: c.title, signature: s.cert_signature || "", has_bg: !!s.cert_bg });
}, "user");

// =====================================================================
// الأدمن
// =====================================================================
route("GET", "/admin/overview", async ({ db }) => {
  const [s, a, e] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS n, SUM(active) AS active FROM users WHERE role = 'student'").first(),
    db.prepare("SELECT COUNT(*) AS n, SUM(passed) AS passed FROM attempts WHERE submitted_at IS NOT NULL").first(),
    db.prepare("SELECT COUNT(*) AS n FROM enrollments WHERE expires_at IS NULL OR expires_at >= date('now')").first(),
  ]);
  return json({ students: s.n, active: s.active || 0, attempts: a.n, passed: a.passed || 0, enrollments: e.n });
}, "admin");

route("GET", "/admin/students", async ({ db, url }) => {
  const q = "%" + toLatinDigits(url.searchParams.get("q") || "").trim() + "%";
  const { results } = await db.prepare(`SELECT u.id, u.name, u.email, u.phone, u.active, u.notes, u.created_at, u.last_login, u.must_change
      FROM users u WHERE u.role = 'student' AND (u.name LIKE ?1 OR IFNULL(u.email,'') LIKE ?1 OR IFNULL(u.phone,'') LIKE ?1)
      ORDER BY u.id DESC LIMIT 500`).bind(q).all();
  const { results: enr } = await db.prepare(`SELECT e.user_id, e.course_id, e.plan_code, e.expires_at, c.title, c.slug
      FROM enrollments e JOIN courses c ON c.id = e.course_id`).all();
  return json(results.map((u) => ({ ...u, enrollments: enr.filter((e) => e.user_id === u.id) })));
}, "admin");

function studentFields(b, partial = false) {
  const out = {};
  if (!partial || b.name !== undefined) {
    out.name = String(b.name || "").trim();
    if (!out.name) fail(400, "اكتب اسم المتدرب.");
  }
  if (!partial || b.email !== undefined) {
    out.email = b.email ? normalizeEmail(b.email) : null;
    if (b.email && !out.email) fail(400, "الميل مكتوب غلط.");
  }
  if (!partial || b.phone !== undefined) {
    out.phone = b.phone ? normalizePhone(b.phone) : null;
    if (b.phone && !out.phone) fail(400, "رقم التليفون مكتوب غلط.");
  }
  return out;
}

route("POST", "/admin/students", async ({ db, request }) => {
  const b = await body(request);
  const f = studentFields(b);
  if (!f.email && !f.phone) fail(400, "لازم ميل أو رقم تليفون علشان المتدرب يدخل بيه.");
  validatePassword(b.password);
  const r = await db.prepare("INSERT INTO users (name, email, phone, pass_hash, notes, must_change) VALUES (?, ?, ?, ?, ?, ?) RETURNING id")
    .bind(f.name, f.email, f.phone, await hashPassword(b.password), b.notes || null, b.must_change === false ? 0 : 1).first();
  if (b.course_slug) await upsertEnrollment(db, r.id, b);
  return json({ ok: true, id: r.id });
}, "admin");

route("PATCH", "/admin/students/:id", async ({ db, request, params }) => {
  const b = await body(request);
  const f = studentFields(b, true);
  const sets = [], vals = [];
  for (const [k, v] of Object.entries(f)) { sets.push(`${k} = ?`); vals.push(v); }
  if (b.notes !== undefined) { sets.push("notes = ?"); vals.push(b.notes || null); }
  if (b.active !== undefined) { sets.push("active = ?"); vals.push(b.active ? 1 : 0); }
  if (b.password) { validatePassword(b.password); sets.push("pass_hash = ?", "must_change = 1"); vals.push(await hashPassword(b.password)); }
  if (!sets.length) fail(400, "مفيش حاجة اتغيرت.");
  await db.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ? AND role = 'student'`).bind(...vals, params.id).run();
  if (b.password || b.active === false) await db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(params.id).run();
  return json({ ok: true });
}, "admin");

route("DELETE", "/admin/students/:id", async ({ db, params }) => {
  await db.prepare("DELETE FROM users WHERE id = ? AND role = 'student'").bind(params.id).run();
  return json({ ok: true });
}, "admin");

async function upsertEnrollment(db, userId, b) {
  const c = await db.prepare("SELECT id FROM courses WHERE slug = ?").bind(b.course_slug).first();
  if (!c) fail(400, "الكورس ده مش موجود.");
  const plan = b.plan_code === "pro" ? "pro" : "basic";
  const exp = b.expires_at ? String(b.expires_at).slice(0, 10) : null;
  if (exp && !/^\d{4}-\d{2}-\d{2}$/.test(exp)) fail(400, "تاريخ الانتهاء مكتوب غلط.");
  await db.prepare(`INSERT INTO enrollments (user_id, course_id, plan_code, expires_at) VALUES (?, ?, ?, ?)
                    ON CONFLICT (user_id, course_id) DO UPDATE SET plan_code = excluded.plan_code, expires_at = excluded.expires_at`)
    .bind(userId, c.id, plan, exp).run();
}

route("PUT", "/admin/students/:id/enrollment", async ({ db, request, params }) => {
  await upsertEnrollment(db, params.id, await body(request));
  return json({ ok: true });
}, "admin");

route("DELETE", "/admin/students/:id/enrollment/:slug", async ({ db, params }) => {
  await db.prepare("DELETE FROM enrollments WHERE user_id = ? AND course_id = (SELECT id FROM courses WHERE slug = ?)").bind(params.id, params.slug).run();
  return json({ ok: true });
}, "admin");

route("GET", "/admin/students/:id/report", async ({ db, params }) => {
  const u = await db.prepare("SELECT id, name, email, phone FROM users WHERE id = ?").bind(params.id).first();
  if (!u) fail(404, "المتدرب ده مش موجود.");
  const { results: enr } = await db.prepare("SELECT e.*, c.title, c.slug FROM enrollments e JOIN courses c ON c.id = e.course_id WHERE e.user_id = ?").bind(u.id).all();
  const courses = [];
  for (const e of enr) courses.push({ title: e.title, slug: e.slug, plan: e.plan_code, ...(await courseState(db, u.id, { id: e.course_id }, e.plan_code)) });
  return json({ user: u, courses });
}, "admin");

route("GET", "/admin/export.csv", async ({ db }) => {
  const { results: rows } = await db.prepare(`SELECT u.id, u.name, u.email, u.phone, u.active, u.last_login, e.course_id, e.plan_code, e.expires_at, c.title
      FROM users u LEFT JOIN enrollments e ON e.user_id = u.id LEFT JOIN courses c ON c.id = e.course_id
      WHERE u.role = 'student' ORDER BY u.id`).all();
  const head = ["الاسم", "الميل", "التليفون", "الحالة", "آخر دخول", "الكورس", "الباقة", "ينتهي في", "نسبة التقدم", "المستوى الحالي", "خلص الكورس"];
  const lines = [head];
  for (const r of rows) {
    let st = null;
    if (r.course_id) st = await courseState(db, r.id, { id: r.course_id }, r.plan_code);
    lines.push([r.name, r.email || "", r.phone || "", r.active ? "نشط" : "موقوف", r.last_login || "", r.title || "", r.plan_code || "",
      r.expires_at || "", st ? st.progress + "%" : "", st ? st.current_level : "", st ? (st.completed ? "نعم" : "لا") : ""]);
  }
  const csv = "﻿" + lines.map((l) => l.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\r\n");
  return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="students-${today()}.csv"` } });
}, "admin");

// ---------- الكورسات والأسعار والمستويات ----------
route("GET", "/admin/courses", async ({ db }) => {
  const [{ results: courses }, { results: plans }, { results: levels }] = await Promise.all([
    db.prepare("SELECT * FROM courses ORDER BY sort, id").all(),
    db.prepare("SELECT * FROM plans ORDER BY code").all(),
    db.prepare("SELECT * FROM levels ORDER BY num").all(),
  ]);
  return json(courses.map((c) => ({
    ...c,
    plans: plans.filter((p) => p.course_id === c.id).map((p) => ({ ...p, features: parseJSON(p.features, []), ...priceInfo(p) })),
    levels: levels.filter((l) => l.course_id === c.id),
  })));
}, "admin");

const pick = (b, keys) => Object.fromEntries(keys.filter((k) => b[k] !== undefined).map((k) => [k, b[k]]));
async function update(db, table, id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) fail(400, "مفيش حاجة اتغيرت.");
  await db.prepare(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).bind(...Object.values(fields), id).run();
}

route("POST", "/admin/courses", async ({ db, request }) => {
  const b = await body(request);
  const slug = String(b.slug || "").trim().toLowerCase();
  if (!/^[a-z0-9-]{2,40}$/.test(slug)) fail(400, "الرابط المختصر لازم يكون حروف إنجليزي صغيرة وأرقام وشرطة بس.");
  if (!String(b.title || "").trim()) fail(400, "اكتب اسم الكورس.");
  const r = await db.prepare("INSERT INTO courses (slug, title, subtitle, status, sort) VALUES (?, ?, ?, ?, ?) RETURNING id")
    .bind(slug, b.title.trim(), b.subtitle || null, ["open", "soon", "hidden"].includes(b.status) ? b.status : "soon", Number(b.sort) || 99).first();
  await db.batch([
    db.prepare("INSERT INTO plans (course_id, code, name, features) VALUES (?, 'basic', 'الباقة الأساسية', '[]')").bind(r.id),
    db.prepare("INSERT INTO plans (course_id, code, name, features, visible) VALUES (?, 'pro', 'باقة Pro', '[]', 0)").bind(r.id),
  ]);
  return json({ ok: true, id: r.id });
}, "admin");

route("PATCH", "/admin/courses/:id", async ({ db, request, params }) => {
  const f = pick(await body(request), ["title", "subtitle", "intro", "audience", "status", "sort"]);
  if (f.status && !["open", "soon", "hidden"].includes(f.status)) fail(400, "حالة الكورس غلط.");
  await update(db, "courses", params.id, f);
  return json({ ok: true });
}, "admin");

route("PATCH", "/admin/plans/:id", async ({ db, request, params }) => {
  const b = await body(request);
  const f = pick(b, ["name", "price", "show_price", "discount_type", "discount_value", "discount_ends", "visible"]);
  if (b.features !== undefined) f.features = JSON.stringify((Array.isArray(b.features) ? b.features : String(b.features).split("\n")).map((s) => String(s).trim()).filter(Boolean));
  if (f.discount_type && !["none", "percent", "amount"].includes(f.discount_type)) fail(400, "نوع الخصم غلط.");
  if (f.discount_type === "percent" && Number(f.discount_value) > 100) fail(400, "نسبة الخصم مينفعش تزيد عن 100%.");
  for (const k of ["price", "discount_value"]) if (f[k] !== undefined) { f[k] = Number(toLatinDigits(f[k])) || 0; if (f[k] < 0) fail(400, "الأرقام لازم تكون موجبة."); }
  for (const k of ["show_price", "visible"]) if (f[k] !== undefined) f[k] = f[k] ? 1 : 0;
  if (f.discount_ends === "") f.discount_ends = null;
  await update(db, "plans", params.id, f);
  return json({ ok: true });
}, "admin");

route("POST", "/admin/courses/:id/levels", async ({ db, request, params }) => {
  const b = await body(request);
  const last = await db.prepare("SELECT MAX(num) AS n FROM levels WHERE course_id = ?").bind(params.id).first();
  const num = (last.n || 0) + 1;
  if (!String(b.title || "").trim()) fail(400, "اكتب عنوان المستوى.");
  await db.batch([
    db.prepare("INSERT INTO levels (course_id, num, title, topics, teaser) VALUES (?, ?, ?, ?, ?)").bind(params.id, num, b.title.trim(), b.topics || null, b.teaser || null),
    db.prepare("INSERT OR IGNORE INTO exams (course_id, kind, after_level, title) VALUES (?, 'level', ?, ?)").bind(params.id, num, "امتحان المستوى " + num),
  ]);
  return json({ ok: true, num });
}, "admin");

route("PATCH", "/admin/levels/:id", async ({ db, request, params }) => {
  await update(db, "levels", params.id, pick(await body(request), ["title", "topics", "teaser"]));
  return json({ ok: true });
}, "admin");

// ---------- المادة العلمية ----------
route("GET", "/admin/levels/:id/materials", async ({ db, params }) => {
  const { results } = await db.prepare("SELECT * FROM materials WHERE level_id = ? ORDER BY sort, id").bind(params.id).all();
  return json(results);
}, "admin");

route("POST", "/admin/levels/:id/materials", async ({ db, request, params }) => {
  const b = await body(request);
  const kind = b.kind === "video" ? "video" : "pdf";
  if (!String(b.title || "").trim()) fail(400, "اكتب عنوان المادة.");
  const r = await db.prepare("INSERT INTO materials (level_id, kind, title, min_plan, video_url, sort) VALUES (?, ?, ?, ?, ?, ?) RETURNING id")
    .bind(params.id, kind, b.title.trim(), b.min_plan === "pro" || kind === "video" ? "pro" : "basic", b.video_url || null, Number(b.sort) || 0).first();
  return json({ ok: true, id: r.id });
}, "admin");

route("PATCH", "/admin/materials/:id", async ({ db, request, params }) => {
  const f = pick(await body(request), ["title", "min_plan", "video_url", "sort"]);
  if (f.min_plan && !["basic", "pro"].includes(f.min_plan)) fail(400, "الباقة غلط.");
  await update(db, "materials", params.id, { ...f, updated_at: new Date().toISOString() });
  return json({ ok: true });
}, "admin");


route("DELETE", "/admin/materials/:id", async ({ db, params }) => {
  await deletePrefix(db, `m/${params.id}/`);
  await db.prepare("DELETE FROM materials WHERE id = ?").bind(params.id).run();
  return json({ ok: true });
}, "admin");

// رفع نسخة جديدة: الصفحات بتترفع على نسخة جديدة، وبعد النشر النسخة القديمة بتتمسح
route("PUT", "/admin/materials/:id/pages/:n", async ({ db, request, params, url }) => {
  const m = await db.prepare("SELECT id, version FROM materials WHERE id = ? AND kind = 'pdf'").bind(params.id).first();
  if (!m) fail(404, "المادة دي مش موجودة.");
  const v = parseInt(url.searchParams.get("v"), 10);
  const n = parseInt(params.n, 10);
  if (v !== m.version + 1 || !(n >= 1 && n <= 2000)) fail(400, "رقم النسخة أو الصفحة غلط.");
  const data = await request.arrayBuffer();
  if (!data.byteLength || data.byteLength > MAX_FILE) fail(400, "حجم الصفحة كبير. جرب ملف PDF بدقة أقل.");
  await putFile(db, `m/${m.id}/v${v}/${n}.webp`, "image/webp", data);
  return json({ ok: true });
}, "admin");

route("POST", "/admin/materials/:id/publish", async ({ db, request, params }) => {
  const b = await body(request);
  const m = await db.prepare("SELECT id, version FROM materials WHERE id = ? AND kind = 'pdf'").bind(params.id).first();
  if (!m) fail(404, "المادة دي مش موجودة.");
  const pages = parseInt(b.pages, 10);
  if (Number(b.version) !== m.version + 1 || !(pages >= 1)) fail(400, "بيانات النشر غلط.");
  const lastPage = await db.prepare("SELECT 1 FROM files WHERE key = ?").bind(`m/${m.id}/v${m.version + 1}/${pages}.webp`).first();
  if (!lastPage) fail(400, "مش كل الصفحات اترفعت. جرب ترفع الملف تاني.");
  await db.prepare("UPDATE materials SET version = ?, pages = ?, updated_at = datetime('now') WHERE id = ?").bind(m.version + 1, pages, m.id).run();
  if (m.version > 0) await deletePrefix(db, `m/${m.id}/v${m.version}/`);
  return json({ ok: true });
}, "admin");

// ---------- الامتحانات والأسئلة ----------
route("GET", "/admin/courses/:id/exams", async ({ db, params }) => {
  const { results } = await db.prepare(`SELECT e.*, (SELECT COUNT(*) FROM questions q WHERE q.exam_id = e.id) AS bank
      FROM exams e WHERE e.course_id = ? ORDER BY e.after_level, e.kind DESC`).bind(params.id).all();
  return json(results);
}, "admin");

route("POST", "/admin/courses/:id/exams", async ({ db, request, params }) => {
  const b = await body(request);
  const after = parseInt(b.after_level, 10);
  if (!(after >= 1)) fail(400, "اختار الامتحان بعد أنهي مستوى.");
  await db.prepare("INSERT INTO exams (course_id, kind, after_level, title, question_count, pass_pct) VALUES (?, 'cumulative', ?, ?, ?, ?)")
    .bind(params.id, after, b.title || `امتحان تراكمي بعد المستوى ${after}`, Number(b.question_count) || 20, Number(b.pass_pct) || 50).run();
  return json({ ok: true });
}, "admin");

route("PATCH", "/admin/exams/:id", async ({ db, request, params }) => {
  const f = pick(await body(request), ["title", "question_count", "pass_pct"]);
  if (f.question_count !== undefined && !(Number(f.question_count) >= 1)) fail(400, "عدد الأسئلة لازم يكون 1 أو أكتر.");
  if (f.pass_pct !== undefined && !(Number(f.pass_pct) >= 0 && Number(f.pass_pct) < 100)) fail(400, "نسبة النجاح لازم تكون بين 0 و 99.");
  await update(db, "exams", params.id, f);
  return json({ ok: true });
}, "admin");

route("DELETE", "/admin/exams/:id", async ({ db, params }) => {
  const ex = await db.prepare("SELECT kind FROM exams WHERE id = ?").bind(params.id).first();
  if (!ex) fail(404, "الامتحان ده مش موجود.");
  if (ex.kind !== "cumulative") fail(400, "امتحانات المستويات مش بتتمسح، تقدر تفضي أسئلتها بس.");
  await db.prepare("DELETE FROM exams WHERE id = ?").bind(params.id).run();
  return json({ ok: true });
}, "admin");

route("GET", "/admin/exams/:id/questions", async ({ db, params }) => {
  const { results } = await db.prepare("SELECT * FROM questions WHERE exam_id = ? ORDER BY id").bind(params.id).all();
  return json(results.map((q) => ({ ...q, options: parseJSON(q.options, []) })));
}, "admin");

function cleanQuestion(q, i = null) {
  const where = i === null ? "" : ` (سطر ${i + 1})`;
  const text = String(q.body || "").trim();
  const options = (q.options || []).map((o) => String(o ?? "").trim()).filter(Boolean);
  const answer = parseInt(toLatinDigits(q.answer), 10) - 1; // جاي من الأدمن 1..n
  if (!text) fail(400, "نص السؤال فاضي" + where + ".");
  if (options.length < 2) fail(400, "لازم اختيارين على الأقل" + where + ".");
  if (!(answer >= 0 && answer < options.length)) fail(400, "رقم الإجابة الصح لازم يكون من 1 لـ " + options.length + where + ".");
  return [text, JSON.stringify(options), answer, String(q.explanation || "").trim() || null];
}

route("POST", "/admin/exams/:id/questions", async ({ db, request, params }) => {
  const b = await body(request);
  const items = Array.isArray(b.items) ? b.items : [b];
  if (!items.length) fail(400, "مفيش أسئلة.");
  const rows = items.map((q, i) => cleanQuestion(q, items.length > 1 ? i : null));
  const stmts = [];
  if (b.replace) stmts.push(db.prepare("DELETE FROM questions WHERE exam_id = ?").bind(params.id));
  for (const r of rows) stmts.push(db.prepare("INSERT INTO questions (exam_id, body, options, answer, explanation) VALUES (?, ?, ?, ?, ?)").bind(params.id, ...r));
  await db.batch(stmts);
  return json({ ok: true, added: rows.length });
}, "admin");

route("PATCH", "/admin/questions/:id", async ({ db, request, params }) => {
  const [text, options, answer, explanation] = cleanQuestion(await body(request));
  await db.prepare("UPDATE questions SET body = ?, options = ?, answer = ?, explanation = ? WHERE id = ?").bind(text, options, answer, explanation, params.id).run();
  return json({ ok: true });
}, "admin");

route("DELETE", "/admin/questions/:id", async ({ db, params }) => {
  await db.prepare("DELETE FROM questions WHERE id = ?").bind(params.id).run();
  return json({ ok: true });
}, "admin");

// ---------- الإعدادات ----------
route("GET", "/admin/settings", async ({ db }) => json(await getSettings(db)), "admin");

route("PUT", "/admin/settings", async ({ db, request }) => {
  const b = await body(request);
  const stmts = [];
  for (const k of PUBLIC_SETTINGS) {
    if (b[k] === undefined) continue;
    let v = String(b[k]).trim();
    if (k === "whatsapp" || k === "lecturer_whatsapp") {
      v = toLatinDigits(v).replace(/\D/g, "");
      if (v.startsWith("0")) v = "20" + v.slice(1);
      if (v && !/^\d{10,15}$/.test(v)) fail(400, "رقم الواتساب مكتوب غلط.");
    }
    stmts.push(db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").bind(k, v));
  }
  if (stmts.length) await db.batch(stmts);
  return json({ ok: true });
}, "admin");

route("PUT", "/admin/cert-bg", async ({ db, request }) => {
  const type = request.headers.get("content-type") || "";
  if (!/^image\/(png|jpeg|webp)$/.test(type)) fail(400, "الصورة لازم تكون PNG أو JPG أو WebP.");
  const data = await request.arrayBuffer();
  if (!data.byteLength || data.byteLength > MAX_FILE) fail(400, "حجم الصورة لازم يكون أقل من 1.9 ميجا. صدرها JPG بجودة أقل.");
  const key = `cert/bg-${Date.now()}`;
  await putFile(db, key, type, data);
  const old = (await getSettings(db)).cert_bg;
  await db.prepare("INSERT INTO settings (key, value) VALUES ('cert_bg', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").bind(key).run();
  if (old) await db.prepare("DELETE FROM files WHERE key = ?").bind(old).run();
  return json({ ok: true });
}, "admin");
