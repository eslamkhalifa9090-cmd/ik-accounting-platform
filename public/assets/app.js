// أدوات مشتركة لصفحات المنصة
(function () {
  const IK = (window.IK = {});

  IK.esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  IK.$ = (sel, root = document) => root.querySelector(sel);
  IK.qs = (k) => new URLSearchParams(location.search).get(k);
  IK.money = (n) => Number(n || 0).toLocaleString("en-US") + " جنيه";

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
    if (!r.ok) throw new Error((data && data.error) || "حصلت مشكلة. جرب تاني.");
    return data;
  };

  let sitePromise;
  IK.site = () => (sitePromise ||= fetch("/api/public/site").then((r) => r.json()).catch(() => ({ settings: {}, courses: [] })));

  IK.fill = (tpl, vars) => String(tpl || "").replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
  IK.wa = (number, text) => "https://wa.me/" + (number || "") + (text ? "?text=" + encodeURIComponent(text) : "");
  // أرقام التواصل: خدمة العملاء (الاشتراك والكورسات)، الدعم الفني (الدخول والمشاكل التقنية)، المحاضر (جوه المستويات)
  IK.contact = (s, kind) => (kind === "support" ? s.support_whatsapp : kind === "lecturer" ? s.lecturer_whatsapp : "") || s.whatsapp;
  IK.supportLink = (s, name) => IK.wa(IK.contact(s, "support"), IK.fill(s.support_message || "السلام عليكم، محتاج مساعدة فنية في المنصة:", { name: name || "" }));

  IK.chatIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.3-.4.8-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 2.9 2.9 0 0 0-.9 2.2 5 5 0 0 0 1 2.7 11.5 11.5 0 0 0 4.4 3.9c1.6.7 2.3.8 3.1.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3Z"/></svg>';

  // الهيدر والفوتر لكل صفحات المنصة
  IK.chrome = async ({ user } = {}) => {
    const site = await IK.site();
    const s = site.settings || {};
    const header = document.createElement("header");
    header.className = "app-header";
    const links = user
      ? (user.role === "admin" ? '<a class="btn btn-ghost btn-sm" href="/admin">لوحة الأدمن</a>' : "") +
        '<a class="btn btn-ghost btn-sm" href="/dashboard">كورساتي</a>' +
        (user.role === "admin" ? "" : '<a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="' + IK.esc(IK.supportLink(s, user.name)) + '">الدعم الفني</a>') +
        '<span class="who">' + IK.esc(user.name) + "</span>" +
        '<button class="btn btn-ghost btn-sm" id="logout-btn" type="button">خروج</button>'
      : '<a class="btn btn-primary btn-sm" href="/login">دخول المتدربين</a>';
    header.innerHTML = '<div class="wrap"><a class="brand" href="/"><img src="/assets/logo.webp" alt=""><b>' +
      IK.esc(s.brand_name || "Mr. Islam Khalifa | Accounting") + "</b></a><nav>" + links + "</nav></div>";
    document.body.prepend(header);
    const footer = document.createElement("footer");
    footer.className = "app-footer";
    footer.innerHTML = "<b>" + IK.esc(s.footer_line1 || "") + "</b><span>" + IK.esc(s.footer_line2 || "") + "</span>";
    document.body.append(footer);
    const lo = IK.$("#logout-btn");
    if (lo) lo.addEventListener("click", async () => { try { await IK.api("/auth/logout", { method: "POST" }); } catch (e) {} location.href = "/login"; });
    return site;
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
})();
