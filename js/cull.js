/*
 * cull.js: check a batch of photos before they are uploaded, so blurry shots,
 * duplicates and near-identical burst frames don't use up storage.
 *
 * Everything runs in the visitor's browser. Nothing is sent anywhere until the
 * person presses Upload, and only the files they kept go.
 *
 * The scoring is adapted from FYF Photo Culler
 * (https://github.com/fikretyukselit/fyf-photo-culler, MIT License,
 * Copyright (c) 2026 Fikret Yuksel Foundation): regional sharpness, exposure
 * with the arena-dark allowance, contrast, the ISO/shutter score, the weights,
 * tiers and thresholds, perceptual hashes, and keeping the best shot of each
 * group. That project is Python + OpenCV; this is a plain-JavaScript rewrite.
 * Where it uses ORB feature matching to confirm burst frames, this uses a
 * small shift search plus SSIM instead, which is cheaper and less exact.
 *
 * Added here: byte-for-byte copy detection (photos and videos), "already in
 * this gallery" for organizers, a storage summary, support for camera
 * formats browsers don't recognise (.insv, .lrv, RAW files and so on), and
 * exposure checks (see "Exposure" below).
 *
 * Exposure: the original's only exposure check (over 80% of pixels near
 * white) caught none of the 23 photos a photographer marked overexposed on a
 * real 480-photo event card. These checks were set on that card instead:
 *   - overexposed: the share of pixels with a channel at 250 or more
 *     ("blown"). 30% or more suggests Skip (10 of the 23, none wrong), 15% or
 *     more suggests Maybe (all 23, plus 26 to look at).
 *   - underexposed, always Maybe since dark photos can often be fixed: the
 *     brightness where the camera focused, read from Canon's focus data, so a
 *     lit subject on a black background is not called dark (20 of 37 marked,
 *     5 wrong). Without focus data: 2% or more pure black pixels, or half the
 *     frame dark (no wrong calls on that card, but fewer caught).
 * One card is a small sample; treat these numbers as a starting point.
 *
 *   Cull.kindOf(file)              "image" | "video" | null
 *   Cull.ACCEPT                    value for <input type="file" accept>
 *   Cull.playableBlob(file)        the file, retyped so the browser will try to play it
 *   Cull.review(files, opts)       opens the review screen; resolves to the files
 *                                  to upload, or null if cancelled
 *   Cull.analyze(files, opts)      the analysis alone (used by review)
 */
