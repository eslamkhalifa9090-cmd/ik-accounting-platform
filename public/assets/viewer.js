// العارض المحمي لصفحات الـ PDF: ملء الشاشة، التكبير، السحب، والعلامة المائية.
// بيستخدمه المتدرب في صفحة الوحدة، والزائر في الفصول المجانية
(function () {
  const IK = window.IK;
  const mobile = matchMedia("(max-width: 700px), (pointer: coarse)").matches;
  const pref = (k, d) => { try { return localStorage.getItem(k) || d; } catch (e) { return d; } };
  const keep = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  const leaveFs = () => {
    document.body.classList.remove("no-scroll");
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (fsEl) try { Promise.resolve((document.exitFullscreen || document.webkitExitFullscreen).call(document)).catch(() => {}); } catch (e) {}
  };

  // opts: s (الإعدادات)، who (اسم اللي بيقرا للعلامة المائية)، src(n) رابط الصفحة،
  // onPage(n) لحفظ آخر صفحة، onDone لو فيه زرار "خلصت"، onClose
  IK.openPdf = async function (wrap, m, opts) {
    const s = opts.s;
    let page = 1, saveT = null, zoom = 1, fs = false;
    // على قد الصفحة (الديسكتوب) أو على قد العرض (الموبايل)، وبنفتكر اختيار كل جهاز
    let fit = pref("ik-fit", mobile ? "width" : "page");
    const cache = new Map();
    wrap.hidden = false;
    wrap.oncontextmenu = wrap.ondragstart = (e) => e.preventDefault();
    wrap.innerHTML = `<div class="spread" style="margin-bottom:10px"><h2 style="font-size:19px">${IK.esc(m.title)}</h2>
        <button class="btn btn-ghost btn-sm" id="v-close" type="button">قفل</button></div>
      <div class="viewer" id="v-box">
        <div class="vstage" id="v-stage"><canvas id="v-canvas"></canvas></div>
        <div class="vbar"><button class="btn btn-sm" id="v-next" type="button">التالي ←</button>
          <span>صفحة <b class="num" id="v-n">1</b> من <b class="num">${m.pages}</b></span>
          <button class="btn btn-sm" id="v-prev" type="button">→ السابق</button></div>
        <div class="vbar vtools">
          <span class="row" style="gap:6px"><button class="btn btn-sm" id="v-zo" type="button" aria-label="تصغير">−</button>
            <b class="num" id="v-z">100%</b><button class="btn btn-sm" id="v-zi" type="button" aria-label="تكبير">+</button></span>
          <button class="btn btn-sm" id="v-fit" type="button" hidden></button>
          <button class="btn btn-sm" id="v-fs" type="button">⛶ ملء الشاشة</button>
          <button class="btn btn-gold btn-sm" id="v-done" type="button" hidden>خلصت المادة دي ✓</button>
        </div></div>`;
    const box = IK.$("#v-box"), stage = IK.$("#v-stage");
    const cv = IK.$("#v-canvas"), ctx = cv.getContext("2d");

    // مقاس الصفحة على الشاشة: على قد العرض، أو الصفحة كلها في ملء الشاشة، مضروب في التكبير
    function layout() {
      const sw = stage.clientWidth, sh = stage.clientHeight, r = cv.width / cv.height || 1;
      const base = fs && fit === "page" ? Math.min(sw, sh * r) : sw;
      cv.style.width = Math.floor(base * zoom) + "px";
      IK.$("#v-z").textContent = Math.round(zoom * 100) + "%";
      IK.$("#v-zo").disabled = zoom <= 1;
      IK.$("#v-zi").disabled = zoom >= 2;
      const fb = IK.$("#v-fit");
      fb.hidden = !fs;
      const narrow = innerWidth < 560;
      fb.textContent = fit === "page" ? (narrow ? "↔ العرض" : "↔ على قد العرض") : (narrow ? "▣ الصفحة" : "▣ على قد الصفحة");
      IK.$("#v-fs").textContent = fs ? (narrow ? "✕ خروج" : "✕ خروج من ملء الشاشة") : "⛶ ملء الشاشة";
    }
    function setFs(on) {
      fs = on;
      box.classList.toggle("fs", on);
      document.body.classList.toggle("no-scroll", on && !(document.fullscreenElement || document.webkitFullscreenElement));
      zoom = 1;
      layout();
      stage.scrollTop = 0;
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
    window.onresize = layout;

    const load = (n) => {
      if (!cache.has(n)) cache.set(n, new Promise((res, rej) => {
        const img = new Image();
        img.onload = () => res(img);
        img.onerror = rej;
        img.src = opts.src(n);
      }));
      return cache.get(n);
    };
    async function show(n) {
      page = Math.min(Math.max(1, n), m.pages);
      IK.$("#v-n").textContent = page;
      try {
        const img = await load(page);
        cv.width = img.naturalWidth; cv.height = img.naturalHeight;
        ctx.drawImage(img, 0, 0);
        IK.drawPageMarks(ctx, cv.width, cv.height, s, opts.who);
      } catch (e) {
        cv.width = 800; cv.height = 200; ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, 800, 200);
        ctx.fillStyle = "#B4402F"; ctx.font = "24px Tahoma"; ctx.textAlign = "center"; ctx.fillText("الصفحة ما اتحملتش، جرب تاني", 400, 110);
      }
      layout();
      stage.scrollTop = 0;
      if (page < m.pages) load(page + 1);
      IK.$("#v-done").hidden = !opts.onDone || page !== m.pages;
      // نحفظ آخر صفحة (للمتدرب)، علشان الملف يفتح عليها المرة الجاية
      if (opts.onPage) { clearTimeout(saveT); const p = page; saveT = setTimeout(() => opts.onPage(p), 1200); }
    }
    IK.$("#v-next").onclick = () => show(page + 1);
    IK.$("#v-prev").onclick = () => show(page - 1);
    IK.$("#v-zi").onclick = () => { zoom = Math.min(2, zoom + 0.25); layout(); };
    IK.$("#v-zo").onclick = () => { zoom = Math.max(1, zoom - 0.25); layout(); };
    IK.$("#v-fit").onclick = () => { fit = fit === "page" ? "width" : "page"; keep("ik-fit", fit); zoom = 1; layout(); };
    IK.$("#v-fs").onclick = toggleFs;
    IK.$("#v-close").onclick = () => { leaveFs(); window.onresize = null; wrap.hidden = true; wrap.innerHTML = ""; if (opts.onClose) opts.onClose(); };
    IK.$("#v-done").onclick = async () => { leaveFs(); await opts.onDone(); };
    document.onkeydown = (e) => {
      if (wrap.hidden) return;
      if (e.key === "ArrowLeft") show(page + 1);
      if (e.key === "ArrowRight") show(page - 1);
      if (e.key === "Escape" && fs) { leaveFs(); setFs(false); }
    };
    // السحب على الموبايل: شمال = الصفحة الجاية، يمين = اللي قبلها (لما الصفحة مش متكبرة)
    let t0 = null;
    stage.addEventListener("touchstart", (e) => { t0 = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null; }, { passive: true });
    stage.addEventListener("touchend", (e) => {
      if (!t0 || zoom > 1) return;
      const dx = e.changedTouches[0].clientX - t0.x, dy = e.changedTouches[0].clientY - t0.y;
      t0 = null;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) show(page + (dx < 0 ? 1 : -1));
    });
    await show(m.last_page || 1);
    if (m.last_page > 1) {
      const note = document.createElement("p");
      note.className = "muted";
      note.style.marginBottom = "8px";
      note.innerHTML = `كملنا من صفحة ${m.last_page} اللي وقفت عندها. <a href="#" id="v-first">ابدأ من الأول</a>`;
      wrap.querySelector(".viewer").before(note);
      IK.$("#v-first").onclick = (e) => { e.preventDefault(); show(1); note.remove(); };
    }
    wrap.scrollIntoView({ behavior: "smooth", block: "start" });
  };

})();
