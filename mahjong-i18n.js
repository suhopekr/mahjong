// /mahjong-i18n.js — the bridge between the site's language runtime and
// game.js.
//
// Every other game on the site is an ES module and imports /i18n/i18n.js
// directly. Mahjong and the Daily Challenge are not: they run on game.js, a
// single 3,000-line classic script wrapped in an IIFE that predates the
// module boundary and cannot `import` anything. So this module does the
// importing, and hands game.js the finished instance on `window`.
//
// The ordering is what makes it safe, and it is not an accident:
//
//   <script src="game.js">           classic, runs the moment it is parsed —
//                                    but every line of it is inside an IIFE
//                                    that only registers a DOMContentLoaded
//                                    listener, so nothing has touched the
//                                    DOM yet.
//   <script type="module" src=…>     deferred: this file and /nav.js run
//                                    after parsing and BEFORE
//                                    DOMContentLoaded.
//   DOMContentLoaded                 game.js's initApp() — window.mahjongI18n
//                                    is already there.
//
// game.js still guards every use of it (`var t = …; if (!t) return key`), so
// a page that somehow loads game.js without this file shows English rather
// than throwing and taking the board down with it.
//
// This instance has BOTH dictionaries — common and mahjong — so unlike
// /nav.js it can safely walk the whole document: every data-i18n key on
// these two pages is in one table or the other. /nav.js's comment about a
// document-wide pass rewriting a game's own keys is exactly the case this
// file avoids by being the game's own instance.
import { createI18n } from "/i18n/i18n.js";
import { common } from "/i18n/common.js";
import { mahjong } from "/i18n/mahjong.js";
import { wireLanguageGrid } from "/i18n/switch.js";

const i18n = createI18n({ common, game: mahjong });

// game.js reads this at DOMContentLoaded and keeps it for the life of the
// page. Nothing here is mutated afterwards: a language change reloads.
window.mahjongI18n = i18n;

i18n.applyStatic(document);

// Settings' own language grid, the same fourteen buttons the top bar's panel
// shows. Both are wired by /i18n/switch.js so a tap does the same thing in
// both places. daily.html and index.html both carry the grid; a page that
// does not is left alone.
wireLanguageGrid({
  i18n,
  common,
  grid: document.getElementById("mahjong-lang-grid"),
  note: document.getElementById("mahjong-lang-note"),
  onSwitch(code) {
    if (typeof window.gtag === "function") {
      window.gtag("event", "language_change", {
        from_lang: i18n.lang, to_lang: code, placement: "settings",
      });
    }
  },
});
