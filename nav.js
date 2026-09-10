// /nav.js — the top bar and the Games panel, on every page.
//
// DESIGN.md "Site navigation" is the spec. The division of labour matters:
//
//   tools/sync-games.mjs writes ALL the markup — the bar, the panel and its
//   eleven game cards — between <!-- games:nav --> fences. So the game links
//   are real <a>s in the HTML and work with JavaScript switched off, and
//   nothing in JS lists the games.
//
//   this file only: opens and closes the panel, moves focus into it and back
//   to the Games button, renders the 14-language grid, translates the bar's
//   own four strings, marks the current game's card, and sends the analytics.
//
// CSP (vercel.json: script-src 'self'; style-src 'self'): no inline style
// attribute is ever written here — the only styling this file does is toggle
// classes and data-open, exactly like .settings-panel and .modal-overlay.
import { createI18n, LANGUAGES } from "/i18n/i18n.js";
import { common } from "/i18n/common.js";

const nav = document.getElementById("site-nav");
const panel = document.getElementById("nav-panel");
const sheet = document.getElementById("nav-panel-sheet");
const panelBody = document.getElementById("nav-panel-body");
const btnGames = document.getElementById("nav-games");
const btnLang = document.getElementById("nav-lang");
const btnClose = document.getElementById("nav-close");
const langGrid = document.getElementById("nav-lang-grid");
const langNote = document.getElementById("nav-lang-note");
const langSection = document.getElementById("nav-lang-section");

