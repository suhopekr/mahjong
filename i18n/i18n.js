// /i18n/i18n.js — the site's shared language runtime (every game imports it).
//
// One language choice for the whole site, stored under `site.v1.lang`, so a
// player who picks 한국어 in Solitaire gets 한국어 in Word Search too. The
// first visit follows the browser language when we have it, else English.
//
// A game passes two dictionaries: the shared one (/i18n/common.js — button
// names, settings labels, win/undo phrases every game uses) and its own
// (<game>/src/i18n/strings.js). Both have the shape { en: {key: "..."},
// ko: {...}, ... }. Lookup order: game[lang] → common[lang] → game.en →
// common.en → the key itself, so a missing translation shows English, never
// a blank.
//
// Values may be strings or functions of one argument (for counts/names):
//   t("won", { moves: 88 })   → strings.won({ moves: 88 })
//
// Static markup is translated with data-i18n attributes:
//   <button data-i18n="hint">Hint</button>
//   <p data-i18n="goal" data-i18n-html>…</p>   (html allowed — only for our
//   own strings with <strong>; never for anything user-supplied)
//   <input data-i18n-attr="aria-label:deck">
// applyStatic() walks them. Call it after every language change.
//
// LONG-FORM PAGE CONTENT is the other half, and it works the other way
// round. The intro prose, the How to Play list, the FAQ, the game names in
// the chrome — ~7,700 words of it — are the SEO copy, and a crawler never
// sets localStorage, so the ENGLISH HAS TO STAY IN THE HTML. Copying it into
// an `en` dictionary would be a second copy of the same paragraph, free to
// drift from the one Google reads. So those blocks carry
//
//   <p data-i18n-content="introP1">The English, which is the source.</p>
//
// and a translation REPLACES it only when the active language has one:
//
//   - English (or no translation for this key): the markup is left exactly
//     as authored — no lookup, no fallback chain, nothing downloaded.
//   - another language: the block's innerHTML is replaced from that
//     language's entry in a per-page module, declared in the markup as
//     <section class="content" data-i18n-lang data-i18n-module="/…/content.js">
//     and fetched with a dynamic import() the first time a non-English
//     language needs it (same-origin, which `script-src 'self'` allows).
//
// useContent() registers those modules; a module that 404s, throws or has
// the wrong shape leaves the page in English, which is the whole point —
// a translation that fails to load must never be worse than cosmetic.
// data-i18n-lang marks the wrapper whose lang/dir follow the translation:
// it says "en"/"ltr" until every key inside it is translated.
//
// Right-to-left (Arabic): the runtime sets dir="rtl" on <html> so text
// blocks, settings and modals flip. Boards are laid out by JS in px and
// must stay LTR — give the board element dir="ltr" in the markup.

export const LANGUAGES = [
  { code: "en", name: "English",   dir: "ltr" },
  { code: "es", name: "Español",   dir: "ltr" },
  { code: "pt", name: "Português", dir: "ltr" },
  { code: "fr", name: "Français",  dir: "ltr" },
  { code: "it", name: "Italiano",  dir: "ltr" },
  { code: "de", name: "Deutsch",   dir: "ltr" },
  { code: "ru", name: "Русский",   dir: "ltr" },
  { code: "tr", name: "Türkçe",    dir: "ltr" },
  { code: "id", name: "Indonesia", dir: "ltr" },
  { code: "ko", name: "한국어",     dir: "ltr" },
  { code: "ja", name: "日本語",     dir: "ltr" },
  { code: "zh", name: "简体中文",   dir: "ltr" },
  { code: "zh-Hant", name: "繁體中文", dir: "ltr" },
  { code: "ar", name: "العربية",   dir: "rtl" },
];
export const LANG_CODES = LANGUAGES.map((l) => l.code);
const STORAGE_KEY = "site.v1.lang";

function detect() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && LANG_CODES.includes(saved)) return saved;
  } catch { /* private mode */ }
  const wanted = (navigator.languages || [navigator.language || "en"]).map((s) => String(s).toLowerCase());
  for (const w of wanted) {
    if (w.startsWith("zh")) return /hant|tw|hk|mo/.test(w) ? "zh-Hant" : "zh";
    const base = w.split("-")[0];
    if (LANG_CODES.includes(base)) return base;
  }
  return "en";
}

