/*
 * auth.js — who is logged in, and what they're allowed to do.
 *
 * ┌──────────────────────────────────────────────────────────────────┐
 * │ THIS IS A DEMO LOGIN. Replace it with your real login system.    │
 * │                                                                  │
 * │ The rest of the site only ever calls:                            │
 * │    Auth.user()            → { username, name, role } or null     │
 * │    Auth.can("organize")   → true / false                         │
 * │    Auth.login(u, p)       → Promise (rejects with a message)     │
 * │    Auth.logout()                                                 │
 * │    Auth.onChange(fn)                                             │
 * │ Keep those five and nothing else needs to change.                │
 * │                                                                  │
 * │ A browser-only check like this one can be read and bypassed by   │
 * │ anyone who opens dev tools. It is fine for placeholder photos.   │
 * │ For real photos the SERVER must check the session on every       │
 * │ request — see docs/BACKEND.md.                                   │
 * └──────────────────────────────────────────────────────────────────┘
 */
(() => {
  // What each role may do. Add roles or permissions here.
  const ROLES = {
    member:    ["view-internal"],              // sees internal galleries
    organizer: ["view-internal", "organize"],  // …and the Organize backend
  };

  // Demo accounts. Passwords are stored as salted SHA-256 hashes, never as
  // plain text. (The demo passwords are listed in the README.)
  const SALT = "drive-gallery-demo";
  const USERS = [
    { username: "member",    name: "Demo Member",    role: "member",    hash: "1f0b3c7196d5fb247a01a9e256a8ba51080efad76db0de2a842a1fb6ef0d211b" },
    { username: "organizer", name: "Demo Organizer", role: "organizer", hash: "38e897e82c177dae071b995e8202cab6ffbdd0bd58f577b47ff9e5b3585bf809" },
  ];

  const SESSION_KEY = "dg:session";
  const LOCK_KEY = "dg:login-attempts";
  const SESSION_HOURS = 8;
  const MAX_TRIES = 5;          // wrong guesses allowed before a time-out
  const LOCK_SECONDS = 30;      // first time-out; doubles each time after

  const listeners = [];
  const read = (store, key) => { try { return JSON.parse(store.getItem(key)); } catch { return null; } };
  const write = (store, key, v) => { try { store.setItem(key, JSON.stringify(v)); } catch {} };

  async function sha256(text) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  function user() {
    const s = read(sessionStorage, SESSION_KEY);
    if (!s || s.exp < Date.now() || !ROLES[s.role]) return null;
    return { username: s.username, name: s.name, role: s.role };
  }

  const can = (permission) => {
    const u = user();
    return !!u && ROLES[u.role].includes(permission);
  };

  async function login(username, password) {
    const lock = read(localStorage, LOCK_KEY) || { fails: 0, until: 0, locks: 0 };
    if (lock.until > Date.now()) {
      throw new Error(`Too many attempts. Try again in ${Math.ceil((lock.until - Date.now()) / 1000)} seconds.`);
    }

    const name = String(username).trim().toLowerCase();
    const account = USERS.find((u) => u.username === name);
    // Always hash, even for unknown usernames, so both cases take the same time.
    const hash = await sha256(`${SALT}|${name}|${password}`);

    if (!account || account.hash !== hash) {
      lock.fails++;
      if (lock.fails >= MAX_TRIES) {
        lock.until = Date.now() + LOCK_SECONDS * 1000 * 2 ** lock.locks;
        lock.locks++;
        lock.fails = 0;
      }
      write(localStorage, LOCK_KEY, lock);
      // Same message for "no such user" and "wrong password" on purpose.
      throw new Error("Wrong username or password.");
    }

    localStorage.removeItem(LOCK_KEY);
    write(sessionStorage, SESSION_KEY, {
      username: account.username, name: account.name, role: account.role,
      exp: Date.now() + SESSION_HOURS * 3600 * 1000,
    });
    listeners.forEach((fn) => fn());
    return user();
  }

  function logout() {
    sessionStorage.removeItem(SESSION_KEY);
    listeners.forEach((fn) => fn());
  }

  window.Auth = { user, can, login, logout, onChange: (fn) => listeners.push(fn) };
})();
