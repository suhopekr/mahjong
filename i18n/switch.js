// /i18n/switch.js — what a tap on a language button does.
//
// Two places on a Mahjong page now offer the fourteen languages: the top
// bar's panel (/nav.js) and Settings (/mahjong-i18n.js). They must behave
// identically, and the behaviour is not obvious, so it lives here once
// instead of being written twice and drifting.
//
// The order is the point (DESIGN.md §4):
//   1. acknowledge the tap immediately — aria-pressed moves before anything
//      else, because the tap is the only thing the person is sure of;
//   2. say what is about to happen IN THE LANGUAGE BEING SWITCHED TO, read
//      straight out of the table (the live instance is still on the old
//      language and cannot say it);
//   3. hold long enough for that sentence to be seen;
//   4. reload from the TOP of the page.
//
// The reload is not laziness. Mahjong runs on game.js, a classic script that
// reads the language once at boot and draws 144 tiles from it; a live swap
// would leave half a board in each language. Coming back at scroll 0 rather
// than at a remembered board offset is deliberate too — that offset is the
// part that reads as a crash.
import { LANGUAGES } from "/i18n/i18n.js";

export const RELOAD_HOLD_MS = 250;

/** `languageReload` in the language being switched TO. */
export function reloadNote(common, code) {
  const dict = common[code] || common.en;
  const v = dict.languageReload ?? common.en.languageReload;
  const entry = LANGUAGES.find((l) => l.code === code);
  return typeof v === "function" ? v({ name: entry ? entry.name : code }) : v;
}

/** Draw the grid and take over its clicks.
 *
 *  i18n.renderPicker() draws the buttons and gives each one a handler that
 *  calls setLang() and stops there; we need the reload as well. So this
 *  listener is registered in the CAPTURE phase and stops the event before
 *  the button's own handler ever sees it — one place decides what a language
 *  tap does, and renderPicker stays the same function every game uses.
 *
 *  `onSwitch(code)` runs after the announcement and before the hold: the bar
 *  uses it to go opaque and to send the analytics event. */
export function wireLanguageGrid({ i18n, common, grid, note, onSwitch }) {
  if (!grid) return;
  let switching = false;
  i18n.renderPicker(grid);
  grid.addEventListener("click", (e) => {
    const btn = e.target.closest(".lang-btn");
    if (!btn || !grid.contains(btn)) return;
    e.stopPropagation();            // renderPicker's own handler must not run
    e.preventDefault();
    const code = btn.dataset.lang;
    if (switching || !code || code === i18n.lang) return;
    switching = true;

    for (const b of grid.querySelectorAll(".lang-btn")) {
      b.setAttribute("aria-pressed", String(b === btn));
    }
    if (note) note.textContent = reloadNote(common, code);
    if (typeof onSwitch === "function") onSwitch(code);
    i18n.setLang(code);
    window.setTimeout(() => {
      window.scrollTo(0, 0);
      location.reload();
    }, RELOAD_HOLD_MS);
  }, true);
}
