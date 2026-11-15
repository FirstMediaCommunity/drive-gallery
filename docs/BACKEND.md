# Connecting a real backend

The site in this repo is a **working preview**. The gallery pages and the Organize screen are real; the login and the "server" behind them are stand-ins that run in the browser so the whole thing can be clicked through without any infrastructure.

This page is for whoever wires it to a real login system and real storage — for example a team's existing member portal.

## What is real and what is pretend

| Piece | File | Status |
| --- | --- | --- |
| Gallery pages, viewer | `js/app.js`, `css/style.css` | Real. Keep. |
| Organize screen | `js/organize.js` | Real. Keep. |
| Reading a public Drive folder | `js/drive.js` | Real (public, read-only mode). |
| Login, roles | `js/auth.js` | **Pretend.** Two hard-coded demo accounts. |
| Galleries, visibility, links, uploads | `js/backend.js` | **Pretend.** Stored in the browser's `localStorage`. |

Because the pretend parts run in the visitor's browser, **they are not security**. Anyone can open dev tools and read or change them. That is fine for placeholder photos and it is why the demo data is placeholders. With real photos, every rule below has to be enforced on the server.

## The two files to replace

### 1. `js/auth.js`

The rest of the site only uses five functions:

```js
Auth.user()            // → { username, name, role } or null
Auth.can("organize")   // → boolean   (permissions: "view-internal", "organize")
Auth.login(user, pass) // → Promise; rejects with an Error whose message is shown to the user
Auth.logout()
Auth.onChange(fn)      // call fn after login/logout
```

For a portal with its own login page, the simplest swap is:

- `Auth.user()` returns what `GET /api/me` said (fetch once at page load, keep in memory).
- `Auth.login()` redirects to the portal's login with a `returnTo` address to come back to.
- The session lives in an `HttpOnly`, `Secure`, `SameSite` cookie set by the portal. No tokens in `localStorage`.

`Auth.can()` only decides which buttons to **show**. The server decides what is **allowed**.

### 2. `js/backend.js`

Every function maps to one endpoint. Shapes are exactly what the demo returns, so the UI needs no changes.

**Reading (anyone; the server filters by who is asking)**

| Function | Suggested endpoint | Returns |
| --- | --- | --- |
| `list(folderId)` | `GET /api/folders/:id/contents` | `{ folders: [...], items: [...] }` — only what this visitor may see |
| `folder(folderId)` | `GET /api/folders/:id` | `{ id, name, description, parentId, kind, visibility? }` |
| `path(folderId)` | `GET /api/folders/:id/path` | `[{ id, name }, …]` root first |
| `cover(folderId)` | `GET /api/folders/:id/cover` | `{ item, photos, folders }` |
| `redeemLink(token, password?)` | `POST /api/links/:token/redeem` | folder id; sets a cookie that unlocks that folder. Throws `401` with `needsPassword: true` if the link has a password |
| `unlock(folderId, password)` | `POST /api/folders/:id/unlock` | nothing; sets a cookie that remembers the gallery password was entered |
| `uploadInfo(token)` | `GET /api/upload-links/:token` | `{ name, description, needsPassword }` for the upload page |
| `guestUpload(token, password, file)` | `POST /api/upload-links/:token/files` | the new item. Lets the holder add files, never view |

`list` and `folder` throw `401` with `{ needsPassword: true, folderId, hint }` when a password-protected gallery hasn't been unlocked; the page then shows the password form. Every folder also carries a `settings` object (see `DEFAULTS` in `js/backend.js`) — never include the password or its hash in it.

**Organizing (requires the `organize` permission — check it on every call)**

| Function | Suggested endpoint |
| --- | --- |
| `admin.tree()` | `GET /api/admin/tree` |
| `admin.contents(folderId)` | `GET /api/admin/folders/:id/contents` (unfiltered) |
| `admin.create(parentId, { kind, name, description, visibility })` | `POST /api/admin/folders` |
| `admin.updateFolder(id, { name, description, visibility, coverId, settings, password })` | `PATCH /api/admin/folders/:id` |
| `admin.updateItem(id, { title, description, keywords, visibility })` | `PATCH /api/admin/items/:id` |
| `admin.move(ids, targetFolderId)` | `POST /api/admin/move` |
| `admin.reorder(idsInOrder)` | `POST /api/admin/reorder` |
| `admin.remove(ids)` | `POST /api/admin/delete` |
| `admin.addItem(folderId, file)` | `POST /api/admin/folders/:id/upload` |
| `admin.links(folderId, type)` / `createLink(folderId, { type, label, days, password })` / `revokeLink(token)` | `GET` / `POST` / `DELETE /api/admin/links` — `type` is `"view"` or `"upload"` |

