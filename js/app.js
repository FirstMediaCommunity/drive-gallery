/*
 * app.js — the user interface.
 *
 * Pages are driven by the URL hash so the site works on any static host:
 *   #/                 → the root folder (home page)
 *   #/f/<folderId>     → a folder / gallery
 *   #/f/<id>/p/<file>  → a gallery with one photo open in the viewer
 *
 * Sections:  helpers → chrome (header/footer/theme) → folder page →
 *            photo grid → lightbox → router
 */
(() => {
  const C = window.GALLERY_CONFIG;
  const D = window.Drive;
  const $ = (sel, root = document) => root.querySelector(sel);
  const view = $("#view");
  const lb = $("#lightbox");

  /* ── helpers ─────────────────────────────────────────────── */
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const svg = (d) =>
    `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const icon = {
    left: svg('<path d="m15 18-6-6 6-6"/>'),
    right: svg('<path d="m9 18 6-6-6-6"/>'),
    close: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
    download: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>'),
    share: svg('<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>'),
    info: svg('<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>'),
    play: svg('<path d="m6 3 14 9-14 9z" fill="currentColor"/>'),
    pause: svg('<path d="M6 4h4v16H6zM14 4h4v16h-4z" fill="currentColor"/>'),
    full: svg('<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>'),
    moon: svg('<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/>'),
    sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4"/>'),
    external: svg('<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>'),
    search: svg('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>'),
  };

  const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;
  const fmtDate = (d) => {
    const t = d ? new Date(d) : null;
    return t && !isNaN(t) ? t.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : "";
  };
  const fmtBytes = (b) => (b >= 1e9 ? (b / 1e9).toFixed(1) + " GB" : b >= 1e6 ? (b / 1e6).toFixed(1) + " MB" : Math.round(b / 1e3) + " KB");
  const fmtDuration = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
  const ratioOf = (it) => (it.w && it.h ? it.w / it.h : it.type === "video" ? 16 / 9 : 1.5);
  const hashFor = (folderId, photoId) =>
    folderId === D.rootId && !photoId ? "#/" : `#/f/${folderId}${photoId ? "/p/" + photoId : ""}`;

  let toastTimer;
  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
  }

  async function share(title) {
    const url = location.href;
    try {
      if (navigator.share) await navigator.share({ title, url });
      else {
        await navigator.clipboard.writeText(url);
        toast("Link copied");
      }
    } catch {}
  }

  /* ── chrome: theme, header, footer ───────────────────────── */
  const state = {
    folderId: null, folder: null, folders: [], items: [],
    shown: [],            // items after filter + sort (what the grid and viewer use)
    sort: "name", query: "", kind: "all",
    lb: -1, lbPushed: false, slideshow: null,
  };

  function initChrome() {
    const root = document.documentElement;
    const t = C.theme || {};
    if (t.brand) root.style.setProperty("--brand", t.brand);
    if (t.accent) root.style.setProperty("--accent", t.accent);
    if (t.highlight) root.style.setProperty("--highlight", t.highlight);
    if (C.rowHeight) root.style.setProperty("--row-h", C.rowHeight + "px");

    let mode = t.defaultMode || "light";
    try { mode = localStorage.getItem("dg:theme") || mode; } catch {}
    root.dataset.theme = mode;

    $("#brand").innerHTML =
      (C.logo ? `<img src="${esc(C.logo)}" alt="">` : "") +
      `<span class="brand-name">${esc(C.siteTitle)}</span>` +
      (C.tagline ? `<span class="brand-sub">${esc(C.tagline)}</span>` : "");

    $("#topnav").innerHTML =
      (C.links || []).map((l) => `<a href="${esc(l.url)}">${esc(l.label)}</a>`).join("") +
      `<button class="icon-btn" id="theme-toggle" title="Toggle dark mode" aria-label="Toggle dark mode"></button>`;
    const toggle = $("#theme-toggle");
    const paint = () => (toggle.innerHTML = root.dataset.theme === "dark" ? icon.sun : icon.moon);
    paint();
    toggle.onclick = () => {
      root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
      try { localStorage.setItem("dg:theme", root.dataset.theme); } catch {}
      paint();
    };

    $("#footer").innerHTML =
      `<span>© ${new Date().getFullYear()} ${esc(C.siteTitle)}</span>` +
      (C.repoUrl ? `<a href="${esc(C.repoUrl)}" target="_blank" rel="noopener">Powered by Drive Gallery</a>` : "");
    $("#demo-banner").hidden = !D.demo;
  }

  /* ── folder page ─────────────────────────────────────────── */
  async function loadFolder(id) {
    state.folderId = id;
    state.query = "";
    state.kind = "all";
    view.innerHTML = `<div class="hero hero-loading"></div><div class="wrap"><div class="grid">${
      Array.from({ length: 12 }, (_, i) => `<div class="ph skeleton" style="--r:${[1.5, 0.8, 1.5, 1.33][i % 4]}"></div>`).join("")
    }</div></div>`;
    window.scrollTo(0, 0);

    try {
      const [folder, listing, crumbs] = await Promise.all([D.folder(id), D.list(id), D.path(id)]);
      if (state.folderId !== id) return; // user navigated away while loading
      Object.assign(state, { folder, folders: listing.folders, items: listing.items });
      renderFolder(crumbs);
    } catch (err) {
      if (state.folderId !== id) return;
      renderError(err);
    }
  }

  function renderFolder(crumbs) {
    const { folder, folders, items } = state;
    const isRoot = folder.id === D.rootId;
    const photos = items.filter((i) => i.type === "image").length;
    const videos = items.length - photos;
    const parent = crumbs.length > 1 ? crumbs[crumbs.length - 2].name : "";
    const meta = [
      folders.length && plural(folders.length, isRoot ? "collection" : "gallery").replace("gallerys", "galleries"),
      photos && plural(photos, "photo"),
      videos && plural(videos, "video"),
    ].filter(Boolean).join("  ·  ");

    document.title = isRoot ? `${C.siteTitle} — ${C.tagline || "Gallery"}` : `${folder.name} · ${C.siteTitle}`;

    view.innerHTML = `
      <section class="hero ${isRoot ? "hero-home" : ""}">
        <div class="hero-bg" id="hero-bg"></div>
        <div class="hero-inner">
          ${!isRoot && parent ? `<p class="hero-kicker">${esc(parent)}</p>` : ""}
          <h1>${esc(folder.name)}</h1>
          ${folder.description ? `<p class="hero-desc">${esc(folder.description)}</p>` : ""}
          ${meta ? `<p class="hero-meta">${meta}</p>` : ""}
        </div>
      </section>
      <div class="wrap">
        <div class="bar">
          <nav class="crumbs" aria-label="Breadcrumb">
            ${crumbs.map((c, i) =>
              i === crumbs.length - 1
                ? `<span aria-current="page">${esc(c.name)}</span>`
                : `<a href="${hashFor(c.id)}">${esc(c.name)}</a><span class="sep">/</span>`).join("")}
          </nav>
          <div class="tools">
            ${items.length > 8 ? `<label class="search">${icon.search}<input id="q" type="search" placeholder="Filter by name" aria-label="Filter by name"></label>` : ""}
            ${photos && videos ? `<div class="seg" id="kind" role="group" aria-label="Show">
                <button data-kind="all" class="on">All</button><button data-kind="image">Photos</button><button data-kind="video">Videos</button>
              </div>` : ""}
            ${items.length > 1 ? `<select id="sort" aria-label="Sort">
                <option value="name">Name A–Z</option><option value="name-desc">Name Z–A</option>
                <option value="new">Newest first</option><option value="old">Oldest first</option>
              </select>` : ""}
            ${photos > 1 ? `<button class="btn" id="slideshow">${icon.play}<span>Slideshow</span></button>` : ""}
            <button class="btn" id="share">${icon.share}<span>Share</span></button>
            ${C.showDriveLink && !D.demo ? `<a class="btn" href="${D.folderUrl(folder.id)}" target="_blank" rel="noopener">${icon.external}<span>Open in Drive</span></a>` : ""}
          </div>
        </div>
        ${folders.length ? `<section class="tiles" id="tiles">${folders.map(tileHtml).join("")}</section>` : ""}
        ${folders.length && items.length ? `<h2 class="section-title">Photos &amp; videos</h2>` : ""}
        <section class="grid" id="grid"></section>
        ${!folders.length && !items.length ? `<p class="empty">This gallery is empty.</p>` : ""}
      </div>`;

    // hero cover
    D.cover(folder.id).then(({ item }) => {
      const bg = $("#hero-bg");
      if (!item || !bg || state.folder !== folder) return;
      const img = new Image();
      img.referrerPolicy = "no-referrer";
      img.onload = () => {
        bg.style.backgroundImage = `url("${img.src}")`;
        bg.classList.add("loaded");
      };
      img.src = D.thumb(item, 1600);
    }).catch(() => {});

    // folder tiles: fetch each cover + counts
    folders.forEach((f) => {
      D.cover(f.id).then(({ item, photos, folders }) => {
        const tile = document.getElementById("tile-" + f.id);
        if (!tile) return;
        if (item) $(".tile-img", tile).innerHTML = `<img src="${D.thumb(item, 640)}" alt="" loading="lazy" referrerpolicy="no-referrer">`;
        $(".tile-meta", tile).textContent =
          [folders && plural(folders, "gallery").replace("gallerys", "galleries"), photos && plural(photos, "item")].filter(Boolean).join(" · ") || "Empty";
      }).catch(() => {});
    });

    // toolbar wiring
    $("#q")?.addEventListener("input", (e) => { state.query = e.target.value.trim().toLowerCase(); renderGrid(); });
    $("#sort")?.addEventListener("change", (e) => { state.sort = e.target.value; renderGrid(); });
    if ($("#sort")) $("#sort").value = state.sort;
    $("#kind")?.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      state.kind = b.dataset.kind;
      [...$("#kind").children].forEach((x) => x.classList.toggle("on", x === b));
      renderGrid();
    });
    $("#share").onclick = () => share(folder.name);
    $("#slideshow")?.addEventListener("click", () => {
      const first = state.shown.findIndex((i) => i.type === "image");
      if (first >= 0) { openAt(first); toggleSlideshow(true); }
    });

    renderGrid();
  }

  const tileHtml = (f) => `
    <a class="tile" id="tile-${esc(f.id)}" href="${hashFor(f.id)}">
      <div class="tile-img"></div>
      <div class="tile-body"><h3>${esc(f.name)}</h3><p class="tile-meta">&nbsp;</p></div>
    </a>`;

  function renderError(err) {
    if (err.status === 401 && D.auth.enabled) {
      view.innerHTML = `
        <div class="notice">
          <h1>${esc(C.siteTitle)}</h1>
          <p>This gallery is private. Sign in with a Google account that has access to the photo folder.</p>
          <button class="btn btn-primary" id="signin">Sign in with Google</button>
          <p class="notice-err" id="signin-err"></p>
        </div>`;
      $("#signin").onclick = () =>
        D.auth.signIn().then(() => loadFolder(state.folderId)).catch((e) => ($("#signin-err").textContent = e.message));
      return;
    }
    const hint =
      err.status === 404 || err.status === 403
        ? "Check that the Drive folder is shared as “Anyone with the link → Viewer” and that the folder ID in js/config.js is right."
        : err.status === 400
        ? "Check that the API key in js/config.js is correct and that the Google Drive API is enabled for it."
        : "Check your connection and try again.";
    view.innerHTML = `
      <div class="notice">
        <h1>Couldn’t load this gallery</h1>
        <p>${esc(err.message)}</p>
        <p class="notice-hint">${hint}</p>
        <a class="btn" href="#/">Back to home</a>
      </div>`;
  }

  /* ── photo grid ──────────────────────────────────────────── */
  function renderGrid() {
    const grid = $("#grid");
    if (!grid) return;
    const time = (i) => (i.date ? Date.parse(i.date) || 0 : 0);
    const sorters = {
      name: D.sortNatural,
      "name-desc": (a, b) => D.sortNatural(b, a),
      new: (a, b) => time(b) - time(a),
      old: (a, b) => time(a) - time(b),
    };
    state.shown = state.items
      .filter((i) => (state.kind === "all" || i.type === state.kind) && (!state.query || i.name.toLowerCase().includes(state.query)))
      .sort(sorters[state.sort]);

    grid.innerHTML = state.shown.map((it, i) => `
      <figure class="ph" data-i="${i}" tabindex="0" aria-label="${esc(it.title)}">
        <img src="${D.thumb(it, 640)}" alt="${esc(it.title)}" loading="lazy" referrerpolicy="no-referrer">
        ${it.type === "video" ? `<span class="ph-badge">${icon.play}${it.duration ? fmtDuration(it.duration) : "Video"}</span>` : ""}
        <figcaption>
          <span>${esc(it.title)}</span>
          ${C.allowDownloads ? `<a class="ph-dl" href="${D.downloadUrl(it)}" target="_blank" rel="noopener" title="Download" aria-label="Download ${esc(it.title)}">${icon.download}</a>` : ""}
        </figcaption>
      </figure>`).join("") ||
      (state.items.length ? `<p class="empty">Nothing matches that filter.</p>` : "");
    stripBuiltFor = null;
    layoutGrid();
  }

  // Justified layout: pack photos into rows, then scale each row so it
  // exactly fills the page width (every photo in a row shares one height).
  function layoutGrid() {
    const grid = $("#grid");
    const els = grid ? grid.querySelectorAll(".ph[data-i]") : [];
    if (!els.length) return;
    const css = getComputedStyle(grid);
    const width = grid.clientWidth - 0.5;
    const gap = parseFloat(css.columnGap) || 6;
    const target = parseFloat(css.getPropertyValue("--row-h")) || 260;
    let row = [], sum = 0;
    const flush = (isLast) => {
      let h = (width - gap * (row.length - 1)) / sum;
      if (isLast && h > target * 1.2) h = target; // don't blow up a short last row
      row.forEach(([el, r]) => {
        el.style.width = Math.floor(h * r * 100) / 100 + "px";
        el.style.height = h + "px";
      });
      row = []; sum = 0;
    };
    els.forEach((el, i) => {
      const r = ratioOf(state.shown[i]);
      row.push([el, r]);
      sum += r;
      if (sum * target + gap * (row.length - 1) >= width) flush(false);
    });
    if (row.length) flush(true);
  }
  let lastWidth = 0;
  new ResizeObserver(() => {
    if (view.clientWidth !== lastWidth) { lastWidth = view.clientWidth; layoutGrid(); }
  }).observe(view);

  view.addEventListener("click", (e) => {
    if (e.target.closest(".ph-dl")) return;
    const ph = e.target.closest(".ph[data-i]");
    if (ph) openAt(Number(ph.dataset.i));
  });
  view.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.matches?.(".ph[data-i]")) openAt(Number(e.target.dataset.i));
  });
  // Drive doesn't report dimensions for every file — fix the tile shape once it loads.
  view.addEventListener("load", (e) => {
    const img = e.target;
    if (img.tagName !== "IMG") return;
    img.classList.add("loaded");
    const ph = img.closest(".ph[data-i]");
    const it = ph && state.shown[ph.dataset.i];
    if (it && !(it.w && it.h) && img.naturalWidth) {
      it.w = img.naturalWidth; it.h = img.naturalHeight;
      layoutGrid();
    }
  }, true);

  /* ── lightbox (full-screen viewer) ───────────────────────── */
  lb.innerHTML = `
    <div class="lb-top">
      <span class="lb-count" id="lb-count"></span>
      <span class="lb-title" id="lb-title"></span>
      <div class="lb-actions">
        <button class="icon-btn" id="lb-play" title="Slideshow (space)" aria-label="Slideshow">${icon.play}</button>
        <button class="icon-btn" id="lb-info-btn" title="Info (i)" aria-label="Photo info">${icon.info}</button>
        <button class="icon-btn" id="lb-share" title="Share" aria-label="Share">${icon.share}</button>
        ${C.allowDownloads ? `<a class="icon-btn" id="lb-dl" title="Download" aria-label="Download" target="_blank" rel="noopener">${icon.download}</a>` : ""}
        <button class="icon-btn" id="lb-full" title="Full screen" aria-label="Full screen">${icon.full}</button>
        <button class="icon-btn" id="lb-close" title="Close (Esc)" aria-label="Close">${icon.close}</button>
      </div>
    </div>
    <div class="lb-stage" id="lb-stage"></div>
    <button class="lb-nav lb-prev" id="lb-prev" aria-label="Previous">${icon.left}</button>
    <button class="lb-nav lb-next" id="lb-next" aria-label="Next">${icon.right}</button>
    <aside class="lb-info" id="lb-info" hidden></aside>
    <div class="lb-strip" id="lb-strip"></div>`;

  let stripBuiltFor = null;
  function buildStrip() {
    if (stripBuiltFor === state.shown) return;
    stripBuiltFor = state.shown;
    $("#lb-strip").innerHTML = state.shown.map((it, i) =>
      `<img data-i="${i}" src="${D.thumb(it, 160)}" alt="" loading="lazy" referrerpolicy="no-referrer" style="aspect-ratio:${ratioOf(it).toFixed(3)}">`).join("");
  }

  // Open photo i and record it in the URL so the link can be shared.
  function openAt(i) {
    const hash = hashFor(state.folderId, state.shown[i].id);
    if (lb.hidden) { history.pushState(null, "", hash); state.lbPushed = true; }
    else history.replaceState(null, "", hash);
    showLightbox(i);
  }

  function showLightbox(i) {
    const it = state.shown[i];
    if (!it) return;
    state.lb = i;
    lb.hidden = false;
    document.body.classList.add("lb-open");
    buildStrip();

    const stage = $("#lb-stage");
    stage.innerHTML = "";
    if (it.type === "video") {
      toggleSlideshow(false);
      if (D.demo) {
        stage.innerHTML = `<video class="lb-media" src="${D.demoVideo}" poster="${D.thumb(it, 1280)}" controls autoplay playsinline></video>`;
      } else {
        stage.innerHTML = `<iframe class="lb-media lb-frame" src="${D.videoEmbedUrl(it)}" allow="autoplay; fullscreen" allowfullscreen title="${esc(it.title)}"></iframe>`;
      }
    } else {
      // show the grid thumbnail instantly, then swap in the big version
      const img = new Image();
      img.className = "lb-media";
      img.alt = it.title;
      img.referrerPolicy = "no-referrer";
      img.src = D.thumb(it, 640);
      const hi = new Image();
      hi.referrerPolicy = "no-referrer";
      hi.onload = () => { if (state.lb === i && state.shown[i] === it) img.src = hi.src; };
      hi.src = D.thumb(it, C.lightboxSize || 2000);
      stage.append(img);
    }

    $("#lb-count").textContent = `${i + 1} / ${state.shown.length}`;
    $("#lb-title").textContent = it.title;
    if ($("#lb-dl")) $("#lb-dl").href = D.downloadUrl(it);
    $("#lb-prev").disabled = i === 0;
    $("#lb-next").disabled = i === state.shown.length - 1;
    renderInfo(it);

    const strip = $("#lb-strip");
    $(".on", strip)?.classList.remove("on");
    const cur = strip.children[i];
    if (cur) {
      cur.classList.add("on");
      strip.scrollTo({ left: cur.offsetLeft - strip.clientWidth / 2 + cur.clientWidth / 2, behavior: "smooth" });
    }

    // warm the cache for the neighbours
    [i + 1, i - 1].forEach((n) => {
      const nb = state.shown[n];
      if (nb && nb.type === "image") { const p = new Image(); p.referrerPolicy = "no-referrer"; p.src = D.thumb(nb, C.lightboxSize || 2000); }
    });
  }

  function renderInfo(it) {
    const rows = [
      ["File", it.name],
      ["Taken", fmtDate(it.date)],
      ["Size", [it.w && it.h && `${it.w} × ${it.h}`, it.size && fmtBytes(it.size)].filter(Boolean).join("  ·  ")],
      ["Length", it.duration ? fmtDuration(it.duration) : ""],
      ["Camera", it.camera],
      ["Lens", it.lens],
      ["Settings", [
        it.focal && `${Math.round(it.focal)}mm`,
        it.aperture && `ƒ/${it.aperture}`,
        it.exposure && (it.exposure < 1 ? `1/${Math.round(1 / it.exposure)}s` : `${it.exposure}s`),
        it.iso && `ISO ${it.iso}`,
      ].filter(Boolean).join("  ·  ")],
    ].filter(([, v]) => v);
    $("#lb-info").innerHTML =
      (it.description ? `<p class="lb-desc">${esc(it.description)}</p>` : "") +
      `<dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("")}</dl>`;
  }

  function hideLightbox() {
    if (lb.hidden) return;
    toggleSlideshow(false);
    if (document.fullscreenElement) document.exitFullscreen();
    $("#lb-stage").innerHTML = ""; // stops any playing video
    lb.hidden = true;
    state.lb = -1;
    state.lbPushed = false;
    document.body.classList.remove("lb-open");
  }

  function closeLightbox() {
    if (state.lbPushed) history.back(); // the router hides it
    else { history.replaceState(null, "", hashFor(state.folderId)); hideLightbox(); }
  }

  const step = (d) => {
    const n = state.lb + d;
    if (n >= 0 && n < state.shown.length) openAt(n);
    else if (state.slideshow) toggleSlideshow(false);
  };

  function toggleSlideshow(on = !state.slideshow) {
    clearInterval(state.slideshow);
    state.slideshow = on ? setInterval(() => step(1), (C.slideshowSeconds || 4) * 1000) : null;
    $("#lb-play").innerHTML = on ? icon.pause : icon.play;
    $("#lb-play").classList.toggle("on", on);
  }

  $("#lb-close").onclick = closeLightbox;
  $("#lb-prev").onclick = () => step(-1);
  $("#lb-next").onclick = () => step(1);
  $("#lb-play").onclick = () => toggleSlideshow();
  $("#lb-share").onclick = () => share(state.shown[state.lb]?.title);
  $("#lb-info-btn").onclick = () => {
    const p = $("#lb-info");
    p.hidden = !p.hidden;
    $("#lb-info-btn").classList.toggle("on", !p.hidden);
  };
  $("#lb-full").onclick = () => (document.fullscreenElement ? document.exitFullscreen() : lb.requestFullscreen?.());
  $("#lb-strip").onclick = (e) => { if (e.target.dataset.i) openAt(Number(e.target.dataset.i)); };
  $("#lb-stage").onclick = (e) => { if (e.target.id === "lb-stage") closeLightbox(); };

  document.addEventListener("keydown", (e) => {
    if (lb.hidden || e.target.matches("input, select, textarea")) return;
    if (e.key === "Escape") closeLightbox();
    else if (e.key === "ArrowRight") step(1);
    else if (e.key === "ArrowLeft") step(-1);
    else if (e.key === " ") { e.preventDefault(); toggleSlideshow(); }
    else if (e.key.toLowerCase() === "i") $("#lb-info-btn").click();
  });

  // swipe left / right on touch screens
  let touchX = null;
  lb.addEventListener("touchstart", (e) => { touchX = e.touches.length === 1 ? e.touches[0].clientX : null; }, { passive: true });
  lb.addEventListener("touchend", (e) => {
    if (touchX === null || e.target.closest(".lb-strip, .lb-top, .lb-info")) return;
    const dx = e.changedTouches[0].clientX - touchX;
    if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1);
    touchX = null;
  }, { passive: true });

  /* ── router ──────────────────────────────────────────────── */
  async function route() {
    const m = location.hash.match(/^#\/f\/([^/]+)(?:\/p\/([^/]+))?/);
    const folderId = m ? decodeURIComponent(m[1]) : D.rootId;
    const photoId = m && m[2] ? decodeURIComponent(m[2]) : null;

    if (folderId !== state.folderId) {
      hideLightbox();
      await loadFolder(folderId);
      if (state.folderId !== folderId) return;
    }
    const i = photoId ? state.shown.findIndex((x) => x.id === photoId) : -1;
    if (i >= 0) { if (state.lb !== i) showLightbox(i); }
    else hideLightbox();
  }

  initChrome();
  window.addEventListener("hashchange", route);
  window.addEventListener("popstate", route);
  route();
})();
