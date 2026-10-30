// العارض المحمي لصفحات الـ PDF: قراءة متصلة (فوق وتحت) أو صفحة صفحة، التكبير بصباعين، ملء الشاشة، والعلامة المائية.
// بيستخدمه المتدرب في صفحة الوحدة، والزائر في الفصول المجانية
(function () {
  const IK = window.IK;
  const mobile = matchMedia("(max-width: 700px), (pointer: coarse)").matches;
  const pref = (k, d) => { try { return localStorage.getItem(k) || d; } catch (e) { return d; } };
  const keep = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const ZMAX = 3;
  // زرار الرجوع في الموبايل أو المتصفح بيقفل العارض ويفضل في نفس الصفحة، بدل ما يخرّجك منها
  let closeActive = null;
  addEventListener("popstate", () => { if (closeActive) closeActive(); });
  IK.viewerOpened = (close) => {
    if (closeActive) closeActive(true);
    closeActive = close;
    if (!(history.state && history.state.ikViewer)) history.pushState({ ikViewer: 1 }, "");
  };
  // زرار "قفل": لو العارض واخد خطوة في الـ history نرجعها، والـ popstate هو اللي بيقفل
  IK.viewerClose = () => {
    if (history.state && history.state.ikViewer) history.back(); else if (closeActive) closeActive();
  };
  IK.viewerDone = () => { closeActive = null; };
  // المكان اللي العارض بيظهر فيه لازم يبان تحت الهيدر الثابت
  IK.scrollToViewer = (wrap) => {
    const h = (document.querySelector(".app-header") || {}).offsetHeight || 0;
    wrap.style.scrollMarginTop = h + 12 + "px";
    wrap.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const leaveFs = () => {
    document.body.classList.remove("no-scroll");
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (fsEl) try { Promise.resolve((document.exitFullscreen || document.webkitExitFullscreen).call(document)).catch(() => {}); } catch (e) {}
  };

  // opts: s (الإعدادات)، who (اسم اللي بيقرا للعلامة المائية)، src(n) رابط الصفحة،
  // onPage(n) لحفظ آخر صفحة، onDone لو فيه زرار "خلصت"، onClose
  IK.openPdf = async function (wrap, m, opts) {
    const s = opts.s;
    let page = 1, saveT = null, zoom = 1, fs = false, ratio = 1 / Math.SQRT2;
    // على قد الصفحة أو على قد العرض في ملء الشاشة، وقراءة متصلة (الموبايل) أو صفحة صفحة، وبنفتكر اختيار كل جهاز
    let fit = pref("ik-fit", mobile ? "width" : "page");
    let mode = pref("ik-mode", mobile ? "scroll" : "page");
    const cache = new Map();
    let slots = [], io = null;
    wrap.hidden = false;
    wrap.oncontextmenu = wrap.ondragstart = (e) => e.preventDefault();
    wrap.innerHTML = `<div class="spread" style="margin-bottom:10px"><h2 style="font-size:19px">${IK.esc(m.title)}</h2>
        <button class="btn btn-ghost btn-sm" id="v-close" type="button">قفل</button></div>
      <div class="viewer" id="v-box">
        <div class="vstage" id="v-stage"><div class="vpages" id="v-pages"></div></div>
        <div class="vbar"><button class="btn btn-sm" id="v-prev" type="button">→ السابق</button>
          <span>صفحة <b class="num" id="v-n">1</b> من <b class="num">${m.pages}</b></span>
          <button class="btn btn-sm" id="v-next" type="button">التالي ←</button></div>
        <div class="vbar vtools">
          <span class="row" style="gap:6px"><button class="btn btn-sm" id="v-zo" type="button" aria-label="تصغير">−</button>
            <b class="num" id="v-z">100%</b><button class="btn btn-sm" id="v-zi" type="button" aria-label="تكبير">+</button></span>
          <button class="btn btn-sm" id="v-mode" type="button"></button>
          <button class="btn btn-sm" id="v-fit" type="button" hidden></button>
          <button class="btn btn-sm" id="v-fs" type="button">⛶ ملء الشاشة</button>
          <button class="btn btn-gold btn-sm" id="v-done" type="button" hidden>خلصت المادة دي ✓</button>
        </div>
        ${mobile ? '<p class="vhint">اسحب لفوق وتحت علشان تقرا، وكبّر بصباعين. وعلى الصفحة: اسحب يمين للصفحة الجاية.</p>' : ""}</div>`;
    const box = IK.$("#v-box"), stage = IK.$("#v-stage"), pages = IK.$("#v-pages");

    // ===== تحميل ورسم الصفحات =====
    const load = (n) => {
      if (!cache.has(n)) cache.set(n, new Promise((res, rej) => {
        const img = new Image();
        img.onload = () => res(img);
        img.onerror = () => { cache.delete(n); rej(new Error("img")); };
        img.src = opts.src(n);
      }));
      return cache.get(n);
    };
    async function render(slot, n) {
      if (slot.dataset.drawn === String(n)) return;
      slot.dataset.drawn = String(n);
      const cv = document.createElement("canvas"), ctx = cv.getContext("2d");
      try {
        const img = await load(n);
        if (slot.dataset.drawn !== String(n)) return;
        cv.width = img.naturalWidth; cv.height = img.naturalHeight;
        ctx.drawImage(img, 0, 0);
        IK.drawPageMarks(ctx, cv.width, cv.height, s, opts.who);
      } catch (e) {
        if (slot.dataset.drawn !== String(n)) return;
        delete slot.dataset.drawn;
        cv.width = 800; cv.height = 300; ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, 800, 300);
        ctx.fillStyle = "#B4402F"; ctx.font = "26px Tahoma"; ctx.textAlign = "center"; ctx.fillText("الصفحة ما اتحملتش، جرب تاني", 400, 160);
      }
      slot.replaceChildren(cv);
    }
    const unload = (slot) => { if (slot.dataset.drawn) { delete slot.dataset.drawn; slot.replaceChildren(); } };

    function build() {
      if (io) { io.disconnect(); io = null; }
      pages.innerHTML = "";
      box.classList.toggle("scroll", mode === "scroll");
      const n = mode === "scroll" ? m.pages : 1;
      slots = [];
      for (let i = 1; i <= n; i++) {
        const d = document.createElement("div");
        d.className = "vpage";
        d.dataset.n = mode === "scroll" ? i : page;
        d.style.aspectRatio = String(ratio);
        pages.append(d);
        slots.push(d);
      }
      if (mode === "scroll") {
        // الصفحات القريبة من الشاشة بس هي اللي بتترسم، والبعيدة بتتشال علشان الموبايل مايتقلش
        io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) render(e.target, +e.target.dataset.n); }),
          { root: stage, rootMargin: "120% 0px" });
        slots.forEach((d) => io.observe(d));
      }
    }

    // ===== المقاسات =====
    function layout() {
      const sw = stage.clientWidth, sh = stage.clientHeight;
      const base = fs && fit === "page" ? Math.min(sw, sh * ratio) : sw;
      pages.style.width = Math.floor(base * zoom) + "px";
      IK.$("#v-z").textContent = Math.round(zoom * 100) + "%";
      IK.$("#v-zo").disabled = zoom <= 1;
      IK.$("#v-zi").disabled = zoom >= ZMAX;
      const narrow = innerWidth < 560;
      const fb = IK.$("#v-fit");
      fb.hidden = !fs;
      fb.textContent = fit === "page" ? (narrow ? "↔ العرض" : "↔ على قد العرض") : (narrow ? "▣ الصفحة" : "▣ على قد الصفحة");
      IK.$("#v-mode").textContent = mode === "scroll" ? (narrow ? "📄 صفحة صفحة" : "📄 اقرا صفحة صفحة") : (narrow ? "📜 متصلة" : "📜 قراءة متصلة");
      IK.$("#v-fs").textContent = fs ? (narrow ? "✕ خروج" : "✕ خروج من ملء الشاشة") : "⛶ ملء الشاشة";
    }
    // تكبير من الزراير: نفضل على نفس المكان في الصفحة
    function setZoom(z) {
      const fy = stage.scrollHeight ? (stage.scrollTop + stage.clientHeight / 2) / stage.scrollHeight : 0;
      zoom = clamp(Math.round(z * 100) / 100, 1, ZMAX);
      layout();
      stage.scrollTop = fy * stage.scrollHeight - stage.clientHeight / 2;
      stage.scrollLeft = (stage.scrollWidth - stage.clientWidth) / 2;
    }

    // ===== التنقل =====
    function update() {
      IK.$("#v-n").textContent = page;
      IK.$("#v-prev").disabled = page <= 1;
      IK.$("#v-next").disabled = page >= m.pages;
      IK.$("#v-done").hidden = !opts.onDone || page !== m.pages;
      // نحفظ آخر صفحة (للمتدرب)، علشان الملف يفتح عليها المرة الجاية
      if (opts.onPage) { clearTimeout(saveT); const p = page; saveT = setTimeout(() => opts.onPage(p), 1200); }
    }
    function go(n) {
      n = clamp(n, 1, m.pages);
      if (mode === "scroll") {
        page = n;
        stage.scrollTop = slots[n - 1].offsetTop - 6;
        update();
        return;
      }
      page = n;
      const slot = slots[0];
      slot.dataset.n = n;
      render(slot, n);
      stage.scrollTop = 0;
      stage.scrollLeft = (stage.scrollWidth - stage.clientWidth) / 2;
      if (n < m.pages) load(n + 1).catch(() => {});
      update();
    }
    // في القراءة المتصلة: الصفحة الحالية = اللي واخدة الجزء الأكبر من الشاشة
    let ticking = false;
    stage.addEventListener("scroll", () => {
      if (mode !== "scroll" || ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        const line = stage.scrollTop + stage.clientHeight * 0.4;
        let n = slots.findIndex((d) => d.offsetTop + d.offsetHeight > line) + 1 || m.pages;
        if (stage.scrollTop + stage.clientHeight >= stage.scrollHeight - 4) n = m.pages;
        slots.forEach((d, i) => { if (Math.abs(i + 1 - n) > 4) unload(d); });
        if (n !== page) { page = n; update(); }
      });
    }, { passive: true });

    // ===== ملء الشاشة =====
    function setFs(on) {
      fs = on;
      box.classList.toggle("fs", on);
      document.body.classList.toggle("no-scroll", on && !(document.fullscreenElement || document.webkitFullscreenElement));
      zoom = 1;
      layout();
      go(page);
    }
    async function toggleFs() {
      if (fs) { leaveFs(); setFs(false); return; }
      // الفل سكرين الحقيقي على الكمبيوتر والأندرويد، وعلى الآيفون بنملا الشاشة بنفسنا
      const req = box.requestFullscreen || box.webkitRequestFullscreen;
      if (req) { try { await req.call(box); } catch (e) {} }
      setFs(true);
    }
    const onFsChange = () => { if (fs && !(document.fullscreenElement || document.webkitFullscreenElement) && !document.body.classList.contains("no-scroll")) setFs(false); };
    document.addEventListener("fullscreenchange", onFsChange);
    document.addEventListener("webkitfullscreenchange", onFsChange);
    window.onresize = () => { const p = page; layout(); if (mode === "scroll") go(p); };

    IK.$("#v-next").onclick = () => go(page + 1);
    IK.$("#v-prev").onclick = () => go(page - 1);
    IK.$("#v-zi").onclick = () => setZoom(zoom + 0.25);
    IK.$("#v-zo").onclick = () => setZoom(zoom - 0.25);
    IK.$("#v-fit").onclick = () => { fit = fit === "page" ? "width" : "page"; keep("ik-fit", fit); zoom = 1; layout(); go(page); };
    IK.$("#v-mode").onclick = () => { mode = mode === "scroll" ? "page" : "scroll"; keep("ik-mode", mode); zoom = 1; const p = page; build(); layout(); go(p); };
    IK.$("#v-fs").onclick = toggleFs;
    // replaced = عارض تاني فتح مكانه، فمفيش رجوع لمكان الزرار
    const close = (replaced) => {
      IK.viewerDone();
      leaveFs(); if (io) io.disconnect(); window.onresize = null;
      if (replaced === true) return;
      wrap.hidden = true; wrap.innerHTML = "";
      if (opts.onClose) opts.onClose();
      // نرجع للفصل اللي كنت فاتحه منه
      if (opts.from && opts.from.isConnected) opts.from.scrollIntoView({ block: "center" });
    };
    IK.viewerOpened(close);
    IK.$("#v-close").onclick = IK.viewerClose;
    IK.$("#v-done").onclick = async () => { leaveFs(); if (history.state && history.state.ikViewer) history.replaceState(null, ""); await opts.onDone(); };
    // الكتاب عربي: السهم الشمال = الصفحة الجاية
    document.onkeydown = (e) => {
      if (wrap.hidden || !wrap.contains(box)) return;
      if (e.key === "ArrowLeft") go(page + 1);
      if (e.key === "ArrowRight") go(page - 1);
      if (e.key === "Escape" && fs) { leaveFs(); setFs(false); }
    };

    // ===== اللمس: التكبير بصباعين (من 100% لـ 300%)، والسحب يمين = الصفحة الجاية زي الكتاب العربي =====
    const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    let t0 = null, pinch = null;
    stage.addEventListener("touchstart", (e) => {
      if (e.touches.length === 2) {
        const [a, b] = e.touches, r = stage.getBoundingClientRect();
        const cx = (a.clientX + b.clientX) / 2 - r.left, cy = (a.clientY + b.clientY) / 2 - r.top;
        pinch = { d: dist(a, b) || 1, z: zoom, k: 1, cx, cy, fx: stage.scrollLeft + cx, fy: stage.scrollTop + cy, l: pages.offsetLeft, t: pages.offsetTop };
        pages.style.transformOrigin = `${pinch.fx - pinch.l}px ${pinch.fy - pinch.t}px`;
        t0 = null;
      } else if (e.touches.length === 1 && !pinch) {
        t0 = { x: e.touches[0].clientX, y: e.touches[0].clientY, at: Date.now() };
      }
    }, { passive: true });
    stage.addEventListener("touchmove", (e) => {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      const z = clamp(pinch.z * (dist(e.touches[0], e.touches[1]) / pinch.d), 1, ZMAX);
      pinch.k = z / pinch.z;
      pages.style.transform = `scale(${pinch.k})`;
    }, { passive: false });
    stage.addEventListener("touchend", (e) => {
      if (pinch) {
        if (e.touches.length) return;
        const p = pinch;
        pinch = null;
        pages.style.transform = "";
        zoom = clamp(p.z * p.k, 1, ZMAX);
        layout();
        const k = zoom / p.z;
        stage.scrollLeft = pages.offsetLeft + (p.fx - p.l) * k - p.cx;
        stage.scrollTop = pages.offsetTop + (p.fy - p.t) * k - p.cy;
        return;
      }
      if (!t0 || zoom > 1.05) { t0 = null; return; }
      const dx = e.changedTouches[0].clientX - t0.x, dy = e.changedTouches[0].clientY - t0.y;
      const quick = Date.now() - t0.at < 700;
      t0 = null;
      if (quick && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(page + (dx > 0 ? 1 : -1));
    });

    // أول صفحة بتحدد شكل الصفحات (طولية أو عرضية)
    try { const img = await load(1); ratio = img.naturalWidth / img.naturalHeight || ratio; } catch (e) {}
    build();
    layout();
    page = clamp(m.last_page || 1, 1, m.pages);
    go(page);
    if (m.last_page > 1) {
      const note = document.createElement("p");
      note.className = "muted";
      note.style.marginBottom = "8px";
      note.innerHTML = `كملنا من صفحة ${m.last_page} اللي وقفت عندها. <a href="#" id="v-first">ابدأ من الأول</a>`;
      box.before(note);
      IK.$("#v-first").onclick = (e) => { e.preventDefault(); go(1); note.remove(); };
    }
    IK.scrollToViewer(wrap);
  };

})();
