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
 *                        "unlisted"  hidden from listings (from members too);
 *                                    anyone with the link can open it
 *                        "internal"  logged-in team members only
 *   item.visibility      "inherit"   follows its gallery
 *                        "public"    always public (even inside an internal gallery)
 *                        "internal"  always members-only (even inside a public gallery)
 *
 * On top of that a gallery can ask for a password, and organizers can hand
 * out two kinds of link:
 *   view link    opens one gallery without logging in (optional password)
 *   upload link  lets someone add photos and videos to one gallery without
 *                logging in, and can tag everything that comes in through it
 *
 * TAGS: a gallery is where a file lives; tags are how you find it again.
 * A file sits in exactly one gallery but can carry any number of tags, so
 * the same photo turns up under its event, its subject and so on. The list
 * of tags (the "vocabulary") is kept in named groups in db.tagGroups.
 *
 * Sections: storage → settings → who can see what → read API →
 *           passwords & links → organize API (incl. library & tags) → demo library
 */
(() => {
  const C = window.GALLERY_CONFIG;
  const A = window.Auth;
  const DB_KEY = "dg:db:v4";
  const GRANTS_KEY = "dg:link-grants";     // view links opened in this tab
  const UNLOCKED_KEY = "dg:unlocked";      // gallery passwords entered in this tab
  const ROOT = "demo-root";
  const SALT = "drive-gallery-demo";

  const fail = (status, message, extra) => Object.assign(new Error(message), { status }, extra);
  const uid = (prefix) => prefix + crypto.getRandomValues(new Uint32Array(2)).reduce((s, n) => s + n.toString(36), "");
  const clean = (s, max = 200) => String(s ?? "").trim().slice(0, max);
  const natural = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  const session = (key) => { try { return JSON.parse(sessionStorage.getItem(key)) || []; } catch { return []; } };
  const remember = (key, value) => {
    const list = session(key);
    if (!list.includes(value)) list.push(value);
    try { sessionStorage.setItem(key, JSON.stringify(list)); } catch {}
  };
  async function hash(scope, password) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${SALT}|${scope}|${password}`));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  /* ── storage ─────────────────────────────────────────────── */
  let db;
  try { db = JSON.parse(localStorage.getItem(DB_KEY)); } catch {}
  if (!db || !db.nodes || !db.nodes[ROOT] || !db.tagGroups) db = seed();

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

  /* ── tags ────────────────────────────────────────────────── */
  const OTHER = "Other"; // where tags nobody filed under a group end up
  const sameTag = (a, b) => a.toLowerCase() === b.toLowerCase();
  const knownTag = (name) => db.tagGroups.flatMap((g) => g.tags).find((t) => sameTag(t, name));
  // Tidy a list of tag names: trim, drop blanks and repeats, and use the
  // vocabulary's spelling. A tag nobody has used before joins "Other".
  function cleanTags(list) {
    const out = [];
    for (const raw of Array.isArray(list) ? list : String(list ?? "").split(",")) {
      const name = clean(raw, 40).replace(/\s+/g, " ");
      if (!name) continue;
      let tag = knownTag(name);
      if (!tag) {
        let other = db.tagGroups.find((g) => g.name === OTHER);
        if (!other) db.tagGroups.push((other = { name: OTHER, tags: [] }));
        other.tags.push((tag = name));
      }
      if (!out.includes(tag)) out.push(tag);
    }
    return out.slice(0, 30);
  }

  /* ── gallery settings (the same ones SmugMug has) ────────── */
  const DEFAULTS = {
    // Basics
    keywords: "",
    // Security & Sharing
    access: "anyone",            // "anyone" | "password"
    passwordHint: "",
    webSearchable: true,
    // Photo Protection
    maxSize: "original",         // see SIZES in app.js
    downloads: true,
    // Social
    sharing: true,
    // Appearance
    style: "collage-landscape",  // smugmug | thumbnails | collage-landscape | collage-portrait | journal
    coverImage: true,
    squareThumbs: true,
    sortBy: "position",          // position | caption | filename | dateUploaded | dateModified | dateTaken
    sortDir: "asc",
    cameraInfo: true,
    filenames: false,
    slideshow: true,
  };
  const CHOICES = {
    access: ["anyone", "password"],
    maxSize: ["original", "4k", "x5", "x4", "x3", "x2", "xl", "l", "m"],
    style: ["smugmug", "thumbnails", "collage-landscape", "collage-portrait", "journal"],
    sortBy: ["position", "caption", "filename", "dateUploaded", "dateModified", "dateTaken"],
    sortDir: ["asc", "desc"],
  };
  // Settings without the password hash — safe to send to the page.
  const settingsOf = (n) => {
    const { passwordHash, ...rest } = { ...DEFAULTS, ...(n.settings || {}) };
    return rest;
  };

  /* ── who can see what ────────────────────────────────────── */
  const isMember = () => A.can("view-internal");
  const isOrganizer = () => A.can("organize");
  const liveLink = (token) => {
    const l = db.links[token];
    return l && (!l.expires || l.expires > Date.now()) && db.nodes[l.folderId] ? l : null;
  };

  // Did this visitor open a view link for this folder or one above it?
  function hasLinkTo(n) {
    const unlocked = session(GRANTS_KEY).map(liveLink).filter((l) => l && l.type === "view").map((l) => l.folderId);
    for (let cur = n; cur; cur = db.nodes[cur.parentId]) if (unlocked.includes(cur.id)) return true;
    return false;
  }

  // The nearest password-protected folder this visitor hasn't unlocked (or null).
  function lockedBy(n) {
    if (isMember() || hasLinkTo(n)) return null;
    const entered = session(UNLOCKED_KEY);
    for (let cur = n; cur; cur = db.nodes[cur.parentId]) {
      const s = cur.settings || {};
      if (s.access === "password" && s.passwordHash && !entered.includes(cur.id)) return cur;
    }
    return null;
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

  // Shown in its parent's listing?  Unlisted galleries are only listed for
  // organizers — everyone else, members included, needs the link.
  const isListed = (n) =>
    isOrganizer() || hasLinkTo(n) || n.visibility === "public" ||
    (n.visibility === "internal" && isMember()) || hasPublicInside(n);

  // Openable by direct link?
  const canOpen = (n) => n.id === ROOT || isMember() || hasLinkTo(n) || n.visibility !== "internal" || hasPublicInside(n);

  function checkOpen(n) {
    if (!canOpen(n)) throw fail(403, "This gallery is only available to team members.");
    const lock = lockedBy(n);
    if (lock) {
      throw fail(401, `“${lock.name}” is protected by a password.`, {
        needsPassword: true, folderId: lock.id, hint: (lock.settings || {}).passwordHint || "",
      });
    }
  }

  // May this visitor come across this file outside its gallery (on a tag page)?
  // Stricter than opening a gallery by link: nothing from an unlisted or
  // password-locked gallery, and nothing internal unless it is pinned public.
  function canFindItem(i) {
    const n = db.nodes[i.folderId];
    if (!n) return false;
    if (isOrganizer()) return true;
    if (lockedBy(n) || !canSeeItem(i, n)) return false;
    if (hasLinkTo(n)) return true;
    for (let cur = n; cur; cur = db.nodes[cur.parentId]) {
      if (cur.visibility === "unlisted") return false;
      if (cur.visibility === "internal" && !isMember() && i.visibility !== "public") return false;
    }
    return true;
  }

  // What we hand to the page. Visibility labels are only sent to members.
  const folderView = (n) => ({
    id: n.id, type: "folder", kind: n.kind, name: n.name, description: n.description || "",
    settings: settingsOf(n),
    ...(lockedBy(n) ? { locked: true } : {}),
    ...(isMember() ? { visibility: n.visibility } : {}),
  });
  const CAMERA_FIELDS = ["camera", "lens", "aperture", "iso", "exposure", "focal"];
  const itemView = (i, folder) => {
    const { folderId, visibility, ...rest } = i;
    if (!settingsOf(folder).cameraInfo && !isMember()) CAMERA_FIELDS.forEach((f) => delete rest[f]);
    return { ...rest, ...(isMember() && visibility !== "inherit" ? { visibility } : {}) };
  };

  function sorted(items, s) {
    const keys = {
      position: (i) => i.pos,
      caption: (i) => i.description || "",
      filename: (i) => i.name,
      dateUploaded: (i) => i.uploaded || 0,
      dateModified: (i) => i.modified || i.uploaded || 0,
      dateTaken: (i) => Date.parse(i.date) || 0,
    };
    const key = keys[s.sortBy] || keys.position;
    const dir = s.sortDir === "desc" ? -1 : 1;
    return [...items].sort((a, b) => {
      const x = key(a), y = key(b);
      const c = typeof x === "string" ? natural.compare(x, y) : x - y;
      return dir * (c || a.pos - b.pos);
    });
  }

  /* ── read API (what the gallery pages use) ───────────────── */
  async function list(folderId) {
    const n = node(folderId);
    checkOpen(n);
    const s = settingsOf(n);
    const folders = childFolders(n.id).filter(isListed);
    if (s.sortBy === "filename") folders.sort((a, b) => natural.compare(a.name, b.name));
    if (s.sortBy.startsWith("date")) folders.sort((a, b) => (a.created || 0) - (b.created || 0));
    if (s.sortBy !== "position" && s.sortDir === "desc") folders.reverse();
    return {
      folders: folders.map(folderView),
      items: sorted(childItems(n.id).filter((i) => canSeeItem(i, n)), s).map((i) => itemView(i, n)),
    };
  }

  async function folder(folderId) {
    const n = node(folderId);
    checkOpen(n);
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
        item = (await cover(sub.id, depth + 1).catch(() => ({}))).item;
        if (item) break;
      }
    }
    return { item, photos: items.length, folders: folders.length };
  }

  // Everything this visitor may see that carries a tag, newest first, from
  // every gallery at once. Each item says which gallery it lives in.
  async function byTag(name) {
    const tag = knownTag(clean(name, 40));
    if (!tag) throw fail(404, "Nothing is tagged with that.");
    const items = Object.values(db.items)
      .filter((i) => (i.tags || []).includes(tag) && canFindItem(i))
      .sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0) || a.pos - b.pos)
      .map((i) => ({ ...itemView(i, db.nodes[i.folderId]), galleryId: i.folderId, galleryName: db.nodes[i.folderId].name }));
    if (!items.length && !isOrganizer()) throw fail(404, "Nothing is tagged with that.");
    return { tag, items };
  }

  /* ── passwords & links (no login needed) ─────────────────── */
  // Enter a gallery's password. Remembered for this browser tab.
  async function unlock(folderId, password) {
    const n = node(folderId);
    const s = n.settings || {};
    if (s.access !== "password" || s.passwordHash !== (await hash(n.id, password))) throw fail(401, "That password isn't right.");
    remember(UNLOCKED_KEY, n.id);
  }

  async function linkPasswordOk(link, password) {
    return !link.passwordHash || link.passwordHash === (await hash(link.token, password ?? ""));
  }

  // Open a view link. Returns the folder it unlocks.
  async function redeemLink(token, password) {
    const link = liveLink(token);
    if (!link || link.type !== "view") throw fail(404, "This link has expired or been turned off.");
    if (!(await linkPasswordOk(link, password))) {
      throw fail(401, password == null ? "This link is protected by a password." : "That password isn't right.", { needsPassword: true, linkToken: token });
    }
    remember(GRANTS_KEY, token);
    return link.folderId;
  }

  // What an upload link points at (so the upload page can greet people).
  async function uploadInfo(token) {
    const link = liveLink(token);
    if (!link || link.type !== "upload") throw fail(404, "This upload link has expired or been turned off.");
    const n = db.nodes[link.folderId];
    return { name: n.name, description: n.description || "", needsPassword: !!link.passwordHash, tags: [...(link.tags || [])] };
  }

  // Add one file through an upload link.
  async function guestUpload(token, password, file) {
    const link = liveLink(token);
    if (!link || link.type !== "upload") throw fail(404, "This upload link has expired or been turned off.");
    if (!(await linkPasswordOk(link, password))) throw fail(401, "That password isn't right.");
    // whatever comes in through the link gets the link's tags — nobody tags by hand
    return addFile(link.folderId, file, `Upload link: ${link.label}`, link.tags);
  }

  // `url` is the picture shown in the grid; a video also has `src` (the clip) and `duration`.
  function addFile(folderId, { type, name, url, src, duration, w, h, size }, uploadedBy, tags) {
    if (!url || !(w > 0) || !(h > 0)) throw fail(400, "That file couldn't be read.");
    const item = {
      id: uid("u"), ...(type === "video" ? { type: "video", src, duration: duration || 0 } : { type: "image" }), name: clean(name, 120), title: clean(name, 120).replace(/\.[a-z0-9]{2,5}$/i, ""),
      description: "", tags: cleanTags(tags), w, h, ratio: w / h, date: new Date().toISOString(), size, url,
      uploaded: Date.now(), modified: Date.now(), uploadedBy,
      folderId, visibility: "inherit", pos: nextPos(childItems(folderId)),
    };
    db.items[item.id] = item;
    return { ...item };
  }

  /* ── organize API (requires the "organize" permission) ───── */
  // Every function checks permission itself — hiding the button is not security.
  const requireOrganizer = () => {
    if (!isOrganizer()) throw fail(403, "You don't have permission to organize the site.");
  };
  const isInside = (n, ancestorId) => {
    for (let cur = n; cur; cur = db.nodes[cur.parentId]) if (cur.id === ancestorId) return true;
    return false;
  };
  // The organizer's view of a folder: everything except the password itself.
  const adminFolder = (n) => ({ ...n, settings: settingsOf(n), hasPassword: !!(n.settings || {}).passwordHash });

  const admin = {
    // The whole folder tree, for the sidebar.
    async tree() {
      requireOrganizer();
      const build = (n) => ({ id: n.id, name: n.name, kind: n.kind, visibility: n.visibility, children: childFolders(n.id).map(build) });
      return build(db.nodes[ROOT]);
    },

    // Everything in one folder, unfiltered, in manual order.
    async contents(folderId) {
      requireOrganizer();
      const n = node(folderId);
      return {
        folder: adminFolder(n),
        folders: childFolders(n.id).map((c) => ({ ...adminFolder(c), count: childFolders(c.id).length + childItems(c.id).length })),
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
        coverId: null, pos: nextPos(childFolders(parentId)), created: Date.now(), settings: {},
      };
      db.nodes[n.id] = n;
      save();
      return adminFolder(n);
    },

    // patch: { name, description, visibility, coverId, settings: {...}, password }
    // `password` is the new plain-text password ("" = leave unchanged).
    async updateFolder(id, patch) {
      requireOrganizer();
      const n = node(id);
      if (id === ROOT) throw fail(400, "The home page can't be changed here.");
      if ("name" in patch) { if (!clean(patch.name)) throw fail(400, "Give it a name."); n.name = clean(patch.name, 80); }
      if ("description" in patch) n.description = clean(patch.description, 500);
      if ("visibility" in patch && ["public", "unlisted", "internal"].includes(patch.visibility)) n.visibility = patch.visibility;
      if ("coverId" in patch) n.coverId = patch.coverId;
      if (patch.settings) {
        const s = (n.settings = n.settings || {});
        for (const [key, value] of Object.entries(patch.settings)) {
          if (!(key in DEFAULTS)) continue;
          if (CHOICES[key]) { if (CHOICES[key].includes(value)) s[key] = value; }
          else if (typeof DEFAULTS[key] === "boolean") s[key] = !!value;
          else s[key] = clean(value, 300);
        }
      }
      if (patch.password) (n.settings = n.settings || {}).passwordHash = await hash(n.id, patch.password);
      const s = n.settings || {};
      if (s.access === "password" && !s.passwordHash) { s.access = "anyone"; save(); throw fail(400, "Set a password, or change Access back to Anyone."); }
      if (s.access !== "password") delete s.passwordHash;
      n.modified = Date.now();
      save();
    },

    async updateItem(id, patch) {
      requireOrganizer();
      const i = db.items[id];
      if (!i) throw fail(404, "That file doesn't exist.");
      if ("title" in patch && clean(patch.title)) i.title = clean(patch.title, 120);
      if ("description" in patch) i.description = clean(patch.description, 500);
      if ("tags" in patch) i.tags = cleanTags(patch.tags);
      if ("visibility" in patch && ["inherit", "public", "internal"].includes(patch.visibility)) i.visibility = patch.visibility;
      i.modified = Date.now();
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
    async addItem(folderId, file) {
      requireOrganizer();
      if (node(folderId).kind !== "gallery") throw fail(400, "Upload into a gallery, not a folder.");
      const who = A.user();
      return addFile(folderId, file, who ? who.name : null);
    },

    /* library: every file on the site in one list, whatever gallery it is in */
    // filter: { q, tags: [...all must match], untagged, type: "image"|"video", folderId,
    //           visibility: "public"|"unlisted"|"internal", year, month, sort }
    // sort: "taken-desc" (default) | "taken-asc" | "uploaded-desc" | "name"
    async library(filter = {}) {
      requireOrganizer();
      const q = clean(filter.q, 80).toLowerCase();
      const want = (filter.tags || []).map(knownTag).filter(Boolean);
      // what the public effectively gets: the file's own pin, else its gallery's setting
      const seenAs = (i) => (i.visibility !== "inherit" ? i.visibility : db.nodes[i.folderId].visibility);
      const all = Object.values(db.items).filter((i) => db.nodes[i.folderId]);
      const items = all.filter((i) => {
        const tags = i.tags || [];
        if (filter.untagged ? tags.length : !want.every((t) => tags.includes(t))) return false;
        if (filter.type && i.type !== filter.type) return false;
        if (filter.folderId && !isInside(db.nodes[i.folderId], filter.folderId)) return false;
        if (filter.visibility && seenAs(i) !== filter.visibility) return false;
        if (filter.year && !String(i.date).startsWith(String(filter.year) + (filter.month ? "-" + filter.month : ""))) return false;
        return !q || `${i.name} ${i.title} ${i.description || ""} ${tags.join(" ")} ${db.nodes[i.folderId].name}`.toLowerCase().includes(q);
      });
      const taken = (i) => Date.parse(i.date) || 0;
      const sorts = {
        "taken-desc": (a, b) => taken(b) - taken(a),
        "taken-asc": (a, b) => taken(a) - taken(b),
        "uploaded-desc": (a, b) => (b.uploaded || 0) - (a.uploaded || 0),
        name: (a, b) => natural.compare(a.name, b.name),
      };
      items.sort(sorts[filter.sort] || sorts["taken-desc"]);
      const months = {};
      all.forEach((i) => { const m = String(i.date).slice(0, 7); if (/^\d{4}-\d{2}$/.test(m)) months[m] = (months[m] || 0) + 1; });
      return {
        total: all.length,
        months, // { "2026-03": 180, … } for the By Date list
        items: items.map((i) => ({ ...i, tags: [...(i.tags || [])], galleryName: db.nodes[i.folderId].name, seenAs: seenAs(i) })),
      };
    },

    /* tags */
    // The vocabulary, in groups, with how many files carry each tag.
    async tagGroups() {
      requireOrganizer();
      const counts = {};
      Object.values(db.items).forEach((i) => (i.tags || []).forEach((t) => (counts[t] = (counts[t] || 0) + 1)));
      return {
        groups: db.tagGroups.map((g) => ({ name: g.name, tags: g.tags.map((t) => ({ name: t, count: counts[t] || 0 })) })),
        untagged: Object.values(db.items).filter((i) => !(i.tags || []).length).length,
      };
    },
    // Add a tag to a group (the group is created if it is new).
    async addTag(group, name) {
      requireOrganizer();
      const tag = clean(name, 40).replace(/\s+/g, " ");
      const groupName = clean(group, 30) || OTHER;
      if (!tag) throw fail(400, "Type a tag.");
      if (tag.includes(",")) throw fail(400, "Tags can't contain commas.");
      if (knownTag(tag)) throw fail(400, `“${knownTag(tag)}” already exists.`);
      let g = db.tagGroups.find((x) => sameTag(x.name, groupName));
      if (!g) db.tagGroups.push((g = { name: groupName, tags: [] }));
      g.tags.push(tag);
      save();
      return tag;
    },
    // Remove a tag from the vocabulary and from every file and upload link.
    async removeTag(name) {
      requireOrganizer();
      const tag = knownTag(name);
      if (!tag) return;
      db.tagGroups.forEach((g) => (g.tags = g.tags.filter((t) => t !== tag)));
      db.tagGroups = db.tagGroups.filter((g) => g.tags.length);
      const strip = (x) => { if (x.tags) x.tags = x.tags.filter((t) => t !== tag); };
      Object.values(db.items).forEach(strip);
      Object.values(db.links).forEach(strip);
      save();
    },
    // Add and/or remove tags on many files at once.
    async tagItems(ids, { add = [], remove = [] }) {
      requireOrganizer();
      const adding = cleanTags(add);
      const removing = remove.map(knownTag).filter(Boolean);
      for (const id of ids) {
        const i = db.items[id];
        if (!i) continue;
        i.tags = [...new Set([...(i.tags || []), ...adding])].filter((t) => !removing.includes(t)).slice(0, 30);
        i.modified = Date.now();
      }
      save();
    },

    /* links: type "view" (see one gallery) or "upload" (add files to one gallery) */
    async links(folderId, type) {
      requireOrganizer();
      return Object.values(db.links)
        .filter((l) => l.folderId === folderId && l.type === type)
        .sort((a, b) => b.created - a.created)
        .map(({ passwordHash, ...l }) => ({ ...l, hasPassword: !!passwordHash }));
    },
    // `tags` (upload links only) are put on every file that arrives through the link.
    async createLink(folderId, { type, label, days, password, tags }) {
      requireOrganizer();
      const n = node(folderId);
      if (type === "upload" && n.kind !== "gallery") throw fail(400, "Upload links only work on galleries.");
      const token = [...crypto.getRandomValues(new Uint8Array(18))].map((b) => b.toString(36).padStart(2, "0")).join("").slice(0, 28);
      const who = A.user();
      db.links[token] = {
        token, folderId, type: type === "upload" ? "upload" : "view",
        label: clean(label, 60) || (type === "upload" ? "Upload link" : "View link"),
        created: Date.now(), expires: days ? Date.now() + days * 86400000 : null,
        createdBy: who ? who.username : null,
        passwordHash: password ? await hash(token, password) : null,
        tags: type === "upload" ? cleanTags(tags) : [],
      };
      save();
      return token;
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
    const d = {
      nodes: {}, items: {}, links: {},
      tagGroups: [
        { name: "Category", tags: ["competition", "build season", "outreach", "camp", "team"] },
        { name: "Event", tags: ["District Event", "Championship", "Off-season", "Kickoff"] },
        { name: "Subject", tags: ["robot", "pit", "drive team", "awards", "team photo"] },
      ],
    };
    const subjects = [["robot"], [], ["pit"], ["robot", "drive team"], [], ["team photo"], [], ["awards"], [], []];
    const ratios = [1.5, 1.5, 1.5, 1.5, 0.667, 1.333, 1.778, 1.5, 0.8, 1];
    const folderPos = {};
    const add = (id, kind, name, parentId, visibility, description = "", settings = {}) => {
      folderPos[parentId] = (folderPos[parentId] ?? -1) + 1;
      d.nodes[id] = { id, kind, name, description, parentId, visibility, coverId: null, pos: folderPos[parentId], created: folderPos[parentId], settings };
    };
    // `tags` go on every file; `withSubjects` also sprinkles Subject tags around
    // so the same tag turns up in several galleries.
    const photos = (folderId, n, prefix, month, tags, publicOnes = [], withSubjects = true) => {
      for (let i = 1; i <= n; i++) {
        const video = i % 9 === 4;
        const r = video ? 1.778 : ratios[(i * 7 + folderId.length * 3) % ratios.length];
        const w = video ? 1920 : r >= 1 ? 3000 : Math.round(3000 * r);
        const num = String(i).padStart(4, "0");
        const day = String(((i * 3) % 27) + 1).padStart(2, "0");
        d.items[`${folderId}-${i}`] = {
          id: `${folderId}-${i}`, type: video ? "video" : "image",
          name: `${prefix}_${num}.${video ? "mp4" : "jpg"}`, title: `${prefix}_${num}`, description: "",
          tags: [...tags, ...(withSubjects ? subjects[(i + folderId.length) % subjects.length] : [])],
          w, h: Math.round(w / r), ratio: r,
          date: `${month}-${day}T1${i % 10}:24:00`,
          uploaded: Date.parse(`2026-04-01T12:00:00`) + i * 60000, modified: Date.parse(`2026-04-01T12:00:00`) + i * 60000,
          size: 4200000 + i * 137000,
          ...(video
            ? { duration: 5 + ((i * 13) % 50) }
            : { camera: "Canon EOS R6", lens: "RF 24-70mm F2.8", aperture: 2.8, iso: 800, exposure: 1 / 500, focal: 50 }),
          folderId, visibility: publicOnes.includes(i) ? "public" : "inherit", pos: i,
        };
      }
    };

    d.nodes[ROOT] = { id: ROOT, kind: "folder", name: C.siteTitle, description: C.tagline || "", parentId: null, visibility: "public", coverId: null, pos: 0, created: 0, settings: {} };
    add("demo-comp", "folder", "Competitions", ROOT, "public", "Every event we've played");
    add("demo-build", "folder", "Build Seasons", ROOT, "public");
    add("demo-outreach", "gallery", "Outreach", ROOT, "public", "Demos, school visits and community events", { style: "collage-portrait" });
    add("demo-camps", "gallery", "Camps", ROOT, "internal", "Summer camps — team only, with a few approved public picks");
    add("demo-team", "gallery", "Team Stuff", ROOT, "internal", "Team only");
    add("demo-uploads", "gallery", "Uploads", ROOT, "unlisted", "Drop zone for new media", { style: "thumbnails", sortBy: "dateUploaded", sortDir: "desc" });
    add("demo-district", "gallery", "District Event", "demo-comp", "public", "Qualification and playoff matches");
    add("demo-champs", "gallery", "Championship", "demo-comp", "public", "Houston, TX", { style: "journal", filenames: true });
    add("demo-offseason", "gallery", "Off-season", "demo-comp", "unlisted");
    add("demo-kickoff", "gallery", "Kickoff", "demo-build", "public", "Game reveal day", { style: "smugmug" });
    add("demo-shop", "gallery", "In the Shop", "demo-build", "internal", "Work in progress — not for sharing yet");
    photos("demo-district", 64, "DISTRICT", "2026-03", ["competition", "District Event"]);
    photos("demo-champs", 36, "CHAMPS", "2026-04", ["competition", "Championship"]);
    photos("demo-offseason", 14, "OFFSEASON", "2025-10", ["competition", "Off-season"]);
    photos("demo-kickoff", 18, "KICKOFF", "2026-01", ["build season", "Kickoff"]);
    photos("demo-shop", 42, "SHOP", "2026-02", ["build season"]);
    photos("demo-outreach", 24, "OUTREACH", "2025-11", ["outreach"]);
    photos("demo-camps", 30, "CAMP", "2025-07", ["camp"], [2, 7, 12]);
    photos("demo-team", 12, "TEAM", "2025-09", ["team"]);
    photos("demo-uploads", 8, "UPLOAD", "2026-05", [], [], false); // untagged, waiting to be sorted
    // an upload link that tags whatever comes in through it
    d.links["demo-upload-district"] = {
      token: "demo-upload-district", folderId: "demo-district", type: "upload", label: "District Event — parent photos",
      created: Date.parse("2026-03-01T12:00:00"), expires: null, createdBy: "organizer", passwordHash: null,
      tags: ["competition", "District Event"],
    };
    return d;
  }

  window.Backend = { rootId: ROOT, list, folder, path, cover, byTag, unlock, redeemLink, uploadInfo, guestUpload, admin };
})();
