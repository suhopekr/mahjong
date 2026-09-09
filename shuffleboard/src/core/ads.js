// core/ads.js — SITE BUILD (easymahjongsolitaire.com).
//
// The portal build of this game talks to the CrazyGames HTML5 SDK through
// this one file. This site has no ad SDK at all: the whole point of the
// page is a free game with nothing in the way, and the site's
// Content-Security-Policy would refuse the SDK script anyway. So every
// export keeps its name and its signature — main.js is byte-for-byte the
// same game — but does nothing, with one deliberate exception:
//
//   requestRewardedHint() resolves "granted" at once. On the portal that
//   preview is paid for by watching an ad; here it is simply free, the same
//   policy as the site's Mahjong (unlimited hints) and Five in a Row.
//
// Nothing in this file may throw. The game must never notice measurement,
// ads, or a portal that is not there.

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0", ""]);

/** Kept from the portal build: main.js exposes a debug hook only on a
 * local dev host, and that decision still belongs here. */
function isLocalDev() {
  try {
    if (typeof location === "undefined") return false;
    if (location.protocol === "file:") return true;
    const h = location.hostname;
    if (LOCAL_HOSTS.has(h)) return true;
    if (h.endsWith(".local")) return true;
    return (
      /^192\.168\.\d{1,3}\.\d{1,3}$/.test(h) ||
      /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h) ||
      /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(h)
    );
  } catch {
    return false;
  }
}
export { isLocalDev };

/** `true` so that any offer gated on "is there an SDK to honour this"
 * still shows — it is honoured, for free. */
export function getAdSdkReadyState() {
  return true;
}

export function notifyGameplayStart() {}
export function notifyGameplayStop() {}
export function notifyLoadingStart() {}
export function notifyLoadingStop() {}
export function reportProgress() {}
export function setContext() {}

/** No interstitials on this site. */
export function onGameOver() {}

/** The preview is free here. A short pause keeps the button's "loading"
 * state from flashing for a single frame, which reads as a glitch. */
export async function requestRewardedHint() {
  await new Promise((r) => setTimeout(r, 250));
  return "granted";
}
