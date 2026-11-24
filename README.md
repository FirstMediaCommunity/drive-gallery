# Drive Gallery

A clean, SmugMug / Pixieset-style photo and video gallery that runs on **Google Drive + any free static host** (GitHub Pages, Netlify, Cloudflare Pages…).

Your photos stay in Google Drive. The website just reads the folder and shows it nicely — upload to Drive and the site updates itself.

- **Folders are galleries.** Nest them however you like (`2026 Season / District Event / …`).
- **Cover-image headers**, folder tiles, and an edge-to-edge justified photo grid.
- **Full-screen viewer** with keyboard arrows, swipe, filmstrip, slideshow, photo info (camera, lens, settings), share links and downloads.
- **Videos** play right in the viewer.
- **Filter, sort, light/dark mode**, and it works on phones.
- **Organize screen** *(preview)* — a SmugMug-style backend for people with the right permission: create galleries and folders, drag to reorder or move, set covers, choose who can see what, and make access links.
- **Library and tags** *(preview)* — every photo and video in one searchable place, whatever gallery it is in. Tag files in bulk, click a tag to see everything that carries it, and let upload links tag whatever comes in through them.
- **Public / Unlisted / Internal** visibility per gallery, and per photo *(preview)*.
- **Check before upload.** Pick a batch of photos and the site checks them on your device first: blurry or overexposed shots, exact copies, re-exported duplicates and near-identical burst frames are marked to skip, and the best shot of each group is kept. You see every suggestion, change any of them (<kbd>K</kbd> keep, <kbd>M</kbd> maybe, <kbd>R</kbd> skip), and only what you keep is uploaded. Based on [FYF Photo Culler](https://github.com/fikretyukselit/fyf-photo-culler) (MIT).
- **Camera formats browsers don't know.** Insta360 `.insv` and `.insp`, GoPro `.lrv` and `.360`, `.mts`, RAW photos (`.cr3`, `.nef`, `.arw`, `.dng`…) and HEIC upload as the original file. If the browser can play one it is shown normally; otherwise it gets a placeholder.
- **No build step, no frameworks.** A handful of small JavaScript files you can read in one sitting.

Built by the FIRST Media Community. Free for any team, club, school or family to copy.

**Live demo:** <https://firstmediacommunity.github.io/drive-gallery/>

## Demo accounts

Click **Log in** in the demo's top bar and use one of these:

| Who | Username | Password | Sees |
| --- | --- | --- | --- |
| Team member | `member` | `member-demo-pass` | Public and Internal galleries |
| Organizer | `organizer` | `organizer-demo-pass` | Everything, plus the **Organize** screen |

Don't log in at all to see what the public sees. These logins are for trying the demo only — see [What to try](#what-to-try) below.

---

## Make it yours

All branding lives in one file, [`js/config.js`](js/config.js). Nothing else in the project mentions a name, logo or color.

| To change | Edit in `js/config.js` |
| --- | --- |
| Site name and tagline | `siteTitle`, `tagline` |
| Logo | Drop an image in `assets/` and set `logo: "assets/logo.png"`. It sits on the brand-colored top bar, so pick a version that reads well there. |
| Browser-tab icon | `favicon` (a square image), or leave `""` for a badge drawn from `logoText` in your brand color |
| Brand colors | `theme.brand`, `theme.accent`, `theme.highlight` — text on top of them turns black or white automatically |
| Page colors | `theme.light` and `theme.dark` (background, surface, border, text, muted) — optional; delete them for neutral grays |
| Fonts | `theme.font`, `theme.headingFont`, `theme.fontUrl` (a Google Fonts link) — optional; leave `""` for the system font |
| Light or dark by default | `theme.defaultMode` |
| Top-bar links | `links` |
| Footer credit link | `repoUrl` (or `""` to hide) |

Save the file and refresh the page — that's the whole rebrand.

---

## Try it in 30 seconds

Download or clone this repo and open it with any static server. With no Drive folder configured it runs in **demo mode** with placeholder photos.

**Windows** (nothing to install):

```bash
powershell -ExecutionPolicy Bypass -File serve.ps1
```

**Mac / Linux / anyone with Python:**

```bash
python3 -m http.server 4173
```

Then open <http://localhost:4173>.

### What to try

Demo mode has three kinds of visitor so you can see what each one gets. The logins are in [Demo accounts](#demo-accounts) at the top of this page.

| Who | Sees |
| --- | --- |
| Public visitor *(not logged in)* | Public galleries, plus photos pinned "Always public" |
| Team member | Public and Internal galleries (Unlisted ones only by link, like everyone else) |
| Organizer | Everything, plus the **Organize** screen |

Things to try as the organizer: create a gallery, drag photos to reorder them, drag a gallery onto a folder in the sidebar, set a gallery to Internal and then log out to watch it disappear, pin one photo in an internal gallery as "Always public", and create an access link under **Share**.

**Library and tags.** Next to Organize there is a **Library** tab, modelled on SmugMug's: every file on the site in one grid, grouped by month.

- **Find things:** search names, captions, tags and gallery names; filter by photo or video, gallery, visibility and month; or click tags in the sidebar (click two to see files that have both).
- **Tag in bulk:** select files, press **Tags**, and click tags on or off for the whole selection. **Untagged** in the sidebar shows what still needs sorting.
- **Keep the tag list tidy:** tags live in groups (the demo has Category, Event and Subject). **Manage** adds, groups and deletes them.
- **Tag pages:** in the viewer's info panel every tag is a link. It opens a page with everything a visitor is allowed to see that carries that tag, from every gallery.
- **Upload links that tag for you:** when creating an upload link, pick the tags it should apply. Everything uploaded through it arrives tagged. The demo's District Event gallery has one ready under Share.

A gallery is where a file lives; tags are how you find it again. One photo sits in one gallery but can carry any number of tags.

**Gallery settings** (select a gallery → Settings) follow SmugMug's tabs:

| Tab | Settings |
| --- | --- |
| Basics | Name, description, meta keywords, feature image |
| Security & Sharing | Visibility (Public / Unlisted / Internal), Access (Anyone / People with password) with password + hint, web searchable, view links, guest upload links |
| Photo Protection | Maximum display size, allow downloads |
| Social | Show sharing options |
| Appearance | Gallery style (SmugMug, Thumbnails, Collage Landscape, Collage Portrait, Journal), cover image, square thumbnails, sort by + direction, show camera info, show filenames, slideshow |

**Two kinds of link**, both under Share and under Settings → Security & Sharing:

- **View link** — lets someone without an account (a parent, a sponsor) see one gallery, even an Internal one. Optional password and expiry; turn it off any time.
- **Upload link** — lets someone add photos and videos to one gallery without logging in. It does not let them view it. It can carry tags that are put on everything uploaded through it.

Not copied from SmugMug: selling/shopping cart, comments, map features and "hide owner", which don't apply here.

**Check before upload.** In Organize, open a gallery and press **Upload**, then drag files into the box or click it to choose them. You can also drop files straight onto the gallery. With two or more photos (or through the District Event upload link) the check opens first. The check runs in the browser and nothing is sent until you press **Upload**. It looks at each photo's sharpness in nine regions (so a sharp subject on a soft background isn't thrown out), exposure (arena-dark backgrounds aren't penalised), contrast, and ISO and shutter speed when the file has them. It groups duplicates and burst frames taken within two seconds of each other. Organizers are also told about files already in the gallery; guests through an upload link are not, because an upload link never shows what a gallery holds. Videos and formats the browser can't open are checked only for exact copies.

Changes you make are saved in your own browser only. **Reset demo** in the Organize toolbar puts everything back.

> **These logins are a demonstration, not security.** They run in the browser, so anyone technical can get around them — which is fine, because the demo only contains placeholder photos. To protect real photos, the login and the permission checks must run on a server. [docs/BACKEND.md](docs/BACKEND.md) explains exactly what to replace and how.

---

## Set it up with your own photos

You need a Google account and about 10 minutes. Everything you change lives in one file: [`js/config.js`](js/config.js).

### 1. Get your own copy

Click **Use this template** (or **Fork**) at the top of this repo.

### 2. Make a Drive folder and share it

1. In Google Drive, create a folder for the gallery (e.g. `Team Photos`) and put your galleries inside it as sub-folders.
2. Right-click the folder → **Share** → under *General access* choose **Anyone with the link** → **Viewer**.
3. Open the folder and copy the ID from the address bar — the part after `/folders/`:
   `https://drive.google.com/drive/folders/`**`1AbCdEfGhIjKlMnOpQrStUvWxYz`**

> **Heads up:** "Anyone with the link" means anyone who finds your website can see these photos. If you need the gallery to be members-only, see [Logins, private galleries and the Organize screen](#logins-private-galleries-and-the-organize-screen).

### 3. Get a Google API key (free)

1. Go to the [Google Cloud Console](https://console.cloud.google.com/) and create a project (any name).
2. Open **APIs & Services → Library**, search for **Google Drive API**, and click **Enable**.
3. Open **APIs & Services → Credentials → Create credentials → API key**.
4. Click the new key to edit it and lock it down so nobody else can use it:
   - **Application restrictions → Websites** → add your site, e.g. `https://yourname.github.io/*` (add `http://localhost:4173/*` too if you want to test locally).
   - **API restrictions → Restrict key** → select **Google Drive API** only.

With those two restrictions the key is safe to commit — it only works from your website and can only read files that are already public.

### 4. Fill in `js/config.js`

```js
siteTitle: "Your Team Name",
tagline: "Photo library",
googleApiKey: "AIza...your key...",
rootFolderId: "1AbCdEfGhIjKlMnOpQrStUvWxYz",
theme: { brand: "#17001c", accent: "#f85259", highlight: "#a335e6", defaultMode: "light" },
```

Set your name, logo and colors in the same file — see [Make it yours](#make-it-yours).

### 5. Publish

In your repo: **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)` → Save**. A minute later your gallery is live at `https://yourname.github.io/your-repo/`.

---

## Organising your Drive

| In Google Drive | On the website |
| --- | --- |
| A folder | A gallery (or a collection, if it contains more folders) |
| Folder name | Gallery title |
| Folder **description** (right-click → File information → Details) | Subtitle under the title |
| A file named `cover.jpg` (or `.png`, `.webp`…) | That gallery's cover image. Without one, the first photo is used. |
| Photo description | Caption in the viewer's info panel |
| File names | Default sort order (`IMG_2` comes before `IMG_10`) |

New uploads show up on their own — visitors may need to wait up to `cacheMinutes` (10 by default) or open the site in a new tab.

---

## Logins, private galleries and the Organize screen

The live Drive mode above is public and read-only: it shows a publicly shared folder to everyone, with no logins and no Organize screen.

Logins, Internal/Unlisted galleries, access links and the Organize screen need a server that knows who is logged in. This repo ships them as a **working preview** on top of a pretend, in-browser server so you can click through the whole experience (see [Demo accounts](#demo-accounts)).

**Making them real is a proper project, not a config change.** In this repo you only edit two files, `js/auth.js` and `js/backend.js`, but behind them you need a login system, a database, around twenty API endpoints, a way to serve private files from Drive, and hosting for all of it. If you already run a media site with its own login, it is probably easier to borrow the look and screens from here than to switch to it.

**[docs/BACKEND.md](docs/BACKEND.md)** is the handoff guide: what the work involves, the five login functions, an endpoint for every backend function, the options for serving private Drive files (and what each one costs), and a security checklist.

### What the preview does not do

- **No review step.** Anything added to a Public gallery, including guest uploads, is public straight away. Nobody approves it first.
- **Uploads are pretend.** The upload page and Organize accept photos and videos, but in the demo they stay in your browser tab and vanish on reload. A real server has to get large videos into Drive without routing them through a small host.
- **Tags sit on top of galleries, they don't replace them.** Every file still lives in exactly one gallery. Cross-gallery search is for organizers (the Library); visitors get tag pages but no site-wide search box.
- **Tag names are visible to anyone who can see the photo.** Don't use them for anything private, such as student names.
- **View and upload links** let people without an account see or add photos. Think about whether that is right for photos of students before turning them on for real.

### Visibility is a setting, not a folder

Every photo has one record, and who can see it is a setting on that record:

| Setting | On a gallery | On a single photo |
| --- | --- | --- |
| **Public** | Listed for everyone | Shown publicly even inside an internal gallery |
| **Unlisted** | Hidden from listings (from team members too); anyone with the link can open it | — |
| **Internal** | Logged-in team members only | Hidden publicly even inside a public gallery |

Public visitors and team members look at the same library through a different filter.

Whether the file itself can also be stored just once depends on how a real server delivers it. Showing a private Drive file to the public means either sharing that file publicly, sending it through your own server (expensive for video), or keeping a public copy. [docs/BACKEND.md](docs/BACKEND.md#serving-the-actual-files-from-google-drive) lays out the trade-offs; none of them is free.

---

## How it works

```
index.html      page shell
css/style.css   all styling (colors are CSS variables at the top)
js/config.js    your settings  ← the only file you need to edit
js/drive.js     reads a public Google Drive folder (live mode)
js/app.js       the gallery: folder pages, photo grid, viewer, URL routing
js/organize.js  the Organize screen
js/library.js   the Library screen (all media, search, tags)
js/auth.js      DEMO login and roles          ← pretend; needs a real login
js/backend.js   DEMO server (in the browser)  ← pretend; needs a real server
docs/BACKEND.md what building the real versions involves
serve.ps1       optional local preview server for Windows
```

- The page asks the Drive API for the files in a folder (`files.list`), then shows thumbnails straight from Google's image servers at whatever size it needs. Nothing is copied or re-hosted.
- URLs look like `#/f/<folderId>` and `#/f/<folderId>/p/<fileId>`, so every gallery and every photo has a link you can share.
- Folder listings are cached in the visitor's browser for a few minutes to keep things fast and stay well inside Google's free API quota.

### Limits worth knowing

- Thumbnails come from Drive, which caps them at roughly 2000px on the long edge. The **Download** button always gives the original file.
- Drive only makes thumbnails for formats it understands (JPEG, PNG, HEIC, WebP, GIF, most video). RAW files won't preview.
- Google Drive shortcuts are ignored; put the actual files in the folders.

---

## Customising

- **Colors, title, links, row height, slideshow speed, downloads on/off** → `js/config.js`
- **Fonts, spacing, anything visual** → `css/style.css`
- **Custom domain** → GitHub Pages settings; remember to add the new domain to your API key's website restrictions.

## Contributing

Issues and pull requests are welcome. The goal is to keep this small and dependency-free so that any student can read it and make it their own.

## License

[MIT](LICENSE) — do whatever you like, just keep the notice.

*Not affiliated with SmugMug, Pixieset or Google. Demo photos are served by [Lorem Picsum](https://picsum.photos).*
