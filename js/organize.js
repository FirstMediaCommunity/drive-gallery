/*
 * organize.js — the Organize screen (the "backend" people with the
 * organize permission use to build the site).
 *
 *   #/organize            → the home folder
 *   #/organize/<folderId> → any other folder or gallery
 *
 * Layout: folder tree on the left, the current folder's contents on the
 * right, and a toolbar that acts on whatever is selected.
 *
 * Every change goes through Backend.admin.* (js/backend.js), which checks
 * permission itself. This file never touches the data directly, so pointing
 * it at a real server only means replacing those functions.
 *
 * Sections: state → page → tree + tiles → selection → toolbar actions →
 *           dialogs (create, settings, share/links, move, delete) → drag & drop
 */
(() => {
  const B = window.Backend;
  let A; // window.App helpers (set when the screen opens)

  const st = {
    folderId: null,
    folder: null, folders: [], items: [],   // contents of the current folder
    tree: null, path: [],
    selected: new Set(), anchor: null,       // selected tile ids
    expanded: new Set(),                     // open tree branches
    dragging: [],
  };

  const VIS = {
    public:   { label: "Public",   desc: "Listed on the site. Anyone can see it." },
    unlisted: { label: "Unlisted", desc: "Hidden from listings — even from team members. Anyone with the link can open it." },
    internal: { label: "Internal", desc: "Only logged-in team members can see it." },
  };
  const ITEM_VIS = {
    inherit:  { label: "Same as gallery", desc: "Follows the gallery's setting." },
    public:   { label: "Always public",   desc: "Shown publicly even if the gallery is internal. No copy is made." },
    internal: { label: "Team only",       desc: "Hidden from the public even if the gallery is public." },
  };

  const siteUrl = (hash) => location.origin + location.pathname + hash;
  const isNode = (id) => st.folders.some((f) => f.id === id);
  const order = () => [...st.folders, ...st.items].map((x) => x.id);

  // Run an action; show any error from the backend as a toast.
  async function run(fn) {
    try { await fn(); } catch (err) { A.toast(err.message || "Something went wrong"); }
  }

  /* ── page ────────────────────────────────────────────────── */
  async function open(folderId) {
    A = window.App;
    document.title = `Organize · ${window.GALLERY_CONFIG.siteTitle}`;
    if (!Auth.user()) {
      sessionStorage.setItem("dg:return-to", location.hash);
      location.hash = "#/login";
      return;
    }
    if (!Auth.can("organize")) {
      A.view.innerHTML = `
        <div class="notice">
          <h1>No access</h1>
          <p>You're logged in as <b>${A.esc(Auth.user().name)}</b>, but the Organize screen needs the organizer permission.</p>
          <a class="btn" href="#/">Back to the gallery</a>
        </div>`;
      return;
    }
    if (folderId !== st.folderId) { st.selected.clear(); st.anchor = null; }
    st.folderId = folderId;
    await refresh();
  }

  async function refresh() {
    try {
      const [tree, contents, path] = await Promise.all([B.admin.tree(), B.admin.contents(st.folderId), B.path(st.folderId)]);
      Object.assign(st, { tree, path, folder: contents.folder, folders: contents.folders, items: contents.items });
    } catch (err) {
      A.view.innerHTML = `<div class="notice"><h1>Couldn't open that</h1><p>${A.esc(err.message)}</p><a class="btn" href="#/organize">Back to Organize</a></div>`;
      return;
    }
    const here = new Set(order());
    st.selected = new Set([...st.selected].filter((id) => here.has(id)));
    st.path.forEach((c) => st.expanded.add(c.id));
    render();
  }

  function render() {
    const { esc, icon } = A;
    const isRoot = st.folderId === B.rootId;
    const kindIcon = (n) => (n.id === B.rootId ? icon.home : n.kind === "folder" ? icon.folder : icon.images);

    const treeHtml = (n, depth) => {
      const open = st.expanded.has(n.id);
      return `
        <div class="tnode ${n.id === st.folderId ? "on" : ""}" style="--d:${depth}" data-drop="${esc(n.id)}" data-kind="${n.kind}">
          ${n.children.length
            ? `<button class="ttoggle ${open ? "open" : ""}" data-toggle="${esc(n.id)}" aria-label="${open ? "Collapse" : "Expand"}">${icon.chevron}</button>`
            : `<span class="ttoggle"></span>`}
          <a href="#/organize/${n.id === B.rootId ? "" : esc(n.id)}">${kindIcon(n)}<span class="tname">${esc(n.id === B.rootId ? "Site Homepage" : n.name)}</span>
            ${n.visibility === "internal" ? `<i class="tvis" title="Internal">${icon.lock}</i>` : n.visibility === "unlisted" ? `<i class="tvis" title="Unlisted">${icon.link}</i>` : ""}</a>
        </div>
        ${open ? n.children.map((c) => treeHtml(c, depth + 1)).join("") : ""}`;
    };

    const folderTile = (f) => `
      <div class="otile onode" data-id="${esc(f.id)}" data-kind="${f.kind}" draggable="true" tabindex="0">
        <div class="otile-img" id="ocover-${esc(f.id)}"></div>
        <span class="otile-check">${icon.check}</span>
        <div class="otile-label">
          <b>${esc(f.name)}</b>
          <span>${f.kind === "folder" ? icon.folder : icon.images}${f.count} ${f.count === 1 ? "item" : "items"}
            ${f.visibility !== "public" ? `<em class="ovis ovis-${f.visibility}">${VIS[f.visibility].label}</em>` : ""}
            ${f.hasPassword ? `<em class="ovis">${icon.lock}Password</em>` : ""}</span>
        </div>
      </div>`;

    const itemTile = (it) => `
      <div class="otile oitem" data-id="${esc(it.id)}" data-kind="item" draggable="true" tabindex="0">
        <img src="${window.Drive.thumb(it, 320)}" alt="${esc(it.title)}" loading="lazy" referrerpolicy="no-referrer" draggable="false">
        <span class="otile-check">${icon.check}</span>
        <div class="otile-flags">
          ${st.folder.coverId === it.id ? `<em class="ovis ovis-cover" title="Feature image">${icon.star}Cover</em>` : ""}
          ${it.visibility !== "inherit" ? `<em class="ovis ovis-${it.visibility}">${ITEM_VIS[it.visibility].label}</em>` : ""}
          ${it.type === "video" ? `<em class="ovis">Video</em>` : ""}
        </div>
        <div class="otile-label"><b>${esc(it.title)}</b></div>
      </div>`;

    A.view.innerHTML = `
      <div class="org" id="org">
        <div class="org-head">
          <div class="org-title">
            <h1>Site Organizer</h1>
            <nav class="org-crumbs">${st.path.map((c, i) =>
              i === st.path.length - 1 ? `<span>${esc(i ? c.name : "Site Homepage")}</span>`
              : `<a href="#/organize/${i ? esc(c.id) : ""}">${esc(i ? c.name : "Site Homepage")}</a><i>/</i>`).join("")}
              ${!isRoot ? `<em class="ovis ovis-${st.folder.visibility}">${VIS[st.folder.visibility].label}</em>` : ""}
            </nav>
          </div>
          <div class="org-head-actions">
            <button class="obtn" data-act="share">Share</button>
            <a class="obtn" href="${A.hashFor(st.folderId)}">View on site</a>
            <select class="obtn" id="org-arrange" aria-label="Arrange">
              <option value="">Sort manually</option>
              <option value="name">Arrange by name (A–Z)</option>
              <option value="name-desc">Arrange by name (Z–A)</option>
              <option value="date">Arrange by date (oldest first)</option>
              <option value="date-desc">Arrange by date (newest first)</option>
            </select>
          </div>
        </div>

        <div class="org-bar">
          <button class="obtn obtn-accent" data-act="create" title="Create a gallery or folder">${icon.plus}<span>Create</span></button>
          <button class="obtn" data-act="upload" title="Upload photos to this gallery">${icon.upload}<span>Upload</span></button>
          <i class="osep"></i>
          <button class="obtn" data-act="settings" title="Settings">${icon.gear}<span>Settings</span></button>
          <button class="obtn" data-act="visibility" title="Who can see this">${icon.eye}<span>Visibility</span></button>
          <button class="obtn" data-act="cover" title="Use the selected photo as this gallery's feature image">${icon.star}<span>Make cover</span></button>
          <button class="obtn" data-act="move" title="Move to another folder">${icon.move}<span>Move</span></button>
          <button class="obtn" data-act="delete" title="Delete">${icon.trash}<span>Delete</span></button>
          <i class="osep"></i>
          <button class="obtn" data-act="select-all" title="Select all / none">${icon.check}</button>
          <span class="org-count" id="org-count"></span>
          <span class="ospacer"></span>
          <button class="obtn obtn-quiet" data-act="reset" title="Put the demo library back the way it started">Reset demo</button>
        </div>

        <div class="org-body">
          <aside class="org-tree" id="org-tree">${treeHtml(st.tree, 0)}</aside>
          <section class="org-grid" id="org-grid">
            ${st.folders.map(folderTile).join("")}${st.items.map(itemTile).join("")}
            ${!st.folders.length && !st.items.length ? `<p class="org-empty">${
              st.folder.kind === "folder" ? "This folder is empty. Use <b>Create</b> to add a gallery or folder."
                                          : "This gallery is empty. Use <b>Upload</b> to add photos, or drag photos here from another gallery."}</p>` : ""}
          </section>
        </div>
        <input type="file" id="org-file" accept="image/*" multiple hidden>
      </div>`;

    // covers for folder tiles
    st.folders.forEach((f) => B.cover(f.id).then(({ item }) => {
      const el = document.getElementById("ocover-" + f.id);
      if (el && item) el.innerHTML = `<img src="${window.Drive.thumb(item, 320)}" alt="" loading="lazy" referrerpolicy="no-referrer" draggable="false">`;
    }).catch(() => {}));

    wire();
    paintSelection();
  }

  /* ── selection ───────────────────────────────────────────── */
  function paintSelection() {
    const root = A.$("#org");
    if (!root) return;
    root.querySelectorAll(".otile").forEach((t) => t.classList.toggle("sel", st.selected.has(t.dataset.id)));
    const total = st.folders.length + st.items.length;
    const n = st.selected.size;
    A.$("#org-count").textContent = `${A.plural(total, "item")}${n ? `, ${n} selected` : ""}`;

    const isRoot = st.folderId === B.rootId;
    const oneItem = n === 1 && !isNode([...st.selected][0]);
    const enable = {
      create: st.folder.kind === "folder",
      upload: st.folder.kind === "gallery",
      settings: n === 1 || (n === 0 && !isRoot),
      visibility: n > 0 || !isRoot,
      cover: oneItem,
      move: n > 0,
      delete: n > 0,
      share: n <= 1,
    };
    for (const [act, on] of Object.entries(enable)) {
      const b = root.querySelector(`[data-act="${act}"]`);
      if (b) b.disabled = !on;
    }
  }

  function clickTile(tile, e) {
    const id = tile.dataset.id;
    const ids = order();
    if (e.shiftKey && st.anchor && ids.includes(st.anchor)) {
      const [a, b] = [ids.indexOf(st.anchor), ids.indexOf(id)].sort((x, y) => x - y);
      st.selected = new Set(ids.slice(a, b + 1));
    } else if (e.ctrlKey || e.metaKey || e.target.closest(".otile-check")) {
      st.selected.has(id) ? st.selected.delete(id) : st.selected.add(id);
      st.anchor = id;
    } else {
      st.selected = new Set([id]);
      st.anchor = id;
    }
    paintSelection();
  }

  function openTile(tile) {
    const id = tile.dataset.id;
    location.hash = isNode(id) ? `#/organize/${id}` : A.hashFor(st.folderId, id);
  }

  /* ── wiring ──────────────────────────────────────────────── */
  function wire() {
    const root = A.$("#org");
    const grid = A.$("#org-grid");

    grid.addEventListener("click", (e) => {
      const tile = e.target.closest(".otile");
      if (tile) clickTile(tile, e);
      else { st.selected.clear(); paintSelection(); }
    });
    grid.addEventListener("dblclick", (e) => {
      const tile = e.target.closest(".otile");
      if (tile && !e.target.closest(".otile-check")) openTile(tile);
    });
    grid.addEventListener("keydown", (e) => {
      const tile = e.target.closest(".otile");
      if (!tile) return;
      if (e.key === "Enter") openTile(tile);
      if (e.key === " ") { e.preventDefault(); clickTile(tile, { ctrlKey: true, target: tile }); }
      if (e.key === "Delete" && st.selected.size) actions.delete();
    });

    root.addEventListener("click", (e) => {
      const toggle = e.target.closest("[data-toggle]");
      if (toggle) {
        const id = toggle.dataset.toggle;
        st.expanded.has(id) ? st.expanded.delete(id) : st.expanded.add(id);
        return render();
      }
      const btn = e.target.closest("[data-act]");
      if (btn && !btn.disabled) run(() => actions[btn.dataset.act](btn));
    });

    A.$("#org-arrange").addEventListener("change", (e) => run(async () => {
      const how = e.target.value;
      if (!how) return;
      const cmp = how.startsWith("name")
        ? (a, b) => (a.title || a.name).localeCompare(b.title || b.name, undefined, { numeric: true, sensitivity: "base" })
        : (a, b) => (Date.parse(a.date) || a.created || 0) - (Date.parse(b.date) || b.created || 0);
      const dir = how.endsWith("-desc") ? -1 : 1;
      const sorted = (list) => [...list].sort((a, b) => dir * cmp(a, b)).map((x) => x.id);
      await B.admin.reorder(sorted(st.folders));
      await B.admin.reorder(sorted(st.items));
      A.toast("Order saved");
      await refresh();
    }));

    A.$("#org-file").addEventListener("change", (e) => run(async () => {
      const files = [...e.target.files];
      for (const file of files) {
        const url = URL.createObjectURL(file);
        const img = new Image();
        await new Promise((ok, bad) => { img.onload = ok; img.onerror = () => bad(new Error(`${file.name} isn't an image the browser can read.`)); img.src = url; });
        await B.admin.addItem(st.folderId, { name: file.name, url, w: img.naturalWidth, h: img.naturalHeight, size: file.size });
      }
      A.toast(`Added ${A.plural(files.length, "photo")} — demo uploads last until you reload`);
      await refresh();
    }));

    wireDragAndDrop(root);
  }

  /* ── toolbar actions ─────────────────────────────────────── */
  const selection = () => {
    const ids = [...st.selected];
    return { ids, nodes: ids.filter(isNode), items: ids.filter((id) => !isNode(id)) };
  };

  const actions = {
    create(btn) {
      menu(btn, [
        { icon: A.icon.images, label: "Gallery", desc: "Stores and displays your photos and videos.", go: () => createDialog("gallery") },
        { icon: A.icon.folder, label: "Folder", desc: "A space for storing galleries and other folders.", go: () => createDialog("folder") },
      ]);
    },

    upload() { A.$("#org-file").click(); },

    settings() {
      const { ids } = selection();
      if (!ids.length) return folderSettings(st.folder);
      const id = ids[0];
      if (isNode(id)) folderSettings(st.folders.find((f) => f.id === id));
      else itemSettings(st.items.find((i) => i.id === id));
    },

    visibility(btn) {
      const { nodes, items, ids } = selection();
      const set = (targets, fn, value, label) => async () => {
        for (const id of targets) await fn(id, { visibility: value });
        A.toast(`${A.plural(targets.length, targets === items ? "file" : "gallery").replace("gallerys", "galleries")} → ${label}`);
        await refresh();
      };
      const entries = [];
      const folderTargets = ids.length ? nodes : [st.folderId];
      if (folderTargets.length) {
        entries.push({ heading: ids.length ? "Galleries & folders" : `“${st.folder.name}”` });
        for (const [v, d] of Object.entries(VIS)) entries.push({ label: d.label, desc: d.desc, go: set(folderTargets, B.admin.updateFolder, v, d.label) });
      }
      if (items.length) {
        entries.push({ heading: "Photos & videos" });
        for (const [v, d] of Object.entries(ITEM_VIS)) entries.push({ label: d.label, desc: d.desc, go: set(items, B.admin.updateItem, v, d.label) });
      }
      menu(btn, entries);
    },

    async cover() {
      const id = selection().items[0];
      await B.admin.updateFolder(st.folderId, { coverId: st.folder.coverId === id ? null : id });
      A.toast(st.folder.coverId === id ? "Feature image cleared" : "Feature image set");
      await refresh();
    },

    move() {
      const { nodes, items, ids } = selection();
      if (nodes.length && items.length) return A.toast("Move galleries and photos separately.");
      moveDialog(ids, nodes.length ? "folder" : "gallery");
    },

    delete() {
      const { nodes, items, ids } = selection();
      const what = [nodes.length && A.plural(nodes.length, "gallery/folder").replace("folders", "folder(s)"), items.length && A.plural(items.length, "file")].filter(Boolean).join(" and ");
      dialog({
        title: `Delete ${what}?`,
        body: `<p>${nodes.length ? "Everything inside the selected galleries and folders is deleted too. " : ""}This can't be undone.</p>`,
        ok: "Delete", danger: true,
        onOk: async () => { await B.admin.remove(ids); st.selected.clear(); A.toast("Deleted"); await refresh(); },
      });
    },

    "select-all"() {
      const all = order();
      st.selected = st.selected.size === all.length ? new Set() : new Set(all);
      paintSelection();
    },

    share() {
      const { ids } = selection();
      if (!ids.length) return shareDialog({ folder: st.folder });
      const id = ids[0];
      if (isNode(id)) shareDialog({ folder: st.folders.find((f) => f.id === id) });
      else shareDialog({ folder: st.folder, item: st.items.find((i) => i.id === id) });
    },

    reset() {
      dialog({
        title: "Reset the demo library?",
        body: "<p>Puts every gallery, setting and link back the way it started. Only affects this browser.</p>",
        ok: "Reset", danger: true,
        onOk: async () => { await B.admin.reset(); st.selected.clear(); A.toast("Demo library reset"); location.hash = "#/organize"; await open(B.rootId); },
      });
    },
  };

  /* ── small UI helpers: popup menu + dialog ───────────────── */
  function menu(anchor, entries) {
    document.querySelector(".opop")?.remove();
    const pop = document.createElement("div");
    pop.className = "opop";
    pop.innerHTML = entries.map((e, i) =>
      e.heading ? `<div class="opop-head">${A.esc(e.heading)}</div>`
                : `<button data-i="${i}">${e.icon || ""}<span><b>${A.esc(e.label)}</b>${e.desc ? `<small>${A.esc(e.desc)}</small>` : ""}</span></button>`).join("");
    document.body.append(pop);
    const r = anchor.getBoundingClientRect();
    pop.style.top = r.bottom + 6 + "px";
    pop.style.left = Math.max(8, Math.min(r.left, innerWidth - pop.offsetWidth - 8)) + "px";
    const close = () => { pop.remove(); document.removeEventListener("pointerdown", outside, true); };
    const outside = (e) => { if (!pop.contains(e.target)) close(); };
    setTimeout(() => document.addEventListener("pointerdown", outside, true));
    pop.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      close();
      run(() => entries[b.dataset.i].go());
    });
  }

  // dialog({ title, body, ok, danger, onOk(dlg), onOpen(dlg), wide }) — onOk may throw to keep it open.
  function dialog({ title, body, ok = "Save", danger, onOk, onOpen, wide }) {
    const dlg = document.createElement("dialog");
    dlg.className = "odlg" + (wide ? " odlg-wide" : "");
    dlg.innerHTML = `
      <form method="dialog">
        <h2>${A.esc(title)}</h2>
        <div class="odlg-body">${body}</div>
        <p class="odlg-err" role="alert"></p>
        <div class="odlg-foot">
          <button type="button" class="obtn" data-close>${onOk ? "Cancel" : "Done"}</button>
          ${onOk ? `<button type="submit" class="obtn ${danger ? "obtn-danger" : "obtn-accent"}">${A.esc(ok)}</button>` : ""}
        </div>
      </form>`;
    document.body.append(dlg);
    dlg.querySelector("[data-close]").onclick = () => dlg.close();
    dlg.addEventListener("close", () => dlg.remove());
    dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
    dlg.querySelector("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!onOk) return dlg.close();
      try { await onOk(dlg); dlg.close(); }
      catch (err) { dlg.querySelector(".odlg-err").textContent = err.message; }
    });
    dlg.showModal();
    onOpen?.(dlg);
    return dlg;
  }

  const radios = (name, options, current) => `
    <div class="oradios">${Object.entries(options).map(([v, d]) => `
      <label><input type="radio" name="${name}" value="${v}" ${v === current ? "checked" : ""}>
        <span><b>${d.label}</b><small>${d.desc}</small></span></label>`).join("")}</div>`;
  const val = (dlg, name) => dlg.querySelector(`[name="${name}"]`)?.value ?? "";
  const picked = (dlg, name) => dlg.querySelector(`[name="${name}"]:checked`)?.value;

  /* ── dialogs ─────────────────────────────────────────────── */
  function createDialog(kind) {
    dialog({
      title: kind === "gallery" ? "New gallery" : "New folder",
      ok: "Create",
      body: `
        <label class="ofield">Name<input name="name" maxlength="80" required autofocus></label>
        <label class="ofield">Description <i>(optional)</i><textarea name="description" rows="2" maxlength="500"></textarea></label>
        <div class="ofield">Who can see it${radios("visibility", VIS, "internal")}</div>`,
      onOk: async (dlg) => {
        const made = await B.admin.create(st.folderId, { kind, name: val(dlg, "name"), description: val(dlg, "description"), visibility: picked(dlg, "visibility") });
        st.selected = new Set([made.id]);
        A.toast(`${kind === "gallery" ? "Gallery" : "Folder"} created`);
        await refresh();
      },
    });
  }

  async function folderSettings(f) {
    const inside = f.kind === "gallery" ? (await B.admin.contents(f.id)).items.filter((i) => i.type === "image").slice(0, 30) : [];
    const s = f.settings;
    const gallery = f.kind === "gallery";
    const select = (name, label, options, hint) => `
      <label class="ofield">${label}<select name="${name}">${Object.entries(options).map(([v, text]) =>
        `<option value="${v}" ${s[name] === v ? "selected" : ""}>${text}</option>`).join("")}</select>${hint ? `<small class="ohint">${hint}</small>` : ""}</label>`;
    const toggle = (name, label, hint) => `
      <label class="otoggle"><input type="checkbox" name="${name}" ${s[name] ? "checked" : ""}><span><b>${label}</b>${hint ? `<small>${hint}</small>` : ""}</span></label>`;

    dialog({
      title: `${gallery ? "Gallery" : "Folder"} settings — ${f.name}`,
      wide: true,
      body: `
        <div class="otabs">
          <button type="button" class="on" data-tab="basics">Basics</button>
          <button type="button" data-tab="security">Security &amp; Sharing</button>
          ${gallery ? `<button type="button" data-tab="protection">Photo Protection</button>
          <button type="button" data-tab="social">Social</button>` : ""}
          <button type="button" data-tab="appearance">Appearance</button>
        </div>
        ${gallery ? `<div data-pane="protection" hidden>
          ${select("maxSize", "Maximum display size", {
            original: "Original", "4k": "TV & Computer (4K)", x5: "X5 (2208px)", x4: "X4 (2048px)", x3: "X3 (1600px)",
            x2: "X2 (1280px)", xl: "XL (1024px)", l: "L (800px)", m: "M (600px)",
          }, "The largest size visitors can view. Smaller sizes make photos harder to reuse.")}
          ${toggle("downloads", "Allow downloads", "Show download buttons on photos and in the viewer.")}
        </div>
        <div data-pane="social" hidden>
          ${toggle("sharing", "Show sharing options", "Show Share buttons on the gallery and in the viewer.")}
        </div>` : ""}
        <div data-pane="appearance" hidden>
          ${gallery ? select("style", "Gallery style", {
            smugmug: "SmugMug (thumbnails + large photo)", thumbnails: "Thumbnails",
            "collage-landscape": "Collage Landscape (default)", "collage-portrait": "Collage Portrait", journal: "Journal",
          }) : ""}
          ${toggle("coverImage", gallery ? "Gallery cover image" : "Folder cover image", "Show the large cover photo behind the title.")}
          ${gallery ? toggle("squareThumbs", "Square thumbnails", "Crop thumbnails to squares in the Thumbnails and SmugMug styles.") : ""}
          <div class="orow">
            ${select("sortBy", "Sort by", gallery
              ? { position: "Position (manual)", caption: "Caption", filename: "Filename", dateUploaded: "Date uploaded", dateModified: "Date modified", dateTaken: "Date taken" }
              : { position: "Position (manual)", filename: "Name", dateUploaded: "Date created" })}
            ${select("sortDir", "Sort direction", { asc: "Ascending", desc: "Descending" })}
          </div>
          ${gallery ? toggle("cameraInfo", "Show camera info", "Let visitors see camera, lens and exposure details.") : ""}
          ${gallery ? toggle("filenames", "Show filenames", "Always show each photo's title on the gallery page.") : ""}
          ${gallery ? toggle("slideshow", "Slideshow", "Show the Slideshow button.") : ""}
        </div>
        <div data-pane="basics">
          <label class="ofield">Name<input name="name" maxlength="80" required value="${A.esc(f.name)}"></label>
          <label class="ofield">Description<textarea name="description" rows="2" maxlength="500">${A.esc(f.description || "")}</textarea></label>
          <label class="ofield">Meta keywords<input name="keywords" maxlength="300" placeholder="keyword 1, keyword 2, etc" value="${A.esc(s.keywords || "")}"></label>
          <div class="ofield">Feature image
            ${inside.length ? `<div class="ocovers">
                <label><input type="radio" name="coverId" value="" ${!f.coverId ? "checked" : ""}><span class="ocover-auto">Auto</span></label>
                ${inside.map((i) => `<label><input type="radio" name="coverId" value="${A.esc(i.id)}" ${f.coverId === i.id ? "checked" : ""}><img src="${window.Drive.thumb(i, 160)}" alt="${A.esc(i.title)}" loading="lazy" referrerpolicy="no-referrer"></label>`).join("")}
              </div>` : `<small class="ohint">${f.kind === "gallery" ? "Add photos first, then pick one here." : "Folders use the cover of their first gallery."}</small>`}
          </div>
        </div>
        <div data-pane="security" hidden>
          <div class="ofield">Visibility${radios("visibility", VIS, f.visibility)}</div>
          ${select("access", "Access", { anyone: "Anyone", password: "People with password" },
            "Who can open it once they've found it. Team members never need the password.")}
          <div data-password ${s.access === "password" ? "" : "hidden"}>
            <label class="ofield">Password<input name="password" type="text" autocomplete="off" maxlength="80"
              placeholder="${f.hasPassword ? "Leave blank to keep the current password" : "Choose a password"}"></label>
            <label class="ofield">Password hint <i>(optional, shown to visitors)</i><input name="passwordHint" maxlength="120" value="${A.esc(s.passwordHint || "")}"></label>
          </div>
          ${select("webSearchable", "Web searchable", { true: "Site setting (yes)", false: "No" }, "“No” asks search engines not to index this page.")}
          <div class="ofield">View links <small class="ohint">Let someone without an account — a parent, a sponsor — see this ${f.kind}. Each link can have its own password and expiry.</small>
            <div class="olinks" data-links="view"></div>
          </div>
          ${gallery ? `<div class="ofield">Guest uploading <small class="ohint">An upload link lets someone add photos to this gallery without logging in. It does not let them view it.</small>
            <div class="olinks" data-links="upload"></div>
          </div>` : ""}
        </div>`,
      onOpen: (dlg) => {
        dlg.querySelector(".otabs").onclick = (e) => {
          const tab = e.target.dataset.tab;
          if (!tab) return;
          dlg.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("on", b === e.target));
          dlg.querySelectorAll("[data-pane]").forEach((p) => (p.hidden = p.dataset.pane !== tab));
        };
        dlg.querySelector('[name="access"]').onchange = (e) => (dlg.querySelector("[data-password]").hidden = e.target.value !== "password");
        dlg.querySelector('[name="webSearchable"]').value = String(s.webSearchable);
        dlg.querySelectorAll("[data-links]").forEach((box) => linksSection(box, f.id, box.dataset.links));
      },
      onOk: async (dlg) => {
        const on = (name) => dlg.querySelector(`[name="${name}"]`)?.checked;
        const settings = {
          keywords: val(dlg, "keywords"), access: val(dlg, "access"), passwordHint: val(dlg, "passwordHint"),
          webSearchable: val(dlg, "webSearchable") === "true",
          coverImage: on("coverImage"), sortBy: val(dlg, "sortBy"), sortDir: val(dlg, "sortDir"),
        };
        if (gallery) Object.assign(settings, {
          maxSize: val(dlg, "maxSize"), downloads: on("downloads"), sharing: on("sharing"), style: val(dlg, "style"),
          squareThumbs: on("squareThumbs"), cameraInfo: on("cameraInfo"), filenames: on("filenames"), slideshow: on("slideshow"),
        });
        const patch = { name: val(dlg, "name"), description: val(dlg, "description"), visibility: picked(dlg, "visibility"), settings, password: val(dlg, "password") };
        if (inside.length) patch.coverId = picked(dlg, "coverId") || null;
        await B.admin.updateFolder(f.id, patch);
        A.toast("Settings saved");
        await refresh();
      },
    });
  }

  function itemSettings(it) {
    dialog({
      title: "Photo settings",
      body: `
        <label class="ofield">Title<input name="title" maxlength="120" required value="${A.esc(it.title)}"></label>
        <label class="ofield">Caption<textarea name="description" rows="2" maxlength="500">${A.esc(it.description || "")}</textarea></label>
        <label class="ofield">Keywords<input name="keywords" maxlength="300" placeholder="keyword 1, keyword 2, etc" value="${A.esc(it.keywords || "")}"></label>
        <div class="ofield">Who can see it${radios("visibility", ITEM_VIS, it.visibility)}</div>
        <div class="ofield">File details
          <dl class="ometa">${[
            ["File", it.name],
            ["Type", it.type === "video" ? "Video" : "Photo"],
            ["Dimensions", it.w && it.h ? `${it.w} × ${it.h}` : ""],
            ["Size", it.size ? (it.size / 1e6).toFixed(1) + " MB" : ""],
            ["Length", it.duration ? `${Math.floor(it.duration / 60)}:${String(Math.round(it.duration % 60)).padStart(2, "0")}` : ""],
            ["Taken", A.fmtDate(it.date)],
            ["Uploaded", A.fmtDate(it.uploaded)],
            ["Uploaded by", it.uploadedBy],
            ["Camera", it.camera],
            ["Lens", it.lens],
            ["Settings", [it.focal && `${Math.round(it.focal)}mm`, it.aperture && `ƒ/${it.aperture}`,
              it.exposure && (it.exposure < 1 ? `1/${Math.round(1 / it.exposure)}s` : `${it.exposure}s`), it.iso && `ISO ${it.iso}`].filter(Boolean).join(" · ")],
          ].filter(([, v]) => v).map(([k, v]) => `<dt>${k}</dt><dd>${A.esc(v)}</dd>`).join("")}</dl>
        </div>`,
      onOk: async (dlg) => {
        await B.admin.updateItem(it.id, { title: val(dlg, "title"), description: val(dlg, "description"), keywords: val(dlg, "keywords"), visibility: picked(dlg, "visibility") });
        A.toast("Saved");
        await refresh();
      },
    });
  }

  function shareDialog({ folder, item }) {
    const url = siteUrl(A.hashFor(folder.id, item?.id));
    const vis = folder.id === B.rootId ? "public" : folder.visibility;
    const who = item && item.visibility === "public" ? "Anyone can open this link — this file is marked Always public."
      : item && item.visibility === "internal" ? "Only logged-in team members can open this link — this file is marked Team only."
      : vis === "public" ? "Anyone can open this link, and it's listed on the site."
      : vis === "unlisted" ? "Anyone with this link can open it, but it isn't listed anywhere on the site."
      : "Only logged-in team members can open this link. To share with someone outside the team, create an access link below.";
    dialog({
      title: `Share “${item ? item.title : folder.id === B.rootId ? "Site Homepage" : folder.name}”`,
      wide: true,
      body: `
        <div class="ofield">Link
          <div class="ocopy"><input readonly value="${A.esc(url)}"><button type="button" class="obtn" data-copy="${A.esc(url)}">${A.icon.copy}Copy</button></div>
          <small class="ohint"><em class="ovis ovis-${vis}">${VIS[vis].label}</em> ${who}</small>
        </div>
        ${!item && folder.id !== B.rootId ? `<div class="ofield">View links <small class="ohint">A private link that lets someone see this ${folder.kind} without logging in — for parents, sponsors, anyone without an account. Add a password if you like, and turn it off any time.</small>
          <div class="olinks" data-links="view"></div></div>
          ${folder.kind === "gallery" ? `<div class="ofield">Upload links <small class="ohint">A separate link that lets someone add photos to this gallery without logging in. It does not let them view the gallery.</small>
          <div class="olinks" data-links="upload"></div></div>` : ""}` : ""}`,
      onOpen: (dlg) => {
        wireCopy(dlg);
        dlg.querySelectorAll("[data-links]").forEach((box) => linksSection(box, folder.id, box.dataset.links));
      },
    });
  }

  function wireCopy(root) {
    root.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-copy]");
      if (!b) return;
      try { await navigator.clipboard.writeText(b.dataset.copy); A.toast("Link copied"); }
      catch { A.toast("Couldn't copy — select the link and copy it by hand"); }
    });
  }

  // List + create + turn off links for one folder. type: "view" or "upload".
  async function linksSection(box, folderId, type) {
    const route = type === "upload" ? "#/u/" : "#/s/";
    const paint = async () => {
      const links = await B.admin.links(folderId, type);
      box.innerHTML = `
        ${links.map((l) => `
          <div class="olink">
            <div><b>${A.esc(l.label)}${l.hasPassword ? ` <em class="ovis">${A.icon.lock}Password</em>` : ""}</b>
              <small>Created ${A.fmtDate(l.created)}${l.expires ? ` · ${l.expires < Date.now() ? "expired" : "expires"} ${A.fmtDate(l.expires)}` : " · never expires"}</small></div>
            <button type="button" class="obtn" data-copy="${A.esc(siteUrl(route + l.token))}">${A.icon.copy}Copy</button>
            <button type="button" class="obtn obtn-danger" data-revoke="${A.esc(l.token)}">Turn off</button>
          </div>`).join("") || `<small class="ohint">No ${type} links yet.</small>`}
        <div class="olink-new">
          <input placeholder="Label, e.g. “${type === "upload" ? "Parent photos" : "Parents — camp week 1"}”" maxlength="60" data-label>
          <input placeholder="Password (optional)" maxlength="80" autocomplete="off" data-password>
          <select data-days><option value="">Never expires</option><option value="7">Expires in 7 days</option><option value="30">Expires in 30 days</option></select>
          <button type="button" class="obtn obtn-accent" data-make>Create ${type} link</button>
        </div>
        <small class="ohint">Demo note: the pretend server lives in this browser, so links only work here. On a real server they work for anyone.</small>`;
    };
    box.addEventListener("click", (e) => run(async () => {
      if (e.target.closest("[data-make]")) {
        await B.admin.createLink(folderId, {
          type, label: box.querySelector("[data-label]").value, password: box.querySelector("[data-password]").value,
          days: Number(box.querySelector("[data-days]").value) || null,
        });
        A.toast(`${type === "upload" ? "Upload" : "View"} link created`);
        await paint();
      }
      const revoke = e.target.closest("[data-revoke]");
      if (revoke) { await B.admin.revokeLink(revoke.dataset.revoke); A.toast("Link turned off"); await paint(); }
    }));
    wireCopy(box);
    await paint();
  }

  function moveDialog(ids, targetKind) {
    const rows = [];
    const walk = (n, depth) => {
      const blocked = ids.includes(n.id);
      if (blocked) return; // can't move something into itself
      rows.push({ n, depth, ok: n.kind === targetKind && n.id !== st.folderId });
      n.children.forEach((c) => walk(c, depth + 1));
    };
    walk(st.tree, 0);
    dialog({
      title: `Move ${A.plural(ids.length, "item")} to…`,
      ok: "Move here",
      body: `<div class="omove">${rows.map(({ n, depth, ok }) => `
        <label class="${ok ? "" : "off"}" style="--d:${depth}">
          <input type="radio" name="target" value="${A.esc(n.id)}" ${ok ? "" : "disabled"}>
          ${n.kind === "folder" ? A.icon.folder : A.icon.images}<span>${A.esc(n.id === B.rootId ? "Site Homepage" : n.name)}</span>
        </label>`).join("")}</div>
        <small class="ohint">${targetKind === "folder" ? "Galleries and folders go inside folders." : "Photos and videos go inside galleries."}</small>`,
      onOk: async (dlg) => {
        const target = picked(dlg, "target");
        if (!target) throw new Error("Pick a destination.");
        await B.admin.move(ids, target);
        st.selected.clear();
        A.toast("Moved");
        await refresh();
      },
    });
  }

  /* ── drag & drop: move into folders, or drag to reorder ──── */
  function wireDragAndDrop(root) {
    const clearMarks = () => root.querySelectorAll(".drop-into, .drop-before, .drop-after").forEach((el) => el.classList.remove("drop-into", "drop-before", "drop-after"));

    root.addEventListener("dragstart", (e) => {
      const tile = e.target.closest?.(".otile");
      if (!tile) return;
      if (!st.selected.has(tile.dataset.id)) { st.selected = new Set([tile.dataset.id]); st.anchor = tile.dataset.id; paintSelection(); }
      st.dragging = [...st.selected];
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", st.dragging.join(","));
    });
    root.addEventListener("dragend", () => { st.dragging = []; clearMarks(); });

    // Work out what dropping here would do: { into: id } or { before/after: id } or null.
    function dropPlan(e) {
      if (!st.dragging.length) return null;
      const draggingNodes = st.dragging.every(isNode);
      const draggingItems = st.dragging.every((id) => !isNode(id));
      const branch = e.target.closest(".tnode");
      if (branch) {
        const ok = (draggingNodes && branch.dataset.kind === "folder") || (draggingItems && branch.dataset.kind === "gallery");
        return ok && !st.dragging.includes(branch.dataset.drop) && branch.dataset.drop !== st.folderId ? { el: branch, into: branch.dataset.drop } : null;
      }
      const tile = e.target.closest(".otile");
      if (!tile || st.dragging.includes(tile.dataset.id)) return null;
      const r = tile.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const tileIsNode = tile.classList.contains("onode");
      if (tileIsNode) {
        const canEnter = (draggingNodes && tile.dataset.kind === "folder") || (draggingItems && tile.dataset.kind === "gallery");
        if (canEnter && (!draggingNodes || (x > 0.25 && x < 0.75))) return { el: tile, into: tile.dataset.id };
        if (draggingNodes) return { el: tile, [x < 0.5 ? "before" : "after"]: tile.dataset.id };
        return null;
      }
      return draggingItems ? { el: tile, [x < 0.5 ? "before" : "after"]: tile.dataset.id } : null;
    }

    root.addEventListener("dragover", (e) => {
      const plan = dropPlan(e);
      clearMarks();
      if (!plan) return;
      e.preventDefault();
      plan.el.classList.add(plan.into ? "drop-into" : plan.before ? "drop-before" : "drop-after");
    });

    root.addEventListener("drop", (e) => {
      const plan = dropPlan(e);
      clearMarks();
      if (!plan) return;
      e.preventDefault();
      const moving = [...st.dragging];
      run(async () => {
        if (plan.into) {
          await B.admin.move(moving, plan.into);
          st.selected.clear();
          A.toast(`Moved ${A.plural(moving.length, "item")}`);
        } else {
          const list = (isNode(moving[0]) ? st.folders : st.items).map((x) => x.id).filter((id) => !moving.includes(id));
          const at = list.indexOf(plan.before || plan.after) + (plan.after ? 1 : 0);
          const inOrder = order().filter((id) => moving.includes(id)); // keep the dragged ones in their existing order
          list.splice(at, 0, ...inOrder);
          await B.admin.reorder(list);
        }
        await refresh();
      });
    });
  }

  window.Organizer = { open };
})();