Errors: throw an `Error` with a `status` (`403`, `404`, `400`) and a human-readable `message` — the UI shows the message as-is.

## One file, many audiences (no more duplicates)

Today, making something public copies the file so it exists on both the internal and the public site. This design never copies. **Visibility is a field on the record, not a location.**

```
gallery.visibility   public | unlisted | internal
item.visibility      inherit | public | internal
```

- **Public** — listed for everyone.
- **Unlisted** — not listed for anyone except organizers (team members don't see it either); anyone holding the link can open it.
- **Internal** — logged-in members only.
- An item normally **inherits** from its gallery, but can be pinned **public** (shows publicly even inside an internal gallery) or **internal** (hidden publicly even inside a public gallery).

The public site and the internal site are the same records passed through one filter — `canSeeItem`, `isListed` and `canOpen` near the top of `js/backend.js` are that filter, about 20 lines, and can be ported directly. "Make public" becomes a one-field update; storage use does not change.

A gallery that is internal but contains pinned-public items shows up publicly with only those items in it. That replaces the "public copy" workflow: pick the few approved shots inside the internal gallery and pin them.

## Serving the actual files from Google Drive

Files stay in Drive, stored once. Two workable setups:

**A. Server holds the keys (recommended for internal media).**
Keep the Drive folder private. The server uses a Google service account that has been given Viewer access to the folder. For each image request the server checks the session and the visibility rule, then either streams the bytes from Drive (`files.get?alt=media`, or the `thumbnailLink` for small sizes) or redirects to a short-lived URL. Members never need a Google account, and nothing is reachable without passing the check. Cache thumbnails on the server or a CDN — Drive is slow and rate-limited if every tile is proxied live.

**B. Public files straight from Drive (what `js/drive.js` does today).**
Share the folder as "Anyone with the link" and let browsers load thumbnails from Google directly. Zero server cost, but anything in that folder is effectively public to whoever has a file ID. Only suitable for media that is meant to be public.

A reasonable split: setup A for everything, with public items additionally cacheable on a CDN because they need no session check.

To make `Drive.thumb()` use setup A, change one function in `js/drive.js` to return something like `/api/media/:id?w=640`.

## Where to keep the metadata

Names, order, visibility, covers and links need to live somewhere the server can query:

- **Portal database** (best fit if the portal already has one): a `folders` table, an `items` table keyed by Drive file ID, a `links` table. The fields are exactly those in the seed data at the bottom of `js/backend.js`.
- **Drive itself**, if you want zero extra storage: Drive files have a `properties` map (`files.update` with `properties: { visibility: "public" }`) and folders can be created/renamed/moved through the Drive API. Simpler to deploy, slower to query, and ordering is awkward.

Either way, uploads from the Organize screen should go to the server, which writes the file into the right Drive folder with the service account and records the item.

## Access links

There are two kinds, and they are deliberately separate:

- A **view link** is a random token that unlocks one folder (and everything under it) for someone without an account — for example parents viewing an internal gallery. It can carry its own password.
- An **upload link** lets the holder add files to one gallery. It grants no viewing rights at all.

Gallery passwords and link passwords: hash them with a slow salted hash on the server, rate-limit guesses, and never send the hash to the browser. A valid view link bypasses the gallery's own password (the link is the invitation); logged-in members bypass it too.

- Generate at least 128 bits from a cryptographic RNG. Store only a hash of the token.
- Support expiry and "turn off"; check both on every request, not only when the link is first opened.
- Redeeming a link should set a scoped cookie, not put the token in every URL.
- Items pinned **internal** stay hidden even through an access link (the demo does this too).

## Login hardening checklist

The demo login shows the behaviour; the server has to provide the substance.

- Check passwords on the server only. Store them with a slow salted hash (argon2id or bcrypt), never SHA-256.
- Same error message for "unknown user" and "wrong password".
- Rate-limit attempts per account **and** per IP, with increasing delays. (The demo's lock-out lives in the browser and resets if you clear storage — a real one cannot.)
- Session cookie: `HttpOnly`, `Secure`, `SameSite=Lax`, with a server-side expiry.
- Check the `organize` permission inside every `/api/admin/*` handler. Hidden buttons are not a permission system.
- Log who changed visibility, created links and deleted things.

## Roles

Defined at the top of `js/auth.js`:

| Role | Permissions | Sees |
| --- | --- | --- |
| *(not logged in)* | — | public galleries, pinned-public items, unlisted galleries by link |
| `member` | `view-internal` | public and internal galleries, read-only; unlisted only by link |
| `organizer` | `view-internal`, `organize` | everything, plus the Organize screen |

Add roles (for example a `publisher` who can change visibility but not delete) by adding permissions there and checking them in the matching handlers.
