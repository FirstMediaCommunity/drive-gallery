/*
 * ─────────────────────────────────────────────────────────────
 *  GALLERY CONFIG — make the site yours by editing this one file.
 * ─────────────────────────────────────────────────────────────
 *  Everything a visitor sees that says who you are — name, logo,
 *  colors, links — comes from here. No other file mentions it.
 *
 *  Leave googleApiKey / rootFolderId empty to run in DEMO MODE
 *  (placeholder photos, no Google account needed).
 */
window.GALLERY_CONFIG = {
  // ── 1. Who you are ─────────────────────────────────────────
  siteTitle: "FIRST Media Community",   // shown in the top bar, the home page and the browser tab
  tagline: "Photo & video library",     // small text next to the title ("" to hide)

  // Your logo: put an image in the assets/ folder and name it here,
  // e.g. "assets/logo.png". Leave "" and the site draws a badge from
  // logoText in your brand color instead (also used as the tab icon).
  logo: "",
  logoText: "FMC",                      // 1–4 letters for the badge ("" = initials of siteTitle)

  // Links shown in the top bar, e.g. your main website. [] for none.
  links: [
    // { label: "Website", url: "https://example.org" },
  ],

  // ── 2. Your colors ─────────────────────────────────────────
  // Any CSS color works. Text on top of these switches between black
  // and white automatically so it stays readable.
  theme: {
    brand: "#1f2a44",      // top bar and main buttons
    accent: "#3b82f6",     // highlights, hover states, selected things
    highlight: "#f59e0b",  // small details (active photo, cover badge)
    defaultMode: "light",  // "light" or "dark" (visitors can switch)
  },

  // ── 3. Your photos (Google Drive) ──────────────────────────
  // API key from Google Cloud Console with the "Google Drive API" enabled.
  // It is safe to commit IF you restrict it to your website (see README).
  googleApiKey: "",

  // The ID of the Drive folder that holds everything. It's the last part
  // of the folder URL: https://drive.google.com/drive/folders/<THIS_PART>
  // The folder must be shared as "Anyone with the link → Viewer".
  rootFolderId: "",

  // ── 4. Fine-tuning (safe to leave alone) ───────────────────
  rowHeight: 260,          // target height of photo rows on desktop, in px
  lightboxSize: 2000,      // longest edge (px) loaded in the full-screen viewer
  slideshowSeconds: 4,
  allowDownloads: true,    // show download buttons
  showDriveLink: true,     // show an "Open in Drive" button on each gallery
  cacheMinutes: 10,        // how long folder listings are cached per visitor

  // Footer credit link. Point it at your own copy, or "" to hide it.
  repoUrl: "https://github.com/FirstMediaCommunity/drive-gallery",
};
