// game/textures.js
// The two ground textures, and nothing else.
//
// Obstacles that STAND on the board are lit forms drawn in the stones'
// own language, with no texture at all -- a texture on one of those is
// exactly the ornament that language exists to avoid. A zone is the
// opposite case: it is not an object, it is a patch of different ground,
// and there is no shape to read. Surface is the only thing left to say
// "you cannot stop here" or "this eats your shot", so the zones, and only
// the zones, get real texture.
//
// Everything degrades to nothing: before an image loads, or in a headless
// test, `texture()` returns null and game/render.js draws the flat tinted
// patch it would otherwise draw underneath.

const NAMES = ["ice", "mud"];
const images = new Map();
let started = false;

export function loadTextures() {
  if (started || typeof Image === "undefined") return;
  started = true;
  for (const name of NAMES) {
    const img = new Image();
    img.src = new URL(`../../assets/textures/${name}.png`, import.meta.url).href;
    images.set(name, img);
  }
}

/** Resolves once both tiles have loaded or failed. The screenshot and
 * browser suites wait on this, or they photograph the fallback. */
export function texturesReady() {
  loadTextures();
  return Promise.all([...images.values()].map((img) =>
    img.complete ? Promise.resolve() : new Promise((r) => { img.onload = r; img.onerror = r; })
  ));
}

export function texture(name) {
  loadTextures();
  const img = images.get(name);
  return img && img.complete && img.naturalWidth > 0 ? img : null;
}