(() => {
  /* ── file types ──────────────────────────────────────────── */
  // Camera and editing formats a browser usually can't name. They upload as
  // the original file; the site shows a placeholder when it can't preview one.
  const VIDEO_EXT = ["mp4", "m4v", "mov", "webm", "mkv", "avi", "wmv", "flv", "3gp", "mpg", "mpeg",
    "mts", "m2ts", "ts", "mxf", "insv", "lrv", "360", "braw", "r3d", "hevc", "vob"];
  const IMAGE_EXT = ["jpg", "jpeg", "png", "gif", "webp", "avif", "bmp", "tif", "tiff", "heic", "heif", "jxl",
    "insp", "dng", "cr2", "cr3", "crw", "nef", "nrw", "arw", "srf", "sr2", "raf", "orf", "rw2", "pef", "srw", "x3f", "3fr", "iiq", "raw"];
  // What to tell the browser a file is when it doesn't know. Insta360 .insv and
  // GoPro .lrv/.360 are MP4 inside; Insta360 .insp is a JPEG inside.
  const PLAY_AS = { insv: "video/mp4", lrv: "video/mp4", "360": "video/mp4", mts: "video/mp2t", m2ts: "video/mp2t",
    ts: "video/mp2t", hevc: "video/mp4", insp: "image/jpeg" };

  const extOf = (name) => (/\.([a-z0-9]+)$/i.exec(name || "") || [])[1]?.toLowerCase() || "";
  function kindOf(file) {
    const t = file.type || "";
    const e = extOf(file.name);
    // some systems label .insv as application/octet-stream, so the extension wins over a vague type
    if (VIDEO_EXT.includes(e)) return "video";
    if (IMAGE_EXT.includes(e)) return "image";
    if (t.startsWith("image/")) return "image";
    if (t.startsWith("video/")) return "video";
    return null;
  }
  const ACCEPT = ["image/*", "video/*", ...VIDEO_EXT.map((e) => "." + e), ...IMAGE_EXT.map((e) => "." + e)].join(",");
  function playableBlob(file) {
    const as = PLAY_AS[extOf(file.name)];
    return as && file.type !== as ? new Blob([file], { type: as }) : file;
  }

  /* ── scoring (ported from culling/technical.py) ──────────── */
  const W = { sharp: 0.40, exposure: 0.25, contrast: 0.15, exif: 0.20 };
  const W_NO_EXIF = { sharp: 0.53, exposure: 0.33, contrast: 0.14 };
  const BLUR_THRESHOLD = 85;
  const BLUR_THRESHOLD_SHALLOW_DOF = 50; // wide-aperture shots have soft backgrounds on purpose
  const SHALLOW_DOF_APERTURE = 4.0;
  const DARK_PIXEL = 30, BRIGHT_PIXEL = 225, BRIGHT_RATIO = 0.80;
  const BLOWN_SKIP = 0.30, BLOWN_MAYBE = 0.15;      // share of pixels with a channel at 250+
  const FOCUS_DARK = 44;                             // brightness (0-255) where the camera focused
  const CRUSHED_DARK = 0.02, DARK_SHARE_DARK = 0.5;  // fallback when there is no focus data
  const BURST_WINDOW = 2.0; // seconds; frames further apart can't be one burst
  const ANALYZE_EDGE = 1024; // the thresholds above were tuned at this size

  // Laplacian variance of one tile (4-neighbour kernel, as cv2.Laplacian ksize=1).
  function lapVar(g, w, h, x0, y0, x1, y1) {
    let n = 0, sum = 0, sq = 0;
    const xa = Math.max(x0, 1), xb = Math.min(x1, w - 1), ya = Math.max(y0, 1), yb = Math.min(y1, h - 1);
    for (let y = ya; y < yb; y++) {
      const r = y * w;
      for (let x = xa; x < xb; x++) {
        const i = r + x;
        const v = g[i - 1] + g[i + 1] + g[i - w] + g[i + w] - 4 * g[i];
        sum += v; sq += v * v; n++;
      }
    }
    if (!n) return 0;
    const m = sum / n;
    return sq / n - m * m;
  }
  // Harmonic mean of the two sharpest of nine regions, plus the sharpest one.
  // A small sharp subject on a soft background goes to Maybe, not Reject.
  function sharpness(g, w, h) {
    const tw = Math.floor(w / 3), th = Math.floor(h / 3);
    const v = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++)
      v.push(lapVar(g, w, h, c * tw, r * th, c < 2 ? (c + 1) * tw : w, r < 2 ? (r + 1) * th : h));
    v.sort((a, b) => b - a);
    const [a, b] = v;
    return { robust: a + b ? (2 * a * b) / (a + b) : 0, peak: a };
  }
  function exposureAndContrast(g) {
    let dark = 0, bright = 0, sum = 0, sq = 0;
    for (let i = 0; i < g.length; i++) {
      const v = g[i];
      if (v < DARK_PIXEL) dark++; else if (v > BRIGHT_PIXEL) bright++;
      sum += v; sq += v * v;
    }
    const n = g.length, mean = sum / n;
    const brightRatio = bright / n;
    // dark pixels count half: arenas are 40-60% dark stands and floor by design
    const exposure = clamp((1 - (dark / n) * 0.5 - brightRatio) * 100, 0, 100);
    const contrast = clamp((Math.sqrt(Math.max(0, sq / n - mean * mean)) / 75) * 100, 0, 100);
    return { exposure, contrast, brightRatio, mean };
  }
  // Clipped highlights and shadows, from the colour pixels.
  function clipping(rgba) {
    let blown = 0, crushed = 0, dark = 0;
    const n = rgba.length / 4;
    for (let i = 0; i < rgba.length; i += 4) {
      const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
      if (r >= 250 || g >= 250 || b >= 250) blown++;
      if (r <= 5 && g <= 5 && b <= 5) crushed++;
      if (0.299 * r + 0.587 * g + 0.114 * b < DARK_PIXEL) dark++;
    }
    return { blown: blown / n, crushed: crushed / n, dark: dark / n };
  }
  // Average brightness inside the camera's focus area(s), on the upright
  // analysis image. Focus positions are in the sensor's orientation, so they
  // are turned the way the picture was (EXIF orientation 3, 6 or 8).
  function focusBrightness(g, w, h, af, orientation) {
    if (!af || !af.pts.length) return null;
    const means = [];
    for (const p of af.pts) {
      let u = (af.w / 2 + p.x) / af.w, v = (af.h / 2 - p.y) / af.h, bu = p.w / af.w, bv = p.h / af.h;
      if (orientation === 3) { u = 1 - u; v = 1 - v; }
      else if (orientation === 6) { [u, v] = [1 - v, u]; [bu, bv] = [bv, bu]; }
      else if (orientation === 8) { [u, v] = [v, 1 - u]; [bu, bv] = [bv, bu]; }
      const half = Math.max(bu * w, bv * h, 0.02 * Math.max(w, h)) * 1.25;
      const x0 = Math.max(0, Math.round(u * w - half)), x1 = Math.min(w, Math.round(u * w + half));
      const y0 = Math.max(0, Math.round(v * h - half)), y1 = Math.min(h, Math.round(v * h + half));
      let sum = 0, n = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { sum += g[y * w + x]; n++; }
      if (n > 20) means.push(sum / n);
    }
    return means.length ? means.reduce((a, b) => a + b) / means.length : null;
  }
  function exifScore({ iso, shutter }) {
    const s = [];
    if (iso != null) s.push(clamp(((6400 - iso) / (6400 - 100)) * 100, 0, 100));
    if (shutter != null) {
      const lv = Math.log10(shutter > 0 ? shutter : 0.001), fast = -3, slow = Math.log10(1 / 30);
      s.push(clamp(((lv - slow) / (fast - slow)) * 100, 0, 100));
    }
    return s.length ? s.reduce((a, b) => a + b) / s.length : null;
  }
  function qualityScore(sharpRaw, exposure, contrast, ex) {
    const sn = clamp((sharpRaw / 500) * 100, 0, 100);
    return ex != null
      ? sn * W.sharp + exposure * W.exposure + contrast * W.contrast + ex * W.exif
      : sn * W_NO_EXIF.sharp + exposure * W_NO_EXIF.exposure + contrast * W_NO_EXIF.contrast;
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /* ── EXIF (the score's four fields, orientation, and Canon focus data) ── */
  async function readExif(file) {
    const out = { iso: null, shutter: null, aperture: null, time: null, orientation: 1, make: null, af: null };
    try {
      const buf = new DataView(await file.slice(0, 256 * 1024).arrayBuffer());
      if (buf.getUint16(0) !== 0xffd8) return out; // JPEG only; other formats score without EXIF
      let p = 2;
      while (p + 4 < buf.byteLength) {
        const marker = buf.getUint16(p), len = buf.getUint16(p + 2);
        if (marker === 0xffe1 && buf.getUint32(p + 4) === 0x45786966) return parseTiff(buf, p + 10, out);
        if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) break;
        p += 2 + len;
      }
    } catch {}
    return out;
  }
  function parseTiff(v, base, out) {
    const le = v.getUint16(base) === 0x4949;
    const u16 = (o) => v.getUint16(base + o, le), u32 = (o) => v.getUint32(base + o, le);
    const str = (o, n) => { let s = ""; for (let i = 0; i < n - 1; i++) s += String.fromCharCode(v.getUint8(base + o + i)); return s; };
    const raw = {};
    const ifd = (o, keep) => {
      const tags = {};
      const n = u16(o);
      for (let i = 0; i < n; i++) {
        const e = o + 2 + i * 12, tag = u16(e), type = u16(e + 2), count = u32(e + 4);
        const at = (type === 2 && count > 4) || type === 5 ? u32(e + 8) : e + 8;
        tags[tag] = type === 3 ? u16(at) : type === 4 ? u32(at) : type === 5 ? u32(at) / (u32(at + 4) || 1) : type === 2 ? str(at, count) : null;
        if (keep) keep[tag] = { type, count, at: count * (type === 3 ? 2 : 1) > 4 ? u32(e + 8) : e + 8 };
      }
      return tags;
    };
    const i0 = ifd(u32(4));
    out.orientation = i0[0x0112] || 1;
    out.make = (i0[0x010f] || "").trim() || null;
    const exif = i0[0x8769];
    if (exif == null) return out;
    const t = ifd(exif, raw);
    // Canon writes where it focused (MakerNote tag 0x26, AFInfo2): the focus
    // area sizes and positions from the sensor's centre, y counted upward.
    try {
      if (/^canon/i.test(out.make || "") && raw[0x927c]) {
        const mk = {};
        ifd(raw[0x927c].at, mk);
        const a = mk[0x26];
        if (a && a.type === 3 && a.count > 8) {
          const s16 = (j) => v.getInt16(base + a.at + 2 * j, le);
          const n = s16(2), valid = Math.max(1, s16(3)), afw = s16(6), afh = s16(7);
          const pts = [];
          for (let k = 0; k < Math.min(valid, n); k++) {
            const pw = s16(8 + k), ph = s16(8 + n + k);
            if (pw > 0 && ph > 0) pts.push({ w: pw, h: ph, x: s16(8 + 2 * n + k), y: s16(8 + 3 * n + k) });
          }
          if (afw > 0 && afh > 0 && pts.length) out.af = { w: afw, h: afh, pts };
        }
      }
    } catch {} // a short read or an odd maker note just means no focus data
    out.shutter = t[0x829a] ?? null;
    out.aperture = t[0x829d] ?? null;
    out.iso = t[0x8827] ?? null;
    const m = /^(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/.exec(t[0x9003] || "");
    if (m) {
      out.time = new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() / 1000;
      const sub = String(t[0x9291] || "").trim();
      if (/^\d+$/.test(sub)) out.time += +sub / 10 ** sub.length;
    }
    return out;
  }

  /* ── perceptual hash (as imagehash.phash) ────────────────── */
  const COS = (() => {
    const t = new Float64Array(32 * 32);
    for (let k = 0; k < 32; k++) for (let n = 0; n < 32; n++) t[k * 32 + n] = Math.cos((Math.PI * k * (2 * n + 1)) / 64);
    return t;
  })();
  function phash(g32) {
    // DCT down the columns, then along the rows; only the 8x8 low frequencies are needed
    const col = new Float64Array(8 * 32);
    for (let k = 0; k < 8; k++) for (let x = 0; x < 32; x++) {
      let s = 0;
      for (let y = 0; y < 32; y++) s += g32[y * 32 + x] * COS[k * 32 + y];
      col[k * 32 + x] = s;
    }
    const low = new Float64Array(64);
    for (let k = 0; k < 8; k++) for (let j = 0; j < 8; j++) {
      let s = 0;
      for (let x = 0; x < 32; x++) s += col[k * 32 + x] * COS[j * 32 + x];
      low[k * 8 + j] = s;
    }
    const sorted = [...low].sort((a, b) => a - b);
    const med = (sorted[31] + sorted[32]) / 2;
    let hi = 0, lo = 0;
    for (let i = 0; i < 64; i++) if (low[i] > med) { if (i < 32) hi |= 1 << (31 - i); else lo |= 1 << (63 - i); }
    return [hi >>> 0, lo >>> 0];
  }
  const pop = (x) => { x -= (x >>> 1) & 0x55555555; x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24; };
  const hamming = (a, b) => pop(a[0] ^ b[0]) + pop(a[1] ^ b[1]);

  /* ── structural similarity (for confirming a hash match) ── */
  // SSIM map with a 7x7 box window (skimage defaults), via summed-area tables.
  function ssimMap(a, b, w, h) {
    const W1 = w + 1, N = W1 * (h + 1);
    const sa = new Float64Array(N), sb = new Float64Array(N), saa = new Float64Array(N), sbb = new Float64Array(N), sab = new Float64Array(N);
    for (let y = 0; y < h; y++) {
      let ra = 0, rb = 0, raa = 0, rbb = 0, rab = 0;
      for (let x = 0; x < w; x++) {
        const va = a[y * w + x], vb = b[y * w + x];
        ra += va; rb += vb; raa += va * va; rbb += vb * vb; rab += va * vb;
        const i = (y + 1) * W1 + x + 1, up = y * W1 + x + 1;
        sa[i] = sa[up] + ra; sb[i] = sb[up] + rb; saa[i] = saa[up] + raa; sbb[i] = sbb[up] + rbb; sab[i] = sab[up] + rab;
      }
    }
    const box = (s, x0, y0, x1, y1) => s[y1 * W1 + x1] - s[y0 * W1 + x1] - s[y1 * W1 + x0] + s[y0 * W1 + x0];
    const C1 = (0.01 * 255) ** 2, C2 = (0.03 * 255) ** 2, NP = 49, cov = NP / (NP - 1);
    const map = new Float32Array(w * h).fill(NaN); // NaN = too near the edge for a full window
    for (let y = 3; y < h - 3; y++) for (let x = 3; x < w - 3; x++) {
      const x0 = x - 3, y0 = y - 3, x1 = x + 4, y1 = y + 4;
      const ma = box(sa, x0, y0, x1, y1) / NP, mb = box(sb, x0, y0, x1, y1) / NP;
      const va = cov * (box(saa, x0, y0, x1, y1) / NP - ma * ma);
      const vb = cov * (box(sbb, x0, y0, x1, y1) / NP - mb * mb);
      const vab = cov * (box(sab, x0, y0, x1, y1) / NP - ma * mb);
      map[y * w + x] = ((2 * ma * mb + C1) * (2 * vab + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
    }
    return map;
  }
  // Mean of the map overall and in each of the 4x4 regions.
  function regionMeans(map, w, h, grid = 4) {
    const sum = new Float64Array(grid * grid), n = new Float64Array(grid * grid);
    let all = 0, an = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = map[y * w + x];
      if (Number.isNaN(v)) continue;
      const r = Math.min(grid - 1, Math.floor((y * grid) / h)) * grid + Math.min(grid - 1, Math.floor((x * grid) / w));
      sum[r] += v; n[r]++; all += v; an++;
    }
    return { all: an ? all / an : 0, regions: [...sum].map((s, i) => (n[i] ? s / n[i] : 0)) };
  }
  // Mean absolute colour difference in each 4x4 region (0-255).
  function colorRegions(a, b, w, h, grid = 4) {
    const sum = new Float64Array(grid * grid), n = new Float64Array(grid * grid);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      const d = (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3;
      const r = Math.min(grid - 1, Math.floor((y * grid) / h)) * grid + Math.min(grid - 1, Math.floor((x * grid) / w));
      sum[r] += d; n[r]++;
    }
    return [...sum].map((s, i) => (n[i] ? s / n[i] : 0));
  }
  const sameShape = (A, B) => A.w === B.w && A.h === B.h;

  // Same picture (a copy, a re-export, a resized version): strict, as the original's pass 1.
  function isDuplicate(A, B) {
    if (!sameShape(A.small, B.small)) return false;
    const { w, h } = A.small;
    const s = regionMeans(ssimMap(A.small.gray, B.small.gray, w, h), w, h);
    if (s.all <= 0.95 || s.regions.some((r) => r < 0.90)) return false;
    return colorRegions(A.small.rgb, B.small.rgb, w, h).every((c) => c <= 12);
  }
  // Two frames of one burst: the camera may have moved a little, so try small
  // shifts and keep the best match. Looser than a duplicate on purpose; the
  // person sees the group side by side before anything is skipped.
  // Compared at half size, where a sub-pixel camera shake matters less.
  function isBurstMatch(A, B) {
    if (!sameShape(A.small, B.small)) return false;
    const { w: W0 } = A.small;
    const a = half(A.small), b = half(B.small);
    const { w, h } = a;
    const max = Math.max(2, Math.round(w * 0.04));
    let best = null;
    for (let dy = -max; dy <= max; dy++) for (let dx = -max; dx <= max; dx++) {
      const cw = w - Math.abs(dx), ch = h - Math.abs(dy);
      const ga = crop(a.gray, w, Math.max(0, dx), Math.max(0, dy), cw, ch);
      const gb = crop(b.gray, w, Math.max(0, -dx), Math.max(0, -dy), cw, ch);
      const s = regionMeans(ssimMap(ga, gb, cw, ch), cw, ch);
      if (!best || s.all > best.s.all) best = { s, dx, dy };
    }
    if (best.s.all < 0.75 || best.s.regions.some((r) => r < 0.5)) return false;
    const dx = best.dx * 2, dy = best.dy * 2, cw = W0 - Math.abs(dx), ch = A.small.h - Math.abs(dy);
    const ca = crop(A.small.rgb, W0, Math.max(0, dx), Math.max(0, dy), cw, ch, 3);
    const cb = crop(B.small.rgb, W0, Math.max(0, -dx), Math.max(0, -dy), cw, ch, 3);
    return colorRegions(ca, cb, cw, ch).every((c) => c <= 24);
  }
  function half({ w, h, gray }) {
    const hw = w >> 1, hh = h >> 1, g = new Uint8ClampedArray(hw * hh);
    for (let y = 0; y < hh; y++) for (let x = 0; x < hw; x++) {
      const i = 2 * y * w + 2 * x;
      g[y * hw + x] = (gray[i] + gray[i + 1] + gray[i + w] + gray[i + w + 1]) / 4;
    }
    return { w: hw, h: hh, gray: g };
  }
  function crop(src, w, x0, y0, cw, ch, chans = 1) {
    const out = new Uint8ClampedArray(cw * ch * chans);
    for (let y = 0; y < ch; y++) out.set(src.subarray(((y0 + y) * w + x0) * chans, ((y0 + y) * w + x0 + cw) * chans), y * cw * chans);
    return out;
  }

  /* ── reading one photo ───────────────────────────────────── */
  function canvasOf(w, h) {
    if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
    const c = document.createElement("canvas"); c.width = w; c.height = h; return c;
  }
  // Draw the bitmap at a size and return its pixels.
  function pixels(bmp, w, h) {
    const c = canvasOf(w, h);
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bmp, 0, 0, w, h);
    return { c, data: ctx.getImageData(0, 0, w, h).data };
  }
  const toGray = (d) => { const g = new Uint8ClampedArray(d.length / 4); for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; return g; };
  const toRgb = (d) => { const r = new Uint8ClampedArray((d.length / 4) * 3); for (let i = 0, j = 0; i < d.length; i += 4, j += 3) { r[j] = d[i]; r[j + 1] = d[i + 1]; r[j + 2] = d[i + 2]; } return r; };
  const fit = (w, h, edge) => { const s = Math.min(1, edge / Math.max(w, h)); return [Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))]; };
  async function scaledBitmap(bmp, edge) {
    const [w, h] = fit(bmp.width, bmp.height, edge);
    try { return await createImageBitmap(bmp, { resizeWidth: w, resizeHeight: h, resizeQuality: "high" }); }
    catch { return bmp; } // older Safari: let drawImage do the scaling
  }

  async function analyzePhoto(file) {
    let full;
    try { full = await createImageBitmap(playableBlob(file), { imageOrientation: "from-image" }); }
    catch { return null; } // HEIC in most browsers, RAW files: can't be checked here
    try {
      const big = await scaledBitmap(full, ANALYZE_EDGE);
      const [w, h] = fit(full.width, full.height, ANALYZE_EDGE);
      const { data } = pixels(big, w, h);
      const g = toGray(data);
      const sharp = sharpness(g, w, h);
      const { exposure, contrast, brightRatio, mean } = exposureAndContrast(g);
      const clip = clipping(data);
      const exif = await readExif(file);
      const focusMean = focusBrightness(g, w, h, exif.af, exif.orientation);
      const ex = exifScore(exif);
      const blurAt = exif.aperture != null && exif.aperture <= SHALLOW_DOF_APERTURE ? BLUR_THRESHOLD_SHALLOW_DOF : BLUR_THRESHOLD;
      const focusUncertain = sharp.robust < blurAt && blurAt <= sharp.peak;
      // A washed-out frame also measures as soft, so overexposure is checked
      // first here (the original checks blur first) to give the truer reason.
      let reason = null;
      if (brightRatio > BRIGHT_RATIO || clip.blown >= BLOWN_SKIP) reason = "overexposed";
      else if (sharp.robust < blurAt && !focusUncertain) reason = "blurry";
      // dark is never an automatic reject: indoor and arena photos are dark
      const score = qualityScore(sharp.robust, exposure, contrast, ex);
      let tier = reason || score < 25 ? "unacceptable" : score < 50 ? "marginal" : "good";
      if (focusUncertain && !reason) tier = "marginal";
      // softer exposure warnings: a Maybe, never a Skip on their own
      let exposureFlag = null;
      if (!reason && clip.blown >= BLOWN_MAYBE) exposureFlag = "bright";
      else if (!reason && (focusMean != null ? focusMean < FOCUS_DARK : clip.crushed >= CRUSHED_DARK || clip.dark >= DARK_SHARE_DARK)) exposureFlag = "dark";

      const [sw, sh] = fit(w, h, 192);
      const sm = pixels(big, sw, sh);
      const g32 = toGray(pixels(big, 32, 32).data);
      const [tw, th] = fit(w, h, 320);
      const thumbCanvas = pixels(big, tw, th).c;
      const blob = thumbCanvas.convertToBlob ? await thumbCanvas.convertToBlob({ type: "image/jpeg", quality: 0.8 })
        : await new Promise((ok) => thumbCanvas.toBlob(ok, "image/jpeg", 0.8));
      if (big !== full) big.close?.();
      return {
        score: round(score), tier, reason, focusUncertain, exposureFlag,
        sharpness: round(sharp.robust), exposure: round(exposure), contrast: round(contrast),
        blown: clip.blown, crushed: clip.crushed, brightness: mean, focusBrightness: focusMean,
        iso: exif.iso, shutter: exif.shutter, aperture: exif.aperture, time: exif.time,
        w: full.width, h: full.height,
        thumb: blob ? URL.createObjectURL(blob) : null,
        hash: phash(g32),
        small: { w: sw, h: sh, gray: toGray(sm.data), rgb: toRgb(sm.data) },
      };
    } finally {
      full.close?.();
    }
  }
  const round = (v) => Math.round(v * 10) / 10;

  // A fingerprint that is the same only for identical files. Big videos are
  // sampled (start, middle, end and the size) so this stays quick.
  async function fingerprint(file) {
    const MB = 1024 * 1024;
    const parts = file.size <= 6 * MB ? [file]
      : [file.slice(0, 2 * MB), file.slice(file.size / 2 - MB, file.size / 2 + MB), file.slice(file.size - 2 * MB)];
    const buf = await new Blob([String(file.size), ...parts]).arrayBuffer();
    if (!crypto.subtle) return `${file.size}:${file.name}`; // not a secure context; fall back to size + name
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", buf));
    return [...hash].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  /* ── the whole batch ─────────────────────────────────────── */
  // files: File[]; opts.existing: [{ name, size }] already in the target gallery
  // (organizers only: a guest must not learn what a gallery holds);
  // opts.progress(done, total, label); opts.signal: AbortSignal.
  async function analyze(files, opts = {}) {
    const progress = opts.progress || (() => {});
    const yieldNow = () => new Promise((ok) => setTimeout(ok));
    const entries = files.map((file, i) => ({
      id: i, file, kind: kindOf(file), size: file.size, name: file.name,
      decision: "keep", reason: null, note: null, a: null, group: null,
    }));
    const existing = new Set((opts.existing || []).map((e) => `${(e.name || "").toLowerCase()}|${e.size}`));
    const total = entries.length * 2;
    let done = 0;

    // 1. already uploaded, and exact copies inside this batch
    const seen = new Map();
    for (const e of entries) {
      if (opts.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      if (existing.has(`${e.name.toLowerCase()}|${e.size}`)) { e.decision = "reject"; e.reason = "already"; }
      else {
        const fp = await fingerprint(e.file);
        const first = seen.get(fp);
        if (first) { e.decision = "reject"; e.reason = "copy"; e.copyOf = first.id; }
        else seen.set(fp, e);
      }
      progress(++done, total, "Looking for copies");
      if (done % 8 === 0) await yieldNow();
    }

    // 2. score each photo
    for (const e of entries) {
      if (opts.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      if (e.kind === "image" && !e.reason) {
        e.a = await analyzePhoto(e.file);
        if (!e.a) e.note = "Can't be checked in a browser, kept as is";
      } else if (e.kind === "video" && !e.reason) {
        e.note = "Videos aren't checked";
      }
      progress(++done, total, "Checking photos");
      await yieldNow();
    }

    // 3. near-duplicates and bursts among the photos that scored
    const photos = entries.filter((e) => e.a && !e.a.reason);
    const pairs = [];
    for (let i = 0; i < photos.length; i++) for (let j = i + 1; j < photos.length; j++) {
      const A = photos[i], B = photos[j];
      const d = hamming(A.a.hash, B.a.hash);
      if (d <= 5 && isDuplicate(A.a, B.a)) { pairs.push([A, B, "duplicate"]); continue; }
      const close = A.a.time != null && B.a.time != null && Math.abs(A.a.time - B.a.time) <= BURST_WINDOW;
      if (d <= 20 && close && isBurstMatch(A.a, B.a)) pairs.push([A, B, "similar"]);
    }
    const groups = groupAroundBest(photos, pairs);

    // 4. a suggestion for everything still undecided
    for (const e of entries) {
      if (e.reason || !e.a) continue;
      if (e.a.reason) { e.decision = "reject"; e.reason = e.a.reason; }
      else if (e.a.tier === "good") {
        e.decision = e.a.exposureFlag ? "maybe" : "keep";
        e.reason = e.a.exposureFlag;
      }
      else if (e.a.tier === "marginal") { e.decision = "maybe"; e.reason = e.a.focusUncertain ? "focus" : e.a.exposureFlag || "low"; }
      else { e.decision = "reject"; e.reason = "low"; }
    }
    for (const g of groups) for (const m of g.members) {
      m.group = g;
      if (m !== g.best) { m.decision = "reject"; m.reason = m.groupKind; }
    }
    for (const e of entries) e.suggested = e.decision;
    return { entries, groups };
  }

  // Each group is built around its best photo. A photo joins only if it
  // matched the best one directly (no chains of "similar to similar"), and a
  // burst can't stretch past the time window. From the original's _select_groups.
  function groupAroundBest(photos, pairs) {
    const key = (e) => [e.a.score, e.size];
    const better = (x, y) => { const a = key(x), b = key(y); return a[0] - b[0] || a[1] - b[1] || (y.id - x.id); };
    const nb = new Map(photos.map((p) => [p, new Map()]));
    for (const [a, b, kind] of pairs) { nb.get(a).set(b, kind); nb.get(b).set(a, kind); }
    const assigned = new Set(), groups = [];
    for (const best of [...photos].sort((x, y) => better(y, x))) {
      if (assigned.has(best)) continue;
      assigned.add(best);
      const members = [best];
      let times = best.a.time != null ? [best.a.time] : [];
      for (const m of [...nb.get(best).keys()].sort((x, y) => better(y, x))) {
        if (assigned.has(m)) continue;
        const kind = nb.get(best).get(m);
        if (kind === "similar" && m.a.time != null) {
          const t = [...times, m.a.time];
          if (Math.max(...t) - Math.min(...t) > BURST_WINDOW) continue;
          times = t;
        }
        assigned.add(m);
        m.groupKind = kind;
        members.push(m);
      }
      if (members.length > 1) {
        const kinds = new Set(members.slice(1).map((m) => m.groupKind));
        groups.push({ best, members, kind: kinds.size > 1 ? "mixed" : [...kinds][0] });
      }
    }
    return groups;
  }

  /* ── the review screen ───────────────────────────────────── */
  const REASON = {
    blurry: "Blurry", overexposed: "Overexposed", low: "Low quality", focus: "Focus unsure",
    duplicate: "Duplicate of a better copy", similar: "Similar to a better shot",
    copy: "Exact copy of another file", already: "Already in this gallery",
    bright: "Bright, highlights may be blown", dark: "Dark, may be underexposed",
  };
  const LABEL = { keep: "Keep", maybe: "Maybe", reject: "Skip" };
  const KEYS = { k: "keep", m: "maybe", r: "reject", x: "reject" };

  function review(files, opts = {}) {
    const A = window.App;
    const esc = A.esc;
    const fmtBytes = (b) => (b >= 1e9 ? (b / 1e9).toFixed(1) + " GB" : b >= 1e6 ? (b / 1e6).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1e3)) + " KB");
    const root = document.createElement("div");
    root.className = "cull";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "Review before uploading");
    document.body.append(root);
    document.body.classList.add("lb-open");
    const prevFocus = document.activeElement;
    const ctl = new AbortController();
    const urls = [];
    let result = null, filter = "all", focus = 0, includeMaybe = true;

    return new Promise((resolve) => {
      const finish = (value) => {
        ctl.abort();
        document.removeEventListener("keydown", onKey, true);
        root.remove();
        document.body.classList.remove("lb-open");
        urls.forEach((u) => URL.revokeObjectURL(u));
        prevFocus?.focus?.();
        resolve(value);
      };

      root.innerHTML = `
        <div class="cull-top">
          <h2>Checking ${A.plural(files.length, "file")}</h2>
          <button class="cull-x" data-act="cancel" aria-label="Cancel">${A.icon.close}</button>
        </div>
        <div class="cull-progress">
          <p id="cull-step">Starting</p>
          <div class="cull-bar"><i id="cull-fill"></i></div>
          <p class="cull-hint">This runs on your device. Nothing is uploaded until you choose what to keep.</p>
          <button class="btn" data-act="skip">Skip the check and upload everything</button>
        </div>`;
      root.querySelector("[data-act=cancel]").focus();
      root.addEventListener("click", (ev) => {
        const act = ev.target.closest("[data-act]")?.dataset.act;
        if (act === "cancel") finish(null);
        else if (act === "skip") finish(files);
      });
      const onKey = (ev) => {
        if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); finish(null); return; }
        if (!result || ev.target.closest?.("input, select, textarea")) return;
        const list = visible();
        if (KEYS[ev.key.toLowerCase()] && list[focus]) { ev.preventDefault(); decide([list[focus]], KEYS[ev.key.toLowerCase()]); move(1); }
        else if (ev.key === "ArrowRight") { ev.preventDefault(); move(1); }
        else if (ev.key === "ArrowLeft") { ev.preventDefault(); move(-1); }
        else if (ev.key === "ArrowDown" || ev.key === "ArrowUp") { ev.preventDefault(); move((ev.key === "ArrowDown" ? 1 : -1) * perRow()); }
      };
      document.addEventListener("keydown", onKey, true);

      analyze(files, {
        existing: opts.existing,
        signal: ctl.signal,
        progress: (d, t, label) => {
          const fill = root.querySelector("#cull-fill"), step = root.querySelector("#cull-step");
          if (fill) fill.style.width = `${(d / t) * 100}%`;
          if (step) step.textContent = `${label}…`;
        },
      }).then((r) => {
        result = r;
        r.entries.forEach((e) => e.a?.thumb && urls.push(e.a.thumb));
        paint();
      }).catch((err) => {
        if (err.name !== "AbortError") { A.toast("The check failed, so nothing was skipped"); finish(files); }
      });

      const counts = () => {
        const c = { keep: 0, maybe: 0, reject: 0, groups: result.groups.length, all: result.entries.length };
        for (const e of result.entries) c[e.decision]++;
        return c;
      };
      const chosen = () => result.entries.filter((e) => e.decision === "keep" || (includeMaybe && e.decision === "maybe"));
      const visible = () => {
        if (filter === "groups") return result.groups.flatMap((g) => g.members);
        return filter === "all" ? result.entries : result.entries.filter((e) => e.decision === filter);
      };
      const perRow = () => {
        const tiles = root.querySelectorAll(".cull-tile");
        if (tiles.length < 2) return 1;
        const top = tiles[0].offsetTop;
        let n = 0;
        for (const t of tiles) { if (t.offsetTop !== top) break; n++; }
        return n || 1;
      };
      function move(by) {
        const list = visible();
        if (!list.length) return;
        focus = clamp(focus + by, 0, list.length - 1);
        paintGrid();
      }
      function decide(list, d) {
        for (const e of list) e.decision = d;
        paintSummary(); paintGrid();
      }

      function thumbHtml(e) {
        const pic = e.a?.thumb || (e.copyOf != null && result.entries[e.copyOf].a?.thumb); // a copy shows its original
        if (pic) return `<img src="${pic}" alt="" loading="lazy">`;
        const ext = (extOf(e.name) || (e.kind === "video" ? "video" : "file")).toUpperCase();
        return `<span class="cull-ph">${e.kind === "video" ? "▶ " : ""}${esc(ext)}</span>`;
      }
      function tileHtml(e, i) {
        return `<button class="cull-tile d-${e.decision}${i === focus ? " focus" : ""}" data-i="${i}" aria-pressed="${e.decision !== "reject"}"
            aria-label="${esc(e.name)}: ${LABEL[e.decision]}${e.reason ? ", " + esc(REASON[e.reason]) : ""}">
          ${thumbHtml(e)}
          <span class="cull-badge">${LABEL[e.decision]}</span>
          ${e.group && e.group.best === e ? `<span class="cull-best">Best of ${e.group.members.length}</span>` : ""}
          <span class="cull-cap">${e.reason ? esc(REASON[e.reason]) : e.a ? `Score ${Math.round(e.a.score)}` : esc(e.note || "")}</span>
        </button>`;
      }

      function paint() {
        root.innerHTML = `
          <div class="cull-top">
            <h2>Review before uploading</h2>
            <p class="cull-sum" id="cull-sum"></p>
            <button class="cull-x" data-act="cancel" aria-label="Cancel">${A.icon.close}</button>
          </div>
          <div class="cull-bar2">
            <div class="cull-tabs" role="tablist" id="cull-tabs"></div>
            <div class="cull-bulk">
              <span class="cull-keys">Keys: <kbd>K</kbd> keep <kbd>M</kbd> maybe <kbd>R</kbd> skip</span>
              <button class="btn" data-bulk="keep">Keep all shown</button>
              <button class="btn" data-bulk="reject">Skip all shown</button>
              <button class="btn" data-bulk="reset">Back to suggestions</button>
            </div>
          </div>
          <div class="cull-body">
            <div class="cull-grid" id="cull-grid"></div>
            <aside class="cull-side" id="cull-side"></aside>
          </div>
          <div class="cull-foot">
            <label class="cull-maybe"><input type="checkbox" id="cull-maybe" ${includeMaybe ? "checked" : ""}> Upload Maybe too</label>
            <span class="cull-spacer"></span>
            <button class="btn" data-act="cancel">Cancel</button>
            <button class="btn btn-primary" data-act="upload" id="cull-go"></button>
          </div>`;
        root.querySelector("#cull-maybe").onchange = (ev) => { includeMaybe = ev.target.checked; paintSummary(); };
        root.querySelector("#cull-go").onclick = () => finish(chosen().map((e) => e.file));
        root.querySelector("#cull-tabs").onclick = (ev) => {
          const t = ev.target.closest("[data-f]");
          if (!t) return;
          filter = t.dataset.f; focus = 0;
          paintSummary(); paintGrid();
        };
        root.querySelector(".cull-bulk").onclick = (ev) => {
          const b = ev.target.closest("[data-bulk]")?.dataset.bulk;
          if (!b) return;
          const list = visible();
          if (b === "reset") { for (const e of list) e.decision = e.suggested; paintSummary(); paintGrid(); }
          else decide(list, b);
        };
        root.querySelector("#cull-grid").onclick = (ev) => {
          const t = ev.target.closest(".cull-tile");
          if (!t) return;
          const i = +t.dataset.i;
          const e = visible()[i];
          if (i === focus) {
            // a second click on the focused tile flips keep <-> skip
            decide([e], e.decision === "reject" ? "keep" : "reject");
          } else { focus = i; paintGrid(); }
        };
        root.querySelector("#cull-side").onclick = (ev) => {
          const d = ev.target.closest("[data-set]")?.dataset.set;
          const e = visible()[focus];
          if (d && e) decide([e], d);
          const j = ev.target.closest("[data-jump]")?.dataset.jump;
          if (j != null) { const k = visible().indexOf(result.entries[+j]); if (k >= 0) { focus = k; paintGrid(); } }
        };
        paintSummary(); paintGrid();
        root.querySelector("#cull-go").focus();
      }

      function paintSummary() {
        const c = counts();
        const up = chosen();
        const upBytes = up.reduce((s, e) => s + e.size, 0);
        const all = result.entries.reduce((s, e) => s + e.size, 0);
        root.querySelector("#cull-sum").textContent =
          `Uploading ${A.plural(up.length, "file")} (${fmtBytes(upBytes)}). Skipping ${A.plural(result.entries.length - up.length, "file")}, which saves ${fmtBytes(all - upBytes)}.`;
        root.querySelector("#cull-go").textContent = up.length ? `Upload ${A.plural(up.length, "file")}` : "Nothing to upload";
        root.querySelector("#cull-go").disabled = !up.length;
        const tabs = [["all", "All"], ["keep", "Keep"], ["maybe", "Maybe"], ["reject", "Skip"], ["groups", "Similar groups"]];
        root.querySelector("#cull-tabs").innerHTML = tabs
          .filter(([f]) => f !== "groups" || c.groups)
          .map(([f, label]) => `<button role="tab" data-f="${f}" aria-selected="${filter === f}">${label} <b>${c[f]}</b></button>`).join("");
      }

      function paintGrid() {
        const list = visible();
        const grid = root.querySelector("#cull-grid");
        if (filter === "groups") {
          let i = 0;
          grid.innerHTML = result.groups.map((g) => `
            <section class="cull-group">
              <h3>${{ duplicate: "Duplicates", similar: "Similar shots", mixed: "Duplicates and similar shots" }[g.kind]}: ${g.members.length} photos, best kept</h3>
              <div class="cull-row">${g.members.map((e) => tileHtml(e, i++)).join("")}</div>
            </section>`).join("");
        } else {
          grid.innerHTML = list.length ? `<div class="cull-row">${list.map(tileHtml).join("")}</div>` : `<p class="cull-empty">Nothing here.</p>`;
        }
        grid.querySelector(".cull-tile.focus")?.scrollIntoView({ block: "nearest" });
        paintSide(list[focus]);
      }

      function paintSide(e) {
        const side = root.querySelector("#cull-side");
        if (!e) { side.innerHTML = ""; return; }
        const a = e.a;
        const row = (k, v) => (v == null || v === "" ? "" : `<dt>${k}</dt><dd>${v}</dd>`);
        const shutter = a?.shutter ? (a.shutter >= 1 ? `${a.shutter}s` : `1/${Math.round(1 / a.shutter)}s`) : null;
        side.innerHTML = `
          <div class="cull-big">${thumbHtml(e)}</div>
          <h3 title="${esc(e.name)}">${esc(e.name)}</h3>
          <div class="cull-seg" role="group" aria-label="Decision">
            ${["keep", "maybe", "reject"].map((d) => `<button data-set="${d}" aria-pressed="${e.decision === d}">${LABEL[d]}</button>`).join("")}
          </div>
          <p class="cull-why">${e.reason ? esc(REASON[e.reason]) : e.note ? esc(e.note) : "Looks fine"}${e.suggested !== e.decision ? ` · suggested ${LABEL[e.suggested]}` : ""}</p>
          <dl>
            ${row("Size", fmtBytes(e.size))}
            ${a ? row("Quality", `${Math.round(a.score)} / 100`) + row("Sharpness", Math.round(a.sharpness)) + row("Exposure", `${Math.round(a.exposure)}%`) + row("Contrast", `${Math.round(a.contrast)}%`) + row("Blown highlights", `${Math.round(a.blown * 100)}%`) + row(a.focusBrightness != null ? "Brightness at focus" : "Brightness", `${Math.round(a.focusBrightness ?? a.brightness)} / 255`) : ""}
            ${a ? row("ISO", a.iso) + row("Shutter", shutter) + row("Aperture", a.aperture ? `f/${round(a.aperture)}` : null) + row("Pixels", `${a.w} × ${a.h}`) : ""}
          </dl>
          ${e.group ? `<p class="cull-grp">In a group of ${e.group.members.length}. ${e.group.best === e ? "This is the best one." : `<button class="linkish" data-jump="${e.group.best.id}">Show the best one</button>`}</p>` : ""}
          ${e.copyOf != null ? `<p class="cull-grp">Same file as <button class="linkish" data-jump="${e.copyOf}">${esc(result.entries[e.copyOf].name)}</button></p>` : ""}`;
      }
    });
  }

  window.Cull = { kindOf, ACCEPT, playableBlob, analyze, review, extOf, _test: { isDuplicate, isBurstMatch, hamming } };
})();
