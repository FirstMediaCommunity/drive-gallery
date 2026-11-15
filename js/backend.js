/*
 * backend.js — a pretend server that lives in the browser.
 *
 * ┌──────────────────────────────────────────────────────────────────┐
 * │ THIS IS A DEMO BACKEND. It keeps the gallery structure in this   │
 * │ browser's localStorage so the Organize screen has something real │
 * │ to work on. Replace each function with a call to your server —   │
 * │ docs/BACKEND.md lists the matching endpoints one for one.        │
 * └──────────────────────────────────────────────────────────────────┘
 *
 * THE IMPORTANT IDEA: one file, many audiences — no copies.
 * Every gallery and every file is stored once. Who may see it is just a
 * field on the record:
 *
 *   gallery.visibility   "public"    listed for everyone
 *                        "unlisted"  hidden from listings; anyone with the link can open it
 *                        "internal"  logged-in team members only
 *   item.visibility      "inherit"   follows its gallery
 *                        "public"    always public (even inside an internal gallery)
 *                        "internal"  always members-only (even inside a public gallery)
 *
 * The public site and the internal site are the same data seen through a
 * different filter (see canSeeItem / isListed below), so "making something
 * public" flips a field instead of duplicating the file.
 */
(() => {
  const C = window.GALLERY_CONFIG;
  const A = window.Auth;
  const DB_KEY = "dg:db:v2";
  const GRANTS_KEY = "dg:link-grants";
  const ROOT = "demo-root";

  const fail = (status, message) => Object.assign(new Error(message), { status });
  const uid = (prefix) => prefix + crypto.getRandomValues(new Uint32Array(2)).reduce((s, n) => s + n.toString(36), "");

  /* ── storage ─────────────────────────────────────────────── */
  let db;
  try { db = JSON.parse(localStorage.getItem(DB_KEY)); } catch {}
  if (!db || !db.nodes || !db.nodes[ROOT]) db = seed();

  function save() {
    // Uploaded demo files only exist in memory, so they aren't saved.
    const items = Object.fromEntries(Object.entries(db.items).filter(([, i]) => !i.url));
    try { localStorage.setItem(DB_KEY, JSON.stringify({ ...db, items })); } catch {}
  }

  const byPos = (a, b) => a.pos - b.pos;
  const childFolders = (id) => Object.values(db.nodes).filter((n) => n.parentId === id).sort(byPos);
  const childItems = (id) => Object.values(db.items).filter((i) => i.folderId === id).sort(byPos);
  const nextPos = (list) => (list.length ? Math.max(...list.map((x) => x.pos)) + 1 : 0);
  const node = (id) => db.nodes[id] || (() => { throw fail(404, "That gallery doesn't exist (it may have been deleted)."); })();

  /* ── who can see what ────────────────────────────────────── */
  const isMember = () => A.can("view-internal");

  // Folders this visitor unlocked with an access link (and everything inside them).
  function hasLinkTo(n) {
    let tokens = [];
    try { tokens = JSON.parse(sessionStorage.getItem(GRANTS_KEY)) || []; } catch {}
    const unlocked = tokens
      .map((t) => db.links[t])
      .filter((l) => l && (!l.expires || l.expires > Date.now()))
      .map((l) => l.folderId);
    for (let cur = n; cur; cur = db.nodes[cur.parentId]) if (unlocked.includes(cur.id)) return true;
    return false;
  }

  function canSeeItem(item, folder) {
    if (isMember()) return true;
    if (item.visibility === "internal") return false;
    if (item.visibility === "public") return true;
    return folder.visibility !== "internal" || hasLinkTo(folder);
  }

  // Does this folder contain anything explicitly public further down?
  const hasPublicInside = (n) =>
    childItems(n.id).some((i) => i.visibility === "public") ||
    childFolders(n.id).some((c) => c.visibility === "public" || hasPublicInside(c));

  // Shown in its parent's listing?
  const isListed = (n) => isMember() || hasLinkTo(n) || n.visibility === "public" || hasPublicInside(n);
  // Openable by direct link?
  const canOpen = (n) => n.id === ROOT || isMember() || hasLinkTo(n) || n.visibility !== "internal" || hasPublicInside(n);

  // What we hand to the page. Visibility labels are only sent to members.
  const folderView = (n) => ({
    id: n.id, type: "folder", kind: n.kind, name: n.name, description: n.description || "",
    ...(isMember() ? { visibility: n.visibility } : {}),
  });
  const itemView = (i) => {
    const { folderId, visibility, ...rest } = i;
    return { ...rest, ...(isMember() && visibility !== "inherit" ? { visibility } : {}) };
  };

  /* ── read API (what the gallery pages use) ───────────────── */
  async function list(folderId) {
    const n = node(folderId);
    if (!canOpen(n)) throw fail(403, "This gallery is only available to team members.");
    return {
      folders: childFolders(n.id).filter(isListed).map(folderView),
      items: childItems(n.id).filter((i) => canSeeItem(i, n)).map(itemView),
    };
  }

  async function folder(folderId) {
    const n = node(folderId);
    if (!canOpen(n)) throw fail(403, "This gallery is only available to team members.");
    return { ...folderView(n), parentId: n.parentId };
  }

  async function path(folderId) {
    const crumbs = [];
    for (let cur = db.nodes[folderId]; cur; cur = db.nodes[cur.parentId]) crumbs.unshift({ id: cur.id, name: cur.name });
    return crumbs;
  }

  async function cover(folderId, depth = 0) {
    const n = node(folderId);
    const { folders, items } = await list(folderId);
    let item = items.find((i) => i.id === n.coverId) || items.find((i) => i.type === "image") || items[0] || null;
    if (!item && depth < 3) {
      for (const sub of folders) {
        item = (await cover(sub.id, depth + 1)).item;
        if (item) break;
      }
    }
    return { item, photos: items.length, folders: folders.length };
  }

  // Opening an access link remembers it for this browser tab.
  async function redeemLink(token) {
    const link = db.links[token];
    if (!link || (link.expires && link.expires < Date.now()) || !db.nodes[link.folderId]) {
      throw fail(404, "This link has expired or been turned off.");
    }
    let tokens = [];
    try { tokens = JSON.parse(sessionStorage.getItem(GRANTS_KEY)) || []; } catch {}
    if (!tokens.includes(token)) tokens.push(token);
    try { sessionStorage.setItem(GRANTS_KEY, JSON.stringify(tokens)); } catch {}
    return link.folderId;
  }

  /* ── organize API (requires the "organize" permission) ───── */
  // Every function checks permission itself — hiding the button is not security.
  const requireOrganizer = () => {
    if (!A.can("organize")) throw fail(403, "You don't have permission to organize the site.");
  };
  const isInside = (n, ancestorId) => {
    for (let cur = n; cur; cur = db.nodes[cur.parentId]) if (cur.id === ancestorId) return true;
    return false;
  };
  const clean = (s, max = 200) => String(s ?? "").trim().slice(0, max);

  const admin = {
    // The whole folder tree, for the sidebar.
    async tree() {
      requireOrganizer();
      const build = (n) => ({ id: n.id, name: n.name, kind: n.kind, visibility: n.visibility, children: childFolders(n.id).map(build) });
      return build(db.nodes[ROOT]);
    },

    // Everything in one folder, unfiltered.
    async contents(folderId) {
      requireOrganizer();
      const n = node(folderId);
      return {
        folder: { ...n },
        folders: childFolders(n.id).map((c) => ({ ...c, count: childFolders(c.id).length + childItems(c.id).length })),
        items: childItems(n.id).map((i) => ({ ...i })),
      };
    },

    async create(parentId, { kind, name, description, visibility }) {
      requireOrganizer();
      const parent = node(parentId);
      if (parent.kind !== "folder") throw fail(400, "Galleries hold photos. Create new galleries inside a folder.");
      if (!clean(name)) throw fail(400, "Give it a name.");
      const n = {
        id: uid("n"), kind: kind === "folder" ? "folder" : "gallery", name: clean(name, 80),
        description: clean(description, 500), parentId,
        visibility: ["public", "unlisted", "internal"].includes(visibility) ? visibility : "internal",
        coverId: null, pos: nextPos(childFolders(parentId)), created: Date.now(),
      };
      db.nodes[n.id] = n;
      save();
      return { ...n };
    },

    async updateFolder(id, patch) {
      requireOrganizer();
      const n = node(id);
      if (id === ROOT) throw fail(400, "The home page can't be changed here.");
      if ("name" in patch) { if (!clean(patch.name)) throw fail(400, "Give it a name."); n.name = clean(patch.name, 80); }
      if ("description" in patch) n.description = clean(patch.description, 500);
      if ("visibility" in patch && ["public", "unlisted", "internal"].includes(patch.visibility)) n.visibility = patch.visibility;
      if ("coverId" in patch) n.coverId = patch.coverId;
      save();
    },

    async updateItem(id, patch) {
      requireOrganizer();
      const i = db.items[id];
      if (!i) throw fail(404, "That file doesn't exist.");
      if ("title" in patch && clean(patch.title)) i.title = clean(patch.title, 120);
      if ("description" in patch) i.description = clean(patch.description, 500);
      if ("visibility" in patch && ["inherit", "public", "internal"].includes(patch.visibility)) i.visibility = patch.visibility;
      save();
    },

    // Move folders/galleries into a folder, or files into a gallery.
    async move(ids, targetId) {
      requireOrganizer();
      const target = node(targetId);
      for (const id of ids) {
        if (db.nodes[id]) {
          if (target.kind !== "folder") throw fail(400, "Galleries and folders can only be moved into a folder.");
          if (isInside(target, id)) throw fail(400, "A folder can't be moved inside itself.");
        } else if (db.items[id]) {
          if (target.kind !== "gallery") throw fail(400, "Photos and videos can only be moved into a gallery.");
        }
      }
      for (const id of ids) {
        if (db.nodes[id]) { db.nodes[id].pos = nextPos(childFolders(targetId)); db.nodes[id].parentId = targetId; }
        else if (db.items[id]) {
          const from = db.nodes[db.items[id].folderId];
          if (from && from.coverId === id) from.coverId = null;
          db.items[id].pos = nextPos(childItems(targetId));
          db.items[id].folderId = targetId;
        }
      }
      save();
    },

    // Save a new manual order. `ids` is the full list in the order wanted.
    async reorder(ids) {
      requireOrganizer();
      ids.forEach((id, pos) => { const x = db.nodes[id] || db.items[id]; if (x) x.pos = pos; });
      save();
    },

    async remove(ids) {
      requireOrganizer();
      const dropFolder = (id) => {
        childFolders(id).forEach((c) => dropFolder(c.id));
        childItems(id).forEach((i) => delete db.items[i.id]);
        Object.values(db.links).filter((l) => l.folderId === id).forEach((l) => delete db.links[l.token]);
        delete db.nodes[id];
      };
      for (const id of ids) {
        if (id === ROOT) continue;
        if (db.nodes[id]) dropFolder(id);
        else delete db.items[id];
      }
      save();
    },

    // Demo upload: the file stays in this browser tab only.
    async addItem(folderId, { name, url, w, h, size }) {
      requireOrganizer();
      const g = node(folderId);
      if (g.kind !== "gallery") throw fail(400, "Upload into a gallery, not a folder.");
      const item = {
        id: uid("u"), type: "image", name: clean(name, 120), title: clean(name, 120).replace(/\.[a-z0-9]{2,5}$/i, ""),
        description: "", w, h, ratio: w / h, date: new Date().toISOString(), size, url,
        folderId, visibility: "inherit", pos: nextPos(childItems(folderId)),
      };
      db.items[item.id] = item;
      return { ...item };
    },

    /* access links: let someone without an account open one gallery */
    async links(folderId) {
      requireOrganizer();
      return Object.values(db.links).filter((l) => l.folderId === folderId).sort((a, b) => b.created - a.created).map((l) => ({ ...l }));
    },
    async createLink(folderId, { label, days }) {
      requireOrganizer();
      node(folderId);
      const token = [...crypto.getRandomValues(new Uint8Array(18))].map((b) => b.toString(36).padStart(2, "0")).join("").slice(0, 28);
      const who = A.user();
      db.links[token] = {
        token, folderId, label: clean(label, 60) || "Access link", created: Date.now(),
        expires: days ? Date.now() + days * 86400000 : null, createdBy: who ? who.username : null,
      };
      save();
      return { ...db.links[token] };
    },
    async revokeLink(token) {
      requireOrganizer();
      delete db.links[token];
      save();
    },

    async reset() {
      requireOrganizer();
      db = seed();
      save();
    },
  };

  /* ── demo library ────────────────────────────────────────── */
  function seed() {
    const d = { nodes: {}, items: {}, links: {} };
    const ratios = [1.5, 1.5, 1.5, 1.5, 0.667, 1.333, 1.778, 1.5, 0.8, 1];
    const folderPos = {};
    const add = (id, kind, name, parentId, visibility, description = "") => {
      folderPos[parentId] = (folderPos[parentId] ?? -1) + 1;
      d.nodes[id] = { id, kind, name, description, parentId, visibility, coverId: null, pos: folderPos[parentId], created: 0 };
    };
    const photos = (folderId, n, prefix, publicOnes = []) => {
      for (let i = 1; i <= n; i++) {
        const video = i % 9 === 4;
        const r = video ? 1.778 : ratios[(i * 7 + folderId.length * 3) % ratios.length];
        const w = video ? 1920 : r >= 1 ? 3000 : Math.round(3000 * r);
        const num = String(i).padStart(4, "0");
        d.items[`${folderId}-${i}`] = {
          id: `${folderId}-${i}`, type: video ? "video" : "image",
          name: `${prefix}_${num}.${video ? "mp4" : "jpg"}`, title: `${prefix}_${num}`, description: "",
          w, h: Math.round(w / r), ratio: r,
          date: `2026-03-${String(((i * 3) % 27) + 1).padStart(2, "0")}T1${i % 10}:24:00`,
          size: 4200000 + i * 137000,
          ...(video
            ? { duration: 5 + ((i * 13) % 50) }
            : { camera: "Canon EOS R6", lens: "RF 24-70mm F2.8", aperture: 2.8, iso: 800, exposure: 1 / 500, focal: 50 }),
          folderId, visibility: publicOnes.includes(i) ? "public" : "inherit", pos: i,
        };
      }
    };

    d.nodes[ROOT] = { id: ROOT, kind: "folder", name: C.siteTitle, description: C.tagline || "", parentId: null, visibility: "public", coverId: null, pos: 0, created: 0 };
    add("demo-comp", "folder", "Competitions", ROOT, "public", "Every event we've played");
    add("demo-build", "folder", "Build Seasons", ROOT, "public");
    add("demo-outreach", "gallery", "Outreach", ROOT, "public", "Demos, school visits and community events");
    add("demo-camps", "gallery", "Camps", ROOT, "internal", "Summer camps — team only, with a few approved public picks");
    add("demo-team", "gallery", "Team Stuff", ROOT, "internal", "Team only");
    add("demo-uploads", "gallery", "Uploads", ROOT, "unlisted", "Drop zone for new media");
    add("demo-district", "gallery", "District Event", "demo-comp", "public", "Qualification and playoff matches");
    add("demo-champs", "gallery", "Championship", "demo-comp", "public", "Houston, TX");
    add("demo-offseason", "gallery", "Off-season", "demo-comp", "unlisted");
    add("demo-kickoff", "gallery", "Kickoff", "demo-build", "public", "Game reveal day");
    add("demo-shop", "gallery", "In the Shop", "demo-build", "internal", "Work in progress — not for sharing yet");
    photos("demo-district", 64, "DISTRICT");
    photos("demo-champs", 36, "CHAMPS");
    photos("demo-offseason", 14, "OFFSEASON");
    photos("demo-kickoff", 18, "KICKOFF");
    photos("demo-shop", 42, "SHOP");
    photos("demo-outreach", 24, "OUTREACH");
    photos("demo-camps", 30, "CAMP", [2, 7, 12]);
    photos("demo-team", 12, "TEAM");
    photos("demo-uploads", 8, "UPLOAD");
    return d;
  }

  window.Backend = { rootId: ROOT, list, folder, path, cover, redeemLink, admin };
})();
