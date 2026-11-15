/*
 * drive.js — where the gallery pages get their data.
 *
 * Everything the gallery pages know about photos comes through window.Drive:
 *   Drive.list(folderId)   → { folders: [...], items: [...] }
 *   Drive.folder(folderId) → { id, name, description, parentId }
 *   Drive.path(folderId)   → breadcrumb array from the root down to folderId
 *   Drive.cover(folderId)  → { item, photos, folders } for folder tiles
 *   Drive.thumb(item, px)  → image URL with the longest edge ≈ px
 *
 * Two modes:
 *   • LIVE  — rootFolderId + googleApiKey are set in config.js: reads a
 *             publicly shared Google Drive folder directly.
 *   • DEMO  — nothing configured: uses the pretend server in backend.js,
 *             which also powers logins, visibility and the Organize screen.
 */
(() => {
  const C = window.GALLERY_CONFIG;
  const B = window.Backend;
  const API = "https://www.googleapis.com/drive/v3/files";
  const FOLDER_MIME = "application/vnd.google-apps.folder";
  const DEMO = !C.rootFolderId || !C.googleApiKey;
  const ROOT = DEMO ? B.rootId : C.rootFolderId;
  const TTL = (C.cacheMinutes ?? 10) * 60000;
  const DEMO_VIDEO = "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";

  /* ── tiny cache: memory + sessionStorage (live mode only) ── */
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
    const qs = new URLSearchParams({ ...params, key: C.googleApiKey, supportsAllDrives: "true" });
    const res = await fetch(`${API}${path}?${qs}`);
    if (!res.ok) {
      let msg = res.statusText;
      try { msg = (await res.json()).error.message || msg; } catch {}
      throw Object.assign(new Error(msg), { status: res.status });
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
          "nextPageToken,files(id,name,mimeType,description,createdTime,size," +
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

  /* ── Public API ──────────────────────────────────────────── */
  async function list(folderId) {
    if (DEMO) return B.list(folderId);
    const out = await cached("list:" + folderId, () => driveList(folderId));
    out.folders.forEach((f) => remember(f.id, f.name, folderId));
    return out;
  }

  async function folder(id) {
    if (DEMO) return B.folder(id);
    const f = await cached("folder:" + id, () => driveFolder(id));
    remember(id, f.name, f.parentId);
    return f;
  }

  // Breadcrumbs: [root, ..., folder]. Stops early if a parent isn't visible.
  async function path(id) {
    if (DEMO) return B.path(id);
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
    if (DEMO) return B.cover(folderId);
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
    if (item.url) return item.url; // a file "uploaded" in the demo
    if (DEMO) {
      const r = item.ratio || 1.5;
      const w = r >= 1 ? px : Math.round(px * r);
      const h = r >= 1 ? Math.round(px / r) : px;
      return `https://picsum.photos/seed/${item.id}/${w}/${h}`;
    }
    return `https://drive.google.com/thumbnail?id=${item.id}&sz=w${px}-h${px}`;
  }

  window.Drive = {
    demo: DEMO,
    demoVideo: DEMO_VIDEO,
    rootId: ROOT,
    list, folder, path, cover, thumb,
    sortNatural: (a, b) => natural.compare(a.name, b.name),
    downloadUrl: (item) => (DEMO ? thumb(item, 3000) : `https://drive.google.com/uc?export=download&id=${item.id}`),
    videoEmbedUrl: (item) => `https://drive.google.com/file/d/${item.id}/preview`,
    folderUrl: (id) => (DEMO ? "#" : `https://drive.google.com/drive/folders/${id}`),
  };
})();