/* ==========================================================================
 * Long-form page content — data-i18n-content
 *
 * MODULE state, not per-instance, on purpose. A game page has two i18n
 * instances (the game's own, with its dictionaries, and /nav.js's, with
 * only common) and both call applyStatic() on the whole document. If each
 * kept its own idea of what had been translated, the second pass would
 * undo the first. There is exactly one set of content modules per page and
 * exactly one authored-English cache, so whichever instance walks the
 * document reaches the same answer.
 * ====================================================================== */

/** Module URLs this page declared, in the order they were registered. */
const contentUrls = [];
/** url → its dictionary, once loaded. A url that failed is simply absent. */
const contentPacks = new Map();
/** url → we have already tried; a failure is final, we do not retry per key. */
const contentTried = new Set();
/** element → the English innerHTML the page shipped with, captured before we
 *  ever overwrite it, so switching back to English restores the SEO copy
 *  without a reload. WeakMap: an element that leaves the DOM is collectable. */
const authoredHtml = new WeakMap();

/** Only our own modules, by absolute same-origin path. The URL comes out of
 *  a data attribute, and while `script-src 'self'` would already refuse a
 *  cross-origin import, an allow-list here is one line and means a stray
 *  attribute can never point the loader at anything but a file in this repo. */
function isOwnModule(url) {
  return typeof url === "string" && /^\/[A-Za-z0-9._/-]+\.js$/.test(url) && !url.includes("..");
}

/** The translation for `key` in `lang`, or null for "leave the markup alone".
 *  English never looks anything up: English IS the markup. Later-registered
 *  modules win, so a page module can override /i18n/games.js. */
function contentValue(lang, key) {
  if (lang === "en") return null;
  for (let i = contentUrls.length - 1; i >= 0; i--) {
    const dict = contentPacks.get(contentUrls[i]);
    const forLang = dict && dict[lang];
    if (forLang && Object.prototype.hasOwnProperty.call(forLang, key)) {
      const v = forLang[key];
      if (typeof v === "string" && v.trim()) return v;
    }
  }
  return null;
}

/** Fetch every declared module we have not tried yet. Resolves either way:
 *  the caller re-renders afterwards and a module that never arrived simply
 *  contributes nothing, leaving its blocks in English. */
async function ensureContent(lang) {
  if (lang === "en") return;
  const jobs = [];
  for (const url of contentUrls) {
    if (contentTried.has(url)) continue;
    contentTried.add(url);
    jobs.push(
      import(url).then(
        (mod) => {
          const dict = mod.content ?? mod.default;
          if (dict && typeof dict === "object") contentPacks.set(url, dict);
        },
        (err) => {
          // Cosmetic by design: say so once, in the console, and carry on in
          // English. Never throw — this runs inside the boot path of every
          // page, and a missing translation must not take a game down.
          console.warn("i18n: content module unavailable, staying in English:", url, err && err.message);
        },
      ),
    );
  }
  if (jobs.length) await Promise.all(jobs);
}

/** One document-wide pass. Idempotent: it either writes the translation or
 *  writes back the authored English, so running it twice, or from two
 *  instances, changes nothing the second time. */
function applyContent(lang, dirOf) {
  if (!contentUrls.length) return;
  for (const el of document.querySelectorAll("[data-i18n-content]")) {
    if (!authoredHtml.has(el)) authoredHtml.set(el, el.innerHTML);
    const v = contentValue(lang, el.dataset.i18nContent);
    const next = v == null ? authoredHtml.get(el) : v;
    // innerHTML, and deliberately: these are whole paragraphs and list
    // items that carry our own <strong>, <em> and links, and textContent
    // would print the tags. EVERY value here comes from a .js module in
    // this repository, imported from our own origin — the same trust level
    // as the markup it replaces. Nothing a visitor can type, no query
    // string, no fetched JSON, and nothing from another origin may ever be
    // routed into a content module; if that ever changes, this line is the
    // injection point and has to be rewritten with a sanitiser.
    if (el.innerHTML !== next) el.innerHTML = next;
  }
  // The wrapper that says which language its subtree is actually in. It stays
  // en/ltr until EVERY key inside it has a translation, so a partly filled
  // module can never mislabel a half-English block (and the build check makes
  // "partly filled" a failure anyway).
  for (const el of document.querySelectorAll("[data-i18n-lang]")) {
    const keys = [...el.querySelectorAll("[data-i18n-content]")].map((k) => k.dataset.i18nContent);
    if (el.hasAttribute("data-i18n-content")) keys.push(el.dataset.i18nContent);
    const whole = keys.length > 0 && keys.every((k) => contentValue(lang, k) != null);
    el.setAttribute("lang", whole ? lang : "en");
    el.setAttribute("dir", whole ? dirOf(lang) : "ltr");
  }
}

