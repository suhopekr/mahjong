// core/ads.js
// A shim for the H5 Games Ads that may come later. Today there is no ad
// SDK on the site, so every call here is a no-op that resolves at once —
// but main.js already routes the two ad moments through it (the pause at
// the end of a puzzle, and a hint), so wiring a real SDK in later is a
// change to this file alone.
//
//   preloadInterstitial()       ask the SDK to have an ad ready
//   showInterstitial(reason)    resolves when the ad is over (at once, today);
//                               reason is "game_over" or "new_game"
//   requestRewardedHint()       resolves "granted" when the player may have
//                               the hint (always, today)

export function preloadInterstitial() { /* no SDK yet */ }

export function showInterstitial(reason) {
  void reason;
  return Promise.resolve();
}

export function requestRewardedHint() {
  return Promise.resolve("granted");
}
