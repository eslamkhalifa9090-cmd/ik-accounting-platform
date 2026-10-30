// الـ API بتاع المنصة — كل المسارات تحت /api
import {
  HttpError, json, fail, body, normalizePhone, normalizeEmail, toLatinDigits,
  hashPassword, verifyPassword, validatePassword, createSession, currentUser,
  sessionCookie, priceInfo, shuffle, randomToken, sha256, readCookie,
} from "./lib.js";

const today = () => new Date().toISOString().slice(0, 10);
const parseJSON = (s, d) => { try { return JSON.parse(s); } catch { return d; } };
const sqlTime = (s) => Date.parse(String(s).replace(" ", "T") + "Z"); // datetime('now') في SQLite بتوقيت UTC

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
        // آخر نشاط: بيتحدث مرة كل ساعة بالكتير، علشان قايمة المتدربين المنقطعين
        if (!ctx.user.last_seen || Date.now() - sqlTime(ctx.user.last_seen) > 3600e3) {
          await env.DB.prepare("UPDATE users SET last_seen = datetime('now') WHERE id = ?").bind(ctx.user.id).run();
        }
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
// نصوص الشهادة (الديباجة): الأدمن بيعدلها من الإعدادات، والفاضي بيرجع للنص الافتراضي
const CERT_TEXTS = { cert_title: "شهادة إتمام", cert_title_en: "CERTIFICATE OF COMPLETION", cert_lead: "تشهد المنصة بأن", cert_course_lead: "أتم بنجاح كورس" };
const CERT_TEXT_KEYS = Object.keys(CERT_TEXTS);
// قيم افتراضية لحد ما الأدمن يغيرها من الإعدادات (لو فضاها خالص القسم بيستخبى)
const SETTING_DEFAULTS = {
  services: [
    "Accounting Software | إنشاء البرامج المحاسبية | برنامج محاسبي على مقاس شغلك بدل البرامج الجاهزة اللي مش مناسبة لحجمك. | الدليل المحاسبي والقيود والأستاذ؛ العملاء والموردين والمخزون؛ التقارير والقوائم المالية",
    "Documentary Cycles | تصميم الدورات المستندية | كل عملية ليها مستند، وكل مستند ليه خط سير ومراجعة، فمفيش حاجة تضيع. | دورة المبيعات والتحصيل؛ دورة المشتريات والسداد؛ دورة المخزون والخزينة",
    "Excel Accounting Cycles | تصميم دورات محاسبية بالإكسيل | الدورة المحاسبية كاملة على Excel: من القيد لحد القوائم المالية، بمعادلات مربوطة ومحمية. | دفتر اليومية والأستاذ وميزان المراجعة؛ التسويات والإقفال؛ القوائم المالية والتقارير",
    "Skills Development | كورسات تنمية المهارات | تدريب عملي لفريق الحسابات والـ HR عندك، على شغلكم الحقيقي ومستواكم. | محاسبة وضرايب عملية؛ Excel للمحاسبين؛ برنامج مصمم على احتياج الشركة",
  ].join("\n"),
  testimonials: "",
};
async function getSettings(db) {
  const { results } = await db.prepare("SELECT key, value FROM settings").all();
  return { ...SETTING_DEFAULTS, ...Object.fromEntries(results.map((r) => [r.key, r.value])) };
}
// whatsapp = خدمة العملاء، support_whatsapp = الدعم الفني، lecturer_whatsapp = المحاضر
const PUBLIC_SETTINGS = ["whatsapp", "whatsapp_display", "support_whatsapp", "lecturer_whatsapp", "brand_name", "brand_by", "footer_line1", "footer_line2",
  "subscribe_message", "support_message", "follow_message", "notify_message", "cert_signature", "wm_text", "wm_student", "wm_level", "tracks", "lib_subcats", "follow_mode", "services", "testimonials"];
const ADMIN_SETTINGS = [...PUBLIC_SETTINGS, "reminder_message", "inactive_days", "cert_issuer", "activation_message", "demo_message", ...CERT_TEXT_KEYS];

