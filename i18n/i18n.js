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

  return { t, get lang() { return lang; }, setLang, applyStatic, renderPicker, onChange: (fn) => listeners.add(fn), info };
}
