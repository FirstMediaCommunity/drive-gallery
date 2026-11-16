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

## How much work this really is

The browser side only talks to two files, `js/auth.js` and `js/backend.js`, so those are the only two files you **edit** in this repo. That is not the same as the amount of work. Behind them you have to build and run:

- a login system (or a connection to an existing one), with sessions and rate limiting;
- a database for galleries, items, visibility, order, links and passwords;
- about twenty API endpoints, each checking who is asking;
- a way to serve private photos and video from Drive (the hard part — see [Serving the actual files](#serving-the-actual-files-from-google-drive));
- uploads that write into Drive;
- hosting for all of it, and someone to maintain it.

For an experienced developer this is a project of weeks, not an afternoon. If you already have a media site with its own login and storage, it is usually less work to borrow the look and the screens from this repo than to move onto it.

### Not built at all

These are missing from the demo too, not just from the pretend server:

- **No review step.** Anything added to a Public gallery, including guest uploads through an upload link, is public immediately. If photos of students are involved you probably want uploads to land as "pending" until a person approves them.
- **No real upload path.** The upload page and the Organize upload button accept photos and videos, but the demo only keeps them in the browser tab. Nothing is sent anywhere, and there is no size limit, virus scan or file-type check beyond what the browser reports.
- **No tags or cross-gallery search.** A photo lives in exactly one gallery. Keywords are stored and shown but nothing searches across galleries by them. A tag-based library would treat an album as a saved tag search instead of a container.
- **Live Drive mode has none of the above.** It is public and read-only.

## The two files to edit

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

Every function maps to one endpoint. If the endpoints return the same shapes the demo does, the UI should need no changes — that has only ever been run against the pretend server, so expect some adjusting.

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

## One record, many audiences

In this design **visibility is a field on the record, not a location.** That keeps the *records* from being duplicated. Whether the *file* also has to exist twice depends on how you serve it, which is a separate and harder question — see the next section.

```
gallery.visibility   public | unlisted | internal
item.visibility      inherit | public | internal
```

- **Public** — listed for everyone.
- **Unlisted** — not listed for anyone except organizers (team members don't see it either); anyone holding the link can open it.
- **Internal** — logged-in members only.
- An item normally **inherits** from its gallery, but can be pinned **public** (shows publicly even inside an internal gallery) or **internal** (hidden publicly even inside a public gallery).

The public site and the internal site are the same records passed through one filter — `canSeeItem`, `isListed` and `canOpen` near the top of `js/backend.js` are that filter, about 20 lines, and can be ported directly. "Make public" becomes a one-field update on the record.

A gallery that is internal but contains pinned-public items shows up publicly with only those items in it: pick the few approved shots inside the internal gallery and pin them.

## Serving the actual files from Google Drive

This is where "store each file once" gets expensive. A browser can only load a Drive file directly if that file is shared publicly; otherwise the bytes have to pass through your server. Every option below trades something away, and none of them has been built or tested in this repo except B.

**A. Server proxies everything.**
Keep Drive private. The server uses a Google service account with Viewer access; for each request it checks the session and the visibility rule, then streams the bytes from Drive (`files.get?alt=media`, or `thumbnailLink` for small sizes). Nothing is reachable without passing the check and nothing is copied. The cost is bandwidth and compute: fine for thumbnails if you cache them, a real problem for video. A 100 MB video streamed through a free hosting tier will hit limits quickly.

**B. Share the whole folder (what `js/drive.js` does today).**
"Anyone with the link" on the root folder; browsers load everything from Google. No server cost, but nothing in that folder is private. Only for libraries that are entirely public.

**C. Share only the public files.**
Keep Drive private, and when an item becomes public have the server add an "anyone with the link" permission to that one file (`permissions.create`), removing it (`permissions.delete`) when the item goes back to internal. Public media, including video, then loads from Google; internal media goes through the proxy in A. No copy. Things to check before relying on it: a Workspace admin can forbid sharing outside the organisation, shared drives can restrict it too, and the server needs write access to permissions, not just Viewer. Untested here.

**D. Keep a managed public copy.**
Copy public files to a separate public folder or bucket and serve them from there. Uses more storage, but the private drive is never exposed, video never touches your server, and "unpublish" is a delete. This is a legitimate choice, not a mistake to be fixed — especially where C is blocked by sharing policy.

To point the gallery at your choice, change `Drive.thumb()` (and the download and video URLs next to it) in `js/drive.js`.

### Large uploads

The same bandwidth limit applies in the other direction. For video, have the server start a Drive resumable upload session and hand the session address to the browser, so the bytes go from the visitor straight to Google rather than through your host. Also untested here; the demo upload only pretends. `readMedia()` in `js/app.js` is what reads the picked file, and for a video it produces `{ type: "video", url (a poster frame), src (the clip), duration, w, h, size }` — a real server would make the poster and read the duration itself.

## Where to keep the metadata

Names, order, visibility, covers and links need to live somewhere the server can query:

- **Portal database** (best fit if the portal already has one): a `folders` table, an `items` table keyed by Drive file ID, a `links` table. The fields are exactly those in the seed data at the bottom of `js/backend.js`.
- **Drive itself**, if you want zero extra storage: Drive files have a `properties` map (`files.update` with `properties: { visibility: "public" }`) and folders can be created/renamed/moved through the Drive API. Simpler to deploy, slower to query, and ordering is awkward.

Either way, uploads from the Organize screen should be authorised by the server, end up in the right Drive folder, and be recorded as an item.

## Access links

These let people without an account see or add photos, which matters a great deal when the photos are of students. Decide deliberately whether you want them at all. If you do, sensible defaults are: organizers only, always expiring, password required, and every use logged.

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
