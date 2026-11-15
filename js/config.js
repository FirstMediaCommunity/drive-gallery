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
  // The top bar uses your brand color, so a logo that reads well on it works best.
  logo: "assets/logo.svg",
  logoText: "FMC",                      // 1–4 letters for the badge ("" = initials of siteTitle)

  // Browser-tab icon: path to a square image, or "" to use the badge.
  favicon: "",

  // Links shown in the top bar, e.g. your main website. [] for none.
  links: [
    // { label: "Website", url: "https://example.org" },
  ],

  // ── 2. Your colors ─────────────────────────────────────────
  // Any CSS color works. Text on top of these switches between black
  // and white automatically so it stays readable.
  theme: {
    brand: "#17001c",      // top bar and main buttons
    accent: "#f85259",     // highlights, hover states, selected things
    highlight: "#a335e6",  // small details (active photo, cover badge)
    defaultMode: "light",  // "light" or "dark" (visitors can switch)

    // OPTIONAL — page colors for each mode. Delete either block (or any
    // line in it) to fall back to the built-in neutral grays.
    light: {
      background: "#f8f0f0",   // page background
      surface: "#ffffff",      // cards, buttons, inputs
      border: "#ead9dc",       // thin lines
      text: "#17001c",         // main text
      muted: "#5c4a60",        // secondary text
    },
    dark: {
      background: "#09040d",
      surface: "#1f0b27",
      border: "#3a1d45",
      text: "#f9f0fb",
      muted: "#c9b8cf",
    },

    // OPTIONAL — fonts. Leave all three "" to use the visitor's system font.
    // fontUrl is a Google Fonts stylesheet link that loads the two families.
    font: "Nunito",
    headingFont: "Dela Gothic One",
    fontUrl: "https://fonts.googleapis.com/css2?family=Dela+Gothic+One&family=Nunito:wght@400;600;700&display=swap",
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
