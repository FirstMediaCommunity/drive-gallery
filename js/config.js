/*
 * ─────────────────────────────────────────────────────────────
 *  GALLERY CONFIG — this is the only file you need to edit.
 * ─────────────────────────────────────────────────────────────
 *  Leave googleApiKey / rootFolderId empty to run in DEMO MODE
 *  (placeholder photos, no Google account needed).
 *  See README.md for the 5-minute setup.
 */
window.GALLERY_CONFIG = {
  // ── Branding ───────────────────────────────────────────────
  siteTitle: "Pearadox 5414",
  tagline: "Team photo library",
  logo: "assets/logo.svg",          // path or URL to a logo image ("" = text only)

  // Links shown in the top bar (add, remove, or leave empty)
  links: [
    { label: "Portal", url: "https://portal.pearadox5414.org/dashboard" },
  ],

  // ── Google Drive ───────────────────────────────────────────
  // API key from Google Cloud Console with the "Google Drive API" enabled.
  // It is safe to commit IF you restrict it to your website (see README).
  googleApiKey: "",

  // The ID of the Drive folder that holds everything. It's the last part
  // of the folder URL: https://drive.google.com/drive/folders/<THIS_PART>
  // The folder must be shared as "Anyone with the link → Viewer".
  rootFolderId: "",

  // ── Look & feel ────────────────────────────────────────────
  theme: {
    brand: "#3d5b25",      // top bar + buttons
    accent: "#5abf34",     // highlights, hover states
    highlight: "#e2a215",  // small details (active photo, badges)
    defaultMode: "light",  // "light" or "dark" (visitors can toggle)
  },

  rowHeight: 260,          // target height of photo rows on desktop, in px
  lightboxSize: 2000,      // longest edge (px) loaded in the full-screen viewer
  slideshowSeconds: 4,
  allowDownloads: true,    // show download buttons
  showDriveLink: true,     // show an "Open in Drive" button on each gallery
  cacheMinutes: 10,        // how long folder listings are cached per visitor

  // Footer credit. Point this at your fork, or set to "" to hide it.
  repoUrl: "https://github.com/the0nknowndj/drive-gallery",
};
