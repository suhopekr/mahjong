// core/ads.js — a shim for future H5 Games Ads. No SDK on the site today;
// the site's Content-Security-Policy would refuse one anyway. Every
// export keeps the name and signature main.js calls, and does nothing:
//
//   preloadInterstitial()          no-op
//   showInterstitial(reason)       resolves at once (game over is the one
//                                  natural pause where one could appear)
//   requestRewardedHint()          resolves "granted" — hints are free here
//
// Nothing in this file may throw.

export function preloadInterstitial() {}

export function showInterstitial(reason) {
  void reason;
  return Promise.resolve();
}

/** A short pause keeps a button's "loading" state from flashing for a
 * single frame, which reads as a glitch. */
export async function requestRewardedHint() {
  await new Promise((r) => setTimeout(r, 200));
  return "granted";
}
