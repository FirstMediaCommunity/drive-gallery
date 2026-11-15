/*
 * drive.js — the data layer.
 *
 * Everything the UI knows about photos comes through window.Drive:
 *   Drive.list(folderId)   → { folders: [...], items: [...] }
 *   Drive.folder(folderId) → { id, name, description, parentId }
 *   Drive.path(folderId)   → breadcrumb array from the root down to folderId
 *   Drive.cover(folderId)  → { item, photos, folders } for folder tiles
 *   Drive.thumb(item, px)  → image URL with the longest edge ≈ px
 *
 * With no API key configured it serves a built-in demo library instead,
 * so the site works out of the box.
 */
(() => {
  const C = window.GALLERY_CONFIG;
  const API = "https://www.googleapis.com/drive/v3/files";
  const FOLDER_MIME = "application/vnd.google-apps.folder";
  const DEMO = !C.rootFolderId || (!C.googleApiKey && !C.googleClientId);
  const PRIVATE = !DEMO && !!C.googleClientId; // visitors sign in with Google
  const ROOT = DEMO ? "demo-root" : C.rootFolderId;
  const TTL = (C.cacheMinutes ?? 10) * 60000;
  const DEMO_VIDEO = "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";

  /* ── Private mode: Google sign-in (only used if googleClientId is set) ── */
  let token = null;
  try {
    const s = JSON.parse(sessionStorage.getItem("dg:token"));
    if (s && s.exp > Date.now()) token = s.t;
  } catch {}

  function loadGoogleSignIn() {
    return new Promise((resolve, reject) => {
      if (window.google?.accounts?.oauth2) return resolve();
      const s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.onload = resolve;
      s.onerror = () => reject(new Error("Could not load Google sign-in"));
      document.head.append(s);
    });
  }

  async function signIn() {
    await loadGoogleSignIn();
    return new Promise((resolve, reject) => {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: C.googleClientId,
        scope: "https://www.googleapis.com/auth/drive.readonly",
        callback: (r) => {
          if (r.error) return reject(new Error(r.error_description || r.error));
          token = r.access_token;
          try {
            sessionStorage.setItem("dg:token", JSON.stringify({ t: token, exp: Date.now() + (r.expires_in - 60) * 1000 }));
          } catch {}
          resolve();
        },
        error_callback: (e) => reject(new Error(e.message || "Sign-in was cancelled")),
      });
      client.requestAccessToken();
    });
  }

  function signOut() {
    token = null;
    mem.clear();
    try { Object.keys(sessionStorage).filter((k) => k.startsWith("dg:")).forEach((k) => sessionStorage.removeItem(k)); } catch {}
  }

  /* ── tiny cache: memory + sessionStorage ─────────────────── */
  const mem = new Map();
  function cached(key, fn) {
    if (mem.has(key)) return mem.get(key);
    try {
      const raw = sessionStorage.getItem("dg:" + key);
      if (raw) {
        const { t, v } = JSON.parse(raw);
        if (Date.now() - t < TTL) {
          const p = Promise.resolve(v);
          mem.set(key, p);
          return p;
        }
      }
    } catch {}
    const p = fn().then((v) => {
      try { sessionStorage.setItem("dg:" + key, JSON.stringify({ t: Date.now(), v })); } catch {}
      return v;
    });
    mem.set(key, p);
    p.catch(() => mem.delete(key));
    return p;
  }

  // id → { name, parentId } for every folder we've seen (used for breadcrumbs)
  const known = new Map();
  const remember = (id, name, parentId) => {
    const prev = known.get(id) || {};
    known.set(id, { name: name ?? prev.name, parentId: parentId ?? prev.parentId });
  };

  const natural = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  const stripExt = (n) => n.replace(/\.[a-z0-9]{2,5}$/i, "");

  /* ── Google Drive API ────────────────────────────────────── */
  async function api(path, params) {
    if (PRIVATE && !token) {
      const err = new Error("Sign in to view this gallery");
      err.status = 401;
      throw err;
    }
    const qs = new URLSearchParams({ ...params, supportsAllDrives: "true" });
    if (C.googleApiKey) qs.set("key", C.googleApiKey);
    const res = await fetch(`${API}${path}?${qs}`, PRIVATE ? { headers: { Authorization: "Bearer " + token } } : {});
    if (!res.ok) {
      if (res.status === 401) signOut();
      let msg = res.statusText;
      try { msg = (await res.json()).error.message || msg; } catch {}
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  function normalize(f) {
    if (f.mimeType === FOLDER_MIME) {
      return { id: f.id, type: "folder", name: f.name, description: f.description || "" };
    }
    const isVideo = f.mimeType.startsWith("video/");
    const m = f.imageMediaMetadata || f.videoMediaMetadata || {};
    let w = m.width, h = m.height;
    if (m.rotation === 1 || m.rotation === 3) [w, h] = [h, w]; // sideways photos
    // EXIF time looks like "2026:03:14 10:22:31" → make it ISO
    const taken = m.time ? m.time.replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3").replace(" ", "T") : null;
    return {
      id: f.id,
      type: isVideo ? "video" : "image",
      name: f.name,
      title: stripExt(f.name),
      description: f.description || "",
      w, h,
      duration: m.durationMillis ? Number(m.durationMillis) / 1000 : null,
      thumbLink: PRIVATE ? f.thumbnailLink || null : null,
      date: taken || f.createdTime || null,
      size: f.size ? Number(f.size) : null,
      camera: [m.cameraMake, m.cameraModel].filter(Boolean).join(" ").replace(/^(\w+) \1/i, "$1") || null,
      lens: m.lens || null,
      aperture: m.aperture || null,
      iso: m.isoSpeed || null,
      exposure: m.exposureTime || null,
      focal: m.focalLength || null,
    };
  }

  async function driveList(folderId) {
    const files = [];
    let pageToken;
    do {
      const page = await api("", {
        q: `'${folderId}' in parents and trashed = false`,
        fields:
          "nextPageToken,files(id,name,mimeType,description,createdTime,size,thumbnailLink," +
          "imageMediaMetadata(width,height,rotation,time,cameraMake,cameraModel,lens,aperture,isoSpeed,exposureTime,focalLength)," +
          "videoMediaMetadata(width,height,durationMillis))",
        pageSize: "1000",
        orderBy: "folder,name_natural",
        includeItemsFromAllDrives: "true",
        ...(pageToken ? { pageToken } : {}),
      });
      files.push(...page.files);
      pageToken = page.nextPageToken;
    } while (pageToken);

    const all = files
      .filter((f) => f.mimeType === FOLDER_MIME || f.mimeType.startsWith("image/") || f.mimeType.startsWith("video/"))
      .map(normalize);
    return {
      folders: all.filter((x) => x.type === "folder"),
      items: all.filter((x) => x.type !== "folder"),
    };
  }

  async function driveFolder(id) {
    if (id === ROOT) return { id, name: C.siteTitle, description: C.tagline || "", parentId: null };
    const f = await api("/" + id, { fields: "id,name,description,parents" });
    return { id, name: f.name, description: f.description || "", parentId: (f.parents || [])[0] || null };
  }

  /* ── Demo library (used when no API key is set) ──────────── */
  const demo = (() => {
    const tree = {};
    const ratios = [1.5, 1.5, 1.5, 1.5, 0.667, 1.333, 1.778, 1.5, 0.8, 1];
    const add = (id, name, parentId, description = "") =>
      (tree[id] = { id, name, parentId, description, folders: [], items: [] });
    const photos = (folderId, n, prefix) => {
      for (let i = 1; i <= n; i++) {
        const r = ratios[(i * 7 + folderId.length * 3) % ratios.length];
        const day = String(((i * 3) % 27) + 1).padStart(2, "0");
        tree[folderId].items.push({
          id: `${folderId}-${i}`, type: "image",
          name: `${prefix}_${String(i).padStart(4, "0")}.jpg`,
          title: `${prefix}_${String(i).padStart(4, "0")}`,
          description: "", w: Math.round(3000 * Math.min(r, 1.5) / 1.5 * (r > 1.5 ? r / 1.5 : 1)), h: 0, ratio: r,
          date: `2026-03-${day}T1${i % 10}:24:00`, size: 4200000 + i * 137000,
          camera: "Canon EOS R6", lens: "RF 24-70mm F2.8", aperture: 2.8, iso: 800, exposure: 1 / 500, focal: 50,
        });
        const it = tree[folderId].items.at(-1);
        it.h = Math.round(it.w / r);
        if (i % 9 === 4) { // sprinkle in a few videos
          Object.assign(it, {
            type: "video", name: it.title + ".mp4", ratio: 1.778, w: 1920, h: 1080,
            duration: 5 + ((i * 13) % 50), camera: null, lens: null, aperture: null, iso: null, exposure: null, focal: null,
          });
        }
      }
    };
    const folder = (id, name, parentId, description) => {
      add(id, name, parentId, description);
      tree[parentId].folders.push({ id, type: "folder", name, description: description || "" });
    };

    add(ROOT, C.siteTitle, null, C.tagline);
    folder("demo-2026", "2026 Season", ROOT, "Everything from this year");
    folder("demo-2025", "2025 Season", ROOT, "");
    folder("demo-outreach", "Outreach", ROOT, "Demos, school visits and community events");
    folder("demo-team", "Team Photos", ROOT, "");
    folder("demo-kickoff", "Kickoff", "demo-2026", "Game reveal day");
    folder("demo-build", "Build Season", "demo-2026", "Six weeks in the shop");
    folder("demo-district", "District Event", "demo-2026", "Qualification and playoff matches");
    folder("demo-champs", "Championship", "demo-2026", "Houston, TX");
    folder("demo-25-comp", "Competitions", "demo-2025", "");
    folder("demo-25-off", "Off-season", "demo-2025", "");
    photos("demo-kickoff", 18, "KICKOFF");
    photos("demo-build", 42, "BUILD");
    photos("demo-district", 64, "DISTRICT");
    photos("demo-champs", 36, "CHAMPS");
    photos("demo-25-comp", 30, "COMP25");
    photos("demo-25-off", 14, "OFF25");
    photos("demo-outreach", 24, "OUTREACH");
    photos("demo-team", 12, "TEAM");
    return tree;
  })();

  /* ── Public API ──────────────────────────────────────────── */
  async function list(folderId) {
    const data = DEMO
      ? demo[folderId]
        ? { folders: demo[folderId].folders, items: demo[folderId].items }
        : Promise.reject(new Error("Folder not found"))
      : await cached("list:" + folderId, () => driveList(folderId));
    const out = await data;
    out.folders.forEach((f) => remember(f.id, f.name, folderId));
    return out;
  }

  async function folder(id) {
    if (DEMO) {
      const f = demo[id];
      if (!f) throw new Error("Folder not found");
      return { id, name: f.name, description: f.description, parentId: f.parentId };
    }
    const f = await cached("folder:" + id, () => driveFolder(id));
    remember(id, f.name, f.parentId);
    return f;
  }

  // Breadcrumbs: [root, ..., folder]. Stops early if a parent isn't visible.
  async function path(id) {
    const crumbs = [];
    let cur = id;
    for (let i = 0; cur && i < 12; i++) {
      let info = cur === ROOT ? { name: C.siteTitle, parentId: null } : known.get(cur);
      if (!info || !info.name || (cur !== ROOT && !info.parentId)) {
        try { info = await folder(cur); } catch { break; }
      }
      crumbs.unshift({ id: cur, name: info.name });
      if (cur === ROOT) return crumbs;
      cur = info.parentId;
    }
    if (!crumbs.length || crumbs[0].id !== ROOT) crumbs.unshift({ id: ROOT, name: C.siteTitle });
    return crumbs;
  }

  // The cover of a folder is a file named "cover.*", otherwise its first
  // photo, otherwise the cover of its first sub-folder.
  async function cover(folderId, depth = 0) {
    const { folders, items } = await list(folderId);
    const images = items.filter((i) => i.type === "image");
    let item = images.find((i) => /^cover\./i.test(i.name)) || images[0] || items[0] || null;
    if (!item && depth < 2) {
      for (const sub of folders.slice(0, 3)) {
        item = (await cover(sub.id, depth + 1)).item;
        if (item) break;
      }
    }
    return { item, photos: items.length, folders: folders.length };
  }

  function thumb(item, px) {
    if (DEMO) {
      const r = item.ratio || 1.5;
      const w = r >= 1 ? px : Math.round(px * r);
      const h = r >= 1 ? Math.round(px / r) : px;
      return `https://picsum.photos/seed/${item.id}/${w}/${h}`;
    }
    // Signed-in visitors get Drive's own (short-lived) thumbnail links.
    if (item.thumbLink) return item.thumbLink.replace(/=s\d+$/, "=s" + px);
    return `https://drive.google.com/thumbnail?id=${item.id}&sz=w${px}-h${px}`;
  }

  window.Drive = {
    demo: DEMO,
    demoVideo: DEMO_VIDEO,
    auth: { enabled: PRIVATE, signedIn: () => !!token, signIn, signOut },
    rootId: ROOT,
    list, folder, path, cover, thumb,
    sortNatural: (a, b) => natural.compare(a.name, b.name),
    downloadUrl: (item) => (DEMO ? thumb(item, 3000) : `https://drive.google.com/uc?export=download&id=${item.id}`),
    videoEmbedUrl: (item) => `https://drive.google.com/file/d/${item.id}/preview`,
    folderUrl: (id) => (DEMO ? "#" : `https://drive.google.com/drive/folders/${id}`),
  };
})();
