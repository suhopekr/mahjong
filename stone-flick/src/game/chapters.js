// game/chapters.js
// What a chapter IS, and what one is worth when you finish it.
//
// Chapters were built for the stage GRID: a hundred cards in one scroll
// has no landmark, so ten headings of ten give one. In play they said
// nothing, and measuring the campaign showed why — every element is
// introduced by stage 19, so chapters 3 to 10 share a single vocabulary
// and differ only in par (3.1 rising to 5.3 across them) and in how many
// stones the opponent has. There was no content change at a boundary, so
// there was nothing to announce.
//
// What there IS at a boundary is ten stages of the player's own record.
// This module totals it, and main.js reads it back on the card that
// closes the chapter. It lives here rather than in main.js because it is
// arithmetic over the campaign and the save — domain, not interface — and
// because arithmetic in a DOM module is arithmetic nobody can test.

import { STAGES } from "./stages.js";
import { getStars, getBestTurns } from "../core/storage.js";

/** Stages per chapter. Ten, and the campaign is a hundred. */
export const CHAPTER_SIZE = 10;

/** How many chapters the campaign has. Derived, so adding stages does not
 * leave a constant behind. */
export const CHAPTER_COUNT = Math.ceil(STAGES.length / CHAPTER_SIZE);

/** @param {number} id stage id @returns {number} 1-based chapter */
export function chapterOf(id) {
  return Math.ceil(id / CHAPTER_SIZE);
}

/** @param {number} act 1-based @returns {object[]} that chapter's stages */
export function stagesInChapter(act) {
  return STAGES.filter((s) => s.act === act);
}

/** True on the last stage of a chapter — the one whose clear closes it. */
export function isChapterEnd(id) {
  return id % CHAPTER_SIZE === 0;
}

/**
 * Ten stages of record, totalled.
 *
 * Built from what is STORED, not from the session that happened to finish
 * the chapter: a chapter played across three sittings still totals
 * correctly, and a stage the player went back and did better counts at
 * its best rather than at whatever they did the first time.
 *
 * @param {number} act 1-based chapter
 * @param {boolean} hard which track's records to total — the two keep
 *   separate stars and separate bests, so a chapter has two summaries
 * @returns {{stars:number, maxStars:number, shots:number, par:number}}
 */
export function summariseChapter(act, hard = false) {
  const stages = stagesInChapter(act);
  let stars = 0;
  let shots = 0;
  let par = 0;
  for (const s of stages) {
    stars += getStars(s.id, hard);
    // A stage cleared but with no recorded turn count — an older save, or
    // one written before bestTurns existed — contributes its par rather
    // than a zero. Zero would make the total flatter than the player
    // actually played, which is the one direction a summary of somebody's
    // own record must not lie in.
    shots += getBestTurns(s.id, hard) || s.par;
    par += s.par;
  }
  return { stars, maxStars: stages.length * 3, shots, par };
}
