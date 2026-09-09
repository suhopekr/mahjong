// core/samples.js
// Optional recorded sound effects, layered on top of core/audio.js's
// synthesis. The game is fully playable with no audio files at all —
// every effect falls back to its synthesized voice — so this module's
// contract is: never throw, never block, never be required.
//
// WHY A MANIFEST INSTEAD OF PROBING FOR FILES
// The obvious design is to just fetch() each expected filename and treat
// a 404 as "not provided." That works, but every missing file writes a
// red error line into the browser console, on every load, for every
// player — and a console full of 404s is how a real defect gets missed
// later. `assets/audio/manifest.json` is committed (with an empty list
// until files are added), so exactly one request is made and it always
// succeeds. Run `npm run audio:manifest` after dropping files in and it
// rewrites itself from what is actually on disk.
//
// WHY VARIANTS AND VELOCITY SHAPING ARE NOT OPTIONAL HERE
// A single sample played back at different volumes does not read as a
// harder or softer collision — the ear hears "the same event, further
// away." Real impacts get brighter, shorter and slightly higher in pitch
// with energy, so playback below applies gain, playback rate AND a
// lowpass together, from one `strength` number. And because a busy stage
// can fire a dozen collisions in a second, the same file twice in a row
// turns into a machine-gun artifact — so variants of one role are cycled
// with an explicit no-immediate-repeat rule rather than picked at random,
// which would still repeat about a quarter of the time with four files.

const MANIFEST_URL = "./assets/audio/manifest.json";

/** Every role the game can voice from a file. A role with no files
 * simply never claims a sound, and core/audio.js synthesizes instead. */
export const ROLES = ["impact", "cushion", "obstacle", "bumper", "portal", "flick", "fall", "sink", "win", "lose", "button"];

/** role -> {buffer, offset}[] — see findOnset() for what `offset` is for. */
const buffers = Object.fromEntries(ROLES.map((r) => [r, []]));
/** role -> index last played, so a variant is never repeated back to back */
const lastPlayed = {};
let loadPromise = null;
let loaded = false;

/** Filenames are `<role>[-<variant>].<ext>` — "impact-03.mp3" is an
 * `impact` variant, "sink.wav" is the only `sink`. Parsed here rather
 * than listed by hand so adding a variant is a matter of dropping the
 * file in and re-running the manifest script.
 *
 * Exported only so test/samples.test.js can check it agrees with
 * tools/build-audio-manifest.mjs's own copy of the same rule. The two
 * are deliberately separate (a build script must not import browser
 * code), and a disagreement between them is silent in the worst way: the
 * file lands in the manifest, gets fetched, decodes fine, and is then
 * dropped on the floor because the runtime does not recognize its role.
 */
export function roleOf(filename) {
  const base = filename.replace(/\.[^.]+$/, "");
  const role = base.split("-")[0].toLowerCase();
  return ROLES.includes(role) ? role : null;
}

/**
 * Where the sound actually starts, in seconds — everything before this is
 * skipped at playback time.
 *
 * Two separate problems, one fix.
 *
 * A recorded file usually has some quiet lead-in before the transient.
 * The file that prompted this had 30ms of low-level room tone before the
 * strike, which is not silence (a -50dB silence detector walks straight
 * past it) but is very much a delay: on an impact sound, 30ms between the
 * stones touching and the clack is audible as the sound being LATE.
 *
 * And every lossy codec prepends encoder delay. Chrome strips MP3's
 * correctly — measured, not assumed: a 96kbps mono file decoded there
 * starts at 0.02ms. Safari has historically not, which would put ~26ms
 * back in front of every impact on iPhone, and there is no way to test
 * that from here.
 *
 * Scanning the decoded samples solves both at once and depends on
 * neither: whatever the format did, playback starts at the first sample
 * that is actually audible. It also means a sloppy file just works, which
 * matters because the person dropping sounds in should not have to be an
 * audio engineer.
 *
 * 1% of peak is the threshold. Low enough to keep the very front of a
 * soft attack, high enough to skip dither, room tone and codec ringing.
 */
function findOnset(buffer) {
  const data = buffer.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < data.length; i++) {
    const v = data[i] < 0 ? -data[i] : data[i];
    if (v > peak) peak = v;
  }
  if (peak === 0) return 0;
  const threshold = peak * 0.01;
  for (let i = 0; i < data.length; i++) {
    const v = data[i] < 0 ? -data[i] : data[i];
    if (v > threshold) return i / buffer.sampleRate;
  }
  return 0;
}

/**
 * Fetch the manifest, revalidating it, with the cached copy as a
 * fallback.
 *
 * THIS USED TO BE ONE LINE with `cache: "force-cache"`, and that was a
 * real reported bug: a new sound file was added, the manifest listed it,
 * and the game kept playing the synthesized voice. `force-cache` tells
 * the browser to use a stored response no matter how stale, and never to
 * ask again — so a player who had ever loaded the game before the file
 * was added would keep the old sound set forever, on every subsequent
 * visit, with the new file sitting right there on the server.
 *
 * The distinction the original missed is that the manifest is an INDEX,
 * not an asset. Its entire job is to say what exists RIGHT NOW, so it is
 * the one file here that must be revalidated. It costs a conditional
 * request against sixty bytes and usually comes back 304.
 *
 * The audio files themselves keep `force-cache`: they are content, they
 * are immutable under a given name (see assets/audio/README.md — a
 * changed sound gets a new variant number, never a quiet overwrite), and
 * they are the ones worth never re-fetching.
 *
 * The force-cache retry is not belt-and-braces: without it this module
 * would go from "works offline off the cache" to "silent offline," which
 * would be trading one regression for another.
 */
