// أدوات مشتركة لصفحات المنصة
(function () {
  const IK = (window.IK = {});

  IK.esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  IK.$ = (sel, root = document) => root.querySelector(sel);
  IK.qs = (k) => new URLSearchParams(location.search).get(k);
  IK.money = (n) => Number(n || 0).toLocaleString("en-US") + " جنيه";
  // التخزين على الجهاز ممكن يكون مقفول (تصفح خفي)، فكل قراية وكتابة جوه try
  IK.ls = (k, v) => {
    try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) {}
    return null;
  };

  IK.api = async (path, opts = {}) => {
    const init = { method: opts.method || "GET", headers: {}, credentials: "same-origin" };
    if (opts.body instanceof Blob || opts.body instanceof ArrayBuffer) {
      init.body = opts.body;
      init.headers["content-type"] = opts.type || "application/octet-stream";
    } else if (opts.body !== undefined) {
      init.body = JSON.stringify(opts.body);
      init.headers["content-type"] = "application/json";
    }
    const r = await fetch("/api" + path, init);
    if (r.status === 401 && !opts.noRedirect) {
      location.href = "/login?next=" + encodeURIComponent(location.pathname + location.search);
      throw new Error("login");
    }
    const data = (r.headers.get("content-type") || "").includes("json") ? await r.json() : null;
    if (!r.ok) { const err = new Error((data && data.error) || "حصلت مشكلة. جرب تاني."); err.status = r.status; throw err; }
    return data;
  };

  let sitePromise;
  IK.site = () => (sitePromise ||= fetch("/api/public/site").then((r) => r.json()).catch(() => ({ settings: {}, courses: [], tracks: [], audiences: {}, free: [] })));

  IK.fill = (tpl, vars) => String(tpl || "").replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
  IK.wa = (number, text) => "https://wa.me/" + (number || "") + (text ? "?text=" + encodeURIComponent(text) : "");
  // أرقام التواصل: خدمة العملاء (الاشتراك والكورسات)، الدعم الفني (الدخول والمشاكل التقنية)، المحاضر (جوه المستويات)
  IK.contact = (s, kind) => (kind === "support" ? s.support_whatsapp : kind === "lecturer" ? s.lecturer_whatsapp : "") || s.whatsapp;
  IK.supportLink = (s, name) => IK.wa(IK.contact(s, "support"), IK.fill(s.support_message || "السلام عليكم، محتاج مساعدة فنية في المنصة:", { name: name || "" }));

  IK.chatIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.3-.4.8-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 2.9 2.9 0 0 0-.9 2.2 5 5 0 0 0 1 2.7 11.5 11.5 0 0 0 4.4 3.9c1.6.7 2.3.8 3.1.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3Z"/></svg>';

  // ===== مصدر الزيارة: أول مكان جه منه الزائر (فيسبوك، واتساب، جوجل ...) بيفضل محفوظ على الجهاز =====
  const REF_MAP = [[/facebook|fb\.|messenger/, "facebook"], [/instagram/, "instagram"], [/whatsapp|wa\.me|l\.wl\.co/, "whatsapp"],
    [/google\./, "google"], [/youtube|youtu\.be/, "youtube"], [/tiktok/, "tiktok"], [/linkedin|lnkd/, "linkedin"], [/t\.me|telegram/, "telegram"], [/bing\./, "bing"]];
  const clean = (v) => String(v || "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40);
  let srcCache = null;
  IK.source = () => {
    if (srcCache) return srcCache;
    let saved = null;
    try { saved = JSON.parse(IK.ls("ik-src") || "null"); } catch (e) {}
    if (!saved || !saved.src) {
      const q = new URLSearchParams(location.search);
      let src = clean(q.get("src") || q.get("utm_source"));
      if (!src && q.get("fbclid")) src = "facebook";
      if (!src && q.get("gclid")) src = "google";
      if (!src && document.referrer) {
        let host = "";
        try { host = new URL(document.referrer).hostname; } catch (e) {}
        if (host && host !== location.hostname) src = (REF_MAP.find(([re]) => re.test(host)) || [, clean(host.replace(/^www\./, "").split(".")[0])])[1];
      }
      const utm = {};
      for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]) if (q.get(k)) utm[k] = q.get(k).slice(0, 80);
      saved = { src: src || "direct", utm, landing: location.pathname + location.search.slice(0, 120), at: new Date().toISOString() };
      IK.ls("ik-src", JSON.stringify(saved));
    }
    srcCache = saved;
    // زيارة واحدة من المصدر ده في كل جلسة
    try {
      if (!sessionStorage.getItem("ik-src-sent")) { sessionStorage.setItem("ik-src-sent", "1"); IK.track("visit_src", saved.src); }
    } catch (e) {}
    return saved;
  };
  // كود قصير بيتحط في رسالة الاشتراك علشان نعرف الطلب جه منين
  IK.srcCode = () => "IK-" + IK.source().src.toUpperCase();
  IK.subText = (text) => String(text || "") + "\n\n(كود الطلب: " + IK.srcCode() + ")";
  IK.subClick = (slug) => { IK.track("wa_subscribe", slug || ""); IK.track("sub_src", IK.source().src); };

  // ===== الزائر السريع: اسم ورقم واتساب بس، من غير باسورد =====
  let visitorPromise;
  IK.visitor = (fresh) => {
    if (fresh || !visitorPromise) visitorPromise = fetch("/api/public/visitor", { credentials: "same-origin" }).then((r) => r.json()).then((d) => d.visitor).catch(() => null);
    return visitorPromise;
  };
  IK.showVisitor = (v) => {
    const slot = IK.$("#visitor-slot");
    if (!slot || !v) return;
    slot.className = "visitor-chip";
    slot.innerHTML = '<span class="badge gold" title="دخول سريع كزائر">زائر · ' + IK.esc(v.name.split(" ")[0]) + '</span><a class="btn btn-gold btn-sm" href="/#catalog">اشترك</a>';
  };

  // نافذة الدخول السريع. item = { kind: "chapter" | "file" | "notify" | "contact", ref }
  // بترجع الزائر لو سجل، أو null لو قفلها
  IK.visitorGate = async ({ item, title, why } = {}) => {
    const known = await IK.visitor();
    if (known) return known;
    return new Promise((resolve) => {
      const dlg = document.createElement("dialog");
      dlg.className = "gate";
      dlg.innerHTML = `<form method="dialog" class="stack" novalidate>
        <div class="spread"><span class="badge gold">دخول سريع كزائر: مجاني ومن غير باسورد</span><button class="x" value="cancel" type="submit" aria-label="قفل">✕</button></div>
        <h2>${IK.esc(title || "قبل ما تبدأ، عرّفنا بنفسك")}</h2>
        <p class="muted">ده مش اشتراك ومش هنطلب منك أي فلوس. اسمك ورقمك بس علشان ${IK.esc(why || "تحمّل الملفات وتتابع الجديد")}. وجهازك هيفتكرك المرة الجاية.</p>
        <div class="field"><label for="g-name">اسمك</label><input id="g-name" autocomplete="name" required maxlength="80"></div>
        <div class="field"><label for="g-phone">رقم الواتساب</label><input id="g-phone" type="tel" dir="ltr" autocomplete="tel" required placeholder="01xxxxxxxxx"></div>
        <label class="check"><input type="checkbox" id="g-service" checked> موافق إن رقمي يتسجل علشان أفتح الملفات والفصول المجانية</label>
        <label class="check"><input type="checkbox" id="g-mkt"> ابعتولي الجديد من شيتات وكورسات على واتساب (اختياري)</label>
        <p class="muted" style="font-size:13px">بياناتك مش بتظهر لحد غير إدارة الأكاديمية. <a href="/privacy" target="_blank">إزاي بنستخدم بياناتك</a></p>
        <div class="status" role="status" aria-live="polite" hidden></div>
        <button class="btn btn-primary" id="g-go" type="button">يلا نبدأ</button>
      </form>`;
      document.body.append(dlg);
      const st = dlg.querySelector(".status"), go = dlg.querySelector("#g-go");
      let done = null;
      const finish = () => { dlg.remove(); resolve(done); };
      dlg.addEventListener("close", finish);
      go.onclick = async () => {
        go.disabled = true;
        const src = IK.source();
        try {
          const r = await IK.api("/public/visitor", { method: "POST", noRedirect: true, body: {
            name: dlg.querySelector("#g-name").value, phone: dlg.querySelector("#g-phone").value,
            service: dlg.querySelector("#g-service").checked, marketing: dlg.querySelector("#g-mkt").checked,
            source: src.src, utm: src.utm, landing: src.landing, item,
          } });
          done = r.visitor;
          visitorPromise = Promise.resolve(done);
          IK.showVisitor(done);
          dlg.close();
        } catch (e) { IK.status(st, "bad", e.message); go.disabled = false; }
      };
      dlg.querySelector("form").addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.tagName === "INPUT" && e.target.type !== "checkbox") { e.preventDefault(); go.click(); } });
      dlg.showModal();
      dlg.querySelector("#g-name").focus();
    });
  };

  // الهيدر والفوتر لكل صفحات المنصة
  IK.chrome = async ({ user } = {}) => {
    IK.source();
    const site = await IK.site();
    const s = site.settings || {};
    const header = document.createElement("header");
    header.className = "app-header";
    const lib = '<a class="btn btn-ghost btn-sm" href="/library">مكتبة IK</a>';
    const links = user
      ? (user.role === "admin" ? '<a class="btn btn-ghost btn-sm" href="/admin">لوحة الأدمن</a>' : "") +
        '<a class="btn btn-ghost btn-sm" href="/dashboard">كورساتي</a>' + lib +
        (user.role === "admin" ? "" : '<a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="' + IK.esc(IK.supportLink(s, user.name)) + '">الدعم الفني</a>') +
        '<span class="who">' + IK.esc(user.name) + "</span>" +
        '<button class="btn btn-ghost btn-sm" id="logout-btn" type="button">خروج</button>'
      : lib + '<span id="visitor-slot"></span><a class="btn btn-primary btn-sm" href="/login">دخول المتدربين</a>';
    header.innerHTML = '<div class="wrap"><a class="brand" href="/"><img src="/assets/logo.webp" alt=""><span class="brand-t"><b>' +
      IK.esc(s.brand_name || "IK Academy") + "</b>" + (s.brand_by ? "<small>" + IK.esc(s.brand_by) + "</small>" : "") + "</span></a><nav>" + links + "</nav></div>";
    document.body.prepend(header);
    if (!user) IK.visitor().then(IK.showVisitor);
    const footer = document.createElement("footer");
    footer.className = "app-footer";
    footer.innerHTML = "<b>" + IK.esc(s.footer_line1 || "") + "</b><span>" + IK.esc(s.footer_line2 || "") + '</span><a href="/privacy">الخصوصية</a>';
    document.body.append(footer);
    const lo = IK.$("#logout-btn");
    if (lo) lo.addEventListener("click", async () => { try { await IK.api("/auth/logout", { method: "POST" }); } catch (e) {} location.href = "/login"; });
    return site;
  };

  // العلامة المائية وفوتر صفحات المادة، من الإعدادات:
  // wm_student (1 = اسم المتدرب ورقمه والتاريخ، 0 = لأ)، wm_text نص إضافي، wm_level درجة الوضوح
  IK.WM_ALPHA = { light: 0.07, medium: 0.13, strong: 0.22 };
  IK.drawPageMarks = (ctx, w, h, s, who) => {
    const parts = [];
    if (s.wm_student !== "0" && who) parts.push(who.name, who.phone || who.email || "", new Date().toLocaleDateString("ar-EG"));
    if (s.wm_text) parts.push(s.wm_text);
    const mark = parts.filter(Boolean).join(" · ");
    if (mark) {
      ctx.save();
      ctx.globalAlpha = IK.WM_ALPHA[s.wm_level] || IK.WM_ALPHA.medium;
      ctx.fillStyle = "#102B4E";
      ctx.font = `600 ${Math.round(w / 34)}px "IBM Plex Sans Arabic", Tahoma, sans-serif`;
      ctx.textAlign = "center";
      ctx.translate(w / 2, h / 2);
      ctx.rotate(-Math.PI / 6);
      const stepY = w / 6, stepX = Math.max(w / 1.6, ctx.measureText(mark).width * 1.25);
      for (let y = -h; y < h; y += stepY) for (let x = -w; x < w; x += stepX) ctx.fillText(mark, x + ((y / stepY) % 2) * stepX / 2, y);
      ctx.restore();
    }
    // اسم المنصة في فوتر كل صفحة
    const brand = [s.footer_line1 || s.brand_name || "IK Academy", s.footer_line2].filter(Boolean).join("  —  ");
    const fh = Math.round(w / 40);
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,.88)";
    ctx.fillRect(0, h - fh * 1.9, w, fh * 1.9);
    ctx.fillStyle = "#102B4E";
    ctx.font = `600 ${Math.round(fh * 0.72)}px "IBM Plex Sans Arabic", Tahoma, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(brand, w / 2, h - fh * 0.95);
    ctx.restore();
  };

  // اسم التقسيم في الكورس (مستوى / وحدة / موديول)، بييجي من السيرفر مع كل كورس
  IK.U = (u) => u || { key: "level", the: "المستوى", a: "مستوى", pl: "المستويات", li: "للمستوى", this: "المستوى ده", closed: "مقفول", opens: "بيفتح", will: "هيفتح", before: "اللي قبله" };

  // عداد الإحصائيات (زيارة أو ضغطة)، بيتبعت في الخلفية ومش بيأخر الصفحة
  IK.track = (kind, ref = "") => {
    const data = new Blob([JSON.stringify({ kind, ref })], { type: "application/json" });
    try { if (navigator.sendBeacon && navigator.sendBeacon("/api/public/track", data)) return; } catch (e) {}
    fetch("/api/public/track", { method: "POST", body: data, headers: { "content-type": "application/json" }, keepalive: true }).catch(() => {});
  };

  IK.me = () => IK.api("/auth/me");

  // صفحة لازم دخول: بترجع بيانات المتدرب، وتحوله لتغيير الباسورد لو أول مرة
  IK.requireUser = async ({ admin = false } = {}) => {
    const me = await IK.me();
    if (admin && me.role !== "admin") { location.href = "/dashboard"; throw new Error("forbidden"); }
    if (me.must_change && !location.pathname.startsWith("/account")) { location.href = "/account?first=1"; throw new Error("first"); }
    return me;
  };

  IK.status = (el, kind, msg) => { el.className = "status " + kind; el.textContent = msg; el.hidden = false; };

  // سعر الباقة (قبل وبعد الخصم)
  IK.priceHTML = (p) => {
    if (!p.show_price) return '<span class="muted">السعر على واتساب</span>';
    if (p.discounted) {
      return '<span class="price"><s class="muted">' + IK.money(p.price) + "</s> <b>" + IK.money(p.final) + "</b></span>" +
        (p.discount_ends ? ' <span class="badge gold">العرض لحد ' + IK.esc(p.discount_ends) + "</span>" : "");
    }
    return '<span class="price"><b>' + IK.money(p.final) + "</b></span>";
  };

  // وسوم الكورس أو الملف: مناسب لمين + الأدوات
  IK.tags = (audiences, tools, all) => (audiences || []).map((a) => `<span class="tag">${IK.esc((all || {})[a] || a)}</span>`).join("") +
    (tools || []).map((t) => `<span class="tag tool">${IK.esc(t)}</span>`).join("");
  IK.size = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + " ميجا" : Math.max(1, Math.round(b / 1024)) + " كيلو");

  // تحميل ملف من المكتبة: المجاني محتاج دخول سريع كزائر الأول، وبعدها المتصفح بيحمّل من السيرفر مباشرة
  // (السيرفر بيتأكد من الصلاحية تاني، وبيسمي الملف باسم اللي حمّله)
  IK.download = async (f) => {
    if (!f.can && f.access === "free") {
      const v = await IK.visitorGate({ item: { kind: "file", ref: String(f.id) }, title: "خد الملف ده مجاناً", why: "تحمّل الشيت ده وأي ملف مجاني تاني" });
      if (!v) return false;
    }
    const a = document.createElement("a");
    a.href = "/api/public/library/" + f.id + "/download";
    a.rel = "nofollow";
    document.body.append(a);
    a.click();
    setTimeout(() => a.remove(), 1000);
    return true;
  };
})();
