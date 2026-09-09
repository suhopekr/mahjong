// core/ads.js
// A shim for the H5 Games Ads that may come later. There is no ad SDK on
// the site today, so every function here is a no-op that resolves at
// once — but main.js already calls them at the two moments an ad would
// naturally sit (the pause after a game ends, and before a new deal), and
// routes every Hint through requestRewardedHint(). When an SDK arrives,
// this file is the only one that changes.

/** Ask the SDK to fetch an interstitial ahead of time. */
export function preloadInterstitial() { /* no-op */ }

/**
 * Show an interstitial for `reason` ("game_over" | "new_game"). Resolves
 * when the player is back on the page — immediately, today.
 */
export function showInterstitial(reason) {
  void reason;
  return Promise.resolve();
}

/**
 * Offer a rewarded ad in exchange for a hint. Resolves "granted" when the
 * hint may be shown — always, today — or "declined".
 */
export function requestRewardedHint() {
  return Promise.resolve("granted");
}