async function fetchManifest() {
  try {
    const fresh = await fetch(MANIFEST_URL, { cache: "no-cache" });
    if (fresh.ok) return fresh;
  } catch {
    /* offline, or the request was blocked — try whatever is stored */
  }
  try {
    const cached = await fetch(MANIFEST_URL, { cache: "force-cache" });
    if (cached.ok) return cached;
  } catch {
    /* nothing stored either */
  }
  return null;
}

/**
 * Fetch the manifest and decode everything it lists. Safe to call
 * repeatedly — the first call owns the work and the rest await it.
 * Resolves (never rejects) once every file has either decoded or been
 * given up on.
 * @param {AudioContext} audioCtx
 */
export function loadSamples(audioCtx) {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    let files = [];
    const response = await fetchManifest();
    if (!response) return; // no manifest, offline — synthesis covers everything
    try {
      const manifest = await response.json();
      files = Array.isArray(manifest?.files) ? manifest.files : [];
    } catch {
      return; // malformed
    }
    await Promise.all(
      files.map(async (name) => {
        const role = roleOf(name);
        if (!role) return;
        try {
          const response = await fetch(`./assets/audio/${name}`, { cache: "force-cache" });
          if (!response.ok) return;
          const bytes = await response.arrayBuffer();
          // decodeAudioData is the one call here that can reject on a
          // file the browser simply cannot read (a .wav Safari dislikes,
          // a truncated download). One bad file must not cost the other
          // twenty, hence per-file try/catch rather than one around the
          // batch.
          const buffer = await audioCtx.decodeAudioData(bytes);
          buffers[role].push({ buffer, offset: findOnset(buffer) });
        } catch {
          /* skip this file */
        }
      })
    );
    loaded = true;
  })();
  return loadPromise;
}

/** True once at least one file for `role` is decoded and ready. Checked
 * synchronously by every effect in core/audio.js, so a sound that fires
 * before loading finishes is synthesized rather than dropped. */
export function hasSample(role) {
  return loaded && buffers[role]?.length > 0;
}

function pickVariant(role) {
  const list = buffers[role];
  if (list.length === 1) return 0;
  let index = Math.floor(Math.random() * list.length);
  if (index === lastPlayed[role]) index = (index + 1) % list.length;
  lastPlayed[role] = index;
  return index;
}

/**
 * Play one variant of `role`.
 *
 * `strength` (0..1) drives three things at once, which is what makes one
 * recording cover a whole range of collision energies:
 *   - gain, on a perceptual curve (^0.65) rather than linearly, because
 *     halving amplitude is nowhere near "half as loud";
 *   - playback rate, a narrow +-12% — enough to sell a harder strike,
 *     narrow enough that it never sounds like a different object;
 *   - a lowpass, which is the cue that actually carries. A soft contact
 *     genuinely has less high-frequency content, and dulling it is far
 *     more convincing than turning it down.
 *
 * @param {AudioContext} audioCtx
 * @param {string} role
 * @param {{strength?: number, gain?: number}} [options] - `gain` is a
 *   flat multiplier for roles with no velocity (UI, win/lose stingers).
 * @returns {boolean} false if nothing was played, so the caller can
 *   synthesize instead.
 */
export function playSample(audioCtx, role, { strength = 1, gain = 1 } = {}) {
  if (!hasSample(role)) return false;
  const energy = Math.max(0, Math.min(1, strength));
  const { buffer, offset } = buffers[role][pickVariant(role)];
  const source = audioCtx.createBufferSource();
  source.buffer = buffer;
  // A small random pitch wobble on top of the energy mapping. With
  // several variants installed the no-repeat rule carries most of the
  // load, but a role with only ONE file has nothing to alternate with,
  // and the same 4KB of audio fired a dozen times in a second is the
  // most recognisable artifact in game audio. The synth voice already
  // does exactly this for the same reason (core/audio.js's own
  // "반복 회피 랜덤화"); ±4% is under the threshold of sounding like a
  // different object.
  const wobble = 0.96 + Math.random() * 0.08;
  source.playbackRate.value = (0.88 + energy * 0.24) * wobble;

  const tone = audioCtx.createBiquadFilter();
  tone.type = "lowpass";
  // Exponential rather than linear: pitch and brightness are both
  // logarithmic to the ear, so a linear sweep spends most of its range
  // in the top octave where it is least audible.
  tone.frequency.value = 700 * Math.pow(20000 / 700, energy);

  const level = audioCtx.createGain();
  level.gain.value = gain * Math.pow(energy, 0.65);

  source.connect(tone);
  tone.connect(level);
  level.connect(audioCtx.destination);
  // Start at the onset, not at the top of the file — see findOnset.
  source.start(0, offset);
  source.onended = () => {
    source.disconnect();
    tone.disconnect();
    level.disconnect();
  };
  return true;
}
