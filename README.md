# Drive Gallery

A clean, SmugMug / Pixieset-style photo and video gallery that runs on **Google Drive + any free static host** (GitHub Pages, Netlify, Cloudflare Pages…).

Your photos stay in Google Drive. The website just reads the folder and shows it nicely — upload to Drive and the site updates itself.

- **Folders are galleries.** Nest them however you like (`2026 Season / District Event / …`).
- **Cover-image headers**, folder tiles, and an edge-to-edge justified photo grid.
- **Full-screen viewer** with keyboard arrows, swipe, filmstrip, slideshow, photo info (camera, lens, settings), share links and downloads.
- **Videos** play right in the viewer.
- **Filter, sort, light/dark mode**, and it works on phones.
- **No build step, no server, no database, no frameworks.** Three small JavaScript files you can read in one sitting.

Built by [FRC Team 5414 Pearadox](https://pearadox5414.org) for our own media library. Free for any team, club, school or family to copy.

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

> **Heads up:** "Anyone with the link" means anyone who finds your website can see these photos. If you need the gallery to be members-only, use [private mode](#private-mode-sign-in-with-google) instead.

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
theme: { brand: "#3d5b25", accent: "#5abf34", highlight: "#e2a215", defaultMode: "light" },
```

Swap `assets/logo.svg` for your own logo while you're there.

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

## Private mode (sign in with Google)

If your photos shouldn't be public, set `googleClientId` in `js/config.js`. Visitors then get a **Sign in with Google** button and only see the gallery if the Drive folder has been shared with their Google account — so you control access the normal way, from Drive's Share dialog. The folder does **not** need to be public.

1. In Google Cloud Console: **APIs & Services → OAuth consent screen** — set it up (choose *Internal* if you have Google Workspace, otherwise *External* and add your members as test users).
2. **Credentials → Create credentials → OAuth client ID → Web application**. Under *Authorized JavaScript origins* add your site (`https://yourname.github.io`) and `http://localhost:4173`.
3. Paste the client ID into `googleClientId`.

Things to know:

- The site asks for read-only Drive access (`drive.readonly`). The access token stays in the visitor's browser tab and is never sent anywhere except Google.
- Google treats Drive scopes as sensitive: an *External* app that hasn't been through Google's verification shows an "unverified app" warning and is limited to 100 test users. *Internal* (Workspace) apps have no such limits.
- Videos and downloads open through Drive itself, so the visitor must be signed in to the same Google account in their browser.
- **This mode is newer and less tested than public mode.** Please open an issue if something misbehaves.

---

## How it works

```
index.html      page shell
css/style.css   all styling (colors are CSS variables at the top)
js/config.js    your settings  ← the only file you need to edit
js/drive.js     talks to the Google Drive API (and provides the demo library)
js/app.js       the interface: folder pages, photo grid, viewer, URL routing
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
