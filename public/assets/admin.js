// لوحة الأدمن: المتدربين، الكورسات والأسعار، المادة العلمية، الامتحانات، الإعدادات
(async function () {
  const { esc, $, api } = IK;
  const me = await IK.requireUser({ admin: true });
  const site = await IK.chrome({ user: me });
  const panel = $("#panel");
  let courses = [];
  const loadCourses = async () => (courses = await api("/admin/courses"));
  await loadCourses();

  const toast = (el, kind, msg) => IK.status(el, kind, msg);
  const opt = (v, label, sel) => `<option value="${esc(v)}"${String(v) === String(sel) ? " selected" : ""}>${esc(label)}</option>`;
  const courseOptions = (sel, withEmpty) => (withEmpty ? opt("", "— من غير كورس —", sel) : "") + courses.map((c) => opt(c.slug, c.title, sel)).join("");
  const genPass = () => String(Math.floor(100000 + crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
  const intlPhone = (p) => (p ? (p.startsWith("0") ? "20" + p.slice(1) : p) : "");

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
          <div class="field"><label>الباسورد المبدئي</label><div class="row"><input name="password" dir="ltr" style="flex:1" value="${genPass()}"><button class="btn btn-ghost btn-sm" type="button" id="gen">باسورد جديد</button></div></div>
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
    $("#gen").onclick = () => (f.password.value = genPass());
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const b = Object.fromEntries(new FormData(f));
      try {
        await api("/admin/students", { method: "POST", body: b });
        toast($("#add-st"), "ok", "اتضاف المتدرب " + b.name + ".");
        showWelcome(b);
        f.reset(); f.password.value = genPass(); f.course_slug.value = "financial";
        load(); stats();
      } catch (err) { toast($("#add-st"), "bad", err.message); }
    });
    let timer;
    $("#q").addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(load, 250); });
    await load();
  }

  function showWelcome(b) {
    const s = site.settings;
    const login = location.origin + "/login";
    const id = b.phone || b.email;
    const course = courses.find((c) => c.slug === b.course_slug);
    const msg = `أهلاً يا ${b.name}، تم تفعيل حسابك على منصة ${s.brand_name}${course ? " في كورس " + course.title : ""}.\n\nرابط الدخول: ${login}\nبتدخل بـ: ${id}\nالباسورد: ${b.password}\n\nأول ما تدخل هيطلب منك تغير الباسورد.\n\n${s.footer_line1}\n${s.footer_line2}`;
    const w = $("#welcome");
    w.hidden = false;
    w.innerHTML = `<h3>رسالة الترحيب للمتدرب</h3><pre style="white-space:pre-wrap;font:inherit;margin:10px 0">${esc(msg)}</pre>
      <div class="row">${b.phone ? `<a class="btn btn-wa btn-sm" target="_blank" rel="noopener" href="${IK.wa(intlPhone(IK.toPhone(b.phone)), msg)}">${IK.chatIcon}ابعتها على واتساب المتدرب</a>` : ""}
      <button class="btn btn-ghost btn-sm" type="button" id="copy-w">نسخ الرسالة</button></div>`;
    $("#copy-w").onclick = () => navigator.clipboard.writeText(msg).then(() => ($("#copy-w").textContent = "اتنسخت"));
  }
  IK.toPhone = (p) => String(p || "").replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(/\D/g, "");

  async function load() {
    const list = await api("/admin/students?q=" + encodeURIComponent(($("#q") || {}).value || ""));
    $("#rows").innerHTML = list.map((u) => `
      <tr>
        <td><b>${esc(u.name)}</b>${u.notes ? `<br><small class="muted">${esc(u.notes)}</small>` : ""}</td>
        <td class="num">${esc(u.phone || "")}${u.phone && u.email ? "<br>" : ""}${esc(u.email || "")}</td>
        <td>${u.enrollments.map((e) => `<span class="badge ${e.plan_code === "pro" ? "gold" : ""}">${esc(e.title)}${e.expires_at ? " · لحد " + esc(e.expires_at) : ""}</span>`).join(" ") || '<span class="muted">—</span>'}</td>
        <td>${u.active ? '<span class="badge ok">نشط</span>' : '<span class="badge bad">موقوف</span>'}${u.must_change ? '<br><small class="muted">لسه ما غيرش الباسورد</small>' : ""}</td>
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

  function editStudent(u) {
    const box = $("#edit");
    const enr = u.enrollments[0] || {};
    box.innerHTML = `<div class="card" style="border-color:var(--gold)">
      <div class="spread"><h2>تعديل: ${esc(u.name)}</h2><button class="btn btn-ghost btn-sm" type="button" id="x">قفل</button></div>
      <form id="ef" class="form-grid" style="margin-top:12px">
        <div class="field"><label>الاسم</label><input name="name" value="${esc(u.name)}"></div>
        <div class="field"><label>رقم التليفون</label><input name="phone" dir="ltr" value="${esc(u.phone || "")}"></div>
        <div class="field"><label>الميل</label><input name="email" dir="ltr" value="${esc(u.email || "")}"></div>
        <div class="field"><label>ملاحظات</label><input name="notes" value="${esc(u.notes || "")}"></div>
        <div class="field"><label>باسورد جديد <small>(فاضي = من غير تغيير)</small></label><input name="password" dir="ltr"></div>
        <label class="check"><input type="checkbox" name="active" ${u.active ? "checked" : ""}> الحساب نشط</label>
        <div class="full row"><button class="btn btn-primary" type="submit">حفظ البيانات</button></div>
      </form>
      <h3 style="margin-top:20px">الاشتراك</h3>
      <form id="en" class="form-grid" style="margin-top:10px">
        <div class="field"><label>الكورس</label><select name="course_slug">${courseOptions(enr.slug || "financial")}</select></div>
        <div class="field"><label>الباقة</label><select name="plan_code">${opt("basic", "الأساسية", enr.plan_code)}${opt("pro", "Pro", enr.plan_code)}</select></div>
        <div class="field"><label>ينتهي في</label><input name="expires_at" type="date" value="${esc(enr.expires_at || "")}"></div>
        <div class="full row"><button class="btn btn-primary" type="submit">تفعيل / تحديث الاشتراك</button>
          ${u.enrollments.map((e) => `<button class="btn btn-danger btn-sm" type="button" data-unenroll="${esc(e.slug)}">إلغاء ${esc(e.title)}</button>`).join("")}</div>
      </form>
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
      if (!b.password) delete b.password;
      try {
        await api("/admin/students/" + u.id, { method: "PATCH", body: b });
        toast(st, "ok", "اتحفظ." + (b.password ? " ابعت الباسورد الجديد للمتدرب." : ""));
        if (b.password) showWelcomeInline(u, b);
        load();
      } catch (err) { toast(st, "bad", err.message); }
    };
    $("#en").onsubmit = async (e) => {
      e.preventDefault();
      try { await api(`/admin/students/${u.id}/enrollment`, { method: "PUT", body: Object.fromEntries(new FormData(e.target)) }); toast(st, "ok", "الاشتراك اتحدث."); load(); stats(); }
      catch (err) { toast(st, "bad", err.message); }
    };
    box.querySelectorAll("[data-unenroll]").forEach((b) => (b.onclick = async () => {
      if (!confirm("متأكد إنك عايز تلغي الاشتراك ده؟ تقدم المتدرب هيفضل محفوظ لو فعلته تاني.")) return;
      await api(`/admin/students/${u.id}/enrollment/${encodeURIComponent(b.dataset.unenroll)}`, { method: "DELETE" });
      toast(st, "ok", "الاشتراك اتلغى."); load(); stats();
    }));
    $("#del").onclick = async () => {
      if (!confirm("مسح المتدرب هيمسح كل تقدمه ودرجاته ومش هينفع ترجعهم. متأكد؟")) return;
      await api("/admin/students/" + u.id, { method: "DELETE" });
      box.innerHTML = ""; load(); stats();
    };
  }
  function showWelcomeInline(u, b) {
    const s = site.settings;
    const msg = `أهلاً يا ${b.name || u.name}، باسورد منصة ${s.brand_name} الجديد: ${b.password}\nرابط الدخول: ${location.origin}/login`;
    const p = IK.toPhone(b.phone || u.phone);
    if (p) $("#e-st").insertAdjacentHTML("beforeend", ` <a target="_blank" rel="noopener" href="${IK.wa(intlPhone(p), msg)}">ابعته على واتساب</a>`);
  }

  async function report(u) {
    const box = $("#edit");
    box.innerHTML = '<div class="loading">جاري التحميل...</div>';
    const r = await api(`/admin/students/${u.id}/report`);
    const ex = (e) => !e ? "—" : !e.ready ? '<span class="muted">مفيش أسئلة</span>' : e.tries ? `${e.passed ? "✓" : "✗"} أعلى ${e.best}% · أول محاولة ${e.first}% · ${e.tries} محاولة` : '<span class="muted">لسه</span>';
    box.innerHTML = `<div class="card" style="border-color:var(--gold)">
      <div class="spread"><h2>تقدم: ${esc(r.user.name)}</h2><button class="btn btn-ghost btn-sm" type="button" id="x">قفل</button></div>
      ${r.courses.map((c) => `<h3 style="margin-top:14px">${esc(c.title)} · ${c.progress}% ${c.completed ? '<span class="badge ok">خلص الكورس</span>' : ""}</h3>
        <div class="table-wrap" style="margin-top:8px"><table class="t"><thead><tr><th>المستوى</th><th>الحالة</th><th>المادة</th><th>امتحان المستوى</th><th>التراكمي</th></tr></thead><tbody>
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
        <div class="spread"><h2>${esc(c.title)}</h2><a class="btn btn-ghost btn-sm" href="/course?c=${encodeURIComponent(c.slug)}" target="_blank">شوف صفحة الكورس</a></div>
        <form class="form-grid js-course" style="margin-top:12px">
          <div class="field"><label>اسم الكورس</label><input name="title" value="${esc(c.title)}"></div>
          <div class="field"><label>الحالة</label><select name="status">${opt("open", "متاح للاشتراك", c.status)}${opt("soon", "قيد الافتتاح قريباً", c.status)}${opt("hidden", "مخفي", c.status)}</select></div>
          <div class="field full"><label>سطر تعريفي</label><input name="subtitle" value="${esc(c.subtitle || "")}"></div>
          <div class="field full"><label>المقدمة (النبذة)</label><textarea name="intro" rows="4">${esc(c.intro || "")}</textarea></div>
          <div class="field full"><label>الكورس لمين؟</label><input name="audience" value="${esc(c.audience || "")}"></div>
          <div class="field"><label>الترتيب</label><input name="sort" type="number" value="${c.sort}"></div>
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
        <h3 style="margin-top:22px">المستويات</h3>
        <div class="stack" style="margin-top:10px">${c.levels.map((l) => `
          <form class="card js-level" data-id="${l.id}" style="background:var(--paper)">
            <div class="form-grid">
              <div class="field full"><label>المستوى ${l.num}: العنوان</label><input name="title" value="${esc(l.title)}"></div>
              <div class="field full"><label>المحتوى</label><input name="topics" value="${esc(l.topics || "")}"></div>
              <div class="field full"><label>المقدمة التشويقية</label><textarea name="teaser" rows="2">${esc(l.teaser || "")}</textarea></div>
            </div>
            <div class="row" style="margin-top:10px"><button class="btn btn-primary btn-sm" type="submit">حفظ المستوى</button><span class="status" hidden></span></div>
          </form>`).join("")}
          <form class="card js-addlevel row" data-course="${c.id}"><div class="field" style="flex:1"><input name="title" placeholder="عنوان مستوى جديد"></div><button class="btn btn-ghost" type="submit">إضافة مستوى</button></form>
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
      try { await api("/admin/courses/" + f.closest("[data-course]").dataset.course, { method: "PATCH", body: Object.fromEntries(new FormData(f)) }); note(f, "ok", "اتحفظ"); await loadCourses(); }
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
      <div class="field" style="flex:1;min-width:220px"><label>المستوى</label><select id="pl">${c.levels.map((l) => opt(l.id, l.num + ". " + l.title, pick.level)).join("")}</select></div></div>`;
    const bind = () => {
      $("#pc").onchange = (e) => { pick.course = e.target.value; pick.level = null; onChange(); };
      $("#pl").onchange = (e) => { pick.level = e.target.value; onChange(); };
    };
    return { html, course: c, bind };
  }

  async function contentTab() {
    const p = pickers(contentTab);
    if (!pick.level) { panel.innerHTML = p.html + '<div class="card empty">الكورس ده مفيهوش مستويات لسه. ضيف مستويات من تاب الكورسات.</div>'; p.bind(); return; }
    const mats = await api(`/admin/levels/${pick.level}/materials`);
    panel.innerHTML = p.html + `
      <div class="card">
        <h2>المادة العلمية للمستوى</h2>
        <p class="muted" style="margin-top:4px">ملف الـ PDF بيتحول لصفحات صور محمية عليها اسم المتدرب، ومحدش يقدر يحمل الملف أو ينسخ منه. ولو رفعت نسخة جديدة بتحل مكان القديمة على طول.</p>
        <div class="stack" style="margin-top:14px">${mats.map((m) => `
          <div class="card" style="background:var(--paper)" data-mat="${m.id}">
            <div class="spread"><div><b>${m.kind === "pdf" ? "📄" : "🎬"} ${esc(m.title)}</b>
              <p class="muted">${m.kind === "pdf" ? (m.pages ? m.pages + " صفحة · نسخة " + m.version : "لسه ما اترفعش ملف") : esc(m.video_url || "من غير رابط")} · ${m.min_plan === "pro" ? "باقة Pro" : "كل الباقات"}</p></div>
              <div class="row">
                ${m.kind === "pdf" ? `<label class="btn btn-primary btn-sm">${m.pages ? "رفع نسخة جديدة" : "رفع PDF"}<input type="file" accept="application/pdf" hidden class="js-file"></label>` : ""}
                <button class="btn btn-ghost btn-sm js-edit" type="button">تعديل</button>
                <button class="btn btn-danger btn-sm js-del" type="button">مسح</button>
              </div></div>
            <div class="js-prog" hidden style="margin-top:10px"><div class="bar"><i style="width:0%"></i></div><p class="muted js-ptext"></p></div>
          </div>`).join("") || '<p class="muted">مفيش مادة علمية للمستوى ده لسه.</p>'}</div>
      </div>
      <div class="card"><h2>إضافة مادة</h2>
        <form id="addm" class="form-grid" style="margin-top:12px">
          <div class="field"><label>النوع</label><select name="kind">${opt("pdf", "PDF")}${opt("video", "فيديو (باقة Pro)")}</select></div>
          <div class="field"><label>العنوان</label><input name="title" required placeholder="مثلاً: شرح المستوى الأول"></div>
          <div class="field"><label>متاحة لـ</label><select name="min_plan">${opt("basic", "كل الباقات")}${opt("pro", "باقة Pro بس")}</select></div>
          <div class="field"><label>رابط الفيديو <small>(للفيديو بس: YouTube غير مدرج أو Bunny)</small></label><input name="video_url" dir="ltr"></div>
          <div class="full row"><button class="btn btn-primary" type="submit">إضافة</button><span class="status" hidden></span></div>
        </form></div>`;
    p.bind();
    $("#addm").onsubmit = async (e) => {
      e.preventDefault();
      try { await api(`/admin/levels/${pick.level}/materials`, { method: "POST", body: Object.fromEntries(new FormData(e.target)) }); contentTab(); }
      catch (err) { IK.status(e.target.querySelector(".status"), "bad", err.message); }
    };
    panel.querySelectorAll("[data-mat]").forEach((box) => {
      const m = mats.find((x) => String(x.id) === box.dataset.mat);
      const file = box.querySelector(".js-file");
      if (file) file.onchange = () => file.files[0] && uploadPdf(m, file.files[0], box);
      box.querySelector(".js-del").onclick = async () => {
        if (!confirm("متأكد إنك عايز تمسح المادة دي؟")) return;
        await api("/admin/materials/" + m.id, { method: "DELETE" }); contentTab();
      };
      box.querySelector(".js-edit").onclick = async () => {
        const title = prompt("عنوان المادة", m.title);
        if (title === null) return;
        const body = { title };
        if (m.kind === "video") { const v = prompt("رابط الفيديو", m.video_url || ""); if (v !== null) body.video_url = v; }
        await api("/admin/materials/" + m.id, { method: "PATCH", body }); contentTab();
      };
    });
  }

  async function uploadPdf(m, file, box) {
    const prog = box.querySelector(".js-prog"), bar = prog.querySelector("i"), txt = box.querySelector(".js-ptext");
    prog.hidden = false;
    if (!window.pdfjsLib) { txt.textContent = "مكتبة قراءة الـ PDF ما اتحملتش. اتأكد من النت وحدث الصفحة."; return; }
    pdfjsLib.GlobalWorkerOptions.workerSrc = "/assets/vendor/pdfjs-3.11.174/pdf.worker.min.js";
    try {
      const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
      const version = m.version + 1;
      const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d");
      for (let n = 1; n <= pdf.numPages; n++) {
        txt.textContent = `بحول وبرفع صفحة ${n} من ${pdf.numPages}...`;
        const page = await pdf.getPage(n);
        const base = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: Math.min(2.5, 1400 / base.width) });
        canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        const blob = await new Promise((r) => canvas.toBlob(r, "image/webp", 0.82));
        await api(`/admin/materials/${m.id}/pages/${n}?v=${version}`, { method: "PUT", body: blob, type: "image/webp" });
        bar.style.width = Math.round((n / pdf.numPages) * 100) + "%";
      }
      await api(`/admin/materials/${m.id}/publish`, { method: "POST", body: { version, pages: pdf.numPages } });
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
        <div class="table-wrap" style="margin-top:12px"><table class="t"><thead><tr><th>الامتحان</th><th>بعد مستوى</th><th>أسئلة في كل محاولة</th><th>النجاح بأكتر من %</th><th>المدة (دقيقة)</th><th>بنك الأسئلة</th><th></th></tr></thead><tbody>
        ${exams.map((e) => `<tr data-ex="${e.id}"${String(e.id) === String(examPick) ? ' style="background:#FBF7EE"' : ""}>
          <td><input class="js-t" value="${esc(e.title)}" style="font:inherit;width:100%;border:1px solid var(--line);border-radius:6px;padding:4px 8px"></td>
          <td>${e.after_level}${e.kind === "cumulative" ? ' <span class="badge gold">تراكمي</span>' : ""}</td>
          <td><input class="js-c num" type="number" min="1" value="${e.question_count}" style="width:70px"></td>
          <td><input class="js-p num" type="number" min="0" max="99" value="${e.pass_pct}" style="width:70px"></td>
          <td><span class="stepper"><button type="button" class="js-dm" aria-label="أقل">−</button><input class="js-d num" type="number" min="0" max="300" value="${e.duration_min ?? 15}"><button type="button" class="js-dp" aria-label="أكتر">+</button></span></td>
          <td>${e.bank ? `<span class="badge ok">${e.bank} سؤال</span>` : '<span class="badge bad">فاضي</span>'}</td>
          <td><div class="row"><button class="btn btn-ghost btn-sm js-save" type="button">حفظ</button><button class="btn btn-primary btn-sm js-open" type="button">الأسئلة</button>
          ${e.kind === "cumulative" ? '<button class="btn btn-danger btn-sm js-delx" type="button">مسح</button>' : ""}</div></td></tr>`).join("")}
        </tbody></table></div>
        <p class="muted" style="margin-top:8px">لو بنك الأسئلة أكبر من عدد أسئلة المحاولة، كل محاولة بتسحب أسئلة مختلفة. يفضل يكون البنك ضعف العدد أو أكتر. المستوى الجاي مش بيفتح غير لما المتدرب يعدي الامتحان، فلازم كل امتحان يبقى فيه أسئلة. المدة هي متوسط الحل اللي بيظهر للمتدرب، ولما تخلص الامتحان بيتسلم لوحده (0 = من غير وقت). اضغط حفظ بعد أي تعديل.</p>
        <form id="addx" class="row" style="margin-top:12px"><span>إضافة امتحان تراكمي بعد المستوى</span><input name="after_level" type="number" min="1" style="width:70px" required><button class="btn btn-ghost btn-sm" type="submit">إضافة</button></form>
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
        <p class="muted">دول المتدربين اللي اشتراكهم ساري ولسه ما خلصوش الكورس ومدخلوش المنصة في المدة دي. زرار التذكير بيفتح واتساب برسالة جاهزة باسمه والمستوى اللي واقف عنده، وتقدر تعدل الرسالة من الإعدادات.</p>
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
        ${field("cert_signature", "التوقيع على الشهادة")}
        ${field("cert_issuer", "الجهة المصدرة للشهادة", "بتظهر تحت اللوجو. فاضي = اسم المنصة", true)}
        ${field("footer_line1", "الفوتر: السطر الأول")}
        ${field("footer_line2", "الفوتر: السطر التاني")}
        <h2 class="full" style="margin-top:10px">العلامة المائية على المادة العلمية</h2>
        <div class="field"><label>بيانات المتدرب (الاسم والرقم والتاريخ) <small>(بننصح تفضل ظاهرة، علشان لو حد صوّر الشاشة ونشرها يبان هو مين)</small></label>
          <select name="wm_student"><option value="1">تظهر</option><option value="0"${s.wm_student === "0" ? " selected" : ""}>متظهرش</option></select></div>
        <div class="field"><label>درجة الوضوح</label>
          <select name="wm_level">${[["light", "خفيفة"], ["medium", "متوسطة"], ["strong", "واضحة"]].map(([v, t]) => `<option value="${v}"${(s.wm_level || "medium") === v ? " selected" : ""}>${t}</option>`).join("")}</select></div>
        ${field("wm_text", "نص إضافي في العلامة المائية", "زي Mr. Islam Khalifa | Accounting. فاضي = من غير نص إضافي", true)}
        <div class="field full"><label>معاينة <small>(بتتغير وانت بتعدل، وبتتحفظ لما تدوس حفظ الإعدادات)</small></label>
          <canvas id="wm-prev" width="800" height="1000" style="width:100%;max-width:340px;border:1px solid var(--line);border-radius:8px;background:#fff"></canvas></div>
        <h2 class="full" style="margin-top:10px">أرقام التواصل</h2>
        ${field("whatsapp", "واتساب خدمة العملاء", "الاشتراك، الاستفسار عن الكورسات، التجديد", true)}
        ${field("whatsapp_display", "رقم خدمة العملاء زي ما يظهر للزوار", "", true)}
        ${field("support_whatsapp", "واتساب الدعم الفني", "نسيت الباسورد، مشاكل الدخول والملفات. فاضي = رقم خدمة العملاء", true)}
        ${field("lecturer_whatsapp", "واتساب المحاضر", "أسئلة الشرح جوه المستويات. فاضي = رقم خدمة العملاء", true)}
        <h2 class="full" style="margin-top:10px">رسايل الواتساب الجاهزة</h2>
        ${field("subscribe_message", "رسالة الاشتراك (خدمة العملاء)", "{course} اسم الكورس، {plan} الباقة", false, true)}
        ${field("notify_message", "رسالة بلغني لما يفتح (خدمة العملاء)", "{course} اسم الكورس", false, true)}
        ${field("support_message", "رسالة الدعم الفني", "{name} اسم المتدرب", false, true)}
        ${field("follow_message", "رسالة المحاضر", "{name} الاسم، {course} الكورس، {level} المستوى", false, true)}
        ${field("reminder_message", "رسالة تذكير المتدرب المنقطع", "{name} الاسم، {course} الكورس، {level} المستوى، {link} رابط المنصة", false, true)}
        ${field("inactive_days", "يعتبر منقطع بعد كام يوم من غير دخول", "", true)}
        <div class="full row"><button class="btn btn-primary" type="submit">حفظ الإعدادات</button><span class="status" hidden></span></div>
      </form>
      <div class="card stack">
        <h2>خلفية الشهادة</h2>
        <p class="muted">ارفع تصميم الشهادة اللي عملته على Canva أو Leonardo (صورة بالعرض، مقاس 3508×2480 أو 1123×794، من غير الاسم والتاريخ). المنصة بتكتب اسم المتدرب والكورس والكود فوقها. لو مرفعتش صورة، بيتستخدم التصميم الافتراضي.</p>
        <div class="row"><label class="btn btn-primary">رفع صورة الخلفية<input type="file" id="bg" accept="image/png,image/jpeg,image/webp" hidden></label>
          ${s.cert_bg ? '<a class="btn btn-ghost" href="/api/public/cert-bg" target="_blank">شوف الخلفية الحالية</a>' : ""}</div>
        <div class="status" id="bg-st" hidden></div>
      </div>
      <div class="card stack"><h2>حسابي</h2><a class="btn btn-ghost" href="/account">تغيير باسورد الأدمن</a></div>`;
    const sf = $("#sf");
    const prev = () => {
      const cv = $("#wm-prev"), ctx = cv.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.fillStyle = "#102B4E"; ctx.font = '700 38px "IBM Plex Sans Arabic", Tahoma'; ctx.textAlign = "center"; ctx.fillText("المستوى الأول: نموذج صفحة", 400, 110);
      ctx.fillStyle = "#d9dee5";
      for (let y = 180; y < 880; y += 46) ctx.fillRect(80 + ((y / 46) % 3) * 30, y, 640 - ((y / 46) % 3) * 30, 14);
      IK.drawPageMarks(ctx, cv.width, cv.height, { ...s, ...Object.fromEntries(new FormData(sf)) }, { name: "أحمد محمد", phone: "01012345678" });
    };
    sf.addEventListener("input", prev);
    sf.addEventListener("change", prev);
    prev();
    sf.onsubmit = async (e) => {
      e.preventDefault();
      try { await api("/admin/settings", { method: "PUT", body: Object.fromEntries(new FormData(sf)) }); IK.status(sf.querySelector(".status"), "ok", "اتحفظ"); }
      catch (err) { IK.status(sf.querySelector(".status"), "bad", err.message); }
    };
    $("#bg").onchange = async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try { await api("/admin/cert-bg", { method: "PUT", body: f, type: f.type }); IK.status($("#bg-st"), "ok", "الخلفية اترفعت."); setTimeout(settingsTab, 900); }
      catch (err) { IK.status($("#bg-st"), "bad", err.message); }
    };
  }

  // ======================= التابات =======================
  const tabs = { students: studentsTab, inactive: () => inactiveTab(), courses: coursesTab, content: contentTab, exams: examsTab, settings: settingsTab };
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
