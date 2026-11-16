/*
 * library.js — the Library screen: every photo and video on the site in one
 * place, whatever gallery it lives in. It sits next to the Organize screen
 * and needs the same "organize" permission.
 *
 *   #/library          → all media
 *   #/library/<tag>    → all media, already filtered to one tag
 *
 * Organize answers "what is in this gallery?". The Library answers "where is
 * that photo?": search everything, narrow it down by tag, type, gallery,
 * visibility or date, then tag, move or re-share a whole selection at once.
 *
 * Like organize.js, this file only talks to Backend.admin.* and reuses the
 * Organize screen's dialogs (window.Organizer.helpers()).
 *
 * Sections: state → page → sidebar + grid → selection → toolbar actions → tag list
 */
(() => {
  const B = window.Backend;
  let A, O; // window.App helpers and the Organize screen's dialogs

  const st = {
    view: "all",            // "all" | "recent" | "untagged"
    q: "", tags: [], type: "", folderId: "", visibility: "", month: "", sort: "taken-desc",
    items: [], total: 0, months: {}, groups: [], untagged: 0, tree: null,
    selected: new Set(), anchor: null,
  };
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const monthName = (ym) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

  /* ── page ────────────────────────────────────────────────── */
  async function open(tag) {
    A = window.App;
    O = window.Organizer.helpers();
    document.title = `Library · ${window.GALLERY_CONFIG.siteTitle}`;
    if (!Auth.user()) {
      sessionStorage.setItem("dg:return-to", location.hash);
      location.hash = "#/login";
      return;
    }
    if (!Auth.can("organize")) {
      A.view.innerHTML = `
        <div class="notice">
          <h1>No access</h1>
          <p>You're logged in as <b>${A.esc(Auth.user().name)}</b>, but the Library needs the organizer permission.</p>
          <a class="btn" href="#/">Back to the gallery</a>
        </div>`;
      return;
    }
    if (tag) Object.assign(st, { view: "all", tags: [tag], q: "", type: "", folderId: "", visibility: "", month: "" });
    await refresh();
  }

  async function refresh() {
    try {
      const filter = {
        q: st.q, tags: st.tags, untagged: st.view === "untagged", type: st.type, folderId: st.folderId, visibility: st.visibility,
        year: st.month.slice(0, 4), month: st.month.slice(5, 7),
        sort: st.view === "recent" ? "uploaded-desc" : st.sort,
      };
      const [lib, vocab, tree] = await Promise.all([B.admin.library(filter), B.admin.tagGroups(), B.admin.tree()]);
      Object.assign(st, { items: lib.items, total: lib.total, months: lib.months, groups: vocab.groups, untagged: vocab.untagged, tree });
    } catch (err) {
      A.view.innerHTML = `<div class="notice"><h1>Couldn't open the Library</h1><p>${A.esc(err.message)}</p><a class="btn" href="#/">Back to home</a></div>`;
      return;
    }
    const known = st.groups.flatMap((g) => g.tags.map((t) => t.name));
    st.tags = st.tags.filter((t) => known.includes(t)); // a tag may have been deleted
    const here = new Set(st.items.map((i) => i.id));
    st.selected = new Set([...st.selected].filter((id) => here.has(id)));
    render();
  }

  /* ── sidebar + grid ──────────────────────────────────────── */
  function render() {
    const { esc, icon } = A;
    const keepFocus = document.activeElement?.id === "lib-q";

    const viewRow = (id, label, ic, count) => `
      <div class="tnode ${st.view === id && !st.month && !st.tags.length ? "on" : ""}" style="--d:0">
        <span class="ttoggle"></span>
        <a href="#" data-view="${id}">${ic}<span class="tname">${label}</span>${count != null ? `<i class="lib-n">${count.toLocaleString()}</i>` : ""}</a>
      </div>`;
    const monthRow = (ym) => `
      <div class="tnode ${st.month === ym ? "on" : ""}" style="--d:1">
        <span class="ttoggle"></span>
        <a href="#" data-month="${ym}"><span class="tname">${monthName(ym)}</span><i class="lib-n">${st.months[ym].toLocaleString()}</i></a>
      </div>`;
    const tagRow = (t) => `
      <div class="tnode ${st.tags.includes(t.name) ? "on" : ""}" style="--d:1">
        <span class="ttoggle"></span>
        <a href="#" data-tag="${esc(t.name)}">${icon.tag}<span class="tname">${esc(t.name)}</span><i class="lib-n">${t.count.toLocaleString()}</i></a>
      </div>`;

    // Galleries for the "where" filter, indented like the tree.
    const places = [];
    const walk = (n, depth) => { if (n.id !== B.rootId) places.push({ n, depth }); n.children.forEach((c) => walk(c, n.id === B.rootId ? 0 : depth + 1)); };
    walk(st.tree, 0);

    // Photos grouped under month headings when the list is in date order.
    const dated = st.view !== "recent" && st.sort.startsWith("taken");
    const sections = [];
    for (const it of st.items) {
      const key = dated ? String(it.date).slice(0, 7) : "";
      if (!sections.length || sections[sections.length - 1].key !== key) sections.push({ key, items: [] });
      sections[sections.length - 1].items.push(it);
    }
    const tile = (it) => `
      <div class="otile oitem" data-id="${esc(it.id)}" tabindex="0">
        <img src="${window.Drive.thumb(it, 320)}" alt="${esc(it.title)}" loading="lazy" referrerpolicy="no-referrer" draggable="false">
        <span class="otile-check">${icon.check}</span>
        <div class="otile-flags">
          ${it.seenAs !== "public" ? `<em class="ovis ovis-${it.seenAs}">${O.VIS[it.seenAs].label}</em>` : ""}
          ${it.type === "video" ? `<em class="ovis">Video</em>` : ""}
          ${!it.tags.length ? `<em class="ovis">No tags</em>` : ""}
        </div>
        <div class="otile-label"><b>${esc(it.title)}</b><span>${icon.images}${esc(it.galleryName)}</span>
          ${it.tags.length ? `<span>${icon.tag}${esc(it.tags.join(", "))}</span>` : ""}</div>
      </div>`;

    const filtered = st.q || st.tags.length || st.type || st.folderId || st.visibility || st.month || st.view !== "all";
    const heading = st.view === "recent" ? "Recently added" : st.view === "untagged" ? "Untagged" : st.month ? monthName(st.month) : "All media";

    A.view.innerHTML = `
      <div class="org lib" id="lib">
        <div class="org-head">
          <div class="org-title">
            <nav class="org-tabs"><a href="#/organize">Organize</a><a class="on" href="#/library">Library</a></nav>
            <p class="org-crumbs"><span>${heading}</span><i>·</i>${
              filtered ? `${st.items.length.toLocaleString()} of ${A.plural(st.total, "file")}` : A.plural(st.total, "file")}</p>
          </div>
          <div class="org-head-actions">
            <label class="lib-search">${icon.search}<input id="lib-q" type="search" placeholder="Search names, captions, tags, galleries" aria-label="Search all media" value="${esc(st.q)}"></label>
          </div>
        </div>

        <div class="org-bar">
          <select class="obtn" data-filter="type" aria-label="Media type">
            <option value="">Photos &amp; videos</option><option value="image">Photos</option><option value="video">Videos</option>
          </select>
          <select class="obtn" data-filter="folderId" aria-label="Gallery">
            <option value="">Any gallery</option>
            ${places.map(({ n, depth }) => `<option value="${esc(n.id)}">${"  ".repeat(depth)}${esc(n.name)}</option>`).join("")}
          </select>
          <select class="obtn" data-filter="visibility" aria-label="Who can see it">
            <option value="">Any visibility</option><option value="public">Public</option><option value="unlisted">Unlisted</option><option value="internal">Internal</option>
          </select>
          <select class="obtn" data-filter="sort" aria-label="Sort" ${st.view === "recent" ? "disabled" : ""}>
            <option value="taken-desc">Newest first</option><option value="taken-asc">Oldest first</option>
            <option value="uploaded-desc">Recently uploaded</option><option value="name">Name A–Z</option>
          </select>
          <i class="osep"></i>
          <button class="obtn" data-act="tags" title="Add or remove tags on the selected files">${icon.tag}<span>Tags</span></button>
          <button class="obtn" data-act="settings" title="Title, caption, tags and details">${icon.gear}<span>Settings</span></button>
          <button class="obtn" data-act="visibility" title="Who can see the selected files">${icon.eye}<span>Visibility</span></button>
          <button class="obtn" data-act="move" title="Move to another gallery">${icon.move}<span>Move</span></button>
          <button class="obtn" data-act="delete" title="Delete">${icon.trash}<span>Delete</span></button>
          <i class="osep"></i>
          <button class="obtn" data-act="select-all" title="Select all / none">${icon.check}</button>
          <span class="org-count" id="lib-count"></span>
        </div>

        <div class="org-body">
          <aside class="org-tree" id="lib-side">
            ${viewRow("all", "All media", icon.images, st.total)}
            ${viewRow("recent", "Recently added", icon.upload)}
            ${viewRow("untagged", "Untagged", icon.tag, st.untagged)}
            <div class="lib-side-head">By date</div>
            ${Object.keys(st.months).sort().reverse().map(monthRow).join("")}
            <div class="lib-side-head">Tags <button class="lib-side-btn" data-act="manage-tags" title="Add, group or delete tags">Manage</button></div>
            ${st.groups.map((g) => `<div class="lib-group">${esc(g.name)}</div>${g.tags.map(tagRow).join("")}`).join("")
              || `<p class="lib-side-empty">No tags yet.</p>`}
          </aside>
          <section class="lib-main" id="lib-main">
            ${st.tags.length ? `<div class="lib-chips">Tagged ${st.tags.map((t) =>
              `<button class="otag on" data-untag="${esc(t)}" title="Remove this filter">${esc(t)} ×</button>`).join(st.tags.length > 1 ? " and " : "")}
              <a class="lib-link" href="#/t/${encodeURIComponent(st.tags[0])}">See “${esc(st.tags[0])}” as visitors do</a></div>` : ""}
            ${sections.map((s) => `
              ${s.key ? `<h2 class="lib-month">${/^\d{4}-\d{2}$/.test(s.key) ? monthName(s.key) : "No date"} <i>${s.items.length.toLocaleString()}</i></h2>` : ""}
              <div class="org-grid">${s.items.map(tile).join("")}</div>`).join("")}
            ${!st.items.length ? `<p class="org-empty">${filtered ? `Nothing matches. <a href="#" class="lib-link" data-act="clear">Clear the filters</a>` : "No photos or videos yet."}</p>` : ""}
          </section>
        </div>
      </div>`;

    A.$("#lib").querySelectorAll("[data-filter]").forEach((sel) => (sel.value = st[sel.dataset.filter]));
    wire();
    paintSelection();
    if (keepFocus) { const q = A.$("#lib-q"); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
  }

  /* ── selection ───────────────────────────────────────────── */
  const picked = () => st.items.filter((i) => st.selected.has(i.id));

  function paintSelection() {
    const root = A.$("#lib");
    if (!root) return;
    root.querySelectorAll(".otile").forEach((t) => t.classList.toggle("sel", st.selected.has(t.dataset.id)));
    const n = st.selected.size;
    A.$("#lib-count").textContent = n ? `${n.toLocaleString()} selected` : "";
    const enable = { tags: n > 0, settings: n === 1, visibility: n > 0, move: n > 0, delete: n > 0 };
    for (const [act, on] of Object.entries(enable)) root.querySelector(`[data-act="${act}"]`).disabled = !on;
  }

  function clickTile(tile, e) {
    const id = tile.dataset.id;
    const ids = st.items.map((i) => i.id);
    if (e.shiftKey && st.anchor && ids.includes(st.anchor)) {
      const [a, b] = [ids.indexOf(st.anchor), ids.indexOf(id)].sort((x, y) => x - y);
      st.selected = new Set(ids.slice(a, b + 1));
    } else if (e.ctrlKey || e.metaKey || e.target.closest?.(".otile-check")) {
      st.selected.has(id) ? st.selected.delete(id) : st.selected.add(id);
      st.anchor = id;
    } else {
      st.selected = new Set([id]);
      st.anchor = id;
    }
    paintSelection();
  }

  // Open the file in the viewer, inside the gallery it lives in.
  const openTile = (tile) => {
    const it = st.items.find((i) => i.id === tile.dataset.id);
    if (it) location.hash = A.hashFor(it.folderId, it.id);
  };

  function wire() {
    const root = A.$("#lib");
    const main = A.$("#lib-main");

    main.addEventListener("click", (e) => {
      if (e.target.closest("[data-untag], [data-act], a")) return;
      const tile = e.target.closest(".otile");
      if (tile) clickTile(tile, e);
      else { st.selected.clear(); paintSelection(); }
    });
    main.addEventListener("dblclick", (e) => {
      const tile = e.target.closest(".otile");
      if (tile && !e.target.closest(".otile-check")) openTile(tile);
    });
    main.addEventListener("keydown", (e) => {
      const tile = e.target.closest(".otile");
      if (!tile) return;
      if (e.key === "Enter") openTile(tile);
      if (e.key === " ") { e.preventDefault(); clickTile(tile, { ctrlKey: true, target: tile }); }
      if (e.key === "Delete" && st.selected.size) actions.delete();
    });

    root.addEventListener("click", (e) => {
      const pick = (attr) => e.target.closest(`[data-${attr}]`)?.dataset[attr];
      const go = (change) => { e.preventDefault(); Object.assign(st, change); O.run(refresh); };
      if (pick("view")) return go({ view: pick("view"), month: "", tags: [] });
      if (pick("month")) return go({ view: "all", month: st.month === pick("month") ? "" : pick("month") });
      if (pick("tag")) {
        const t = pick("tag"); // click a tag to narrow down; click again to let go
        return go({ view: st.view === "untagged" ? "all" : st.view, tags: st.tags.includes(t) ? st.tags.filter((x) => x !== t) : [...st.tags, t] });
      }
      if (pick("untag")) return go({ tags: st.tags.filter((x) => x !== pick("untag")) });
      const btn = e.target.closest("[data-act]");
      if (btn && !btn.disabled) { if (btn.tagName === "A") e.preventDefault(); O.run(() => actions[btn.dataset.act](btn)); }
    });

    root.querySelectorAll("[data-filter]").forEach((sel) => sel.addEventListener("change", () => {
      st[sel.dataset.filter] = sel.value;
      O.run(refresh);
    }));

    let typing;
    A.$("#lib-q").addEventListener("input", (e) => {
      clearTimeout(typing);
      typing = setTimeout(() => { st.q = e.target.value.trim(); O.run(refresh); }, 200);
    });
  }

  /* ── toolbar actions ─────────────────────────────────────── */
  const actions = {
    tags() { O.tagDialog(picked(), refresh); },

    settings() { O.itemSettings(picked()[0], refresh); },

    visibility(btn) {
      const ids = [...st.selected];
      O.menu(btn, Object.entries(O.ITEM_VIS).map(([v, d]) => ({
        label: d.label, desc: d.desc,
        go: async () => {
          for (const id of ids) await B.admin.updateItem(id, { visibility: v });
          A.toast(`${A.plural(ids.length, "file")} → ${d.label}`);
          await refresh();
        },
      })));
    },

    move() {
      O.moveDialog([...st.selected], "gallery", { tree: st.tree, here: null, after: refresh });
    },

    delete() {
      const ids = [...st.selected];
      O.dialog({
        title: `Delete ${A.plural(ids.length, "file")}?`,
        body: "<p>They are removed from their galleries too. This can't be undone.</p>",
        ok: "Delete", danger: true,
        onOk: async () => { await B.admin.remove(ids); st.selected.clear(); A.toast("Deleted"); await refresh(); },
      });
    },

    "select-all"() {
      st.selected = st.selected.size === st.items.length ? new Set() : new Set(st.items.map((i) => i.id));
      paintSelection();
    },

    clear() {
      Object.assign(st, { view: "all", q: "", tags: [], type: "", folderId: "", visibility: "", month: "" });
      return refresh();
    },

    "manage-tags"() { manageTags(); },
  };

  /* ── tag list: add, group and delete tags ────────────────── */
  function manageTags() {
    const paint = async (dlg) => {
      const { groups } = await B.admin.tagGroups();
      dlg.querySelector("[data-vocab]").innerHTML = groups.map((g) => `
        <div class="otag-group"><span>${A.esc(g.name)}</span><div>${g.tags.map((t) =>
          `<span class="otag">${A.esc(t.name)} <i>${t.count.toLocaleString()}</i>
            <button type="button" data-drop="${A.esc(t.name)}" data-count="${t.count}" aria-label="Delete the tag ${A.esc(t.name)}" title="Delete this tag">×</button></span>`).join("")}</div></div>`).join("")
        || `<small class="ohint">No tags yet.</small>`;
      dlg.querySelector("#lib-groups").innerHTML = groups.map((g) => `<option value="${A.esc(g.name)}">`).join("");
    };
    O.dialog({
      title: "Tags",
      wide: true,
      body: `
        <p>Tags are grouped so they are easy to pick from — for example Category, Event and Subject. The number is how many files carry each tag.</p>
        <div class="otags" data-vocab></div>
        <div class="otag-new">
          <input placeholder="New tag" maxlength="40" data-new-tag>
          <input placeholder="Group (e.g. Event)" maxlength="30" list="lib-groups" data-new-group>
          <datalist id="lib-groups"></datalist>
          <button type="button" class="obtn obtn-accent" data-add-tag>${A.icon.plus}Add tag</button>
        </div>
        <p class="odlg-note" data-note role="alert"></p>`,
      onOpen: (dlg) => {
        const note = (msg) => (dlg.querySelector("[data-note]").textContent = msg);
        const add = async () => {
          try {
            await B.admin.addTag(dlg.querySelector("[data-new-group]").value, dlg.querySelector("[data-new-tag]").value);
            dlg.querySelector("[data-new-tag]").value = "";
            note("");
            await paint(dlg);
          } catch (err) { note(err.message); }
        };
        dlg.addEventListener("click", async (e) => {
          if (e.target.closest("[data-add-tag]")) return add();
          const drop = e.target.closest("[data-drop]");
          if (!drop) return;
          const n = Number(drop.dataset.count);
          // deleting a tag that is in use takes a second click, since it comes off every file
          if (n && drop.dataset.sure !== "1") {
            drop.dataset.sure = "1";
            drop.textContent = "Delete?";
            return note(`“${drop.dataset.drop}” is on ${A.plural(n, "file")}. Click “Delete?” to take it off all of them.`);
          }
          try { await B.admin.removeTag(drop.dataset.drop); note(""); await paint(dlg); } catch (err) { note(err.message); }
        });
        dlg.addEventListener("keydown", (e) => {
          if (e.key === "Enter" && e.target.matches("[data-new-tag], [data-new-group]")) { e.preventDefault(); add(); }
        });
        dlg.addEventListener("close", () => O.run(refresh));
        paint(dlg);
      },
    });
  }

  window.Library = { open };
})();
