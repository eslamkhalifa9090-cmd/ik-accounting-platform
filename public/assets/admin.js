// لوحة الأدمن: المتدربين، الكورسات والأسعار، المادة العلمية، الامتحانات، مكتبة IK، الزوار، الإحصائيات، الإعدادات
(async function () {
  const { esc, $, api } = IK;
  const me = await IK.requireUser({ admin: true });
  const site = await IK.chrome({ user: me });
  const panel = $("#panel");
  let courses = [];
  const loadCourses = async () => (courses = await api("/admin/courses"));
  await loadCourses();
  let adminSettings = {};
  try { adminSettings = await api("/admin/settings"); } catch (e) {}

  const toast = (el, kind, msg) => IK.status(el, kind, msg);
  const opt = (v, label, sel) => `<option value="${esc(v)}"${String(v) === String(sel) ? " selected" : ""}>${esc(label)}</option>`;
  const courseOptions = (sel, withEmpty) => (withEmpty ? opt("", "— من غير كورس —", sel) : "") + courses.map((c) => opt(c.slug, c.title, sel)).join("");
  const intlPhone = (p) => (p ? (p.startsWith("0") ? "20" + p.slice(1) : p) : "");
  const tracks = () => site.tracks || [];
  const trackName = (k) => (tracks().find((t) => t.key === k) || {}).name || k;
  const AUD = site.audiences || { accountant: "محاسب / خريج", business: "صاحب بيزنس", hr: "HR" };
  const audChecks = (sel) => Object.entries(AUD).map(([k, v]) => `<label class="check" style="display:inline-flex;margin-inline-end:14px"><input type="checkbox" name="audiences" value="${k}"${(sel || []).includes(k) ? " checked" : ""}> ${esc(v)}</label>`).join("");
  const SOURCES = ["facebook", "whatsapp", "instagram", "google", "youtube", "tiktok", "telegram", "linkedin", "friend", "direct"];
  const SRC_AR = { facebook: "فيسبوك", whatsapp: "واتساب", instagram: "إنستجرام", google: "جوجل", youtube: "يوتيوب", tiktok: "تيك توك", telegram: "تليجرام", linkedin: "لينكدإن", friend: "ترشيح من صاحبه", direct: "مباشر" };
  const srcLabel = (s) => (s ? SRC_AR[s] || s : "—");
  const srcOptions = (sel) => opt("", "— مش معروف (أو من الزائر بنفس الرقم) —", sel || "") + SOURCES.map((s) => opt(s, SRC_AR[s], sel)).join("") +
    (sel && !SOURCES.includes(sel) ? opt(sel, sel, sel) : "");

  async function stats() {
    const o = await api("/admin/overview");
    $("#stats").innerHTML = `<span class="badge">${o.students} متدرب</span><span class="badge ok">${o.enrollments} اشتراك ساري</span><span class="badge gold">${o.passed} نجاح من ${o.attempts} محاولة</span>`;
  }
  stats();

  // ======================= المتدربين =======================
  async function studentsTab() {
    panel.innerHTML = `
      <div class="card">
        <h2>إضافة متدرب</h2>
        <form id="add" class="form-grid" style="margin-top:14px" novalidate>
          <div class="field"><label>الاسم</label><input name="name" required></div>
          <div class="field"><label>رقم التليفون <small>(يدخل بيه)</small></label><input name="phone" dir="ltr" placeholder="01xxxxxxxxx"></div>
          <div class="field"><label>الميل <small>(اختياري، يدخل بيه برضه)</small></label><input name="email" dir="ltr"></div>
          <div class="field"><label>جه منين؟ <small>(لو كان زائر بنفس الرقم بيتملا لوحده)</small></label><select name="source">${srcOptions("")}</select></div>
          <div class="field"><label>الكورس</label><select name="course_slug">${courseOptions("financial", true)}</select></div>
          <div class="field"><label>الباقة</label><select name="plan_code">${opt("basic", "الأساسية (PDF)")}${opt("pro", "Pro (PDF + فيديو)")}</select></div>
          <div class="field"><label>الاشتراك ينتهي في <small>(فاضي = مفتوح)</small></label><input name="expires_at" type="date"></div>
          <div class="field"><label>ملاحظات <small>(ليك بس)</small></label><input name="notes" placeholder="مثلاً: دفع فودافون كاش"></div>
          <div class="status full" id="add-st" hidden></div>
          <div class="full row"><button class="btn btn-primary" type="submit">إضافة المتدرب</button></div>
        </form>
        <div id="welcome" class="card" style="margin-top:14px;background:var(--paper)" hidden></div>
      </div>
      <div class="card">
        <div class="spread"><h2>كل المتدربين</h2>
          <div class="row"><input id="q" placeholder="دور بالاسم أو الرقم أو الميل" style="font:inherit;padding:8px 12px;border:1px solid var(--line);border-radius:var(--r-m)">
          <a class="btn btn-ghost btn-sm" href="/api/admin/export.csv">تصدير Excel</a></div></div>
        <div class="table-wrap" style="margin-top:14px"><table class="t"><thead><tr><th>الاسم</th><th>بيدخل بـ</th><th>الكورسات</th><th>الحالة</th><th>آخر دخول</th><th></th></tr></thead><tbody id="rows"></tbody></table></div>
        <div id="edit" style="margin-top:16px"></div>
      </div>`;
    const f = $("#add");
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const b = Object.fromEntries(new FormData(f));
      try {
        const r = await api("/admin/students", { method: "POST", body: b });
        toast($("#add-st"), "ok", "اتضاف المتدرب " + b.name + (r.source ? " · المصدر: " + srcLabel(r.source) : "") + ".");
        await showActivation({ id: r.id, name: b.name, phone: b.phone, email: b.email }, b.course_slug, $("#welcome"));
        f.reset(); f.course_slug.value = "financial";
        load(); stats();
      } catch (err) { toast($("#add-st"), "bad", err.message); }
    });
    let timer;
    $("#q").addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(load, 250); });
    await load();
  }

  // رسالة الترحيب: فيها رابط تفعيل لمرة واحدة (48 ساعة) والمتدرب بيختار الباسورد بنفسه، ومفيش باسورد مكشوف في أي رسالة
  async function showActivation(u, courseSlug, w) {
    const s = site.settings;
    const r = await api(`/admin/students/${u.id}/activation`, { method: "POST" });
    const course = courses.find((c) => c.slug === courseSlug);
    const tpl = adminSettings.activation_message || "أهلاً يا {name} 👋\nحسابك على {brand} اتعمل{course}.\n\nافتح الرابط ده واختار الباسورد بتاعك بنفسك (الرابط شغال 48 ساعة ولمرة واحدة):\n{link}\n\nوبعد كده هتدخل من {login} برقمك ({id}) والباسورد اللي اخترته.\nمستنيينك 🌟";
    const msg = IK.fill(tpl, { name: u.name.split(" ")[0], brand: s.brand_name || "IK Academy", course: course ? " في كورس " + course.title : "", link: r.link,
      login: location.origin + "/login", id: u.phone || u.email || "" });
    w.hidden = false;
    w.innerHTML = `<h3>رسالة التفعيل للمتدرب</h3><p class="muted" style="font-size:13px">الرابط شغال لحد ${esc(new Date(r.expires_at).toLocaleString("ar-EG"))} ولمرة واحدة. لو اتأخر، اعمله رابط جديد من "تعديل".</p>
      <pre style="white-space:pre-wrap;font:inherit;margin:10px 0">${esc(msg)}</pre>
      <div class="row">${u.phone ? `<a class="btn btn-wa btn-sm" target="_blank" rel="noopener" href="${IK.wa(intlPhone(IK.toPhone(u.phone)), msg)}">${IK.chatIcon}ابعتها على واتساب المتدرب</a>` : ""}
      <button class="btn btn-ghost btn-sm js-copy-w" type="button">نسخ الرسالة</button></div>`;
    const cp = w.querySelector(".js-copy-w");
    cp.onclick = () => navigator.clipboard.writeText(msg).then(() => (cp.textContent = "اتنسخت"));
  }
  IK.toPhone = (p) => String(p || "").replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(/\D/g, "");

  async function load() {
    const list = await api("/admin/students?q=" + encodeURIComponent(($("#q") || {}).value || ""));
    $("#rows").innerHTML = list.map((u) => `
      <tr>
        <td><b>${esc(u.name)}</b>${u.source ? ` <span class="badge">${esc(srcLabel(u.source))}</span>` : ""}${u.notes ? `<br><small class="muted">${esc(u.notes)}</small>` : ""}</td>
        <td class="num">${esc(u.phone || "")}${u.phone && u.email ? "<br>" : ""}${esc(u.email || "")}</td>
        <td>${u.enrollments.map((e) => `<span class="badge ${e.plan_code === "pro" ? "gold" : ""}">${esc(e.title)}${e.expires_at ? " · لحد " + esc(e.expires_at) : ""}</span>`).join(" ") || '<span class="muted">—</span>'}</td>
        <td>${u.active ? '<span class="badge ok">نشط</span>' : '<span class="badge bad">موقوف</span>'}${u.must_change ? '<br><small class="muted">لسه ما فعّلش حسابه</small>' : ""}</td>
        <td class="num"><small>${esc(u.last_login || "لسه ما دخلش")}</small></td>
        <td><div class="row"><button class="btn btn-ghost btn-sm" data-act="edit" data-id="${u.id}" type="button">تعديل</button>
          <button class="btn btn-ghost btn-sm" data-act="report" data-id="${u.id}" type="button">التقدم</button></div></td>
      </tr>`).join("") || '<tr><td colspan="6" class="empty">مفيش متدربين لسه.</td></tr>';
    $("#rows").onclick = (e) => {
      const b = e.target.closest("button[data-act]");
      if (!b) return;
      const u = list.find((x) => String(x.id) === b.dataset.id);
      if (b.dataset.act === "edit") editStudent(u); else report(u);
    };
  }

  let libFiles = [];
  async function editStudent(u) {
    try { libFiles = await api("/admin/library"); } catch (e) { libFiles = []; }
    const box = $("#edit");
    const today = new Date().toISOString().slice(0, 10);
    const free = courses.filter((c) => !u.enrollments.some((e) => e.slug === c.slug));
    box.innerHTML = `<div class="card" style="border-color:var(--gold)">
      <div class="spread"><h2>تعديل: ${esc(u.name)}</h2><button class="btn btn-ghost btn-sm" type="button" id="x">قفل</button></div>
      <form id="ef" class="form-grid" style="margin-top:12px">
        <div class="field"><label>الاسم</label><input name="name" value="${esc(u.name)}"></div>
        <div class="field"><label>رقم التليفون</label><input name="phone" dir="ltr" value="${esc(u.phone || "")}"></div>
        <div class="field"><label>الميل</label><input name="email" dir="ltr" value="${esc(u.email || "")}"></div>
        <div class="field"><label>ملاحظات</label><input name="notes" value="${esc(u.notes || "")}"></div>
        <div class="field"><label>جه منين؟</label><select name="source">${srcOptions(u.source)}</select></div>
        <label class="check"><input type="checkbox" name="active" ${u.active ? "checked" : ""}> الحساب نشط</label>
        <div class="full row"><button class="btn btn-primary" type="submit">حفظ البيانات</button>
          <button class="btn btn-wa" type="button" id="act">${IK.chatIcon}ابعت رابط تفعيل / نسيت الباسورد</button></div>
      </form>
      <div id="act-box" class="card" style="margin-top:12px;background:var(--paper)" hidden></div>
      ${libFiles.filter((f) => f.access === "paid").length ? `<h3 style="margin-top:20px">ملفات مدفوعة من مكتبة IK</h3>
      <p class="muted">علّم على الملف اللي المتدرب دفع تمنه، وهيقدر يحمّله على طول من المكتبة أو من صفحة "كورساتي".</p>
      <div class="stack" style="margin-top:8px;gap:6px">${libFiles.filter((f) => f.access === "paid").map((f) => `<label class="check"><input type="checkbox" class="js-grant" value="${f.id}"${(u.files || []).includes(f.id) ? " checked" : ""}> ${esc(f.title)}${f.price ? ` <span class="muted">(${IK.money(f.price)})</span>` : ""}</label>`).join("")}</div>` : ""}
      <h3 style="margin-top:20px">الكورسات المشترك فيها (${u.enrollments.length})</h3>
      <p class="muted">نفس اليوزر والباسورد بيدخل بيهم على كل الكورسات، وكل كورس ليه باقته وتاريخ انتهائه لوحده.</p>
      ${u.enrollments.length ? `<div class="table-wrap" style="margin-top:8px"><table class="t" id="enr-t"><thead><tr><th>الكورس</th><th>الباقة</th><th>ينتهي في</th><th>الحالة</th><th></th></tr></thead><tbody>
        ${u.enrollments.map((e) => `<tr data-enr="${esc(e.slug)}">
          <td><b>${esc(e.title)}</b></td>
          <td><select class="js-plan" disabled>${opt("basic", "الأساسية", e.plan_code)}${opt("pro", "Pro", e.plan_code)}</select></td>
          <td><input class="js-exp" type="date" value="${esc(e.expires_at || "")}" disabled><br><small class="muted js-exp-note">${e.expires_at ? "" : "مفتوح من غير تاريخ"}</small></td>
          <td>${!e.expires_at || e.expires_at >= today ? '<span class="badge ok">ساري</span>' : '<span class="badge bad">منتهي</span>'}</td>
          <td><div class="row"><button class="btn btn-ghost btn-sm js-edit-enr" type="button">تعديل</button>
            <button class="btn btn-primary btn-sm js-save-enr" type="button" hidden>حفظ</button>
            <button class="btn btn-danger btn-sm js-unenroll" type="button">إلغاء</button></div></td></tr>`).join("")}
      </tbody></table></div>` : '<p class="muted" style="margin-top:6px">مش مشترك في أي كورس لسه.</p>'}
      ${free.length ? `<button class="btn btn-gold btn-sm" type="button" id="add-enr" style="margin-top:10px">+ إضافة كورس</button>
      <form id="en" class="form-grid card" style="margin-top:10px;background:var(--paper)" hidden>
        <div class="field"><label>الكورس</label><select name="course_slug">${free.map((c) => opt(c.slug, c.title + (c.status === "open" ? "" : " (قيد الافتتاح)"))).join("")}</select></div>
        <div class="field"><label>الباقة</label><select name="plan_code">${opt("basic", "الأساسية")}${opt("pro", "Pro")}</select></div>
        <div class="field"><label>ينتهي في <small>(فاضي = مفتوح)</small></label><input name="expires_at" type="date"></div>
        <div class="full row"><button class="btn btn-primary" type="submit">إضافة الكورس للمتدرب</button><button class="btn btn-ghost" type="button" id="en-x">إلغاء</button></div>
      </form>` : '<p class="muted" style="margin-top:10px">مشترك في كل الكورسات الموجودة.</p>'}
      <div class="status" id="e-st" hidden style="margin-top:12px"></div>
      <div class="row" style="margin-top:20px"><button class="btn btn-danger btn-sm" type="button" id="del">مسح المتدرب نهائياً</button></div>
    </div>`;
    box.scrollIntoView({ behavior: "smooth", block: "start" });
    const st = $("#e-st");
    $("#x").onclick = () => (box.innerHTML = "");
    $("#ef").onsubmit = async (e) => {
      e.preventDefault();
      const b = Object.fromEntries(new FormData(e.target));
      b.active = e.target.active.checked;
      try {
        await api("/admin/students/" + u.id, { method: "PATCH", body: b });
        toast(st, "ok", "اتحفظ.");
        load();
      } catch (err) { toast(st, "bad", err.message); }
    };
    $("#act").onclick = async () => {
      try { await showActivation(u, u.enrollments[0] && u.enrollments[0].slug, $("#act-box")); } catch (err) { toast(st, "bad", err.message); }
    };
    box.querySelectorAll(".js-grant").forEach((c) => (c.onchange = async () => {
      try {
        await api(`/admin/students/${u.id}/library/${c.value}`, { method: c.checked ? "PUT" : "DELETE" });
        u.files = c.checked ? [...(u.files || []), Number(c.value)] : (u.files || []).filter((x) => x !== Number(c.value));
        toast(st, "ok", c.checked ? "الملف اتفعل للمتدرب." : "الملف اتشال من المتدرب.");
      } catch (err) { c.checked = !c.checked; toast(st, "bad", err.message); }
    }));
    // بعد أي تغيير في الاشتراكات: نجيب بيانات المتدرب من جديد ونرسم الكارت تاني
    const reopen = async (msg) => {
      load(); stats();
      const list = await api("/admin/students?q=" + encodeURIComponent(u.phone || u.email || u.name));
      const fresh = list.find((x) => x.id === u.id);
      if (fresh) { editStudent(fresh); toast($("#e-st"), "ok", msg); }
    };
    if ($("#add-enr")) {
      $("#add-enr").onclick = () => { $("#en").hidden = false; $("#add-enr").hidden = true; };
      $("#en-x").onclick = () => { $("#en").hidden = true; $("#add-enr").hidden = false; };
      $("#en").onsubmit = async (e) => {
        e.preventDefault();
        try { await api(`/admin/students/${u.id}/enrollment`, { method: "PUT", body: Object.fromEntries(new FormData(e.target)) }); await reopen("الكورس اتضاف للمتدرب."); }
        catch (err) { toast(st, "bad", err.message); }
      };
    }
    box.querySelectorAll("tr[data-enr]").forEach((tr) => {
      const slug = tr.dataset.enr;
      tr.querySelector(".js-edit-enr").onclick = () => {
        tr.querySelectorAll("select, input").forEach((x) => (x.disabled = false));
        tr.querySelector(".js-edit-enr").hidden = true;
        tr.querySelector(".js-save-enr").hidden = false;
      };
      tr.querySelector(".js-save-enr").onclick = async () => {
        try {
          await api(`/admin/students/${u.id}/enrollment`, { method: "PUT", body: { course_slug: slug, plan_code: tr.querySelector(".js-plan").value, expires_at: tr.querySelector(".js-exp").value } });
          await reopen("الاشتراك اتحدث.");
        } catch (err) { toast(st, "bad", err.message); }
      };
      tr.querySelector(".js-unenroll").onclick = async () => {
        if (!confirm("متأكد إنك عايز تلغي الاشتراك ده؟ تقدم المتدرب هيفضل محفوظ لو فعلته تاني.")) return;
        await api(`/admin/students/${u.id}/enrollment/${encodeURIComponent(slug)}`, { method: "DELETE" });
        await reopen("الاشتراك اتلغى.");
      };
    });
    $("#del").onclick = async () => {
      if (!confirm("مسح المتدرب هيمسح كل تقدمه ودرجاته ومش هينفع ترجعهم. متأكد؟")) return;
      await api("/admin/students/" + u.id, { method: "DELETE" });
      box.innerHTML = ""; load(); stats();
    };
  }
  async function report(u) {
    const box = $("#edit");
    box.innerHTML = '<div class="loading">جاري التحميل...</div>';
    const r = await api(`/admin/students/${u.id}/report`);
    const ex = (e) => !e ? "—" : !e.ready ? '<span class="muted">مفيش أسئلة</span>' : e.tries ? `${e.passed ? "✓" : "✗"} أعلى ${e.best}% · أول محاولة ${e.first}% · ${e.tries} محاولة` : '<span class="muted">لسه</span>';
    box.innerHTML = `<div class="card" style="border-color:var(--gold)">
      <div class="spread"><h2>تقدم: ${esc(r.user.name)}</h2><button class="btn btn-ghost btn-sm" type="button" id="x">قفل</button></div>
      ${r.courses.map((c) => `<h3 style="margin-top:14px">${esc(c.title)} · ${c.progress}% ${c.completed ? '<span class="badge ok">خلص الكورس</span>' : ""}</h3>
        <div class="table-wrap" style="margin-top:8px"><table class="t"><thead><tr><th>${esc(IK.U(c.unit).the)}</th><th>الحالة</th><th>الفصول</th><th>الامتحان</th><th>التراكمي</th></tr></thead><tbody>
        ${c.levels.map((l) => `<tr><td>${l.num}. ${esc(l.title)}</td><td>${l.status === "locked" ? "مقفول" : l.status === "done" ? "مكتمل" : "مفتوح"}</td>
          <td>${l.materials.filter((m) => m.done).length} / ${l.materials.length}</td><td>${ex(l.exam)}</td><td>${l.cumulative ? ex(l.cumulative) : ""}</td></tr>`).join("")}
        </tbody></table></div>`).join("") || '<p class="muted">مش مشترك في أي كورس.</p>'}
    </div>`;
    $("#x").onclick = () => (box.innerHTML = "");
    box.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ======================= الكورسات والأسعار =======================
  function coursesTab() {
    panel.innerHTML = courses.map((c) => `
      <div class="card" data-course="${c.id}">
        <div class="spread"><h2>${esc(c.title)}</h2><div class="row"><a class="btn btn-ghost btn-sm" href="/certificate?c=${encodeURIComponent(c.slug)}&preview=1" target="_blank">🎓 معاينة الشهادة</a><a class="btn btn-ghost btn-sm" href="/course?c=${encodeURIComponent(c.slug)}" target="_blank">شوف صفحة الكورس</a></div></div>
        <form class="form-grid js-course" style="margin-top:12px">
          <div class="field"><label>اسم الكورس</label><input name="title" value="${esc(c.title)}"></div>
          <div class="field"><label>الحالة</label><select name="status">${opt("open", "متاح للاشتراك", c.status)}${opt("soon", "قيد الافتتاح قريباً", c.status)}${opt("hidden", "مخفي", c.status)}</select></div>
          <div class="field full"><label>سطر تعريفي</label><input name="subtitle" value="${esc(c.subtitle || "")}"></div>
          <div class="field full"><label>المقدمة (النبذة)</label><textarea name="intro" rows="4">${esc(c.intro || "")}</textarea></div>
          <div class="field full"><label>الكورس لمين؟ <small>(جملة بتظهر في صفحة الكورس)</small></label><input name="audience" value="${esc(c.audience || "")}"></div>
          <div class="field"><label>القسم</label><select name="track">${tracks().map((t) => opt(t.key, t.name, c.track)).join("")}${tracks().some((t) => t.key === c.track) ? "" : opt(c.track, c.track, c.track)}</select></div>
          <div class="field"><label>الأدوات <small>(مفصولة بفاصلة، زي Excel, Power BI)</small></label><input name="tools" value="${esc(c.tools || "")}"></div>
          <div class="field full"><label>مناسب لـ <small>(بيستخدم في فلتر "عايز تحقق إيه؟")</small></label><div>${audChecks(String(c.audiences || "").split(","))}</div></div>
          <div class="field full"><label>هتقدر تعمل إيه بعده؟ <small>(سطر واحد بيظهر على كارت الكورس)</small></label><input name="outcome" value="${esc(c.outcome || "")}" placeholder="مثلاً: تمسك دورة محاسبية كاملة لشركة تجارية لحد القوائم المالية"></div>
          <div class="field full"><label>وصف جوجل <small>(لحد 160 حرف، بيظهر في نتايج البحث ولما الرابط يتبعت)</small></label><textarea name="seo_desc" rows="2" maxlength="300">${esc(c.seo_desc || "")}</textarea></div>
          <div class="field"><label>الترتيب</label><input name="sort" type="number" value="${c.sort}"></div>
          <div class="field"><label>اسم التقسيم <small>(بيظهر للمتدرب في كل الصفحات وعناوين الامتحانات)</small></label>
            <select name="unit">${opt("level", "مستويات (المستوى 1، 2 ...)", c.unit.key)}${opt("unit", "وحدات (الوحدة 1، 2 ...)", c.unit.key)}${opt("module", "موديولات (الموديول 1، 2 ...)", c.unit.key)}</select></div>
          <div class="field"><label>طريقة فتح المحتوى <small>(بالترتيب للكورس اللي مبني على قصة، ومفتوح للكورس اللي كل جزء فيه مستقل)</small></label>
            <select name="unlock">${opt("sequence", "بالترتيب: الفصل بعد اللي قبله، و" + c.unit.the + " بعد امتحان اللي قبله", c.unlock)}${opt("open", "كل الكورس مفتوح: المتدرب يبدأ من أي " + c.unit.a, c.unlock)}</select></div>
          <div class="field full"><label>سطر إضافي على الشهادة <small>(اختياري، بيظهر تحت اسم الكورس. مثلاً: 10 مستويات و13 امتحان. فاضي = مفيش)</small></label><input name="cert_note" maxlength="200" value="${esc(c.cert_note || "")}"></div>
          <div class="full row"><button class="btn btn-primary" type="submit">حفظ الكورس</button><span class="status" hidden></span></div>
        </form>
        <h3 style="margin-top:22px">الباقات والأسعار</h3>
        <div class="grid grid-2" style="margin-top:10px">${c.plans.map((p) => `
          <form class="card stack js-plan" data-id="${p.id}" style="background:var(--paper)">
            <div class="spread"><b>${p.code === "pro" ? "باقة Pro" : "الباقة الأساسية"}</b>
              <span>${p.show_price ? IK.priceHTML(p) : '<span class="muted">السعر مخفي</span>'}</span></div>
            <div class="field"><label>اسم الباقة</label><input name="name" value="${esc(p.name)}"></div>
            <div class="form-grid">
              <div class="field"><label>السعر (جنيه)</label><input name="price" type="number" min="0" value="${p.price}"></div>
              <div class="field"><label>الخصم</label><select name="discount_type">${opt("none", "من غير خصم", p.discount_type)}${opt("percent", "نسبة %", p.discount_type)}${opt("amount", "مبلغ ثابت", p.discount_type)}</select></div>
              <div class="field"><label>قيمة الخصم</label><input name="discount_value" type="number" min="0" value="${p.discount_value}"></div>
              <div class="field"><label>العرض ينتهي في <small>(فاضي = مفتوح)</small></label><input name="discount_ends" type="date" value="${esc(p.discount_ends || "")}"></div>
            </div>
            <label class="check"><input type="checkbox" name="show_price" ${p.show_price ? "checked" : ""}> اعرض السعر على الموقع</label>
            <label class="check"><input type="checkbox" name="visible" ${p.visible ? "checked" : ""}> الباقة ظاهرة للزوار</label>
            <div class="field"><label>المميزات <small>(كل ميزة في سطر)</small></label><textarea name="features" rows="4">${esc(p.features.join("\n"))}</textarea></div>
            <div class="row"><button class="btn btn-primary btn-sm" type="submit">حفظ الباقة</button><span class="status" hidden></span></div>
          </form>`).join("")}</div>
        <h3 style="margin-top:22px">${c.unit.pl}</h3>
        <div class="stack" style="margin-top:10px">${c.levels.map((l) => `
          <form class="card js-level" data-id="${l.id}" style="background:var(--paper)">
            <div class="form-grid">
              <div class="field full"><label>${c.unit.the} ${l.num}: العنوان</label><input name="title" value="${esc(l.title)}"></div>
              <div class="field full"><label>المحتوى</label><input name="topics" value="${esc(l.topics || "")}"></div>
              <div class="field full"><label>المقدمة التشويقية</label><textarea name="teaser" rows="2">${esc(l.teaser || "")}</textarea></div>
            </div>
            <div class="row" style="margin-top:10px"><button class="btn btn-primary btn-sm" type="submit">حفظ</button><span class="status" hidden></span></div>
          </form>`).join("")}
          <form class="card js-addlevel row" data-course="${c.id}"><div class="field" style="flex:1"><input name="title" placeholder="عنوان ${c.unit.a} جديد"></div><button class="btn btn-ghost" type="submit">إضافة ${c.unit.a}</button></form>
        </div>
      </div>`).join("") + `
      <div class="card"><h2>إضافة مديول جديد</h2>
        <form id="newc" class="form-grid" style="margin-top:12px">
          <div class="field"><label>اسم الكورس</label><input name="title" required></div>
          <div class="field"><label>رابط مختصر بالإنجليزي <small>(مثلاً cost)</small></label><input name="slug" dir="ltr" required></div>
          <div class="field full"><label>سطر تعريفي</label><input name="subtitle"></div>
          <div class="full row"><button class="btn btn-primary" type="submit">إضافة</button><span class="status" hidden></span></div>
        </form></div>`;

    const note = (form, kind, msg) => { const s = form.querySelector(".status"); IK.status(s, kind, msg); setTimeout(() => (s.hidden = true), 2500); };
    panel.querySelectorAll(".js-course").forEach((f) => (f.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(f);
      const b = Object.fromEntries(fd);
      b.audiences = fd.getAll("audiences");
      try { await api("/admin/courses/" + f.closest("[data-course]").dataset.course, { method: "PATCH", body: b }); await loadCourses(); coursesTab(); }
      catch (err) { note(f, "bad", err.message); }
    }));
    panel.querySelectorAll(".js-plan").forEach((f) => (f.onsubmit = async (e) => {
      e.preventDefault();
      const b = Object.fromEntries(new FormData(f));
      b.show_price = f.show_price.checked; b.visible = f.visible.checked;
      try { await api("/admin/plans/" + f.dataset.id, { method: "PATCH", body: b }); await loadCourses(); coursesTab(); }
      catch (err) { note(f, "bad", err.message); }
    }));
    panel.querySelectorAll(".js-level").forEach((f) => (f.onsubmit = async (e) => {
      e.preventDefault();
      try { await api("/admin/levels/" + f.dataset.id, { method: "PATCH", body: Object.fromEntries(new FormData(f)) }); note(f, "ok", "اتحفظ"); await loadCourses(); }
      catch (err) { note(f, "bad", err.message); }
    }));
    panel.querySelectorAll(".js-addlevel").forEach((f) => (f.onsubmit = async (e) => {
      e.preventDefault();
      try { await api(`/admin/courses/${f.dataset.course}/levels`, { method: "POST", body: { title: f.title.value } }); await loadCourses(); coursesTab(); }
      catch (err) { alert(err.message); }
    }));
    $("#newc").onsubmit = async (e) => {
      e.preventDefault();
      try { await api("/admin/courses", { method: "POST", body: Object.fromEntries(new FormData(e.target)) }); await loadCourses(); coursesTab(); }
      catch (err) { note(e.target, "bad", err.message); }
    };
  }

  // ======================= المادة العلمية =======================
  let pick = { course: "financial", level: null };
  function pickers(onChange) {
    const c = courses.find((x) => x.slug === pick.course) || courses[0];
    if (!pick.level || !c.levels.find((l) => String(l.id) === String(pick.level))) pick.level = c.levels[0] && c.levels[0].id;
    const html = `<div class="row" style="margin-bottom:16px">
      <div class="field"><label>الكورس</label><select id="pc">${courseOptions(c.slug)}</select></div>
      <div class="field" style="flex:1;min-width:220px"><label>${c.unit.the}</label><select id="pl">${c.levels.map((l) => opt(l.id, l.num + ". " + l.title, pick.level)).join("")}</select></div></div>`;
    const bind = () => {
      $("#pc").onchange = (e) => { pick.course = e.target.value; pick.level = null; onChange(); };
      $("#pl").onchange = (e) => { pick.level = e.target.value; onChange(); };
    };
    return { html, course: c, bind };
  }

  async function contentTab() {
    const p = pickers(contentTab);
    const U = p.course.unit;
    if (!pick.level) { panel.innerHTML = p.html + `<div class="card empty">الكورس ده مفيهوش ${U.pl} لسه. ضيفها من تاب الكورسات.</div>`; p.bind(); return; }
    const mats = await api(`/admin/levels/${pick.level}/materials`);
    panel.innerHTML = p.html + `
      <div class="card">
        <div class="spread"><h2>فصول ${U.the}</h2>
          ${mats.length ? `<div class="row"><button class="btn btn-ghost btn-sm" id="lv-free" type="button">🎁 ${U.the} ${U.key === "unit" ? "كلها مجانية" : "كله مجاني"}</button>
            <button class="btn btn-ghost btn-sm" id="lv-lock" type="button">🔒 اقفل ${U.the} ${U.key === "unit" ? "كلها" : "كله"}</button></div>` : ""}</div>
        <p class="muted" style="margin-top:4px">كل فصل ملف لوحده، والمتدرب بيفتحهم بالترتيب ده: الفصل مايفتحش غير لما يخلص اللي قبله. رتبهم بالأسهم. ملف الـ PDF بيتحول لصفحات صور محمية عليها اسم المتدرب، ولو رفعت نسخة جديدة بتحل مكان القديمة على طول.</p>
        <p class="muted" style="margin-top:4px">🎁 <b>مجاني للتجربة:</b> علّم على أي فصل وأي زائر يقدر يفتحه من صفحة الكورس من غير اشتراك، وعليه علامة مائية "نسخة تجريبية". <a href="/course?c=${encodeURIComponent(p.course.slug)}" target="_blank" rel="noopener">شوف صفحة الكورس زي الزائر</a></p>
        <div class="stack" style="margin-top:14px">${mats.map((m, i) => `
          <div class="card" style="background:var(--paper)" data-mat="${m.id}">
            <div class="spread"><div class="row" style="gap:10px;flex-wrap:nowrap"><span class="badge num">${i + 1}</span><div><b>${m.kind === "pdf" ? "📄" : "🎬"} ${esc(m.title)}</b>
              <p class="muted">${m.kind === "pdf" ? (m.pages ? m.pages + " صفحة · نسخة " + m.version : "لسه ما اترفعش ملف") : esc(m.video_url || "من غير رابط")} · ${m.min_plan === "pro" ? "باقة Pro" : "كل الباقات"}</p></div></div>
              <div class="row">
                ${m.kind === "pdf" ? `<label class="badge${m.free ? " gold" : ""}" style="cursor:pointer;gap:6px"><input type="checkbox" class="js-free"${m.free ? " checked" : ""}> 🎁 مجاني للتجربة</label>` : ""}
                <button class="btn btn-ghost btn-sm js-up" type="button" aria-label="لفوق"${i === 0 ? " disabled" : ""}>▲</button>
                <button class="btn btn-ghost btn-sm js-down" type="button" aria-label="لتحت"${i === mats.length - 1 ? " disabled" : ""}>▼</button>
                ${m.kind === "pdf" ? `<label class="btn btn-primary btn-sm">${m.pages ? "رفع نسخة جديدة" : "رفع PDF"}<input type="file" accept="application/pdf" hidden class="js-file"></label>` : ""}
                <button class="btn btn-ghost btn-sm js-edit" type="button">تعديل</button>
                <button class="btn btn-danger btn-sm js-del" type="button">مسح</button>
              </div></div>
            <div class="js-prog" hidden style="margin-top:10px"><div class="bar"><i style="width:0%"></i></div><p class="muted js-ptext"></p></div>
          </div>`).join("") || `<p class="muted">مفيش فصول في ${U.this} لسه.</p>`}</div>
      </div>
      <div class="card" id="split"><h2>رفع ملف ${U.the} كله وتقسيمه لفصول</h2>
        <p class="muted" style="margin-top:4px">اختار ملف الـ PDF الكامل، واكتب كل فصل في سطر: العنوان، وبعده علامة | وبعدها الصفحات من-إلى. المنصة بتعمل فصل لكل سطر وترفعه، والفصول بتتضاف بعد الموجودين بنفس الترتيب.</p>
        <div class="form-grid" style="margin-top:12px">
          <div class="field full"><label class="btn btn-ghost" style="justify-self:start">اختار ملف PDF<input type="file" accept="application/pdf" hidden id="sp-file"></label> <span class="muted" id="sp-name"></span></div>
          <div class="field full"><label>الفصول <small>(مثال: الفصل الأول: كريم وقرار العمر | 4-4)</small></label>
            <textarea id="sp-lines" rows="8" dir="rtl" placeholder="مقدمة: خريطة الرحلة | 1-3&#10;الفصل الأول: كريم وقرار العمر | 4-4&#10;الفصل الثاني: الفروض المحاسبية | 5-6"></textarea></div>
          <div class="field"><label>متاحة لـ</label><select id="sp-plan">${opt("basic", "كل الباقات")}${opt("pro", "باقة Pro بس")}</select></div>
          <div class="full row"><button class="btn btn-primary" type="button" id="sp-go" disabled>قسّم وارفع</button></div>
          <div class="full" id="sp-prog" hidden><div class="bar"><i style="width:0%"></i></div><p class="muted" id="sp-text"></p></div>
        </div></div>
      <div class="card"><h2>إضافة فصل واحد</h2>
        <form id="addm" class="form-grid" style="margin-top:12px">
          <div class="field"><label>النوع</label><select name="kind">${opt("pdf", "PDF")}${opt("video", "فيديو (باقة Pro)")}</select></div>
          <div class="field"><label>العنوان</label><input name="title" required placeholder="مثلاً: الفصل الأول: كريم وقرار العمر"></div>
          <div class="field"><label>متاحة لـ</label><select name="min_plan">${opt("basic", "كل الباقات")}${opt("pro", "باقة Pro بس")}</select></div>
          <div class="field"><label>رابط الفيديو <small>(للفيديو بس: YouTube غير مدرج أو Bunny)</small></label><input name="video_url" dir="ltr"></div>
          <div class="full row"><button class="btn btn-primary" type="submit">إضافة</button><span class="status" hidden></span></div>
        </form></div>`;
    p.bind();
    const nextSort = () => (mats.length ? Math.max(...mats.map((m) => m.sort || 0), mats.length * 10) + 10 : 10);
    $("#addm").onsubmit = async (e) => {
      e.preventDefault();
      try { await api(`/admin/levels/${pick.level}/materials`, { method: "POST", body: { ...Object.fromEntries(new FormData(e.target)), sort: nextSort() } }); contentTab(); }
      catch (err) { IK.status(e.target.querySelector(".status"), "bad", err.message); }
    };
    // الترتيب: بنعيد ترقيم الكل 10، 20، 30 ... بعد التبديل
    const move = async (i, d) => {
      const order = mats.slice();
      [order[i], order[i + d]] = [order[i + d], order[i]];
      await Promise.all(order.map((m, k) => api("/admin/materials/" + m.id, { method: "PATCH", body: { sort: (k + 1) * 10 } })));
      contentTab();
    };
    panel.querySelectorAll("[data-mat]").forEach((box, i) => {
      const m = mats[i];
      const file = box.querySelector(".js-file");
      if (file) file.onchange = () => file.files[0] && uploadPdf(m, file.files[0], box);
      const fr = box.querySelector(".js-free");
      if (fr) fr.onchange = async () => {
        try { await api("/admin/materials/" + m.id, { method: "PATCH", body: { free: fr.checked ? 1 : 0 } }); m.free = fr.checked ? 1 : 0; fr.parentElement.classList.toggle("gold", fr.checked); }
        catch (err) { fr.checked = !fr.checked; alert(err.message); }
      };
      box.querySelector(".js-up").onclick = () => move(i, -1);
      box.querySelector(".js-down").onclick = () => move(i, 1);
      box.querySelector(".js-del").onclick = async () => {
        if (!confirm("متأكد إنك عايز تمسح الفصل ده؟")) return;
        await api("/admin/materials/" + m.id, { method: "DELETE" }); contentTab();
      };
      box.querySelector(".js-edit").onclick = async () => {
        const title = prompt("عنوان الفصل", m.title);
        if (title === null) return;
        const body = { title };
        if (m.kind === "video") { const v = prompt("رابط الفيديو", m.video_url || ""); if (v !== null) body.video_url = v; }
        await api("/admin/materials/" + m.id, { method: "PATCH", body }); contentTab();
      };
    });

    const setLevelFree = async (free) => {
      if (!confirm(free ? `كل فصول ${U.the} هتبقى مجانية للزوار. متأكد؟` : `كل فصول ${U.the} هترجع للمشتركين بس. متأكد؟`)) return;
      await api(`/admin/levels/${pick.level}/free`, { method: "PUT", body: { free } }); contentTab();
    };
    if ($("#lv-free")) { $("#lv-free").onclick = () => setLevelFree(1); $("#lv-lock").onclick = () => setLevelFree(0); }

    // تقسيم ملف كامل لفصول
    let spPdf = null;
    $("#sp-file").onchange = async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const pdf = await openPdfFile(f, $("#sp-name"));
      if (!pdf) return;
      spPdf = pdf;
      $("#sp-name").textContent = `${f.name} · ${pdf.numPages} صفحة`;
      if (!$("#sp-lines").value.trim()) $("#sp-lines").value = `${f.name.replace(/\.pdf$/i, "")} | 1-${pdf.numPages}`;
      $("#sp-go").disabled = false;
    };
    $("#sp-go").onclick = async () => {
      const txt = $("#sp-text"), bar = $("#sp-prog").querySelector("i");
      $("#sp-prog").hidden = false;
      const parts = [];
      for (const [k, raw] of $("#sp-lines").value.split("\n").map((s) => s.trim()).filter(Boolean).entries()) {
        const m = raw.match(/^(.+?)\s*\|\s*([0-9٠-٩]+)\s*[-–]\s*([0-9٠-٩]+)\s*$/);
        const num = (s) => Number(String(s).replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d)));
        if (!m) { txt.textContent = `السطر ${k + 1} مكتوب غلط. اكتبه كده: العنوان | 4-6`; return; }
        const from = num(m[2]), to = num(m[3]);
        if (!(from >= 1 && to >= from && to <= spPdf.numPages)) { txt.textContent = `صفحات السطر ${k + 1} غلط: الملف فيه ${spPdf.numPages} صفحة بس.`; return; }
        parts.push({ title: m[1].trim(), from, to });
      }
      if (!parts.length) { txt.textContent = "اكتب فصل واحد على الأقل."; return; }
      $("#sp-go").disabled = true;
      const all = parts.reduce((a, x) => a + x.to - x.from + 1, 0);
      let doneN = 0, sort = nextSort();
      try {
        for (const [k, part] of parts.entries()) {
          const { id } = await api(`/admin/levels/${pick.level}/materials`, { method: "POST", body: { kind: "pdf", title: part.title, min_plan: $("#sp-plan").value, sort } });
          sort += 10;
          await pushPages({ id, version: 0 }, spPdf, part.from, part.to, (n, total) => {
            txt.textContent = `الفصل ${k + 1} من ${parts.length} (${part.title}): صفحة ${n} من ${total}...`;
            bar.style.width = Math.round(((doneN + n) / all) * 100) + "%";
          });
          doneN += part.to - part.from + 1;
        }
        txt.textContent = `تم. اترفع ${parts.length} فصل ووصلوا للمتدربين.`;
        setTimeout(contentTab, 1500);
      } catch (err) { txt.textContent = "الرفع وقف: " + err.message + " الفصول اللي اترفعت موجودة فوق، كمل الباقي."; $("#sp-go").disabled = false; }
    };
  }

  async function openPdfFile(file, msgEl) {
    if (!window.pdfjsLib) { msgEl.textContent = "مكتبة قراءة الـ PDF ما اتحملتش. اتأكد من النت وحدث الصفحة."; return null; }
    pdfjsLib.GlobalWorkerOptions.workerSrc = "/assets/vendor/pdfjs-3.11.174/pdf.worker.min.js";
    return pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  }

  // بيحول صفحات from..to من الملف لصور ويرفعها كنسخة جديدة من المادة، وبعدين ينشرها
  async function pushPages(m, pdf, from, to, onPage) {
    const version = m.version + 1, total = to - from + 1;
    const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d");
    for (let n = 1; n <= total; n++) {
      onPage(n, total);
      const page = await pdf.getPage(from + n - 1);
      const base = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: Math.min(2.5, 1400 / base.width) });
      canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      const blob = await new Promise((r) => canvas.toBlob(r, "image/webp", 0.82));
      await api(`/admin/materials/${m.id}/pages/${n}?v=${version}`, { method: "PUT", body: blob, type: "image/webp" });
    }
    await api(`/admin/materials/${m.id}/publish`, { method: "POST", body: { version, pages: total } });
  }

  async function uploadPdf(m, file, box) {
    const prog = box.querySelector(".js-prog"), bar = prog.querySelector("i"), txt = box.querySelector(".js-ptext");
    prog.hidden = false;
    try {
      const pdf = await openPdfFile(file, txt);
      if (!pdf) return;
      await pushPages(m, pdf, 1, pdf.numPages, (n, total) => {
        txt.textContent = `بحول وبرفع صفحة ${n} من ${total}...`;
        bar.style.width = Math.round((n / total) * 100) + "%";
      });
      txt.textContent = `تم. اترفعت ${pdf.numPages} صفحة ووصلت للمتدربين.`;
      setTimeout(contentTab, 1200);
    } catch (err) { txt.textContent = "الرفع وقف: " + err.message + " جرب تاني."; }
  }

  // ======================= الامتحانات =======================
  let examPick = null;
  async function examsTab() {
    const c = courses.find((x) => x.slug === pick.course) || courses[0];
    const exams = await api(`/admin/courses/${c.id}/exams`);
    if (!examPick || !exams.find((e) => String(e.id) === String(examPick))) examPick = exams[0] && exams[0].id;
    const ex = exams.find((e) => String(e.id) === String(examPick));
    panel.innerHTML = `
      <div class="row" style="margin-bottom:16px"><div class="field"><label>الكورس</label><select id="pc">${courseOptions(c.slug)}</select></div></div>
      <div class="card"><h2>امتحانات الكورس</h2>
        <div class="table-wrap" style="margin-top:12px"><table class="t"><thead><tr><th>الامتحان</th><th>بعد ${esc(c.unit.the)}</th><th>أسئلة في كل محاولة</th><th>النجاح من % أو أكتر</th><th>المدة (دقيقة)</th><th>بنك الأسئلة</th><th></th></tr></thead><tbody>
        ${exams.map((e) => `<tr data-ex="${e.id}"${String(e.id) === String(examPick) ? ' style="background:#FBF7EE"' : ""}>
          <td><input class="js-t" value="${esc(e.title)}" style="font:inherit;width:100%;border:1px solid var(--line);border-radius:6px;padding:4px 8px"></td>
          <td>${e.after_level}${e.kind === "cumulative" ? ' <span class="badge gold">تراكمي</span>' : ""}</td>
          <td><input class="js-c num" type="number" min="1" value="${e.question_count}" style="width:70px"></td>
          <td><input class="js-p num" type="number" min="0" max="100" value="${e.pass_pct}" style="width:70px"></td>
          <td><span class="stepper"><button type="button" class="js-dm" aria-label="أقل">−</button><input class="js-d num" type="number" min="0" max="300" value="${e.duration_min ?? 15}"><button type="button" class="js-dp" aria-label="أكتر">+</button></span></td>
          <td>${e.bank ? `<span class="badge ok">${e.bank} سؤال</span>` : '<span class="badge bad">فاضي</span>'}</td>
          <td><div class="row"><button class="btn btn-ghost btn-sm js-save" type="button">حفظ</button><button class="btn btn-primary btn-sm js-open" type="button">الأسئلة</button>
          ${e.kind === "cumulative" ? '<button class="btn btn-danger btn-sm js-delx" type="button">مسح</button>' : ""}</div></td></tr>`).join("")}
        </tbody></table></div>
        <p class="muted" style="margin-top:8px">لو بنك الأسئلة أكبر من عدد أسئلة المحاولة، كل محاولة بتسحب أسئلة مختلفة. يفضل يكون البنك ضعف العدد أو أكتر. ${esc(c.unit.the)} ${c.unit.key === "unit" ? "الجاية" : "الجاي"} مش ${c.unit.opens} غير لما المتدرب يعدي الامتحان، فلازم كل امتحان يبقى فيه أسئلة. المدة هي متوسط الحل اللي بيظهر للمتدرب، ولما تخلص الامتحان بيتسلم لوحده (0 = من غير وقت). اضغط حفظ بعد أي تعديل.</p>
        <form id="addx" class="row" style="margin-top:12px"><span>إضافة امتحان تراكمي بعد ${esc(c.unit.the)}</span><input name="after_level" type="number" min="1" style="width:70px" required><button class="btn btn-ghost btn-sm" type="submit">إضافة</button></form>
      </div>
      ${ex ? `<div class="card" id="qs"><div class="loading">جاري تحميل الأسئلة...</div></div>` : ""}`;
    $("#pc").onchange = (e) => { pick.course = e.target.value; examPick = null; examsTab(); };
    panel.querySelectorAll("tr[data-ex]").forEach((tr) => {
      const id = tr.dataset.ex;
      tr.querySelector(".js-save").onclick = async () => {
        try { await api("/admin/exams/" + id, { method: "PATCH", body: { title: tr.querySelector(".js-t").value, question_count: Number(tr.querySelector(".js-c").value), pass_pct: Number(tr.querySelector(".js-p").value), duration_min: Number(tr.querySelector(".js-d").value) } }); examsTab(); }
        catch (err) { alert(err.message); }
      };
      tr.querySelector(".js-open").onclick = () => { examPick = id; examsTab(); };
      const d = tr.querySelector(".js-d");
      tr.querySelector(".js-dm").onclick = () => { d.value = Math.max(0, (Number(d.value) || 0) - 1); };
      tr.querySelector(".js-dp").onclick = () => { d.value = Math.min(300, (Number(d.value) || 0) + 1); };
      const dx = tr.querySelector(".js-delx");
      if (dx) dx.onclick = async () => { if (confirm("مسح الامتحان التراكمي ده وكل أسئلته؟")) { await api("/admin/exams/" + id, { method: "DELETE" }); examsTab(); } };
    });
    $("#addx").onsubmit = async (e) => { e.preventDefault(); try { await api(`/admin/courses/${c.id}/exams`, { method: "POST", body: { after_level: e.target.after_level.value } }); examsTab(); } catch (err) { alert(err.message); } };
    if (ex) questions(ex);
  }

  function parsePaste(text) {
    // من Excel: السؤال | اختيار 1 | اختيار 2 | اختيار 3 | اختيار 4 | رقم الإجابة الصح | الشرح (اختياري)
    return text.split(/\r?\n/).map((l) => l.split("\t")).filter((c) => c.join("").trim()).map((c) => {
      const cells = c.map((x) => x.trim());
      let ansIdx = -1;
      for (let i = cells.length - 1; i >= 2; i--) if (/^[1-9١-٩]$/.test(cells[i])) { ansIdx = i; break; }
      if (ansIdx < 0) return { body: cells[0], options: cells.slice(1), answer: 0 };
      return { body: cells[0], options: cells.slice(1, ansIdx).filter(Boolean), answer: cells[ansIdx], explanation: cells.slice(ansIdx + 1).join(" ") };
    });
  }

  async function questions(ex) {
    const box = $("#qs");
    const list = await api(`/admin/exams/${ex.id}/questions`);
    box.innerHTML = `<div class="spread"><h2>أسئلة: ${esc(ex.title)}</h2><span class="badge">${list.length} سؤال</span></div>
      <div class="grid grid-2" style="margin-top:14px">
        <form id="one" class="card stack" style="background:var(--paper)"><h3>إضافة سؤال</h3>
          <div class="field"><label>السؤال</label><textarea name="body" rows="2" required></textarea></div>
          ${[1, 2, 3, 4].map((i) => `<div class="field"><label>اختيار ${i}${i > 2 ? " <small>(اختياري)</small>" : ""}</label><input name="o${i}"></div>`).join("")}
          <div class="field"><label>رقم الإجابة الصح</label><select name="answer">${[1, 2, 3, 4].map((i) => opt(i, i)).join("")}</select></div>
          <div class="field"><label>توضيح الإجابة <small>(اختياري، بيظهر للمتدرب لو غلط فيه)</small></label><input name="explanation"></div>
          <div class="row"><button class="btn btn-primary btn-sm" type="submit">إضافة السؤال</button><span class="status" hidden></span></div>
        </form>
        <form id="bulk" class="card stack" style="background:var(--paper)"><h3>لصق من Excel</h3>
          <p class="muted">رتب الأعمدة كده: السؤال، الاختيارات (من 2 لـ 4 أعمدة)، رقم الإجابة الصح، توضيح الإجابة (اختياري، بيظهر للمتدرب في مراجعة أخطاؤه). علّم على الصفوف في Excel واعمل نسخ ولصق هنا.</p>
          <div class="field"><textarea name="paste" rows="8" dir="auto" placeholder="الأصول = ؟	الخصوم + حقوق الملكية	الإيرادات - المصروفات	1"></textarea></div>
          <label class="check"><input type="checkbox" name="replace"> امسح الأسئلة القديمة واستبدلها</label>
          <div class="row"><button class="btn btn-primary btn-sm" type="submit">إضافة الأسئلة</button><span class="muted" id="bulk-n"></span></div>
          <div class="status" id="bulk-st" hidden></div>
        </form>
      </div>
      <div class="stack" style="margin-top:16px">${list.map((q, i) => `
        <div class="card" style="background:var(--paper)" data-q="${q.id}">
          <div class="spread"><b>${i + 1}. ${esc(q.body)}</b><div class="row"><button class="btn btn-ghost btn-sm js-qe" type="button">تعديل</button><button class="btn btn-danger btn-sm js-qd" type="button">مسح</button></div></div>
          <ol style="margin:8px 0 0">${q.options.map((o, k) => `<li${k === q.answer ? ' style="color:var(--ok);font-weight:700"' : ""}>${esc(o)}${k === q.answer ? " ✓" : ""}</li>`).join("")}</ol>
          ${q.explanation ? `<p class="muted">${esc(q.explanation)}</p>` : ""}
        </div>`).join("")}</div>`;
    const one = $("#one");
    one.onsubmit = async (e) => {
      e.preventDefault();
      const b = Object.fromEntries(new FormData(one));
      try {
        await api(`/admin/exams/${ex.id}/questions`, { method: "POST", body: { body: b.body, options: [b.o1, b.o2, b.o3, b.o4], answer: b.answer, explanation: b.explanation } });
        examsTab();
      } catch (err) { IK.status(one.querySelector(".status"), "bad", err.message); }
    };
    const bulk = $("#bulk");
    bulk.paste.oninput = () => { const n = parsePaste(bulk.paste.value).length; $("#bulk-n").textContent = n ? n + " سؤال جاهز" : ""; };
    bulk.onsubmit = async (e) => {
      e.preventDefault();
      const items = parsePaste(bulk.paste.value);
      if (!items.length) return IK.status($("#bulk-st"), "bad", "الصق الأسئلة الأول.");
      if (bulk.replace.checked && !confirm(`هتمسح ${list.length} سؤال قديم وتحط ${items.length} سؤال جديد. متأكد؟`)) return;
      try { const r = await api(`/admin/exams/${ex.id}/questions`, { method: "POST", body: { items, replace: bulk.replace.checked } }); IK.status($("#bulk-st"), "ok", `اتضاف ${r.added} سؤال.`); setTimeout(examsTab, 900); }
      catch (err) { IK.status($("#bulk-st"), "bad", err.message); }
    };
    box.querySelectorAll("[data-q]").forEach((el) => {
      const q = list.find((x) => String(x.id) === el.dataset.q);
      el.querySelector(".js-qd").onclick = async () => { if (confirm("مسح السؤال ده؟")) { await api("/admin/questions/" + q.id, { method: "DELETE" }); examsTab(); } };
      el.querySelector(".js-qe").onclick = () => {
        el.innerHTML = `<form class="stack"><div class="field"><label>السؤال</label><textarea name="body" rows="2">${esc(q.body)}</textarea></div>
          ${[0, 1, 2, 3].map((k) => `<div class="field"><label>اختيار ${k + 1}</label><input name="o${k}" value="${esc(q.options[k] || "")}"></div>`).join("")}
          <div class="field"><label>رقم الإجابة الصح</label><select name="answer">${[1, 2, 3, 4].map((i) => opt(i, i, q.answer + 1)).join("")}</select></div>
          <div class="field"><label>توضيح الإجابة</label><input name="explanation" value="${esc(q.explanation || "")}"></div>
          <div class="row"><button class="btn btn-primary btn-sm" type="submit">حفظ</button><button class="btn btn-ghost btn-sm js-cancel" type="button">إلغاء</button><span class="status" hidden></span></div></form>`;
        const f = el.querySelector("form");
        f.querySelector(".js-cancel").onclick = () => questions(ex);
        f.onsubmit = async (e) => {
          e.preventDefault();
          const b = Object.fromEntries(new FormData(f));
          try { await api("/admin/questions/" + q.id, { method: "PATCH", body: { body: b.body, options: [b.o0, b.o1, b.o2, b.o3], answer: b.answer, explanation: b.explanation } }); questions(ex); }
          catch (err) { IK.status(f.querySelector(".status"), "bad", err.message); }
        };
      };
    });
  }

  // ======================= المتدربين المنقطعين =======================
  async function inactiveTab(days) {
    const s = await api("/admin/settings");
    const r = await api("/admin/inactive" + (days ? "?days=" + days : ""));
    const link = location.origin + "/dashboard";
    const remind = (u) => IK.wa(intlPhone(u.phone), IK.fill(s.reminder_message || "أهلاً يا {name}، كمل كورس {course} من هنا: {link}", { name: u.name.split(" ")[0], course: u.course, level: u.level, link }));
    const ago = (t) => { if (!t) return "عمره ما دخل"; const d = Math.floor((Date.now() - Date.parse(t.replace(" ", "T") + "Z")) / 864e5); return d + " يوم"; };
    panel.innerHTML = `
      <div class="card stack">
        <div class="spread"><h2>متدربين منقطعين</h2>
          <form id="dd" class="row"><span>مدخلوش من</span><input name="days" type="number" min="1" max="365" value="${r.days}" style="width:70px"><span>يوم أو أكتر</span><button class="btn btn-ghost btn-sm" type="submit">عرض</button></form></div>
        <p class="muted">دول المتدربين اللي اشتراكهم ساري ولسه ما خلصوش الكورس ومدخلوش المنصة في المدة دي. زرار التذكير بيفتح واتساب برسالة جاهزة باسمه والمكان اللي واقف عنده، وتقدر تعدل الرسالة من الإعدادات.</p>
        ${r.students.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>الاسم</th><th>الكورس</th><th>واقف عند</th><th>التقدم</th><th>آخر نشاط</th><th></th></tr></thead><tbody>
          ${r.students.map((u) => `<tr><td>${esc(u.name)}<br><span class="muted num">${esc(u.phone || u.email || "")}</span></td><td>${esc(u.course)}</td><td>${esc(u.level)}</td>
            <td class="num">${u.progress}%</td><td>${esc(ago(u.seen))}</td>
            <td>${u.phone ? `<a class="btn btn-wa btn-sm" target="_blank" rel="noopener" href="${remind(u)}">${IK.chatIcon}تذكير</a>` : '<span class="muted">مفيش رقم</span>'}</td></tr>`).join("")}
          </tbody></table></div>` : '<div class="empty">مفيش متدربين منقطعين في المدة دي. 👌</div>'}
      </div>`;
    $("#dd").onsubmit = (e) => { e.preventDefault(); inactiveTab(e.target.days.value); };
  }

  // ======================= الإعدادات =======================
  async function settingsTab() {
    const s = await api("/admin/settings");
    const field = (k, label, hint = "", ltr = false, area = false) => `<div class="field${area ? " full" : ""}"><label>${label}${hint ? ` <small>(${hint})</small>` : ""}</label>
      ${area ? `<textarea name="${k}" rows="2">${esc(s[k] || "")}</textarea>` : `<input name="${k}" value="${esc(s[k] || "")}"${ltr ? ' dir="ltr"' : ""}>`}</div>`;
    panel.innerHTML = `
      <form id="sf" class="card form-grid">
        <h2 class="full">بيانات المنصة</h2>
        ${field("brand_name", "اسم المنصة", "بيظهر في الهيدر والشهادة")}
        ${field("brand_by", "السطر الصغير تحت الاسم", "زي by Mr. Islam Khalifa", true)}
        ${field("cert_signature", "التوقيع على الشهادة")}
        ${field("cert_issuer", "الجهة المصدرة للشهادة", "بتظهر تحت اللوجو. فاضي = اسم المنصة", true)}
        <h2 class="full" style="margin-top:10px">ديباجة الشهادة <small class="muted">(الفاضي بيرجع للنص الافتراضي، وتقدر تشوف الشكل من زرار "معاينة الشهادة" في تاب الكورسات)</small></h2>
        ${field("cert_title", "العنوان", "افتراضي: شهادة إتمام")}
        ${field("cert_title_en", "العنوان بالإنجليزي", "افتراضي: CERTIFICATE OF COMPLETION", true)}
        ${field("cert_lead", "قبل اسم المتدرب", "افتراضي: تشهد المنصة بأن")}
        ${field("cert_course_lead", "قبل اسم الكورس", "افتراضي: أتم بنجاح كورس")}
        ${field("footer_line1", "الفوتر: السطر الأول")}
        ${field("footer_line2", "الفوتر: السطر التاني")}
        <h2 class="full" style="margin-top:10px">العلامة المائية على المادة العلمية</h2>
        <div class="field"><label>بيانات المتدرب (الاسم والرقم والتاريخ) <small>(بننصح تفضل ظاهرة، علشان لو حد صوّر الشاشة ونشرها يبان هو مين)</small></label>
          <select name="wm_student"><option value="1">تظهر</option><option value="0"${s.wm_student === "0" ? " selected" : ""}>متظهرش</option></select></div>
        <div class="field"><label>درجة الوضوح</label>
          <select name="wm_level">${[["light", "خفيفة"], ["medium", "متوسطة"], ["strong", "واضحة"]].map(([v, t]) => `<option value="${v}"${(s.wm_level || "medium") === v ? " selected" : ""}>${t}</option>`).join("")}</select></div>
        ${field("wm_text", "نص إضافي في العلامة المائية", "زي IK Academy. فاضي = من غير نص إضافي", true)}
        <div class="field full"><label>معاينة <small>(بتتغير وانت بتعدل، وبتتحفظ لما تدوس حفظ الإعدادات)</small></label>
          <canvas id="wm-prev" width="800" height="1000" style="width:100%;max-width:340px;border:1px solid var(--line);border-radius:8px;background:#fff"></canvas></div>
        <h2 class="full" style="margin-top:10px">أرقام التواصل</h2>
        ${field("whatsapp", "واتساب خدمة العملاء", "الاشتراك، الاستفسار عن الكورسات، التجديد", true)}
        ${field("whatsapp_display", "رقم خدمة العملاء زي ما يظهر للزوار", "", true)}
        ${field("support_whatsapp", "واتساب الدعم الفني", "نسيت الباسورد، مشاكل الدخول والملفات. فاضي = رقم خدمة العملاء", true)}
        ${field("lecturer_whatsapp", "واتساب المحاضر الاحتياطي", "لو الكورس ملوش محاضر برقم في تبويب المحاضرين. فاضي = رقم خدمة العملاء", true)}
        <div class="field"><label>زرار "كلّم المحاضر" جوه الكورس <small>(أرقام المحاضرين بتتظبط من تبويب المحاضرين)</small></label>
          <select name="follow_mode">${[["lecturer", "يروح لمحاضر الكورس"], ["service", "يروح لخدمة العملاء (\"كلّمنا\")"], ["hidden", "يستخبى خالص"]].map(([v, t]) => `<option value="${v}"${(s.follow_mode || "lecturer") === v ? " selected" : ""}>${t}</option>`).join("")}</select></div>
        <h2 class="full" style="margin-top:10px">رسايل الواتساب الجاهزة</h2>
        ${field("subscribe_message", "رسالة الاشتراك (خدمة العملاء)", "{course} اسم الكورس، {plan} الباقة", false, true)}
        ${field("notify_message", "رسالة بلغني لما يفتح (خدمة العملاء)", "{course} اسم الكورس", false, true)}
        ${field("support_message", "رسالة الدعم الفني", "{name} اسم المتدرب", false, true)}
        ${field("follow_message", "رسالة المحاضر", "{name} الاسم، {course} الكورس، {level} واقف عند فين، {lecturer} اسم محاضر الكورس", false, true)}
        ${field("reminder_message", "رسالة تذكير المتدرب المنقطع", "{name} الاسم، {course} الكورس، {level} واقف عند فين، {link} رابط المنصة", false, true)}
        ${field("activation_message", "رسالة التفعيل للمتدرب الجديد", "{name} الاسم، {course} الكورس، {link} رابط التفعيل، {login} رابط الدخول، {id} بيدخل بإيه. فاضي = الرسالة الافتراضية", false, true)}
        ${field("inactive_days", "يعتبر منقطع بعد كام يوم من غير دخول", "", true)}
        <h2 class="full" style="margin-top:10px">أقسام الأكاديمية ومكتبة IK</h2>
        <div class="field full"><label>الأقسام <small>(كل قسم في سطر: المفتاح بالإنجليزي | الاسم | سطر تعريفي. المفتاح مايتغيرش بعد ما تربط بيه كورسات)</small></label>
          <textarea name="tracks" rows="4" dir="rtl">${esc(s.tracks || "")}</textarea></div>
        <div class="field full"><label>تصنيفات المكتبة <small>(كل تصنيف في سطر: مفتاح القسم | اسم التصنيف)</small></label>
          <textarea name="lib_subcats" rows="6" dir="rtl">${esc(s.lib_subcats || "")}</textarea></div>
        <div class="full row"><button class="btn btn-primary" type="submit">حفظ الإعدادات</button><span class="status" hidden></span></div>
      </form>
      <div class="card stack">
        <h2>خلفية الشهادة</h2>
        <p class="muted">ارفع تصميم الشهادة اللي عملته على Canva أو Leonardo (صورة بالعرض، مقاس 3508×2480 أو 1123×794، من غير الاسم والتاريخ). المنصة بتكتب اسم المتدرب والكورس والكود فوقها. لو مرفعتش صورة، بيتستخدم التصميم الافتراضي.</p>
        <div class="row"><label class="btn btn-primary">رفع صورة الخلفية<input type="file" id="bg" accept="image/png,image/jpeg,image/webp" hidden></label>
          ${s.cert_bg ? '<a class="btn btn-ghost" href="/api/public/cert-bg" target="_blank">شوف الخلفية الحالية</a>' : ""}</div>
        <div class="status" id="bg-st" hidden></div>
      </div>
      <div class="card stack"><h2>نسخة احتياطية</h2>
        <p class="muted">ملف فيه كل بيانات المنصة: المتدربين والاشتراكات والدرجات والزوار والإعدادات. نزّله قبل أي تحديث كبير واحتفظ بيه في مكان آمن (فيه أرقام الناس). صفحات الـ PDF وملفات المكتبة نفسها مش جواه، فخلي الملفات الأصلية عندك.</p>
        <div class="row"><a class="btn btn-primary" href="/api/admin/backup.json">⬇ تنزيل نسخة احتياطية</a></div></div>
      <div class="card stack"><h2>حسابي</h2><a class="btn btn-ghost" href="/account">تغيير باسورد الأدمن</a></div>`;
    const sf = $("#sf");
    const prev = () => {
      const cv = $("#wm-prev"), ctx = cv.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.fillStyle = "#102B4E"; ctx.font = '700 38px "IBM Plex Sans Arabic", Tahoma'; ctx.textAlign = "center"; ctx.fillText("نموذج صفحة من المادة العلمية", 400, 110);
      ctx.fillStyle = "#d9dee5";
      for (let y = 180; y < 880; y += 46) ctx.fillRect(80 + ((y / 46) % 3) * 30, y, 640 - ((y / 46) % 3) * 30, 14);
      IK.drawPageMarks(ctx, cv.width, cv.height, { ...s, ...Object.fromEntries(new FormData(sf)) }, { name: "أحمد محمد", phone: "01012345678" });
    };
    sf.addEventListener("input", prev);
    sf.addEventListener("change", prev);
    prev();
    sf.onsubmit = async (e) => {
      e.preventDefault();
      try { await api("/admin/settings", { method: "PUT", body: Object.fromEntries(new FormData(sf)) }); IK.status(sf.querySelector(".status"), "ok", "اتحفظ"); adminSettings = await api("/admin/settings"); }
      catch (err) { IK.status(sf.querySelector(".status"), "bad", err.message); }
    };
    $("#bg").onchange = async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try { await api("/admin/cert-bg", { method: "PUT", body: f, type: f.type }); IK.status($("#bg-st"), "ok", "الخلفية اترفعت."); setTimeout(settingsTab, 900); }
      catch (err) { IK.status($("#bg-st"), "bad", err.message); }
    };
  }

  // ======================= الإحصائيات =======================
  async function statsTab() {
    const d = await api("/admin/stats");
    const get = (kind, ref) => d.rows.find((r) => r.kind === kind && r.ref === (ref || "")) || { today: 0, d7: 0, d30: 0 };
    const sum = (kind) => d.rows.filter((r) => r.kind === kind).reduce((a, r) => ({ today: a.today + r.today, d7: a.d7 + r.d7, d30: a.d30 + r.d30 }), { today: 0, d7: 0, d30: 0 });
    const cells = (x) => `<td class="num">${x.today}</td><td class="num">${x.d7}</td><td class="num">${x.d30}</td>`;
    const head = (first) => `<thead><tr><th>${first}</th><th>النهارده</th><th>آخر 7 أيام</th><th>آخر 30 يوم</th></tr></thead>`;
    const tile = (label, x, hint) => `<div class="card" style="background:var(--paper)"><p class="muted">${label}</p><b class="num" style="font-size:28px;color:var(--navy)">${x.d30}</b><p class="muted" style="font-size:13px">آخر 30 يوم · النهارده ${x.today}${hint ? " · " + hint : ""}</p></div>`;
    const home = get("home_view"), cv = sum("course_view"), subs = sum("wa_subscribe"), notify = sum("wa_notify"), free = sum("free_open");
    const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 + "%" : "—");
    // آخر 30 يوم: زيارات الصفحة الرئيسية + صفحات الكورسات في كل يوم
    const days = [];
    for (let k = 29; k >= 0; k--) days.push(new Date(Date.now() - k * 864e5).toISOString().slice(0, 10));
    const perDay = days.map((day) => d.daily.filter((x) => x.day === day && (x.kind === "home_view" || x.kind === "course_view")).reduce((a, x) => a + x.n, 0));
    const max = Math.max(1, ...perDay);
    const freeRows = d.rows.filter((r) => r.kind === "free_open").map((r) => ({ ...r, m: d.free.find((m) => String(m.id) === r.ref) }));
    panel.innerHTML = `
      <div class="card"><div class="spread"><h2>الإحصائيات</h2><button class="btn btn-ghost btn-sm" id="st-re" type="button">تحديث</button></div>
        <p class="muted" style="margin-top:4px">بتتحسب من المنصة نفسها ومن غير أي خدمة خارجية. زياراتك إنت كأدمن مش بتتحسب. الأرقام بتبدأ من يوم تشغيل التحديث ده.</p>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-top:14px">
          ${tile("زيارات الصفحة الرئيسية", home)}${tile("زيارات صفحات الكورسات", cv)}${tile("ضغطات اشترك على واتساب", subs, "من زيارات الكورسات " + pct(subs.d30, cv.d30))}
          ${tile("ضغطات بلغني أول ما يفتح", notify)}${tile("فتح الفصول المجانية", free)}</div>
        <h3 style="margin-top:18px">الزيارات في آخر 30 يوم</h3>
        <div style="display:flex;align-items:flex-end;gap:3px;height:110px;margin-top:8px;direction:ltr" aria-label="الزيارات اليومية">${perDay.map((n, k) =>
          `<div title="${days[k]}: ${n} زيارة" style="flex:1;min-width:0;height:${Math.max(2, Math.round((n / max) * 100))}%;background:${n ? "var(--navy)" : "var(--line)"};border-radius:3px 3px 0 0"></div>`).join("")}</div>
        <div class="spread muted" style="font-size:12px;direction:ltr"><span>${days[0]}</span><span>${days[29]}</span></div>
      </div>
      <div class="card"><h2>لكل كورس</h2>
        <div class="table-wrap" style="margin-top:10px"><table style="width:100%"><thead><tr><th>الكورس</th><th>زيارات (7 أيام)</th><th>زيارات (30 يوم)</th><th>اشترك (30 يوم)</th><th>بلغني (30 يوم)</th><th>نسبة الاشتراك</th></tr></thead><tbody>
        ${d.courses.map((c) => { const v = get("course_view", c.slug), w = get("wa_subscribe", c.slug), n = get("wa_notify", c.slug);
          return `<tr><td>${esc(c.title)}${c.status === "soon" ? ' <span class="badge">قريباً</span>' : c.status === "hidden" ? ' <span class="badge">مخفي</span>' : ""}</td><td class="num">${v.d7}</td><td class="num">${v.d30}</td><td class="num">${w.d30}</td><td class="num">${n.d30}</td><td class="num">${pct(w.d30, v.d30)}</td></tr>`; }).join("")}
        </tbody></table></div>
        <p class="muted" style="margin-top:8px">نسبة الاشتراك = ضغطات "اشترك على واتساب" ÷ زيارات صفحة الكورس. دي ضغطات على الزرار، مش اشتراكات مدفوعة.</p></div>
      <div class="card"><h2>الفصول المجانية</h2>
        ${freeRows.length ? `<div class="table-wrap" style="margin-top:10px"><table style="width:100%">${head("الفصل")}<tbody>${freeRows.map((r) => `<tr><td>${r.m ? esc(r.m.title) : "فصل اتشال من المجاني أو اتمسح"}</td>${cells(r)}</tr>`).join("")}</tbody></table></div>`
          : `<p class="muted" style="margin-top:6px">${d.free.length ? "لسه محدش فتح الفصول المجانية." : 'مفيش فصول مجانية لسه. علّم على "مجاني للتجربة" من تاب المادة العلمية.'}</p>`}</div>`;
    // رحلة كل مصدر: زيارات ← زوار سجلوا ← ضغطات اشترك ← متدربين اتعملوا (آخر 30 يوم)
    const srcs = new Set([...d.rows.filter((r) => r.kind === "visit_src" || r.kind === "sub_src").map((r) => r.ref), ...d.visitors_by.map((r) => r.source), ...d.students_by.map((r) => r.source || "")]);
    const by = (list, s) => (list.find((r) => (r.source || "") === s) || { n: 0 }).n;
    const srcRows = [...srcs].map((s) => ({ s, v: get("visit_src", s).d30, vis: by(d.visitors_by, s), sub: get("sub_src", s).d30, st: by(d.students_by, s) })).sort((a, b) => b.v + b.vis - a.v - a.vis);
    const dl = d.rows.filter((r) => r.kind === "file_dl").map((r) => ({ ...r, f: d.files.find((f) => String(f.id) === r.ref) }));
    panel.insertAdjacentHTML("beforeend", `
      <div class="card"><h2>الناس جاية منين؟</h2>
        <p class="muted" style="margin-top:4px">آخر 30 يوم (من ${esc(d.since)}). المصدر بيتحسب من أول رابط دخل منه الزائر (فيسبوك، واتساب، جوجل، أو رابط فيه ?src=). المتدربين = اللي اتعملهم حساب ومعروف مصدرهم.</p>
        ${srcRows.length ? `<div class="table-wrap" style="margin-top:10px"><table style="width:100%"><thead><tr><th>المصدر</th><th>زيارات</th><th>سجلوا كزوار</th><th>ضغطوا اشترك</th><th>بقوا متدربين</th></tr></thead><tbody>
          ${srcRows.map((r) => `<tr><td>${esc(srcLabel(r.s) === "—" ? "مش معروف" : srcLabel(r.s))}</td><td class="num">${r.v}</td><td class="num">${r.vis}</td><td class="num">${r.sub}</td><td class="num">${r.st}</td></tr>`).join("")}</tbody></table></div>`
          : '<p class="muted" style="margin-top:6px">لسه مفيش بيانات مصادر.</p>'}
        <p class="muted" style="margin-top:8px">نصيحة: لما تنزل بوست، حط الرابط كده علشان تعرف جه منه كام: <span class="num">${esc(location.origin)}/?src=fb-post</span></p></div>
      <div class="card"><h2>طلبات "بلغني أول ما يفتح"</h2>
        ${d.notify.length ? `<div class="table-wrap" style="margin-top:10px"><table style="width:100%"><thead><tr><th>الكورس</th><th>عدد الناس</th></tr></thead><tbody>
          ${d.notify.map((n) => `<tr><td>${esc((d.courses.find((c) => c.slug === n.slug) || {}).title || n.slug)}</td><td class="num">${n.n}</td></tr>`).join("")}</tbody></table></div>
          <p class="muted" style="margin-top:8px">أساميهم وأرقامهم في تاب "الزوار".</p>` : '<p class="muted" style="margin-top:6px">لسه محدش طلب.</p>'}</div>
      <div class="card"><h2>تحميلات مكتبة IK</h2>
        ${dl.length ? `<div class="table-wrap" style="margin-top:10px"><table style="width:100%">${head("الملف")}<tbody>${dl.map((r) => `<tr><td>${r.f ? esc(r.f.title) : "ملف اتمسح"}</td>${cells(r)}</tr>`).join("")}</tbody></table></div>`
          : '<p class="muted" style="margin-top:6px">لسه محدش حمّل ملفات.</p>'}</div>`);
    $("#st-re").onclick = statsTab;
  }

  // ======================= مكتبة IK =======================
  const CHUNK = 1800 * 1024; // كل جزء أقل من حد الصف في D1
  async function libraryTab() {
    const files = await api("/admin/library");
    const subcats = String(adminSettings.lib_subcats || "").split("\n").map((l) => l.split("|").map((x) => x.trim())).filter((p) => p[1]);
    const cOpts = (sel) => opt("", "— مفيش —", sel || "") + courses.map((c) => opt(c.id, c.title, sel)).join("");
    const form = (f = {}) => `
      <div class="field"><label>اسم الملف</label><input name="title" required value="${esc(f.title || "")}" placeholder="مثلاً: شيت كشف حساب عميل جاهز"></div>
      <div class="field"><label>نوعه</label><select name="access">${opt("free", "🎁 مجاني (للزوار بعد الدخول السريع)", f.access)}${opt("paid", "💎 مدفوع (بتفعله لكل متدرب)", f.access)}${opt("course", "🎓 ضمن كورس (للمشتركين فيه)", f.access)}</select></div>
      <div class="field full"><label>وصف قصير <small>(هيفيدك في إيه)</small></label><textarea name="description" rows="2">${esc(f.description || "")}</textarea></div>
      <div class="field"><label>القسم</label><select name="track">${tracks().map((t) => opt(t.key, t.name, f.track)).join("")}</select></div>
      <div class="field"><label>التصنيف</label><select name="subcat">${opt("", "— من غير —", f.subcat || "")}${subcats.map(([k, n]) => opt(n, trackName(k) + " ← " + n, f.subcat)).join("")}</select></div>
      <div class="field full"><label>مناسب لـ</label><div>${audChecks(f.audiences || ["accountant"])}</div></div>
      <div class="field"><label>السعر <small>(للمدفوع بس، بيظهر للزائر)</small></label><input name="price" type="number" min="0" value="${f.price || 0}"></div>
      <div class="field"><label>الكورس اللي الملف تبعه <small>(لنوع "ضمن كورس")</small></label><select name="course_id">${cOpts(f.course_id)}</select></div>
      <div class="field"><label>كورس مقترح معاه <small>(بيظهر "عايز تفهمه من جوه؟")</small></label><select name="related_course_id">${cOpts(f.related_course_id)}</select></div>
      <div class="field"><label>الترتيب</label><input name="sort" type="number" value="${f.sort || 0}"></div>
      <label class="check"><input type="checkbox" name="visible"${f.visible === 0 ? "" : " checked"}> ظاهر في المكتبة</label>`;
    const body = (fm) => { const fd = new FormData(fm); const b = Object.fromEntries(fd); b.audiences = fd.getAll("audiences"); b.visible = fm.visible.checked; return b; };
    panel.innerHTML = `
      <div class="card"><h2>إضافة ملف للمكتبة</h2>
        <p class="muted" style="margin-top:4px">أي نوع ملف (Excel، PDF، Word ...) لحد 14 ميجا. الملف بيتحمل باسم اللي حمّله، والمجاني محتاج دخول سريع كزائر، والمدفوع والكورس السيرفر بيتأكد من صلاحية المتدرب قبل التحميل.</p>
        <form id="lf" class="form-grid" style="margin-top:12px">${form()}
          <div class="field full"><label class="btn btn-ghost" style="justify-self:start">اختار الملف<input type="file" hidden id="lf-file"></label> <span class="muted" id="lf-name"></span></div>
          <div class="full row"><button class="btn btn-primary" type="submit">إضافة ورفع</button></div>
          <div class="full" id="lf-prog" hidden><div class="bar"><i style="width:0%"></i></div><p class="muted" id="lf-text"></p></div>
          <div class="status full" id="lf-st" hidden></div></form></div>
      <div class="card"><h2>ملفات المكتبة (${files.length})</h2>
        <div class="stack" style="margin-top:12px">${files.map((f) => `
          <div class="card" style="background:var(--paper)" data-lib="${f.id}">
            <div class="spread"><div><b>${f.access === "free" ? "🎁" : f.access === "paid" ? "💎" : "🎓"} ${esc(f.title)}</b>${f.visible ? "" : ' <span class="badge">مخفي</span>'}
              <p class="muted">${esc(trackName(f.track))}${f.subcat ? " · " + esc(f.subcat) : ""} · ${f.chunks ? esc(f.file_name || "") + " · " + IK.size(f.size) : '<b style="color:var(--bad)">لسه ما اترفعش ملف</b>'}${f.access === "paid" ? " · متفعل لـ " + f.grants + " متدرب" : ""}</p></div>
              <div class="row"><label class="btn btn-primary btn-sm">${f.chunks ? "رفع نسخة جديدة" : "رفع الملف"}<input type="file" hidden class="js-lfile"></label>
                ${f.chunks ? `<a class="btn btn-ghost btn-sm" href="/api/public/library/${f.id}/download">تحميل</a>` : ""}
                <button class="btn btn-ghost btn-sm js-ledit" type="button">تعديل</button><button class="btn btn-danger btn-sm js-ldel" type="button">مسح</button></div></div>
            <div class="js-prog" hidden style="margin-top:10px"><div class="bar"><i style="width:0%"></i></div><p class="muted js-ptext"></p></div>
            <form class="form-grid js-lform" style="margin-top:12px" hidden>${form(f)}<div class="full row"><button class="btn btn-primary btn-sm" type="submit">حفظ</button><span class="status" hidden></span></div></form>
          </div>`).join("") || '<p class="muted">المكتبة فاضية لسه.</p>'}</div></div>`;

    async function upload(id, version, file, bar, txt) {
      const n = Math.ceil(file.size / CHUNK);
      if (!n || n > 8) throw new Error("حجم الملف لازم يكون أقل من 14 ميجا.");
      for (let k = 1; k <= n; k++) {
        txt.textContent = `برفع جزء ${k} من ${n}...`;
        await api(`/admin/library/${id}/chunks/${k}?v=${version + 1}`, { method: "PUT", body: file.slice((k - 1) * CHUNK, k * CHUNK) });
        bar.style.width = Math.round((k / n) * 100) + "%";
      }
      await api(`/admin/library/${id}/publish`, { method: "POST", body: { version: version + 1, chunks: n, file_name: file.name, mime: file.type || "application/octet-stream", size: file.size } });
    }
    let picked = null;
    $("#lf-file").onchange = (e) => { picked = e.target.files[0] || null; $("#lf-name").textContent = picked ? picked.name + " · " + IK.size(picked.size) : ""; };
    $("#lf").onsubmit = async (e) => {
      e.preventDefault();
      const st = $("#lf-st");
      if (!picked) return IK.status(st, "bad", "اختار الملف الأول.");
      try {
        const { id } = await api("/admin/library", { method: "POST", body: body(e.target) });
        $("#lf-prog").hidden = false;
        await upload(id, 0, picked, $("#lf-prog").querySelector("i"), $("#lf-text"));
        IK.status(st, "ok", "الملف اترفع وبقى في المكتبة.");
        setTimeout(libraryTab, 900);
      } catch (err) { IK.status(st, "bad", err.message); }
    };
    panel.querySelectorAll("[data-lib]").forEach((box) => {
      const f = files.find((x) => String(x.id) === box.dataset.lib);
      box.querySelector(".js-lfile").onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const prog = box.querySelector(".js-prog");
        prog.hidden = false;
        try { await upload(f.id, f.version, file, prog.querySelector("i"), box.querySelector(".js-ptext")); box.querySelector(".js-ptext").textContent = "تم."; setTimeout(libraryTab, 900); }
        catch (err) { box.querySelector(".js-ptext").textContent = "الرفع وقف: " + err.message; }
      };
      const fm = box.querySelector(".js-lform");
      box.querySelector(".js-ledit").onclick = () => (fm.hidden = !fm.hidden);
      fm.onsubmit = async (e) => {
        e.preventDefault();
        try { await api("/admin/library/" + f.id, { method: "PATCH", body: body(fm) }); libraryTab(); }
        catch (err) { IK.status(fm.querySelector(".status"), "bad", err.message); }
      };
      box.querySelector(".js-ldel").onclick = async () => {
        if (!confirm("مسح الملف ده من المكتبة؟ المتدربين اللي متفعلهم مش هيقدروا يحملوه تاني.")) return;
        await api("/admin/library/" + f.id, { method: "DELETE" }); libraryTab();
      };
    });
  }

  // ======================= المحاضرين =======================
  async function lecturersTab() {
    let list = await api("/admin/lecturers");
    const form = (l = {}) => `
      <div class="field"><label>اسم المحاضر <small>(زي ما يظهر للطلبة، مثلاً: Mr. Islam Khalifa)</small></label><input name="name" required value="${esc(l.name || "")}"></div>
      <div class="field"><label>سطر تعريفي <small>(اختياري)</small></label><input name="role" value="${esc(l.role || "")}" placeholder="مثلاً: محاسب قانوني وخبرة 10 سنين في الضرايب"></div>
      <div class="field full"><label>نبذة <small>(بتظهر في صفحة الكورس تحت "مين هيشرحلك؟")</small></label><textarea name="bio" rows="3">${esc(l.bio || "")}</textarea></div>
      <div class="field"><label>واتساب المحاضر <small>(مش بيظهر للزوار، بس للمشتركين في زرار كلّم المحاضر)</small></label><input name="whatsapp" dir="ltr" value="${esc(l.whatsapp || "")}" placeholder="01xxxxxxxxx"></div>
      <div class="field"><label>توقيع الشهادة <small>(فاضي = التوقيع العام من الإعدادات)</small></label><input name="signature" value="${esc(l.signature || "")}"></div>
      <div class="field full"><label>الكورسات اللي بيديها</label><div style="display:flex;flex-wrap:wrap;gap:8px 20px">${courses.map((c) => `<label class="check" style="white-space:nowrap"><input type="checkbox" name="courses" value="${c.id}"${(l.courses || []).includes(c.id) ? " checked" : ""}> ${esc(c.title)}</label>`).join("") || '<span class="muted">مفيش كورسات لسه.</span>'}</div></div>
      <label class="check"><input type="checkbox" name="visible"${l.visible === false ? "" : " checked"}> اسمه ونبذته يظهروا في صفحة الكورس</label>`;
    const read = (fm, base = {}) => { const fd = new FormData(fm); return { ...base, ...Object.fromEntries(fd), courses: fd.getAll("courses").map(Number), visible: fm.visible.checked }; };
    const save = async (next, st) => { try { list = await api("/admin/lecturers", { method: "PUT", body: { lecturers: next } }); lecturersTab(); } catch (err) { toast(st, "bad", err.message); } };
    const mode = adminSettings.follow_mode || "lecturer";
    const courseTitles = (ids) => courses.filter((c) => (ids || []).includes(c.id)).map((c) => c.title).join("، ") || "مش مربوط بكورس";
    panel.innerHTML = `
      <div class="card"><h2>إضافة محاضر</h2>
        <p class="muted" style="margin-top:4px">كل محاضر بتربطه بالكورسات اللي بيديها. زرار "كلّم المحاضر" جوه الكورس بيروح لرقمه، وتوقيعه بيطلع على شهادة الكورس.
        الزرار دلوقتي: <b>${mode === "hidden" ? "مستخبي" : mode === "service" ? "بيروح لخدمة العملاء" : "بيروح لمحاضر الكورس"}</b> (بيتغير من الإعدادات).</p>
        <form id="lcf" class="form-grid" style="margin-top:12px">${form()}<div class="full row"><button class="btn btn-primary" type="submit">إضافة المحاضر</button><span class="status" hidden></span></div></form></div>
      <div class="card"><h2>المحاضرين (${list.length})</h2>
        <div class="stack" style="margin-top:12px">${list.map((l) => `
          <div class="card" style="background:var(--paper)" data-lec="${l.id}">
            <div class="spread"><div><b>🎓 ${esc(l.name)}</b>${l.visible === false ? ' <span class="badge">مخفي من صفحة الكورس</span>' : ""}
              <p class="muted">${esc(courseTitles(l.courses))} · ${l.whatsapp ? '<span dir="ltr">' + esc(l.whatsapp) + "</span>" : "من غير رقم (الزرار هيروح للرقم الاحتياطي)"}</p></div>
              <div class="row"><button class="btn btn-ghost btn-sm js-e" type="button">تعديل</button><button class="btn btn-danger btn-sm js-d" type="button">مسح</button></div></div>
            <form class="form-grid js-f" style="margin-top:12px" hidden>${form(l)}<div class="full row"><button class="btn btn-primary btn-sm" type="submit">حفظ</button><span class="status" hidden></span></div></form>
          </div>`).join("") || '<p class="muted">لسه مفيش محاضرين. لحد ما تضيف، الزرار بيروح للرقم الاحتياطي من الإعدادات.</p>'}</div></div>`;
    $("#lcf").onsubmit = (e) => { e.preventDefault(); save([...list, read(e.target)], e.target.querySelector(".status")); };
    panel.querySelectorAll("[data-lec]").forEach((box) => {
      const l = list.find((x) => String(x.id) === box.dataset.lec);
      const fm = box.querySelector(".js-f");
      box.querySelector(".js-e").onclick = () => (fm.hidden = !fm.hidden);
      fm.onsubmit = (e) => { e.preventDefault(); save(list.map((x) => (x.id === l.id ? read(fm, { id: l.id }) : x)), fm.querySelector(".status")); };
      box.querySelector(".js-d").onclick = () => { if (confirm("مسح " + l.name + " من المحاضرين؟")) save(list.filter((x) => x.id !== l.id), fm.querySelector(".status")); };
    });
  }

  // ======================= الزوار السريعين =======================
  async function visitorsTab(q = "") {
    const [list, files] = await Promise.all([api("/admin/visitors?q=" + encodeURIComponent(q)), api("/admin/library")]);
    const fBy = Object.fromEntries(files.map((f) => [String(f.id), f.title]));
    const cBy = Object.fromEntries(courses.map((c) => [c.slug, c.title]));
    const ev = (e) => e.kind === "file" ? "⬇ " + (fBy[e.ref] || "ملف") : e.kind === "chapter" ? "📖 فصل مجاني" : e.kind === "notify" ? "🔔 بلغني: " + (cBy[e.ref] || e.ref) : "💬 تواصل" + (cBy[e.ref] ? ": " + cBy[e.ref] : "");
    panel.innerHTML = `
      <div class="card stack">
        <div class="spread"><h2>الزوار السريعين (${list.length})</h2>
          <div class="row"><input id="vq" value="${esc(q)}" placeholder="دور بالاسم أو الرقم" style="font:inherit;padding:8px 12px;border:1px solid var(--line);border-radius:var(--r-m)">
          <a class="btn btn-ghost btn-sm" href="/api/admin/visitors.csv">تصدير Excel</a></div></div>
        <p class="muted">دول الناس اللي سجلوا اسمهم ورقمهم علشان يقروا فصل مجاني أو يحملوا ملف أو يطلبوا "بلغني". البيانات دي ليك إنت بس. ابعت رسايل تسويقية بس للي علّم على الموافقة (✓).</p>
        <div class="table-wrap"><table class="t"><thead><tr><th>الاسم</th><th>الرقم</th><th>المصدر</th><th>رسايل تسويقية</th><th>عمل إيه</th><th>سجل في</th><th></th></tr></thead><tbody>
        ${list.map((v) => `<tr data-v="${v.id}"><td><b>${esc(v.name)}</b>${v.user_id ? ' <span class="badge ok">بقى متدرب</span>' : ""}</td>
          <td class="num">${esc(v.phone)}</td><td>${esc(srcLabel(v.source))}</td>
          <td>${v.consent_marketing ? '<span class="badge ok">✓ موافق</span>' : '<span class="muted">لأ</span>'}</td>
          <td><small>${v.events.map((e) => esc(ev(e))).join("<br>") || "—"}</small></td>
          <td class="num"><small>${esc(v.created_at)}</small></td>
          <td><div class="row"><a class="btn btn-wa btn-sm" target="_blank" rel="noopener" href="${IK.wa(intlPhone(v.phone), "أهلاً يا " + v.name.split(" ")[0] + " 👋 معاك IK Academy")}">${IK.chatIcon}كلمه</a>
            <button class="btn btn-danger btn-sm js-vdel" type="button">مسح</button></div></td></tr>`).join("") || '<tr><td colspan="7" class="empty">لسه مفيش زوار سجلوا.</td></tr>'}
        </tbody></table></div>
      </div>`;
    let timer;
    $("#vq").addEventListener("input", (e) => { clearTimeout(timer); timer = setTimeout(() => visitorsTab(e.target.value).then(() => { const i = $("#vq"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }), 300); });
    panel.querySelectorAll(".js-vdel").forEach((b) => (b.onclick = async () => {
      if (!confirm("مسح بيانات الزائر ده نهائياً؟")) return;
      await api("/admin/visitors/" + b.closest("tr").dataset.v, { method: "DELETE" }); visitorsTab($("#vq").value);
    }));
  }

  // ======================= التابات =======================
  const tabs = { students: studentsTab, inactive: () => inactiveTab(), courses: coursesTab, content: contentTab, exams: examsTab, lecturers: lecturersTab, library: libraryTab, visitors: visitorsTab, stats: statsTab, settings: settingsTab };
  const tabBtns = document.querySelectorAll(".tabs button");
  function go(name) {
    tabBtns.forEach((b) => b.classList.toggle("on", b.dataset.tab === name));
    try { localStorage.setItem("ik-admin-tab", name); } catch (e) {}
    panel.innerHTML = '<div class="loading">جاري التحميل...</div>';
    Promise.resolve(tabs[name]()).catch((e) => { if (e.message !== "login") panel.innerHTML = `<div class="card status bad">${esc(e.message)}</div>`; });
  }
  tabBtns.forEach((b) => (b.onclick = () => go(b.dataset.tab)));
  let first = "students";
  try { first = localStorage.getItem("ik-admin-tab") || first; } catch (e) {}
  go(tabs[first] ? first : "students");
})();