// الأقسام بتتكتب في الإعدادات سطر لكل قسم: المفتاح | الاسم | سطر تعريفي
const parseLines = (txt, n) => String(txt || "").split("\n").map((l) => l.split("|").map((x) => x.trim())).filter((p) => p[0] && p.length >= n);
const parseTracks = (s) => parseLines(s.tracks, 2).map(([key, name, desc]) => ({ key, name, desc: desc || "" }));
// مناسب لمين: مفاتيح ثابتة، والكورس أو الملف ممكن ياخد أكتر من واحد
const AUDIENCES = { accountant: "محاسب / خريج", business: "صاحب بيزنس", hr: "HR" };
const cleanAudiences = (v) => {
  const list = (Array.isArray(v) ? v : String(v || "").split(",")).map((x) => String(x).trim()).filter((x) => AUDIENCES[x]);
  return [...new Set(list)].join(",") || "accountant";
};
const splitList = (v) => String(v || "").split(",").map((x) => x.trim()).filter(Boolean);
// مصدر الزيارة بيتسجل حروف إنجليزي صغيرة وأرقام وشرطة بس (facebook، whatsapp، google ...)
const cleanSource = (v) => String(v || "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40);
const WHATSAPP_KEYS = ["whatsapp", "support_whatsapp", "lecturer_whatsapp"];
const cleanWhatsapp = (raw) => {
  let v = toLatinDigits(String(raw || "")).replace(/\D/g, "");
  if (v.startsWith("0")) v = "20" + v.slice(1);
  if (v && !/^\d{10,15}$/.test(v)) fail(400, "رقم الواتساب مكتوب غلط.");
  return v;
};

// المحاضرين: بيتحفظوا في الإعدادات تحت lecturers (JSON)، وكل محاضر ليه الكورسات اللي بيديها
// follow_mode بيحدد زرار المتابعة جوه الكورس: lecturer = محاضر الكورس، service = خدمة العملاء، hidden = مستخبي
const FOLLOW_MODES = ["lecturer", "service", "hidden"];
const lecturersOf = (s) => (Array.isArray(parseJSON(s.lecturers, [])) ? parseJSON(s.lecturers, []) : []);
const courseLecturers = (s, courseId) => lecturersOf(s).filter((l) => (l.courses || []).includes(Number(courseId)));
// اللي بيظهر للزوار: الاسم والسطر التعريفي والنبذة بس، من غير أرقام
const publicLecturers = (s, courseId) => courseLecturers(s, courseId).filter((l) => l.visible !== false).map((l) => ({ name: l.name, role: l.role || "", bio: l.bio || "" }));
function followFor(s, courseId) {
  const mode = FOLLOW_MODES.includes(s.follow_mode) ? s.follow_mode : "lecturer";
  if (mode === "hidden") return { mode };
  if (mode === "service") return { mode, whatsapp: s.whatsapp || "" };
  const l = courseLecturers(s, courseId).find((x) => x.whatsapp);
  return { mode, name: l ? l.name : "", whatsapp: (l && l.whatsapp) || s.lecturer_whatsapp || s.whatsapp || "" };
}

// اسم التقسيم في كل كورس (مستوى / وحدة / موديول)، بيتحفظ في الإعدادات تحت unit_<id>
const UNITS = {
  level: { key: "level", the: "المستوى", a: "مستوى", pl: "المستويات", li: "للمستوى", this: "المستوى ده", closed: "مقفول", opens: "بيفتح", will: "هيفتح", before: "اللي قبله" },
  unit: { key: "unit", the: "الوحدة", a: "وحدة", pl: "الوحدات", li: "للوحدة", this: "الوحدة دي", closed: "مقفولة", opens: "بتفتح", will: "هتفتح", before: "اللي قبلها" },
  module: { key: "module", the: "الموديول", a: "موديول", pl: "الموديولات", li: "للموديول", this: "الموديول ده", closed: "مقفول", opens: "بيفتح", will: "هيفتح", before: "اللي قبله" },
};
const unitFrom = (s, courseId) => UNITS[s["unit_" + courseId]] || UNITS.level;
async function unitOf(db, courseId) {
  const r = await db.prepare("SELECT value FROM settings WHERE key = ?").bind("unit_" + courseId).first();
  return UNITS[r && r.value] || UNITS.level;
}

// طريقة فتح المحتوى في كل كورس، بتتحفظ تحت unlock_<id>:
// sequence = بالترتيب (الفصل بعد اللي قبله، والمستوى بعد امتحان اللي قبله) / open = كل الكورس مفتوح (كل وحدة مستقلة)
const UNLOCKS = ["sequence", "open"];
const unlockFrom = (s, courseId) => (UNLOCKS.includes(s["unlock_" + courseId]) ? s["unlock_" + courseId] : "sequence");
async function unlockOf(db, courseId) {
  const r = await db.prepare("SELECT value FROM settings WHERE key = ?").bind("unlock_" + courseId).first();
  return r && UNLOCKS.includes(r.value) ? r.value : "sequence";
}

// برامج الـ Demo (HR، mini-sys ...): بتتحفظ في الإعدادات تحت demo_apps (JSON)
// places = بتظهر فين (الرئيسية، صفحة الكورس، كورساتي، المكتبة)، open = أي حد (زائر أو متدرب) يقدر يطلبها،
// courses = تظهر في صفحات الكورسات دي بس (فاضي = كل الكورسات)، login = بيانات الدخول اللي بتظهر للمشترك في باقة فيها البرنامج
const DEMO_PLACES = ["home", "course", "dashboard", "library"];
const demoAppsOf = (s) => (Array.isArray(parseJSON(s.demo_apps, [])) ? parseJSON(s.demo_apps, []) : []);
const publicDemo = (a, courses) => ({
  id: a.id, name: a.name, desc: a.desc || "", button: a.button || "", message: a.message || "", places: a.places || [],
  courses: (a.courses || []).map((id) => (courses.find((c) => c.id === id) || {}).slug).filter(Boolean),
});
function cleanDemoApps(list) {
  if (!Array.isArray(list)) fail(400, "بيانات البرامج غلط.");
  const seen = new Set();
  return list.map((a) => {
    const name = String(a.name || "").trim().slice(0, 80);
    if (!name) fail(400, "اكتب اسم البرنامج اللي هيظهر.");
    let id = String(a.id || "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 30) || "app";
    for (let i = 2; seen.has(id); i++) id = `${String(a.id || "app").slice(0, 26)}-${i}`;
    seen.add(id);
    const url = String(a.url || "").trim().slice(0, 300);
    if (url && !/^https:\/\//.test(url)) fail(400, "رابط البرنامج لازم يبدأ بـ https://");
    return {
      id, name, desc: String(a.desc || "").trim().slice(0, 300), button: String(a.button || "").trim().slice(0, 40), url,
      login: String(a.login || "").trim().slice(0, 400), message: String(a.message || "").trim().slice(0, 500),
      places: (Array.isArray(a.places) ? a.places : []).filter((x) => DEMO_PLACES.includes(x)),
      courses: (Array.isArray(a.courses) ? a.courses : []).map(Number).filter(Boolean),
      open: !!a.open, visible: a.visible !== false,
    };
  });
}

// الباقة: full = بتفتح محتوى Pro (الفيديوهات)، apps = برامج الـ Demo اللي فيها. الكود pro بيفتح كل حاجة دايماً (زي الأول)
async function planOf(db, courseId, code) {
  const p = await db.prepare("SELECT * FROM plans WHERE course_id = ? AND code = ?").bind(courseId, code).first();
  return { code, name: p ? p.name : code, full: code === "pro" || !!(p && p.full_access), apps: p ? parseJSON(p.apps, []) : [] };
}

function publicPlan(p) {
  const info = priceInfo(p);
  return {
    code: p.code, name: p.name, features: parseJSON(p.features, []), show_price: !!p.show_price,
    ...(p.show_price ? info : {}),
  };
}

// ---------- حالة المتدرب في كورس ----------
async function courseState(db, userId, course, plan) {
  const [{ results: levels }, { results: exams }, { results: materials }, { results: done }, { results: best }, unit, unlock] = await Promise.all([
    db.prepare("SELECT id, num, title, topics, teaser FROM levels WHERE course_id = ? ORDER BY num").bind(course.id).all(),
    db.prepare(`SELECT e.id, e.kind, e.after_level, e.title, e.question_count, e.pass_pct, e.duration_min,
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
    unitOf(db, course.id),
    unlockOf(db, course.id),
  ]);
  const full = (await planOf(db, course.id, plan)).full;
  const free = unlock === "open";
  const doneSet = new Set(done.map((d) => d.material_id));
  const bestBy = Object.fromEntries(best.map((b) => [b.exam_id, b]));
  // المستوى الجاي بيفتح بس لما المتدرب ينجح في امتحان المستوى اللي قبله (والتراكمي لو موجود)
  const examPassed = (e) => !e || !!(bestBy[e.id] && bestBy[e.id].passed);
  const levelExam = (n) => exams.find((e) => e.kind === "level" && e.after_level === n);
  const cumBefore = (n) => exams.filter((e) => e.kind === "cumulative" && e.after_level < n);
  // في الكورس المفتوح: التراكمي بيفتح لما المتدرب ينجح في امتحانات كل الوحدات اللي بيغطيها
  const levelsUpTo = (n) => exams.filter((e) => e.kind === "level" && e.after_level <= n).every(examPassed);

  const shapeExam = (e, available, waiting = null) => e && ({
    id: e.id, kind: e.kind, title: e.title, after_level: e.after_level, pass_pct: e.pass_pct, duration_min: e.duration_min,
    waiting, // ليه الامتحان لسه مقفول: materials = لسه ما خلصش المادة العلمية
    questions: Math.min(e.question_count, e.bank), ready: e.bank > 0, available,
    passed: !!(bestBy[e.id] && bestBy[e.id].passed), best: bestBy[e.id] ? bestBy[e.id].best : null,
    first: bestBy[e.id] ? bestBy[e.id].first : null, tries: bestBy[e.id] ? bestBy[e.id].tries : 0,
  });

  let doneCount = 0, total = 0, prevUnlocked = true;
  const outLevels = levels.map((l) => {
    const unlocked = free || l.num === 1 || (prevUnlocked && examPassed(levelExam(l.num - 1)) && cumBefore(l.num).every(examPassed));
    prevUnlocked = unlocked;
    // الفصول بتفتح بالترتيب: الفصل مايفتحش غير لما المتدرب يخلص اللي قبله (اللي في باقته واترفع فعلاً)
    let chainOpen = true;
    const mats = materials.filter((m) => m.level_id === l.id).map((m) => {
      const allowed = m.min_plan === "basic" || full;
      const isDone = doneSet.has(m.id);
      const ready = !(m.kind === "pdf" && !m.pages);
      if (allowed) { total++; if (isDone) doneCount++; }
      const open = allowed && (free || chainOpen);
      if (allowed && ready && !isDone) chainOpen = false;
      return { id: m.id, kind: m.kind, title: m.title, min_plan: m.min_plan, pages: m.pages, allowed, open, done: isDone };
    });
    // امتحان المستوى بيفتح بعد ما المتدرب يخلص كل المادة الجاهزة اللي في باقته
    const matsDone = mats.every((m) => !m.allowed || m.done || (m.kind === "pdf" && !m.pages));
    const ex = levelExam(l.num);
    if (ex) { total++; if (examPassed(ex)) doneCount++; }
    const cum = exams.find((e) => e.kind === "cumulative" && e.after_level === l.num);
    if (cum) { total++; if (examPassed(cum)) doneCount++; }
    const status = !unlocked ? "locked" : (ex && examPassed(ex) ? "done" : "open");
    return {
      ...l, unlocked, status, materials: mats,
      materials_done: matsDone,
      exam: shapeExam(ex, unlocked && matsDone, unlocked && !matsDone ? "materials" : null),
      cumulative: shapeExam(cum, free ? levelsUpTo(l.num) : unlocked && examPassed(ex) && cumBefore(l.num).every(examPassed)),
    };
  });
  const completed = levels.length > 0 && exams.length > 0 && exams.every(examPassed);
  // الكورس المفتوح: الوحدة الحالية = أول وحدة لسه ما خلصهاش
  const current = free ? (outLevels.find((l) => l.status !== "done") || outLevels[outLevels.length - 1]) : outLevels.filter((l) => l.unlocked).pop();
  return {
    unit,
    unlock,
    levels: outLevels,
    progress: total ? Math.round((doneCount / total) * 100) : 0,
    completed,
    current_level: current ? current.num : 1,
  };
}

// جدول الامتحانات بالترتيب + الخطوة الجاية للمتدرب (للداشبورد)
function courseSummary(st) {
  const exams = [];
  for (const l of st.levels) {
    for (const e of [l.exam, l.cumulative]) {
      if (!e) continue;
      const status = e.passed ? "passed" : !e.ready ? "not_ready" : e.available ? (e.tries ? "failed" : "ready")
        : e.waiting === "materials" ? "materials" : "locked";
      exams.push({ n: exams.length + 1, id: e.id, title: e.title, kind: e.kind, level_id: l.id, level_num: l.num,
        tries: e.tries, first: e.first, best: e.best, status });
    }
  }
  const tried = exams.filter((e) => e.tries);
  const avg = tried.length ? Math.round((tried.reduce((a, e) => a + e.best, 0) / tried.length) * 10) / 10 : null;

  let next = null;
  const cur = st.levels.find((l) => l.num === st.current_level);
  const U = st.unit;
  if (st.completed) next = { type: "certificate", label: "خلصت الكورس، استلم شهادتك" };
  else if (cur) {
    const mat = cur.materials.find((m) => m.allowed && !m.done && !(m.kind === "pdf" && !m.pages));
    const cum = cur.cumulative && cur.cumulative.available && cur.cumulative.ready && !cur.cumulative.passed ? cur.cumulative : null;
    if (mat) next = { type: "material", level_id: cur.id, material_id: mat.id, label: `كمل "${mat.title}" في ${U.the} ${cur.num}` };
    else if (cur.exam && cur.exam.available && cur.exam.ready && !cur.exam.passed) next = { type: "exam", level_id: cur.id, exam_id: cur.exam.id, label: `ادخل امتحان ${U.the} ${cur.num}` };
    else if (cum) next = { type: "exam", level_id: cur.id, exam_id: cum.id, label: `ادخل ${cum.title}` };
    else next = { type: "level", level_id: cur.id, label: cur.materials.length ? `كمل ${U.the} ${cur.num}: ${cur.title}` : `${U.the} ${cur.num}: ${cur.title} (المادة بتتجهز وهتنزل قريب)` };
  }
  return {
    exams,
    summary: { total: exams.length, passed: exams.filter((e) => e.status === "passed").length, tried: tried.length, avg_best: avg },
    next,
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
  if (!e.active) fail(403, "اشتراكك في الكورس ده انتهى. كلم خدمة العملاء على واتساب علشان تجدده.");
  return e;
}

async function levelWithCourse(db, levelId) {
  const l = await db.prepare(`SELECT l.*, c.slug, c.title AS course_title, c.id AS cid, c.status AS course_status
                              FROM levels l JOIN courses c ON c.id = l.course_id WHERE l.id = ?`).bind(levelId).first();
  if (!l) fail(404, "الصفحة دي مش موجودة.");
  return l;
}

// =====================================================================
// عام (من غير دخول)
// =====================================================================
const courseCard = (c) => ({
  track: c.track || "accounting", audiences: splitList(c.audiences), tools: splitList(c.tools), outcome: c.outcome || "",
});

route("GET", "/public/site", async ({ db }) => {
  const s = await getSettings(db);
  const { results: courses } = await db.prepare("SELECT * FROM courses WHERE status != 'hidden' ORDER BY sort, id").all();
  const { results: plans } = await db.prepare("SELECT * FROM plans WHERE visible = 1 ORDER BY sort, id").all();
  const { results: counts } = await db.prepare("SELECT course_id, COUNT(*) AS n FROM levels GROUP BY course_id").all();
  // الفصول المجانية في كل الكورسات، علشان قسم "جرّب قبل ما تشترك" في الصفحة الرئيسية
  const { results: free } = await db.prepare(`SELECT m.id, m.title, m.pages, l.num, c.slug, c.title AS course FROM materials m
      JOIN levels l ON l.id = m.level_id JOIN courses c ON c.id = l.course_id
      WHERE m.free = 1 AND m.kind = 'pdf' AND m.pages > 0 AND c.status != 'hidden' ORDER BY c.sort, l.num, m.sort, m.id`).all();
  const nBy = Object.fromEntries(counts.map((c) => [c.course_id, c.n]));
  // أرقام حقيقية للصفحة الرئيسية: الكورسات المفتوحة ووحداتها وأسئلتها
  const openIds = courses.filter((c) => c.status === "open").map((c) => c.id);
  const q = openIds.length ? await db.prepare(`SELECT COUNT(*) AS n FROM questions q JOIN exams e ON e.id = q.exam_id WHERE e.course_id IN (${openIds.map(() => "?").join(",")})`).bind(...openIds).first() : { n: 0 };
  return json({
    numbers: { courses: openIds.length, levels: openIds.reduce((a, id) => a + (nBy[id] || 0), 0), questions: q.n },
    settings: Object.fromEntries(PUBLIC_SETTINGS.map((k) => [k, s[k] || ""])),
    has_cert_bg: !!s.cert_bg,
    tracks: parseTracks(s),
    audiences: AUDIENCES,
    courses: courses.map((c) => ({
      slug: c.slug, title: c.title, subtitle: c.subtitle, status: c.status, levels: nBy[c.id] || 0, unit: unitFrom(s, c.id),
      ...courseCard(c), lecturers: publicLecturers(s, c.id),
      plans: plans.filter((p) => p.course_id === c.id).map(publicPlan),
    })),
    free,
    demos: demoAppsOf(s).filter((a) => a.visible !== false && a.open).map((a) => publicDemo(a, courses)),
  });
});

route("GET", "/public/course/:slug", async ({ db, params }) => {
  const c = await db.prepare("SELECT * FROM courses WHERE slug = ? AND status != 'hidden'").bind(params.slug).first();
  if (!c) fail(404, "الكورس ده مش موجود.");
  const { results: levels } = await db.prepare("SELECT num, title, topics, teaser FROM levels WHERE course_id = ? ORDER BY num").bind(c.id).all();
  const { results: plans } = await db.prepare("SELECT * FROM plans WHERE course_id = ? AND visible = 1 ORDER BY sort, id").bind(c.id).all();
  const { results: exams } = await db.prepare("SELECT kind, after_level, title, pass_pct FROM exams WHERE course_id = ? ORDER BY after_level, kind DESC").bind(c.id).all();
  // أسامي الفصول بس (من غير محتوى) علشان الزائر يشوف الكورس فيه إيه، والمجاني منها يتفتح للتجربة
  const { results: mats } = await db.prepare(`SELECT m.id, l.num, m.kind, m.title, m.pages, m.min_plan, m.free FROM materials m
                                              JOIN levels l ON l.id = m.level_id WHERE l.course_id = ? ORDER BY m.sort, m.id`).bind(c.id).all();
  const s = await getSettings(db);
  const track = parseTracks(s).find((t) => t.key === c.track);
  return json({
    course: { slug: c.slug, title: c.title, subtitle: c.subtitle, intro: c.intro, audience: c.audience, status: c.status, unit: unitFrom(s, c.id),
      ...courseCard(c), track_name: track ? track.name : "", lecturers: publicLecturers(s, c.id) },
    levels: levels.map((l) => ({
      ...l,
      materials: mats.filter((m) => m.num === l.num).map((m) => ({
        id: m.id, kind: m.kind, title: m.title, pages: m.pages, min_plan: m.min_plan,
        free: !!(m.free && m.kind === "pdf" && m.pages),
      })),
    })),
    plans: plans.map(publicPlan), exams,
  });
});

// =====================================================================
// الزائر السريع: اسم ورقم واتساب من غير باسورد، والجهاز بيفتكره بكوكي
// =====================================================================
const VISITOR_COOKIE = "ik_visitor";
function visitorCookie(token, request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${VISITOR_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${365 * 86400}${secure}`;
}
async function currentVisitor(db, request) {
  const token = readCookie(request, VISITOR_COOKIE);
  if (!token) return null;
  return db.prepare(`SELECT v.* FROM visitor_sessions s JOIN visitors v ON v.id = s.visitor_id WHERE s.token_hash = ?`).bind(await sha256(token)).first();
}
// حدث واحد لكل (زائر، نوع، حاجة): فتح فصل، تحميل ملف، بلغني، تواصل
async function visitorEvent(db, v, kind, ref) {
  const seen = await db.prepare("SELECT 1 FROM visitor_events WHERE visitor_id = ? AND kind = ? AND IFNULL(ref, '') = ?").bind(v.id, kind, ref || "").first();
  if (!seen) await db.prepare("INSERT INTO visitor_events (visitor_id, kind, ref, source) VALUES (?, ?, ?, ?)").bind(v.id, kind, ref || null, v.source || null).run();
  await db.prepare("UPDATE visitors SET last_seen = datetime('now') WHERE id = ?").bind(v.id).run();
}
// مين اللي بيطلب: متدرب/أدمن داخل، أو زائر سريع، أو حد مش معروف
async function whoIs(db, request) {
  const [user, visitor] = await Promise.all([currentUser(db, request), currentVisitor(db, request)]);
  return { user, visitor };
}
const needVisitor = () => fail(403, "سجّل دخول سريع كزائر الأول، ده مجاني ومن غير باسورد.");
const EVENT_KINDS = ["contact", "notify", "file", "chapter", "demo"];

route("GET", "/public/visitor", async ({ db, request }) => {
  const { user, visitor } = await whoIs(db, request);
  return json({
    visitor: visitor ? { name: visitor.name, phone: visitor.phone, marketing: !!visitor.consent_marketing } : null,
    user: user ? { name: user.name, phone: user.phone, role: user.role } : null,
  });
});

route("POST", "/public/visitor", async ({ db, request }) => {
  const b = await body(request);
  const name = String(b.name || "").trim().slice(0, 80);
  const phone = normalizePhone(b.phone);
  if (name.length < 2) fail(400, "اكتب اسمك علشان نعرف نكلمك.");
  if (!phone) fail(400, "اكتب رقم واتساب صحيح، مثلاً 01012345678.");
  if (!b.service) fail(400, "علّم على الموافقة علشان نقدر نفتحلك الملفات.");
  const marketing = b.marketing ? 1 : 0;
  const source = cleanSource(b.source) || "direct";
  const utm = b.utm && typeof b.utm === "object" ? JSON.stringify(b.utm).slice(0, 500) : null;
  const landing = String(b.landing || "").slice(0, 200) || null;
  let v = await db.prepare("SELECT * FROM visitors WHERE phone = ?").bind(phone).first();
  if (v) {
    // الموافقة التسويقية = آخر اختيار ليه، والمصدر = أول مرة جه فيها
    await db.prepare(`UPDATE visitors SET name = ?, consent_service = 1, consent_marketing = ?, consent_at = datetime('now'), last_seen = datetime('now'),
                      source = COALESCE(source, ?), utm = COALESCE(utm, ?), landing = COALESCE(landing, ?) WHERE id = ?`)
      .bind(name, marketing, source, utm, landing, v.id).run();
    v = { ...v, name, source: v.source || source };
  } else {
    v = await db.prepare(`INSERT INTO visitors (name, phone, consent_service, consent_marketing, consent_at, source, utm, landing, last_seen)
                          VALUES (?, ?, 1, ?, datetime('now'), ?, ?, ?, datetime('now')) RETURNING *`).bind(name, phone, marketing, source, utm, landing).first();
    await bump(db, "visitor_new", source);
  }
  const token = randomToken();
  await db.prepare("INSERT INTO visitor_sessions (token_hash, visitor_id) VALUES (?, ?)").bind(await sha256(token), v.id).run();
  const item = b.item || {};
  if (EVENT_KINDS.includes(item.kind)) await visitorEvent(db, v, item.kind, String(item.ref || "").slice(0, 120));
  return json({ ok: true, visitor: { name: v.name, phone, marketing: !!marketing } }, 200, { "set-cookie": visitorCookie(token, request) });
});

// "بلغني أول ما يفتح": بيتسجل باسم الزائر ورقمه، والأدمن بيشوف القايمة لكل كورس
route("POST", "/public/notify", async ({ db, request }) => {
  const b = await body(request);
  const c = await db.prepare("SELECT slug FROM courses WHERE slug = ? AND status != 'hidden'").bind(String(b.slug || "")).first();
  if (!c) fail(404, "الكورس ده مش موجود.");
  const v = await currentVisitor(db, request);
  if (!v) needVisitor();
  await visitorEvent(db, v, "notify", c.slug);
  await bump(db, "wa_notify", c.slug);
  return json({ ok: true });
});

// طلب Demo لبرنامج: بيتسجل باسم الزائر (أو المتدرب) علشان الأدمن يبعتله بيانات الدخول على واتساب
route("POST", "/public/demo/:id", async ({ db, request, params }) => {
  const s = await getSettings(db);
  const a = demoAppsOf(s).find((x) => x.id === params.id && x.visible !== false);
  if (!a) fail(404, "البرنامج ده مش متاح دلوقتي.");
  const { user, visitor } = await whoIs(db, request);
  if (!user && !visitor) needVisitor();
  if (!a.open && !user) fail(403, "الـ Demo ده للمشتركين بس.");
  if (visitor && !user) await visitorEvent(db, visitor, "demo", a.id);
  if (user) {
    // المتدرب بيتسجل كزائر بنفس رقمه علشان طلبه يظهر في قايمة الطلبات
    const phone = user.phone || "";
    if (phone) {
      let v = await db.prepare("SELECT * FROM visitors WHERE phone = ?").bind(phone).first();
      if (!v) v = await db.prepare("INSERT INTO visitors (name, phone, consent_service, consent_at, source, last_seen) VALUES (?, ?, 1, datetime('now'), ?, datetime('now')) RETURNING *")
        .bind(user.name, phone, user.source || "student").first();
      if (user.role !== "admin") await visitorEvent(db, v, "demo", a.id);
    }
  }
  if (!user || user.role !== "admin") await bump(db, "demo_req", a.id);
  return json({ ok: true });
});

// الفصول المجانية للتجربة: بتتفتح للزائر السريع أو المتدرب، والسيرفر بيرفض أي فصل مش متعلّم عليه "مجاني"
async function freeMaterial(db, id) {
  const m = await db.prepare(`SELECT m.id, m.title, m.pages, m.version, c.slug FROM materials m JOIN levels l ON l.id = m.level_id
                              JOIN courses c ON c.id = l.course_id
                              WHERE m.id = ? AND m.free = 1 AND m.kind = 'pdf' AND m.pages > 0 AND c.status != 'hidden'`).bind(id).first();
  if (!m) fail(403, "الفصل ده للمشتركين بس. اشترك علشان تفتحه.");
  return m;
}

route("GET", "/public/materials/:id", async ({ db, params, request }) => {
  const m = await freeMaterial(db, params.id);
  const { user, visitor } = await whoIs(db, request);
  if (!user && !visitor) needVisitor();
  if (visitor) await visitorEvent(db, visitor, "chapter", String(m.id));
  if (!user || user.role !== "admin") await bump(db, "free_open", String(m.id));
  return json({ id: m.id, title: m.title, pages: m.pages, course: m.slug });
});

route("GET", "/public/materials/:id/pages/:n", async ({ db, params, request }) => {
  const m = await freeMaterial(db, params.id);
  const { user, visitor } = await whoIs(db, request);
  if (!user && !visitor) needVisitor();
  const n = parseInt(params.n, 10);
  if (!(n >= 1 && n <= m.pages)) fail(404, "الصفحة دي مش موجودة.");
  const f = await getFile(db, `m/${m.id}/v${m.version}/${n}.webp`);
  if (!f) fail(404, "الصفحة دي مش موجودة.");
  return new Response(f.data, { headers: { "content-type": "image/webp", "cache-control": "private, no-store", "content-disposition": "inline" } });
});

// =====================================================================
// مكتبة IK: ملفات مجانية للزوار، ومدفوعة بتتفعل للمتدرب، وملفات ضمن كورس للمشتركين
// =====================================================================
const LIB_FIELDS = "f.id, f.title, f.description, f.track, f.subcat, f.audiences, f.access, f.price, f.course_id, f.related_course_id, f.file_name, f.mime, f.size, f.sort";
const publicFile = (f, courses) => {
  const cBy = Object.fromEntries(courses.map((c) => [c.id, c]));
  const course = cBy[f.course_id], related = cBy[f.related_course_id];
  return {
    id: f.id, title: f.title, description: f.description || "", track: f.track, subcat: f.subcat || "", audiences: splitList(f.audiences),
    access: f.access, price: f.access === "paid" ? f.price : 0, size: f.size, ext: (String(f.file_name || "").match(/\.([a-z0-9]+)$/i) || [])[1] || "",
    course: course && course.status !== "hidden" ? { slug: course.slug, title: course.title } : null,
    related: related && related.status !== "hidden" ? { slug: related.slug, title: related.title } : null,
  };
};

async function canDownload(db, f, user, visitor) {
  if (user && user.role === "admin") return true;
  if (f.access === "free") return !!(user || visitor);
  if (!user) return false;
  if (f.access === "paid") return !!(await db.prepare("SELECT 1 FROM library_grants WHERE user_id = ? AND file_id = ?").bind(user.id, f.id).first());
  const e = f.course_id && (await enrollmentFor(db, user.id, f.course_id));
  return !!(e && e.active);
}

route("GET", "/public/library", async ({ db, request }) => {
  const [{ results: files }, { results: courses }, who] = await Promise.all([
    db.prepare(`SELECT ${LIB_FIELDS} FROM library_files f WHERE f.visible = 1 AND f.chunks > 0 ORDER BY f.sort, f.id DESC`).all(),
    db.prepare("SELECT id, slug, title, status FROM courses").all(),
    whoIs(db, request),
  ]);
  const out = [];
  for (const f of files) {
    // الملف اللي ضمن كورس مخفي مايظهرش للزوار خالص
    if (f.access === "course" && !(courses.find((c) => c.id === f.course_id && c.status !== "hidden"))) continue;
    out.push({ ...publicFile(f, courses), can: await canDownload(db, f, who.user, who.visitor) });
  }
  return json({ files: out, known: !!(who.user || who.visitor) });
});

route("GET", "/public/library/:id/download", async ({ db, request, params }) => {
  const f = await db.prepare("SELECT * FROM library_files WHERE id = ? AND chunks > 0").bind(params.id).first();
  if (!f || (!f.visible)) fail(404, "الملف ده مش موجود.");
  const { user, visitor } = await whoIs(db, request);
  if (!(await canDownload(db, f, user, visitor))) {
    if (f.access === "free") needVisitor();
    if (f.access === "paid") fail(403, user ? "الملف ده مدفوع ولسه ما اتفعلش على حسابك. كلم خدمة العملاء على واتساب." : "الملف ده مدفوع. بعد الدفع بيتفعل على حسابك في المنصة وتحمله من هنا.");
    fail(403, "الملف ده للمشتركين في الكورس بتاعه بس.");
  }
  const parts = [];
  let total = 0;
  for (let n = 1; n <= f.chunks; n++) {
    const part = await getFile(db, `lib/${f.id}/v${f.version}/${n}`);
    if (!part) fail(500, "الملف ناقص. كلم الدعم الفني.");
    parts.push(part.data); total += part.data.byteLength;
  }
  const data = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { data.set(p, at); at += p.byteLength; }
  // اسم اللي حمّل بيتحط في اسم الملف
  const who = (user && user.role !== "admin" ? user.name : visitor ? visitor.name : "").replace(/[\\/:*?"<>|]/g, "").trim();
  const m = String(f.file_name || "file").match(/^(.*?)(\.[a-z0-9]+)?$/i);
  const name = (m[1] || "file") + (who ? " - " + who : "") + (m[2] || "");
  if (visitor && !(user && user.role === "admin")) await visitorEvent(db, visitor, "file", String(f.id));
  if (!user || user.role !== "admin") await bump(db, "file_dl", String(f.id));
  return new Response(data, { headers: {
    "content-type": f.mime || "application/octet-stream", "cache-control": "private, no-store",
    "content-disposition": `attachment; filename="file${m[2] || ""}"; filename*=UTF-8''${encodeURIComponent(name)}`,
  } });
});

// ---------- الإحصائيات: عداد واحد لكل (يوم، نوع، كورس) من غير أي خدمة خارجية ----------
// visit_src = زيارة من مصدر (فيسبوك ...)، sub_src = ضغطة اشترك من مصدر
const TRACK_KINDS = ["home_view", "course_view", "wa_subscribe", "wa_notify", "visit_src", "sub_src", "library_view"];
const bump = (db, kind, ref = "") => db.prepare(`INSERT INTO stats (day, kind, ref, n) VALUES (?, ?, ?, 1)
                                                 ON CONFLICT (day, kind, ref) DO UPDATE SET n = n + 1`).bind(today(), kind, ref).run();

route("POST", "/public/track", async ({ db, request }) => {
  const b = await body(request);
  const ref = String(b.ref || "");
  if (!TRACK_KINDS.includes(b.kind) || !/^[a-z0-9-]{0,60}$/.test(ref)) fail(400, "بيانات غلط.");
  const u = await currentUser(db, request);
  if (!u || u.role !== "admin") await bump(db, b.kind, ref); // زيارات الأدمن مش بتتحسب
  return json({ ok: true });
});

// ---------- رابط التفعيل: المتدرب بيختار الباسورد بنفسه، والرابط صالح 48 ساعة ولمرة واحدة ----------
async function activationToken(db, token) {
  const t = await db.prepare(`SELECT a.*, u.name, u.phone, u.email, u.active FROM activation_tokens a JOIN users u ON u.id = a.user_id
                              WHERE a.token_hash = ?`).bind(await sha256(String(token || ""))).first();
  if (!t || t.used_at || t.expires_at < Date.now() || !t.active) fail(400, "الرابط ده انتهى أو اتستخدم قبل كده. كلم الدعم الفني على واتساب وهيبعتلك رابط جديد.");
  return t;
}

route("GET", "/public/activate/:token", async ({ db, params }) => {
  const t = await activationToken(db, params.token);
  return json({ name: t.name, login: t.phone || t.email });
});

route("POST", "/public/activate", async ({ db, request }) => {
  const b = await body(request);
  const t = await activationToken(db, b.token);
  validatePassword(b.password);
  await db.batch([
    db.prepare("UPDATE users SET pass_hash = ?, must_change = 0 WHERE id = ?").bind(await hashPassword(b.password), t.user_id),
    db.prepare("UPDATE activation_tokens SET used_at = datetime('now') WHERE token_hash = ?").bind(t.token_hash),
    db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(t.user_id),
  ]);
  const token = await createSession(db, t.user_id, request);
  await db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").bind(t.user_id).run();
  return json({ ok: true }, 200, { "set-cookie": sessionCookie(token, request) });
});

route("GET", "/public/verify/:code", async ({ db, params }) => {
  const r = await db.prepare(`SELECT c.code, c.issued_at, u.name, co.title AS course FROM certificates c
                              JOIN users u ON u.id = c.user_id JOIN courses co ON co.id = c.course_id WHERE c.code = ?`)
    .bind(params.code.toUpperCase()).first();
  if (!r) fail(404, "مفيش شهادة بالكود ده.");
  const s = await getSettings(db);
  return json({ ...r, issuer: s.cert_issuer || s.brand_name || "" });
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
  if (!u.active) fail(403, "الحساب ده موقوف. كلم الدعم الفني على واتساب.");
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
  const s = await getSettings(db);
  const apps = demoAppsOf(s).filter((a) => a.visible !== false);
  const mine = new Set();
  for (const e of enr) {
    const st = await courseState(db, user.id, { id: e.course_id }, e.plan_code);
    const cur = st.levels.find((l) => l.num === st.current_level);
    const p = await planOf(db, e.course_id, e.plan_code);
    if (!e.expires_at || e.expires_at >= today()) for (const id of p.apps) mine.add(id);
    courses.push({
      slug: e.slug, title: e.title, subtitle: e.subtitle, plan: e.plan_code, plan_name: p.name, plan_full: p.full, expires_at: e.expires_at,
      active: !e.expires_at || e.expires_at >= today(), progress: st.progress, completed: st.completed,
      current_level: st.current_level, current_title: cur ? cur.title : "", levels: st.levels.length, unit: st.unit,
      ...courseSummary(st), study: await studyTime(db, user.id, e.course_id),
    });
  }
  // برامج الـ Demo: اللي في باقته بيشوف الرابط وبيانات الدخول، والباقي (لو متاح للكل) بيطلبه
  const { results: cs } = await db.prepare("SELECT id, slug FROM courses").all();
  const demos = apps.filter((a) => mine.has(a.id) || (a.open && (a.places || []).includes("dashboard")))
    .map((a) => ({ ...publicDemo(a, cs), mine: mine.has(a.id), ...(mine.has(a.id) ? { url: a.url, login: a.login } : {}) }));
  return json({ user: { name: user.name, must_change: !!user.must_change }, courses, demos });
}, "user");

route("GET", "/student/course/:slug", async ({ db, user, params }) => {
  const c = await db.prepare("SELECT * FROM courses WHERE slug = ?").bind(params.slug).first();
  if (!c) fail(404, "الكورس ده مش موجود.");
  const e = await requireEnrollment(db, user, c.id);
  const st = await courseState(db, user.id, c, e.plan_code);
  const follow = followFor(await getSettings(db), c.id);
  return json({ course: { slug: c.slug, title: c.title, subtitle: c.subtitle }, plan: e.plan_code, expires_at: e.expires_at || null, follow, ...st });
}, "user");

route("GET", "/student/level/:id", async ({ db, user, params }) => {
  const l = await levelWithCourse(db, params.id);
  const e = await requireEnrollment(db, user, l.cid);
  const st = await courseState(db, user.id, { id: l.cid }, e.plan_code);
  const lv = st.levels.find((x) => x.id === l.id);
  if (!lv.unlocked && user.role !== "admin") fail(403, `${st.unit.this} لسه ${st.unit.closed}. اعدي امتحان ${st.unit.the} ${st.unit.before} الأول.`);
  const follow = followFor(await getSettings(db), l.cid);
  return json({ course: { slug: l.slug, title: l.course_title, unit: st.unit }, plan: e.plan_code, level: lv, total_levels: st.levels.length, follow });
}, "user");

async function materialForUser(db, user, materialId) {
  const m = await db.prepare("SELECT * FROM materials WHERE id = ?").bind(materialId).first();
  if (!m) fail(404, "المادة دي مش موجودة.");
  const l = await levelWithCourse(db, m.level_id);
  const e = await requireEnrollment(db, user, l.cid);
  if (user.role !== "admin") {
    const st = await courseState(db, user.id, { id: l.cid }, e.plan_code);
    const lv = st.levels.find((x) => x.id === l.id);
    if (!lv.unlocked) fail(403, `${st.unit.this} لسه ${st.unit.closed}.`);
    if (m.min_plan === "pro" && !(await planOf(db, l.cid, e.plan_code)).full) fail(403, "المادة دي مش ضمن باقتك.");
    const sm = lv.materials.find((x) => x.id === m.id);
    if (sm && !sm.open) fail(403, "الفصل ده هيفتح لما تخلص الفصل اللي قبله.");
  }
  return m;
}

route("GET", "/student/materials/:id", async ({ db, user, params }) => {
  const m = await materialForUser(db, user, params.id);
  const r = await db.prepare("SELECT page FROM reading WHERE user_id = ? AND material_id = ?").bind(user.id, m.id).first();
  const last = r ? Math.min(Math.max(1, r.page), Math.max(1, m.pages)) : 1;
  return json({ id: m.id, kind: m.kind, title: m.title, pages: m.pages, version: m.version, last_page: last,
    video_url: m.kind === "video" ? m.video_url : null });
}, "user");

// آخر صفحة المتدرب وقف عندها، علشان الملف يفتح عليها المرة الجاية من أي جهاز
route("PUT", "/student/materials/:id/position", async ({ db, user, request, params }) => {
  const m = await materialForUser(db, user, params.id);
  const page = parseInt((await body(request)).page, 10);
  if (!(page >= 1 && page <= m.pages)) fail(400, "رقم الصفحة غلط.");
  await db.prepare(`INSERT INTO reading (user_id, material_id, page) VALUES (?, ?, ?)
                    ON CONFLICT (user_id, material_id) DO UPDATE SET page = excluded.page, updated_at = datetime('now')`).bind(user.id, m.id, page).run();
  return json({ ok: true });
}, "user");

// وقت المذاكرة: الصفحة بتبعت نبضة كل دقيقة والفصل مفتوح والمتدرب شغال عليه، والسيرفر بيحسب دقيقة بس لو آخر نبضة من 50 ثانية أو أكتر
route("POST", "/student/materials/:id/time", async ({ db, user, params }) => {
  const m = await materialForUser(db, user, params.id);
  if (user.role === "admin") return json({ ok: true });
  try {
  await db.prepare(`INSERT INTO study_time (user_id, material_id, day, minutes, last_at) VALUES (?, ?, ?, 1, datetime('now'))
      ON CONFLICT (user_id, material_id, day) DO UPDATE SET
        minutes = minutes + (CASE WHEN last_at IS NULL OR last_at <= datetime('now', '-50 seconds') THEN 1 ELSE 0 END),
        last_at = CASE WHEN last_at IS NULL OR last_at <= datetime('now', '-50 seconds') THEN datetime('now') ELSE last_at END`)
    .bind(user.id, m.id, today()).run();
  } catch (e) { /* الجدول لسه ما اتعملش في D1 */ }
  return json({ ok: true });
}, "user");

// إجمالي دقايق المذاكرة في كورس: الكل، وآخر 7 أيام، ولكل فصل ولكل مستوى
// لو جدول study_time لسه ما اتعملش في D1 بترجع null والصفحات بتشتغل عادي
async function studyTime(db, userId, courseId) {
  try {
    const { results } = await db.prepare(`SELECT t.material_id, m.level_id, SUM(t.minutes) AS total,
        SUM(CASE WHEN t.day >= date('now', '-6 days') THEN t.minutes ELSE 0 END) AS week
        FROM study_time t JOIN materials m ON m.id = t.material_id JOIN levels l ON l.id = m.level_id
        WHERE t.user_id = ? AND l.course_id = ? GROUP BY t.material_id`).bind(userId, courseId).all();
    const out = { total: 0, week: 0, by_material: {}, by_level: {} };
    for (const r of results) {
      out.total += r.total; out.week += r.week;
      out.by_material[r.material_id] = r.total;
      out.by_level[r.level_id] = (out.by_level[r.level_id] || 0) + r.total;
    }
    return out;
  } catch (e) { return null; }
}

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
  return { ex, shaped, course: { ...c, unit: st.unit }, level: lv };
}

route("GET", "/student/exams/:id", async ({ db, user, params }) => {
  const { shaped, course, level } = await examForUser(db, user, params.id);
  return json({ exam: shaped, course, level: { id: level.id, num: level.num, title: level.title } });
}, "user");

route("POST", "/student/exams/:id/start", async ({ db, user, params }) => {
  const { ex, shaped } = await examForUser(db, user, params.id);
  const [{ results: bank }, { results: prev }] = await Promise.all([
    db.prepare("SELECT id, body, options FROM questions WHERE exam_id = ?").bind(ex.id).all(),
    db.prepare("SELECT question_ids FROM attempts WHERE user_id = ? AND exam_id = ?").bind(user.id, ex.id).all(),
  ]);
  // تدوير الأسئلة: اللي ظهر للمتدرب أقل عدد مرات بييجي الأول، وبعد ما البنك كله يخلص الدور بيبدأ من جديد
  const seen = {};
  for (const a of prev) for (const p of parseJSON(a.question_ids, [])) seen[p.id] = (seen[p.id] || 0) + 1;
  const picked = shuffle(bank).sort((a, b) => (seen[a.id] || 0) - (seen[b.id] || 0)).slice(0, shaped.questions);
  const plan = picked.map((q) => ({ id: q.id, order: shuffle(parseJSON(q.options, []).map((_, i) => i)) }));
  const r = await db.prepare("INSERT INTO attempts (user_id, exam_id, question_ids) VALUES (?, ?, ?) RETURNING id")
    .bind(user.id, ex.id, JSON.stringify(plan)).first();
  const byId = Object.fromEntries(picked.map((q) => [q.id, q]));
  return json({
    attempt: r.id,
    duration_min: ex.duration_min || 0,
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
    ? await db.prepare(`SELECT id, body, options, answer, explanation FROM questions WHERE id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all()
    : { results: [] };
  const qBy = Object.fromEntries(qs.map((q) => [q.id, q]));
  const ex = await db.prepare("SELECT pass_pct, duration_min FROM exams WHERE id = ?").bind(a.exam_id).first();
  // الوقت بيتحسب من السيرفر كمان. دقيقة ونص سماح للنت البطيء، وبعدها الإجابات مش بتتحسب
  const late = ex.duration_min > 0 && Date.now() - sqlTime(a.started_at) > (ex.duration_min * 60 + 90) * 1000;
  let correct = 0;
  const review = [];
  for (const [i, p] of plan.entries()) {
    const q = qBy[p.id];
    if (!q) continue; // سؤال اتمسح من البنك بعد ما المحاولة بدأت
    const raw = late ? undefined : answers[p.id];
    const chosen = raw === undefined || raw === null || raw === "" ? null : Number(raw);
    const right = p.order.indexOf(q.answer);
    if (chosen !== null && chosen === right) correct++;
    const opts = parseJSON(q.options, []);
    review.push({ n: i + 1, body: q.body, options: p.order.map((k) => opts[k]), chosen, correct: right, explanation: q.explanation || "" });
  }
  const total = plan.length;
  const score = total ? Math.round((correct / total) * 1000) / 10 : 0;
  const passed = score >= ex.pass_pct ? 1 : 0; // النجاح = نسبة النجاح أو أكتر
  await db.prepare("UPDATE attempts SET score = ?, passed = ?, submitted_at = datetime('now') WHERE id = ?").bind(score, passed, a.id).run();
  return json({ score, passed: !!passed, correct, total, pass_pct: ex.pass_pct, late, review });
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
  return json(certPayload(await getSettings(db), c, { code: cert.code, issued_at: cert.issued_at, name: user.name }));
}, "user");

// شكل الشهادة: الديباجة من الإعدادات + سطر الكورس الإضافي (cert_note_<id>) + توقيع محاضر الكورس لو متسجل، وإلا التوقيع العام
function certPayload(s, c, cert) {
  const lec = courseLecturers(s, c.id).find((x) => x.signature);
  const texts = Object.fromEntries(CERT_TEXT_KEYS.map((k) => [k.replace("cert_", ""), s[k] || CERT_TEXTS[k]]));
  return { ...cert, course: c.title, note: s["cert_note_" + c.id] || "", texts, signature: (lec && lec.signature) || s.cert_signature || "",
    issuer: s.cert_issuer || s.brand_name || "", has_bg: !!s.cert_bg };
}

// معاينة الشهادة للأدمن باسم وكود تجريبيين، من غير ما تتسجل شهادة حقيقية
route("GET", "/admin/certificate-preview/:slug", async ({ db, params }) => {
  const c = await db.prepare("SELECT * FROM courses WHERE slug = ?").bind(params.slug).first();
  if (!c) fail(404, "الكورس ده مش موجود.");
  return json({ ...certPayload(await getSettings(db), c, { code: "IK-PREVIEW", issued_at: today(), name: "اسم المتدرب هنا" }), preview: true });
}, "admin");

// ملفاتي: الملفات المدفوعة المتفعلة على الحساب + ملفات الكورسات المشترك فيها
route("GET", "/student/library", async ({ db, user }) => {
  const [{ results: files }, { results: courses }] = await Promise.all([
    db.prepare(`SELECT ${LIB_FIELDS} FROM library_files f WHERE f.visible = 1 AND f.chunks > 0 AND (
        (f.access = 'paid' AND EXISTS (SELECT 1 FROM library_grants g WHERE g.file_id = f.id AND g.user_id = ?1))
        OR (f.access = 'course' AND EXISTS (SELECT 1 FROM enrollments e WHERE e.course_id = f.course_id AND e.user_id = ?1
            AND (e.expires_at IS NULL OR e.expires_at >= date('now'))))) ORDER BY f.sort, f.id DESC`).bind(user.id).all(),
    db.prepare("SELECT id, slug, title, status FROM courses").all(),
  ]);
  return json(files.map((f) => publicFile(f, courses)));
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
  const { results } = await db.prepare(`SELECT u.id, u.name, u.email, u.phone, u.active, u.notes, u.created_at, u.last_login, u.must_change, u.source
      FROM users u WHERE u.role = 'student' AND (u.name LIKE ?1 OR IFNULL(u.email,'') LIKE ?1 OR IFNULL(u.phone,'') LIKE ?1)
      ORDER BY u.id DESC LIMIT 500`).bind(q).all();
  const [{ results: enr }, { results: grants }] = await Promise.all([
    db.prepare(`SELECT e.user_id, e.course_id, e.plan_code, e.expires_at, c.title, c.slug FROM enrollments e JOIN courses c ON c.id = e.course_id`).all(),
    db.prepare("SELECT user_id, file_id FROM library_grants").all(),
  ]);
  return json(results.map((u) => ({ ...u, enrollments: enr.filter((e) => e.user_id === u.id), files: grants.filter((g) => g.user_id === u.id).map((g) => g.file_id) })));
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
  if (!partial || b.source !== undefined) out.source = cleanSource(b.source) || null;
  return out;
}

route("POST", "/admin/students", async ({ db, request }) => {
  const b = await body(request);
  const f = studentFields(b);
  if (!f.email && !f.phone) fail(400, "لازم ميل أو رقم تليفون علشان المتدرب يدخل بيه.");
  // من غير باسورد: بيتعمل باسورد عشوائي محدش يعرفه، والمتدرب بيختار بتاعه من رابط التفعيل
  const password = b.password ? String(b.password) : randomToken(12);
  validatePassword(password);
  // لو كان زائر سريع قبل كده بنفس الرقم، مصدره بيتنقل معاه
  if (!f.source && f.phone) {
    const v = await db.prepare("SELECT source FROM visitors WHERE phone = ?").bind(f.phone).first();
    f.source = v && v.source && v.source !== "direct" ? v.source : f.source;
  }
  const r = await db.prepare("INSERT INTO users (name, email, phone, pass_hash, notes, must_change, source) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id")
    .bind(f.name, f.email, f.phone, await hashPassword(password), b.notes || null, b.must_change === false ? 0 : 1, f.source).first();
  if (b.course_slug) await upsertEnrollment(db, r.id, b);
  return json({ ok: true, id: r.id, source: f.source || "" });
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

// رابط تفعيل جديد (أي رابط قديم لسه ما اتستخدمش بيتلغي)
route("POST", "/admin/students/:id/activation", async ({ db, params, url }) => {
  const u = await db.prepare("SELECT id FROM users WHERE id = ? AND role = 'student'").bind(params.id).first();
  if (!u) fail(404, "المتدرب ده مش موجود.");
  const token = randomToken(24), expires = Date.now() + 48 * 3600e3;
  await db.batch([
    db.prepare("DELETE FROM activation_tokens WHERE user_id = ? AND used_at IS NULL").bind(u.id),
    db.prepare("INSERT INTO activation_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)").bind(await sha256(token), u.id, expires),
  ]);
  return json({ link: `${url.origin}/activate?t=${token}`, expires_at: new Date(expires).toISOString() });
}, "admin");

// تفعيل ملف مدفوع من المكتبة لمتدرب، أو إلغاؤه
route("PUT", "/admin/students/:id/library/:file", async ({ db, params }) => {
  await db.prepare("INSERT OR IGNORE INTO library_grants (user_id, file_id) VALUES (?, ?)").bind(params.id, params.file).run();
  return json({ ok: true });
}, "admin");
route("DELETE", "/admin/students/:id/library/:file", async ({ db, params }) => {
  await db.prepare("DELETE FROM library_grants WHERE user_id = ? AND file_id = ?").bind(params.id, params.file).run();
  return json({ ok: true });
}, "admin");

route("DELETE", "/admin/students/:id", async ({ db, params }) => {
  await db.prepare("DELETE FROM users WHERE id = ? AND role = 'student'").bind(params.id).run();
  return json({ ok: true });
}, "admin");

async function upsertEnrollment(db, userId, b) {
  const c = await db.prepare("SELECT id FROM courses WHERE slug = ?").bind(b.course_slug).first();
  if (!c) fail(400, "الكورس ده مش موجود.");
  const p = await db.prepare("SELECT code FROM plans WHERE course_id = ? AND code = ?").bind(c.id, String(b.plan_code || "basic")).first();
  if (!p) fail(400, "الباقة دي مش موجودة في الكورس ده.");
  const plan = p.code;
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
  for (const e of enr) courses.push({ title: e.title, slug: e.slug, plan: e.plan_code, ...(await courseState(db, u.id, { id: e.course_id }, e.plan_code)),
    study: await studyTime(db, u.id, e.course_id) });
  return json({ user: u, courses });
}, "admin");

// المتدربين اللي اشتراكهم ساري ومدخلوش المنصة من كام يوم
route("GET", "/admin/inactive", async ({ db, url }) => {
  const s = await getSettings(db);
  const days = parseInt(url.searchParams.get("days"), 10) || parseInt(s.inactive_days, 10) || 7;
  const { results: rows } = await db.prepare(`SELECT u.id, u.name, u.phone, u.email, COALESCE(u.last_seen, u.last_login) AS seen, u.created_at,
        e.course_id, e.plan_code, c.title, c.slug
      FROM users u JOIN enrollments e ON e.user_id = u.id JOIN courses c ON c.id = e.course_id
      WHERE u.role = 'student' AND u.active = 1 AND (e.expires_at IS NULL OR e.expires_at >= date('now'))
        AND COALESCE(u.last_seen, u.last_login, u.created_at) < datetime('now', ?)
      ORDER BY COALESCE(u.last_seen, u.last_login, u.created_at)`).bind(`-${days} days`).all();
  const out = [];
  for (const r of rows) {
    const st = await courseState(db, r.id, { id: r.course_id }, r.plan_code);
    if (st.completed) continue;
    const cur = st.levels.find((l) => l.num === st.current_level);
    out.push({ id: r.id, name: r.name, phone: r.phone, email: r.email, seen: r.seen, created_at: r.created_at,
      course: r.title, slug: r.slug, progress: st.progress, level: cur ? `${st.unit.the} ${cur.num} (${cur.title})` : "" });
  }
  return json({ days, students: out });
}, "admin");

route("GET", "/admin/export.csv", async ({ db }) => {
  const { results: rows } = await db.prepare(`SELECT u.id, u.name, u.email, u.phone, u.active, u.last_login, e.course_id, e.plan_code, e.expires_at, c.title
      FROM users u LEFT JOIN enrollments e ON e.user_id = u.id LEFT JOIN courses c ON c.id = e.course_id
      WHERE u.role = 'student' ORDER BY u.id`).all();
  const head = ["الاسم", "الميل", "التليفون", "الحالة", "آخر دخول", "الكورس", "الباقة", "ينتهي في", "نسبة التقدم", "واقف عند", "خلص الكورس", "دقايق المذاكرة"];
  const lines = [head];
  for (const r of rows) {
    let st = null, time = null;
    if (r.course_id) { st = await courseState(db, r.id, { id: r.course_id }, r.plan_code); time = await studyTime(db, r.id, r.course_id); }
    lines.push([r.name, r.email || "", r.phone || "", r.active ? "نشط" : "موقوف", r.last_login || "", r.title || "", r.plan_code || "",
      r.expires_at || "", st ? st.progress + "%" : "", st ? st.current_level : "", st ? (st.completed ? "نعم" : "لا") : "", time ? time.total : ""]);
  }
  const csv = "﻿" + lines.map((l) => l.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\r\n");
  return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="students-${today()}.csv"` } });
}, "admin");

// ---------- الكورسات والأسعار والمستويات ----------
route("GET", "/admin/courses", async ({ db }) => {
  const [{ results: courses }, { results: plans }, { results: levels }, s] = await Promise.all([
    db.prepare("SELECT * FROM courses ORDER BY sort, id").all(),
    db.prepare("SELECT * FROM plans ORDER BY sort, id").all(),
    db.prepare("SELECT * FROM levels ORDER BY num").all(),
    getSettings(db),
  ]);
  return json(courses.map((c) => ({
    ...c,
    unit: unitFrom(s, c.id),
    unlock: unlockFrom(s, c.id),
    cert_note: s["cert_note_" + c.id] || "",
    plans: plans.filter((p) => p.course_id === c.id).map((p) => ({ ...p, features: parseJSON(p.features, []), apps: parseJSON(p.apps, []), ...priceInfo(p) })),
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
  if (!String(b.title || "").trim()) fail(400, "اكتب اسم الكورس.");
  // الرابط اختياري: بننضّفه (مسافات → شرطة، ونشيل أي حاجة مش إنجليزي)، ولو فاضي بناخده من الاسم، ولو متكرر بنزود رقم
  const clean = (v) => toLatinDigits(v).toLowerCase().replace(/[\s_.]+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  const base = clean(b.slug) || clean(b.title) || (/^[a-z0-9-]{1,30}$/.test(b.track || "") ? b.track : "course");
  const { results: taken } = await db.prepare("SELECT slug FROM courses").all();
  const used = new Set(taken.map((t) => t.slug));
  let slug = base.length < 2 ? base + "-course" : base;
  for (let i = 2; used.has(slug); i++) slug = `${base}-${i}`;
  const track = /^[a-z0-9-]{1,30}$/.test(b.track || "") ? b.track : "accounting";
  const r = await db.prepare("INSERT INTO courses (slug, title, subtitle, status, sort, track) VALUES (?, ?, ?, ?, ?, ?) RETURNING id")
    .bind(slug, b.title.trim(), b.subtitle || null, ["open", "soon", "hidden"].includes(b.status) ? b.status : "soon", Number(b.sort) || 99, track).first();
  await db.batch([
    db.prepare("INSERT INTO plans (course_id, code, name, features, sort) VALUES (?, 'basic', 'الباقة الأساسية', '[]', 1)").bind(r.id),
    db.prepare("INSERT INTO plans (course_id, code, name, features, visible, full_access, sort) VALUES (?, 'pro', 'باقة Pro', '[]', 0, 1, 2)").bind(r.id),
  ]);
  return json({ ok: true, id: r.id, slug });
}, "admin");

route("PATCH", "/admin/courses/:id", async ({ db, request, params }) => {
  const b = await body(request);
  const f = pick(b, ["title", "subtitle", "intro", "audience", "status", "sort", "track", "audiences", "tools", "outcome", "seo_desc"]);
  if (f.status && !["open", "soon", "hidden"].includes(f.status)) fail(400, "حالة الكورس غلط.");
  if (f.track !== undefined && !/^[a-z0-9-]{1,30}$/.test(f.track)) fail(400, "القسم غلط.");
  if (f.audiences !== undefined) f.audiences = cleanAudiences(f.audiences);
  if (f.tools !== undefined) f.tools = splitList(f.tools).join(",") || null;
  if (f.seo_desc !== undefined && String(f.seo_desc).length > 300) fail(400, "وصف جوجل لازم يكون أقل من 300 حرف.");
  if (b.unit !== undefined) {
    if (!UNITS[b.unit]) fail(400, "اسم التقسيم غلط.");
    const old = await unitOf(db, params.id), neu = UNITS[b.unit];
    // عناوين الامتحانات الافتراضية (امتحان المستوى 1 ...) بتتغير مع الاسم الجديد
    await db.batch([
      db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").bind("unit_" + params.id, neu.key),
      db.prepare("UPDATE exams SET title = REPLACE(REPLACE(title, ?, ?), ?, ?) WHERE course_id = ?").bind(old.pl, neu.pl, old.the, neu.the, params.id),
    ]);
  }
  if (b.cert_note !== undefined) {
    const note = String(b.cert_note).trim().slice(0, 200);
    await db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").bind("cert_note_" + params.id, note).run();
  }
  if (b.unlock !== undefined) {
    if (!UNLOCKS.includes(b.unlock)) fail(400, "طريقة الفتح غلط.");
    await db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").bind("unlock_" + params.id, b.unlock).run();
  }
  if (Object.keys(f).length) await update(db, "courses", params.id, f);
  return json({ ok: true });
}, "admin");

route("PATCH", "/admin/plans/:id", async ({ db, request, params }) => {
  const b = await body(request);
  const f = pick(b, ["name", "price", "show_price", "discount_type", "discount_value", "discount_ends", "visible", "full_access", "sort"]);
  if (f.name !== undefined && !String(f.name).trim()) fail(400, "اكتب اسم الباقة.");
  if (f.sort !== undefined) f.sort = parseInt(toLatinDigits(f.sort), 10) || 0;
  if (b.apps !== undefined) {
    const ids = new Set(demoAppsOf(await getSettings(db)).map((a) => a.id));
    f.apps = JSON.stringify((Array.isArray(b.apps) ? b.apps : []).filter((x) => ids.has(x)));
  }
  if (b.features !== undefined) f.features = JSON.stringify((Array.isArray(b.features) ? b.features : String(b.features).split("\n")).map((s) => String(s).trim()).filter(Boolean));
  if (f.discount_type && !["none", "percent", "amount"].includes(f.discount_type)) fail(400, "نوع الخصم غلط.");
  if (f.discount_type === "percent" && Number(f.discount_value) > 100) fail(400, "نسبة الخصم مينفعش تزيد عن 100%.");
  for (const k of ["price", "discount_value"]) if (f[k] !== undefined) { f[k] = Number(toLatinDigits(f[k])) || 0; if (f[k] < 0) fail(400, "الأرقام لازم تكون موجبة."); }
  for (const k of ["show_price", "visible", "full_access"]) if (f[k] !== undefined) f[k] = f[k] ? 1 : 0;
  if (f.discount_ends === "") f.discount_ends = null;
  await update(db, "plans", params.id, f);
  return json({ ok: true });
}, "admin");

// باقة جديدة للكورس: بتبدأ مخفية علشان الأدمن يكمل بياناتها الأول
route("POST", "/admin/courses/:id/plans", async ({ db, request, params }) => {
  const b = await body(request);
  const name = String(b.name || "").trim().slice(0, 60);
  if (!name) fail(400, "اكتب اسم الباقة.");
  const c = await db.prepare("SELECT id FROM courses WHERE id = ?").bind(params.id).first();
  if (!c) fail(404, "الكورس ده مش موجود.");
  const { results: taken } = await db.prepare("SELECT code, sort FROM plans WHERE course_id = ?").bind(c.id).all();
  const base = toLatinDigits(name).toLowerCase().replace(/[\s_.]+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/^-+|-+$/g, "").slice(0, 20) || "plan";
  let code = base;
  for (let i = 2; taken.some((t) => t.code === code); i++) code = `${base}-${i}`;
  const sort = Math.max(0, ...taken.map((t) => t.sort || 0)) + 1;
  await db.prepare("INSERT INTO plans (course_id, code, name, features, visible, sort) VALUES (?, ?, ?, '[]', 0, ?)").bind(c.id, code, name, sort).run();
  return json({ ok: true, code });
}, "admin");

// مسح باقة: مينفعش لو فيه متدربين مشتركين عليها
route("DELETE", "/admin/plans/:id", async ({ db, params }) => {
  const p = await db.prepare("SELECT * FROM plans WHERE id = ?").bind(params.id).first();
  if (!p) fail(404, "الباقة دي مش موجودة.");
  const n = await db.prepare("SELECT COUNT(*) AS n FROM enrollments WHERE course_id = ? AND plan_code = ?").bind(p.course_id, p.code).first();
  if (n.n) fail(400, `فيه ${n.n} متدرب مشتركين على الباقة دي. انقلهم لباقة تانية الأول، أو اخفيها بدل ما تمسحها.`);
  await db.prepare("DELETE FROM plans WHERE id = ?").bind(p.id).run();
  return json({ ok: true });
}, "admin");

route("POST", "/admin/courses/:id/levels", async ({ db, request, params }) => {
  const b = await body(request);
  const last = await db.prepare("SELECT MAX(num) AS n FROM levels WHERE course_id = ?").bind(params.id).first();
  const num = (last.n || 0) + 1;
  if (!String(b.title || "").trim()) fail(400, "اكتب العنوان.");
  const U = await unitOf(db, params.id);
  await db.batch([
    db.prepare("INSERT INTO levels (course_id, num, title, topics, teaser) VALUES (?, ?, ?, ?, ?)").bind(params.id, num, b.title.trim(), b.topics || null, b.teaser || null),
    db.prepare("INSERT OR IGNORE INTO exams (course_id, kind, after_level, title) VALUES (?, 'level', ?, ?)").bind(params.id, num, "امتحان " + U.the + " " + num),
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
  const f = pick(await body(request), ["title", "min_plan", "video_url", "sort", "free"]);
  if (f.min_plan && !["basic", "pro"].includes(f.min_plan)) fail(400, "الباقة غلط.");
  if (f.free !== undefined) f.free = f.free ? 1 : 0;
  await update(db, "materials", params.id, { ...f, updated_at: new Date().toISOString() });
  return json({ ok: true });
}, "admin");


// الوحدة كلها مجانية (أو ترجع مقفولة) بضغطة واحدة
route("PUT", "/admin/levels/:id/free", async ({ db, request, params }) => {
  const free = (await body(request)).free ? 1 : 0;
  await db.prepare("UPDATE materials SET free = ? WHERE level_id = ?").bind(free, params.id).run();
  return json({ ok: true });
}, "admin");

route("GET", "/admin/stats", async ({ db }) => {
  const d = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
  const [{ results: rows }, { results: daily }, { results: courses }, { results: mats }] = await Promise.all([
    db.prepare(`SELECT kind, ref, SUM(CASE WHEN day = ? THEN n ELSE 0 END) AS today, SUM(CASE WHEN day >= ? THEN n ELSE 0 END) AS d7,
                SUM(n) AS d30 FROM stats WHERE day >= ? GROUP BY kind, ref`).bind(today(), d(6), d(29)).all(),
    db.prepare("SELECT day, kind, SUM(n) AS n FROM stats WHERE day >= ? GROUP BY day, kind ORDER BY day").bind(d(29)).all(),
    db.prepare("SELECT slug, title, status FROM courses ORDER BY sort, id").all(),
    db.prepare(`SELECT m.id, m.title, l.num, c.slug FROM materials m JOIN levels l ON l.id = m.level_id
                JOIN courses c ON c.id = l.course_id WHERE m.free = 1`).all(),
  ]);
  // الرحلة لكل مصدر في آخر 30 يوم: زيارات ثم زوار سجلوا ثم ضغطات اشترك ثم متدربين اتفعلوا
  const since = d(29);
  const [{ results: visitorsBy }, { results: studentsBy }, { results: notify }, { results: files }] = await Promise.all([
    db.prepare("SELECT IFNULL(source, 'direct') AS source, COUNT(*) AS n FROM visitors WHERE created_at >= ? GROUP BY 1").bind(since).all(),
    db.prepare("SELECT IFNULL(source, '') AS source, COUNT(*) AS n FROM users WHERE role = 'student' AND created_at >= ? GROUP BY 1").bind(since).all(),
    db.prepare("SELECT ref AS slug, COUNT(*) AS n FROM visitor_events WHERE kind = 'notify' GROUP BY ref").all(),
    db.prepare("SELECT id, title, access FROM library_files").all(),
  ]);
  return json({ rows, daily, courses, free: mats, since, visitors_by: visitorsBy, students_by: studentsBy, notify, files });
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
  if (!(after >= 1)) fail(400, "اختار الامتحان التراكمي هيبقى بعد رقم كام.");
  const U = await unitOf(db, params.id);
  await db.prepare("INSERT INTO exams (course_id, kind, after_level, title, question_count, pass_pct, duration_min) VALUES (?, 'cumulative', ?, ?, ?, ?, ?)")
    .bind(params.id, after, b.title || `امتحان تراكمي بعد ${U.the} ${after}`, Number(b.question_count) || 20, Number(b.pass_pct) || 50, Number(b.duration_min) || 40).run();
  return json({ ok: true });
}, "admin");

route("PATCH", "/admin/exams/:id", async ({ db, request, params }) => {
  const f = pick(await body(request), ["title", "question_count", "pass_pct", "duration_min"]);
  if (f.question_count !== undefined && !(Number(f.question_count) >= 1)) fail(400, "عدد الأسئلة لازم يكون 1 أو أكتر.");
  if (f.pass_pct !== undefined && !(Number(f.pass_pct) >= 0 && Number(f.pass_pct) <= 100)) fail(400, "نسبة النجاح لازم تكون بين 0 و 100.");
  if (f.duration_min !== undefined && !(Number.isInteger(Number(f.duration_min)) && Number(f.duration_min) >= 0 && Number(f.duration_min) <= 300)) fail(400, "مدة الامتحان لازم تكون من 0 لـ 300 دقيقة (0 = من غير وقت).");
  await update(db, "exams", params.id, f);
  return json({ ok: true });
}, "admin");

route("DELETE", "/admin/exams/:id", async ({ db, params }) => {
  const ex = await db.prepare("SELECT kind FROM exams WHERE id = ?").bind(params.id).first();
  if (!ex) fail(404, "الامتحان ده مش موجود.");
  if (ex.kind !== "cumulative") fail(400, "الامتحان ده أساسي ومش بيتمسح، تقدر تفضي أسئلته بس.");
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

// ---------- برامج الـ Demo وطلباتها ----------
route("GET", "/admin/demo", async ({ db }) => {
  const s = await getSettings(db);
  const { results } = await db.prepare(`SELECT e.ref AS app, e.created_at, v.id AS visitor_id, v.name, v.phone, v.source,
      (SELECT u.id FROM users u WHERE u.phone = v.phone) AS user_id
      FROM visitor_events e JOIN visitors v ON v.id = e.visitor_id WHERE e.kind = 'demo' ORDER BY e.id DESC LIMIT 300`).all();
  return json({ apps: demoAppsOf(s), requests: results, message: s.demo_message || "" });
}, "admin");

route("PUT", "/admin/demo-apps", async ({ db, request }) => {
  const apps = cleanDemoApps((await body(request)).apps);
  await db.prepare("INSERT INTO settings (key, value) VALUES ('demo_apps', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").bind(JSON.stringify(apps)).run();
  return json({ ok: true, apps });
}, "admin");

// ---------- الإعدادات ----------
route("GET", "/admin/settings", async ({ db }) => json(await getSettings(db)), "admin");

route("PUT", "/admin/settings", async ({ db, request }) => {
  const b = await body(request);
  const stmts = [];
  for (const k of ADMIN_SETTINGS) {
    if (b[k] === undefined) continue;
    let v = String(b[k]).trim();
    if (WHATSAPP_KEYS.includes(k)) v = cleanWhatsapp(v);
    if (k === "follow_mode" && !FOLLOW_MODES.includes(v)) v = "lecturer";
    if (k === "inactive_days") {
      v = String(parseInt(toLatinDigits(v), 10) || 0);
      if (!(Number(v) >= 1 && Number(v) <= 365)) fail(400, "عدد أيام الانقطاع لازم يكون من 1 لـ 365.");
    }
    if (k === "wm_student") v = v === "0" ? "0" : "1";
    if (k === "wm_level" && !["light", "medium", "strong"].includes(v)) v = "medium";
    if (k === "wm_text" && v.length > 60) fail(400, "نص العلامة المائية لازم يكون أقل من 60 حرف.");
    if (k === "tracks") {
      const t = parseLines(v, 2);
      if (!t.length) fail(400, "لازم قسم واحد على الأقل.");
      for (const [key] of t) if (!/^[a-z0-9-]{1,30}$/.test(key)) fail(400, `مفتاح القسم "${key}" لازم يكون إنجليزي صغير من غير مسافات، زي accounting.`);
      v = t.map((x) => x.slice(0, 3).join(" | ")).join("\n");
    }
    // الخدمات: الوسم بالإنجليزي | العنوان | الوصف | البنود مفصولة بـ ؛  — والآراء: الاسم | الوظيفة | الرأي
    if (k === "services") v = parseLines(v, 2).map((x) => x.slice(0, 4).join(" | ")).join("\n");
    if (k === "testimonials") v = parseLines(v, 3).map((x) => x.slice(0, 3).join(" | ")).join("\n");
    if (k === "lib_subcats") v = parseLines(v, 2).map((x) => x.slice(0, 2).join(" | ")).join("\n");
    stmts.push(db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").bind(k, v));
  }
  if (stmts.length) await db.batch(stmts);
  return json({ ok: true });
}, "admin");

route("GET", "/admin/lecturers", async ({ db }) => json(lecturersOf(await getSettings(db))), "admin");

// القايمة كلها بتتبعت مرة واحدة (إضافة / تعديل / مسح)
route("PUT", "/admin/lecturers", async ({ db, request }) => {
  const b = await body(request);
  if (!Array.isArray(b.lecturers) || b.lecturers.length > 50) fail(400, "بيانات المحاضرين مش مظبوطة.");
  const { results } = await db.prepare("SELECT id FROM courses").all();
  const ids = new Set(results.map((r) => r.id));
  const txt = (v, max) => String(v || "").trim().slice(0, max);
  let next = b.lecturers.reduce((m, l) => Math.max(m, Number(l.id) || 0), 0);
  const list = b.lecturers.map((l) => {
    const name = txt(l.name, 80);
    if (!name) fail(400, "اسم المحاضر مطلوب.");
    return {
      id: Number(l.id) || ++next, name, role: txt(l.role, 120), bio: txt(l.bio, 600), signature: txt(l.signature, 80),
      whatsapp: cleanWhatsapp(l.whatsapp), visible: l.visible !== false,
      courses: [...new Set((Array.isArray(l.courses) ? l.courses : []).map(Number).filter((id) => ids.has(id)))],
    };
  });
  await db.prepare("INSERT INTO settings (key, value) VALUES ('lecturers', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").bind(JSON.stringify(list)).run();
  return json(list);
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

// ---------- مكتبة IK ----------
route("GET", "/admin/library", async ({ db }) => {
  const { results } = await db.prepare(`SELECT f.*, (SELECT COUNT(*) FROM library_grants g WHERE g.file_id = f.id) AS grants
                                        FROM library_files f ORDER BY f.sort, f.id DESC`).all();
  return json(results.map((f) => ({ ...f, audiences: splitList(f.audiences) })));
}, "admin");

function libraryFields(b, partial = false) {
  const f = pick(b, ["title", "description", "track", "subcat", "audiences", "access", "price", "course_id", "related_course_id", "visible", "sort"]);
  if (!partial || f.title !== undefined) { f.title = String(f.title || "").trim(); if (!f.title) fail(400, "اكتب اسم الملف."); }
  if (f.access !== undefined && !["free", "paid", "course"].includes(f.access)) fail(400, "نوع الوصول غلط.");
  if (f.track !== undefined && !/^[a-z0-9-]{1,30}$/.test(f.track)) fail(400, "القسم غلط.");
  if (f.audiences !== undefined) f.audiences = cleanAudiences(f.audiences);
  if (f.price !== undefined) { f.price = Number(toLatinDigits(f.price)) || 0; if (f.price < 0) fail(400, "السعر لازم يكون موجب."); }
  for (const k of ["course_id", "related_course_id"]) if (f[k] !== undefined) f[k] = Number(f[k]) || null;
  if (f.visible !== undefined) f.visible = f.visible ? 1 : 0;
  if (f.sort !== undefined) f.sort = Number(f.sort) || 0;
  if (f.access === "course" && !f.course_id) fail(400, "اختار الكورس اللي الملف ده تبعه.");
  return f;
}

route("POST", "/admin/library", async ({ db, request }) => {
  const f = libraryFields(await body(request));
  const keys = Object.keys(f);
  const r = await db.prepare(`INSERT INTO library_files (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")}) RETURNING id`).bind(...Object.values(f)).first();
  return json({ ok: true, id: r.id });
}, "admin");

route("PATCH", "/admin/library/:id", async ({ db, request, params }) => {
  const f = libraryFields(await body(request), true);
  await update(db, "library_files", params.id, { ...f, updated_at: new Date().toISOString() });
  return json({ ok: true });
}, "admin");

route("DELETE", "/admin/library/:id", async ({ db, params }) => {
  await deletePrefix(db, `lib/${params.id}/`);
  await db.prepare("DELETE FROM library_files WHERE id = ?").bind(params.id).run();
  return json({ ok: true });
}, "admin");

// الملف بيترفع أجزاء (كل جزء أقل من 1.9 ميجا) على نسخة جديدة، وبعد النشر النسخة القديمة بتتمسح
const LIB_MAX_CHUNKS = 8; // يعني الملف لحد حوالي 15 ميجا
route("PUT", "/admin/library/:id/chunks/:n", async ({ db, request, params, url }) => {
  const f = await db.prepare("SELECT id, version FROM library_files WHERE id = ?").bind(params.id).first();
  if (!f) fail(404, "الملف ده مش موجود.");
  const v = parseInt(url.searchParams.get("v"), 10), n = parseInt(params.n, 10);
  if (v !== f.version + 1 || !(n >= 1 && n <= LIB_MAX_CHUNKS)) fail(400, "رقم النسخة أو الجزء غلط.");
  const data = await request.arrayBuffer();
  if (!data.byteLength || data.byteLength > MAX_FILE) fail(400, "حجم الجزء كبير.");
  await putFile(db, `lib/${f.id}/v${v}/${n}`, "application/octet-stream", data);
  return json({ ok: true });
}, "admin");

route("POST", "/admin/library/:id/publish", async ({ db, request, params }) => {
  const b = await body(request);
  const f = await db.prepare("SELECT id, version FROM library_files WHERE id = ?").bind(params.id).first();
  if (!f) fail(404, "الملف ده مش موجود.");
  const chunks = parseInt(b.chunks, 10), v = f.version + 1;
  if (Number(b.version) !== v || !(chunks >= 1 && chunks <= LIB_MAX_CHUNKS)) fail(400, "بيانات النشر غلط.");
  const last = await db.prepare("SELECT 1 FROM files WHERE key = ?").bind(`lib/${f.id}/v${v}/${chunks}`).first();
  if (!last) fail(400, "الملف ما اترفعش كله. جرب ترفعه تاني.");
  const name = String(b.file_name || "file").replace(/[\\/:*?"<>|]/g, "").slice(0, 120) || "file";
  await db.prepare("UPDATE library_files SET version = ?, chunks = ?, file_name = ?, mime = ?, size = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(v, chunks, name, String(b.mime || "application/octet-stream").slice(0, 100), Number(b.size) || 0, f.id).run();
  if (f.version > 0) await deletePrefix(db, `lib/${f.id}/v${f.version}/`);
  return json({ ok: true });
}, "admin");

// ---------- الزوار السريعين ----------
const VISITORS_SQL = `SELECT v.id, v.name, v.phone, v.consent_marketing, v.consent_at, v.source, v.utm, v.landing, v.created_at, v.last_seen,
    (SELECT GROUP_CONCAT(e.kind || ':' || IFNULL(e.ref, ''), '|') FROM visitor_events e WHERE e.visitor_id = v.id) AS events,
    (SELECT u.id FROM users u WHERE u.phone = v.phone) AS user_id
  FROM visitors v WHERE (v.name LIKE ?1 OR v.phone LIKE ?1) ORDER BY v.id DESC LIMIT 1000`;
const visitorRows = async (db, q) => {
  const { results } = await db.prepare(VISITORS_SQL).bind("%" + toLatinDigits(q || "").trim() + "%").all();
  return results.map((v) => ({ ...v, events: String(v.events || "").split("|").filter(Boolean).map((x) => { const i = x.indexOf(":"); return { kind: x.slice(0, i), ref: x.slice(i + 1) }; }) }));
};

route("GET", "/admin/visitors", async ({ db, url }) => json(await visitorRows(db, url.searchParams.get("q"))), "admin");

route("GET", "/admin/visitors.csv", async ({ db }) => {
  const [rows, { results: files }, { results: mats }] = await Promise.all([
    visitorRows(db, ""), db.prepare("SELECT id, title FROM library_files").all(), db.prepare("SELECT id, title FROM materials").all(),
  ]);
  const fBy = Object.fromEntries(files.map((f) => [String(f.id), f.title])), mBy = Object.fromEntries(mats.map((m) => [String(m.id), m.title]));
  const label = (e) => e.kind === "file" ? "ملف: " + (fBy[e.ref] || e.ref) : e.kind === "chapter" ? "فصل: " + (mBy[e.ref] || e.ref)
    : e.kind === "notify" ? "بلغني: " + e.ref : "تواصل: " + e.ref;
  const lines = [["الاسم", "الرقم", "المصدر", "موافق على الرسايل التسويقية", "تاريخ الموافقة", "سجل في", "آخر نشاط", "اشترك؟", "عمل إيه"]];
  for (const v of rows) lines.push([v.name, v.phone, v.source || "", v.consent_marketing ? "أيوه" : "لأ", v.consent_at || "", v.created_at, v.last_seen || "",
    v.user_id ? "أيوه" : "لأ", v.events.map(label).join(" / ")]);
  const csv = "﻿" + lines.map((l) => l.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(",")).join("\r\n");
  return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="visitors-${today()}.csv"` } });
}, "admin");

route("DELETE", "/admin/visitors/:id", async ({ db, params }) => {
  await db.prepare("DELETE FROM visitors WHERE id = ?").bind(params.id).run();
  return json({ ok: true });
}, "admin");

// ---------- نسخة احتياطية: كل البيانات في ملف JSON (من غير صفحات الـ PDF والملفات نفسها) ----------
const BACKUP_TABLES = ["settings", "courses", "plans", "levels", "materials", "exams", "questions", "users", "enrollments", "progress", "reading", "study_time",
  "attempts", "certificates", "stats", "visitors", "visitor_events", "library_files", "library_grants"];
route("GET", "/admin/backup.json", async ({ db }) => {
  const out = { app: "IK Academy", created_at: new Date().toISOString(), note: "صفحات الـ PDF وملفات المكتبة نفسها مش جوه النسخة دي (حجمها كبير). احتفظ بالملفات الأصلية عندك.", tables: {} };
  for (const t of BACKUP_TABLES) {
    try { out.tables[t] = (await db.prepare(`SELECT * FROM ${t}`).all()).results; } catch (e) { out.tables[t] = []; } // جدول لسه ما اتعملش في D1
  }
  const { results: files } = await db.prepare("SELECT key, type, length(data) AS bytes FROM files").all();
  out.tables.files_index = files;
  return new Response(JSON.stringify(out), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store",
    "content-disposition": `attachment; filename="ik-academy-backup-${today()}.json"` } });
}, "admin");