// A page can carry the bar without the panel (never should, but a half-copied
// fence must not throw and take the game down with it).
if (nav && panel && sheet && btnGames) {
  const FROM = nav.dataset.navFrom || "site";

  /* ---- analytics ---------------------------------------------------------
   * Same shape as every game's own trackEvent: check window.gtag first, so
   * an ad blocker that eats gtag.js changes nothing about the page. */
  function track(name, params) {
    if (typeof window.gtag === "function") window.gtag("event", name, params);
  }

  /* ---- i18n --------------------------------------------------------------
   * The bar's own strings only (games / close / language / playingNow), all
   * of them in /i18n/common.js. applyStatic() is called with the bar and the
   * panel as roots, NEVER with the document: this instance has no game
   * dictionary, so a document-wide pass would rewrite a game's own
   * data-i18n="goal" to the literal word "goal". On a game page the game's
   * own i18n instance walks the whole document and picks these keys up from
   * common anyway, so the bar ends up translated either way. */
  const i18n = createI18n({ common });
  function applyOwn() {
    i18n.applyStatic(nav);
    i18n.applyStatic(panel);
    syncLangButton();
  }

  /** The Language button is labelled with the current language's own native
   *  name — self-describing in every language, no icon needed.
   *
   *  The bar must not clip, and the order of what gives is fixed: the two
   *  controls never shrink, the brand's words never disappear, the mark is
   *  already gone under 400px — so the last thing left to give is this
   *  label, which drops to the language code with the full name still in
   *  aria-label. DESIGN.md §7 put that fallback under 320px from an
   *  estimate; measured, the case that actually needs it is Indonesian
   *  ("Permainan" 122px + "Indonesia" 115px leaves the brand 109px it
   *  hasn't got), so this asks the layout instead of guessing a width. */
  function shortCode(info) {
    return info.code.replace("-Hant", "t").replace("-", "").slice(0, 3).toUpperCase();
  }
  function syncLangButton() {
    if (!btnLang) return;
    const info = i18n.info();
    btnLang.setAttribute("aria-label", i18n.t("language") + ": " + info.name);
    btnLang.lang = info.code;
    btnLang.textContent = info.name;
    const words = nav.querySelector(".nav-words");
    // Reading scrollWidth here forces the layout we just asked for.
    if (words && words.scrollWidth > words.clientWidth + 1) btnLang.textContent = shortCode(info);
  }
  window.addEventListener("resize", syncLangButton);

  /* ---- the current game's card ------------------------------------------
   * sync-games.mjs already writes aria-current="page" and the words "Playing
   * now" into the card of the page it generated. This re-derives it from the
   * address so a hand-copied fence, or /daily.html reached as /daily.html vs
   * /daily, still marks the right one — never the tint alone. */
  function markCurrentCard() {
    const here = location.pathname.replace(/index\.html$/, "");
    for (const a of panel.querySelectorAll(".nav-card-grid a[href]")) {
      const href = a.getAttribute("href");
      const isHere = href === here || (here === "/" && href === "/");
      if (!isHere) continue;
      a.setAttribute("aria-current", "page");
      a.removeAttribute("data-crossgame-to");
      a.removeAttribute("data-placement");
      const body = a.querySelector(".game-card-body");
      if (body && !body.querySelector(".nav-now")) {
        const now = document.createElement("span");
        now.className = "nav-now";
        now.dataset.i18n = "playingNow";
        now.textContent = i18n.t("playingNow");
        body.appendChild(now);
      }
    }
  }

  /* ---- open / close ------------------------------------------------------ */
  let opener = null;

  /** Anything already on screen that the panel must not fight with. The win
   *  modal wins outright (a finished game is the one thing you must answer);
   *  settings and the phone's menu sheet are simply put away first. */
  function blockingModal() {
    return document.querySelector('.modal-overlay[data-open="true"]');
  }

  function openPanel(placement) {
    if (panel.dataset.open === "true") return;
    if (blockingModal()) return;
    for (const el of document.querySelectorAll('.settings-panel[data-open="true"], .mobile-menu-sheet[data-open="true"]')) {
      el.dataset.open = "false";
    }
    opener = document.activeElement === btnLang ? btnLang : btnGames;
    panel.dataset.open = "true";
    document.body.classList.add("nav-open");
    btnGames.setAttribute("aria-expanded", "true");
    if (btnLang) btnLang.setAttribute("aria-expanded", "true");
    // Always the same list from the same place: opening at scroll 0 is what
    // makes eleven cards learnable.
    if (panelBody) panelBody.scrollTop = 0;
    sheet.focus({ preventScroll: true });
    track("nav_open", { from: FROM, placement: placement || "top_nav" });
  }

  function closePanel() {
    if (panel.dataset.open !== "true") return;
    panel.dataset.open = "false";
    document.body.classList.remove("nav-open");
    btnGames.setAttribute("aria-expanded", "false");
    if (btnLang) btnLang.setAttribute("aria-expanded", "false");
    (opener && document.contains(opener) ? opener : btnGames).focus();
  }

  /** Scroll the panel to the language grid — what the bar's Language button
   *  is for. The grid lives after the cards (DESIGN.md §4), so this is the
   *  shortcut that keeps it discoverable without pushing game 1 off screen. */
  function scrollToLanguage() {
    if (!langSection || !panelBody) return;
    requestAnimationFrame(() => {
      const top = langSection.getBoundingClientRect().top - panelBody.getBoundingClientRect().top;
      panelBody.scrollTop += top - 8;
    });
  }

  btnGames.addEventListener("click", () => {
    if (panel.dataset.open === "true") closePanel(); else openPanel("top_nav");
  });
  if (btnLang) btnLang.addEventListener("click", () => {
    const wasOpen = panel.dataset.open === "true";
    if (!wasOpen) openPanel("top_nav");
    if (panel.dataset.open === "true") scrollToLanguage();
  });
  if (btnClose) btnClose.addEventListener("click", closePanel);

  // The backdrop is only tappable at 1040px and up — below that the sheet is
  // edge to edge and there is nothing behind it, which is why Close is sticky.
  panel.addEventListener("click", (e) => {
    if (e.target === panel && window.matchMedia("(min-width: 1040px)").matches) closePanel();
  });

  document.addEventListener("keydown", (e) => {
    if (panel.dataset.open !== "true") return;
    if (e.key === "Escape") { e.preventDefault(); closePanel(); return; }
    if (e.key !== "Tab") return;
    // Focus is trapped in the sheet: next Tab from the sheet itself is Close,
    // then card 1, then the language buttons, then round again.
    const items = [...sheet.querySelectorAll("a[href], button:not([disabled])")]
      .filter((el) => el.offsetWidth > 0 || el.offsetHeight > 0);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === sheet)) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  });

  /* ---- the language grid -------------------------------------------------
   * i18n.renderPicker() draws it (the same .btn.lang-btn buttons with
   * aria-pressed that every game's Settings uses). Its own click handler
   * would call setLang() and stop there; we need the reload as well, so this
   * capture-phase listener runs first and stops the event before the button's
   * own handler sees it — one place decides what a language tap does.
   *
   * The order is the whole point (DESIGN.md §4): acknowledge the tap, say
   * what is about to happen IN THE NEW LANGUAGE, hold long enough for that to
   * be seen, then reload from the top of the page. The reload is what makes a
   * page whose board reads site.v1.lang only at boot switch at all. */
  const RELOAD_HOLD_MS = 250;
  let switching = false;

  /** languageReload in the language being switched TO — read straight out of
   *  the table, because this instance is still on the old language. */
  function reloadNote(code) {
    const dict = common[code] || common.en;
    const v = dict.languageReload ?? common.en.languageReload;
    const entry = LANGUAGES.find((l) => l.code === code);
    return typeof v === "function" ? v({ name: entry ? entry.name : code }) : v;
  }

  if (langGrid) {
    i18n.renderPicker(langGrid);
    langGrid.addEventListener("click", (e) => {
      const btn = e.target.closest(".lang-btn");
      if (!btn || !langGrid.contains(btn)) return;
      e.stopPropagation();          // renderPicker's own handler must not run
      e.preventDefault();
      const code = btn.dataset.lang;
      if (switching || !code || code === i18n.lang) return;
      switching = true;

      // 1. the tap is acknowledged before anything moves
      for (const b of langGrid.querySelectorAll(".lang-btn")) b.setAttribute("aria-pressed", String(b === btn));
      // 2. what is happening, in the new language, politely announced
      if (langNote) langNote.textContent = reloadNote(code);
      track("language_change", { from_lang: i18n.lang, to_lang: code, placement: "nav_panel" });
      // The panel goes fully opaque for the hold: the person sees one solid
      // surface, never a flash of half-drawn board. (It also covers the one
      // side effect of setLang() — it re-translates the whole document with
      // this instance's common-only table, which the reload then undoes.)
      panel.classList.add("nav-panel-switching");
      i18n.setLang(code);
      applyOwn();
      // 3. hold, then come back at the top rather than at a remembered
      //    board offset — that offset is the part that reads as a crash.
      window.setTimeout(() => {
        window.scrollTo(0, 0);
        location.reload();
      }, RELOAD_HOLD_MS);
    }, true);
  }

  /* ---- cross-game clicks from the panel ----------------------------------
   * On a game page the game already wires every a[data-crossgame-to]
   * (game.js wireCrossGameLinks, <game>/src/main.js) and would report these
   * twice if we did it here too. The pages with no game runtime — about,
   * contact, privacy, terms, /guides/ — are the ones sync-games.mjs marks
   * data-nav-from="site", and there this is the only wiring there is. */
  if (FROM === "site") {
    for (const a of document.querySelectorAll("a[data-crossgame-to]")) {
      a.addEventListener("click", () => {
        track("cross_game_click", {
          from: "site",
          to: a.dataset.crossgameTo,
          placement: a.dataset.placement || "unknown",
        });
      });
    }
  }

  applyOwn();
  markCurrentCard();
  i18n.onChange(applyOwn);
}