export function createI18n({ common = {}, game = {} } = {}) {
  let lang = detect();
  const listeners = new Set();

  function lookup(key) {
    return (game[lang] && game[lang][key]) ?? (common[lang] && common[lang][key])
      ?? (game.en && game.en[key]) ?? (common.en && common.en[key]) ?? key;
  }
  function t(key, arg) {
    const v = lookup(key);
    return typeof v === "function" ? v(arg) : v;
  }
  function info() { return LANGUAGES.find((l) => l.code === lang) || LANGUAGES[0]; }
  const dirOf = (code) => (LANGUAGES.find((l) => l.code === code) || LANGUAGES[0]).dir;

  function applyStatic(root = document) {
    for (const el of root.querySelectorAll("[data-i18n]")) {
      const v = t(el.dataset.i18n);
      if (el.hasAttribute("data-i18n-html")) el.innerHTML = v; else el.textContent = v;
    }
    for (const el of root.querySelectorAll("[data-i18n-attr]")) {
      for (const pair of el.dataset.i18nAttr.split(";")) {
        const [attr, key] = pair.split(":").map((s) => s.trim());
        if (attr && key) el.setAttribute(attr, t(key));
      }
    }
    document.documentElement.lang = lang === "zh-Hant" ? "zh-Hant" : lang;
    document.documentElement.dir = info().dir;
    // The long-form blocks, if this page declared any. Runs document-wide
    // whatever `root` was: the content modules are page-scoped, not
    // instance-scoped, and a partial pass would leave two languages up.
    if (contentUrls.length) refreshContent();
  }

  /** Draw what we already have, then fetch what we do not and draw again.
   *  The first call is synchronous English (or the already-loaded
   *  translation), so nothing ever flashes blank; the awaited half lands a
   *  moment later, which is what makes an English visitor's page identical
   *  to today's — no import, no request, no work. */
  function refreshContent() {
    applyContent(lang, dirOf);
    ensureContent(lang).then(() => applyContent(lang, dirOf), () => {});
  }

  /** Declare this page's content modules (absolute, same-origin .js paths).
   *  Safe to call more than once and from more than one place; each URL is
   *  fetched at most once per page, and never at all in English. */
  function useContent(...urls) {
    let added = false;
    for (const url of urls.flat()) {
      if (!isOwnModule(url) || contentUrls.includes(url)) continue;
      contentUrls.push(url);
      added = true;
    }
    if (added) refreshContent();
  }

  function setLang(code) {
    if (!LANG_CODES.includes(code) || code === lang) return;
    lang = code;
    try { localStorage.setItem(STORAGE_KEY, code); } catch { /* best-effort */ }
    applyStatic();
    for (const fn of listeners) fn(lang);
  }

  /** Fill a container with one 56px button per language (site .btn), the
   *  current one marked. `container` is a <div class="lang-grid">. */
  function renderPicker(container) {
    container.innerHTML = "";
    for (const l of LANGUAGES) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn lang-btn";
      b.lang = l.code;
      b.dataset.lang = l.code;
      b.textContent = l.name;
      b.setAttribute("aria-pressed", String(l.code === lang));
      b.addEventListener("click", () => { setLang(l.code); renderPicker(container); });
      container.appendChild(b);
    }
  }

  return { t, get lang() { return lang; }, setLang, applyStatic, useContent, renderPicker, onChange: (fn) => listeners.add(fn), info };
}
