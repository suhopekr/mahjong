// test/chapters.test.js
// The chapter tally is the one number a player reads about ten stages of
// their own play, so it has to be right about the awkward cases: a
// chapter finished across several sittings, a stage replayed better, and
// a save old enough not to have recorded a turn count at all.
function mockLocalStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
  };
}
const KEY = "stoneflick-save";
global.localStorage = mockLocalStorage();

const { test, assertEqual, assertTrue } = await import("./harness.js");
const storage = await import("../src/core/storage.js");
const { STAGES } = await import("../src/game/stages.js");
const {
  CHAPTER_SIZE, CHAPTER_COUNT, chapterOf, stagesInChapter, isChapterEnd, summariseChapter,
} = await import("../src/game/chapters.js");

function reloadWith(save) {
  global.localStorage = mockLocalStorage(save ? { [KEY]: JSON.stringify(save) } : {});
  storage.reloadFromStorage();
}

test("the campaign divides into whole chapters of ten", () => {
  assertEqual(CHAPTER_COUNT, 10);
  assertEqual(STAGES.length, CHAPTER_SIZE * CHAPTER_COUNT);
  // Every stage agrees with the arithmetic, so the grid's headings and
  // the result card can never disagree about which chapter a stage is in.
  for (const s of STAGES) assertEqual(s.act, chapterOf(s.id), `stage ${s.id}`);
});

test("a chapter ends on its tenth stage and nowhere else", () => {
  assertTrue(isChapterEnd(10) && isChapterEnd(100), "10 and 100 close a chapter");
  assertTrue(!isChapterEnd(1) && !isChapterEnd(9) && !isChapterEnd(11), "and 1, 9, 11 do not");
});

test("every chapter holds exactly ten stages, in order", () => {
  for (let act = 1; act <= CHAPTER_COUNT; act++) {
    const inChapter = stagesInChapter(act);
    assertEqual(inChapter.length, CHAPTER_SIZE, `chapter ${act}`);
    assertEqual(inChapter[0].id, (act - 1) * CHAPTER_SIZE + 1);
    assertEqual(inChapter[CHAPTER_SIZE - 1].id, act * CHAPTER_SIZE);
  }
});

test("the tally reads back what is stored, not what happened this session", () => {
  const stars = {}, bestTurns = {};
  for (let id = 1; id <= 10; id++) { stars[id] = 2; bestTurns[id] = 4; }
  reloadWith({ version: 2, campaign: { cleared: [1,2,3,4,5,6,7,8,9,10], stars, bestTurns, lastStageId: 11 } });
  const sum = summariseChapter(1);
  assertEqual(sum.stars, 20);
  assertEqual(sum.maxStars, 30);
  assertEqual(sum.shots, 40);
  assertEqual(sum.par, stagesInChapter(1).reduce((n, s) => n + s.par, 0));
});

test("a stage replayed better counts at its best", () => {
  // recordStageCleared only ever improves a record, so this is really a
  // check that the tally reads the record rather than the last attempt.
  reloadWith({ version: 2, campaign: { cleared: [], stars: {}, bestTurns: {}, lastStageId: 1 } });
  storage.recordStageCleared(1, 6, 1);
  const worse = summariseChapter(1).shots;
  storage.recordStageCleared(1, 2, 3);
  const better = summariseChapter(1).shots;
  assertTrue(better < worse, `a better clear should lower the chapter total (${worse} -> ${better})`);
  assertEqual(summariseChapter(1).stars, 3, "and raise its stars");
});

test("a cleared stage with no recorded turn count contributes its par, not zero", () => {
  // The one direction a summary of somebody's own record must not lie in
  // is the flattering one.
  reloadWith({ version: 2, campaign: { cleared: [1], stars: { 1: 3 }, bestTurns: {}, lastStageId: 2 } });
  const sum = summariseChapter(1);
  assertEqual(sum.shots, sum.par, "an unrecorded chapter reads as exactly par");
});

test("normal and hard chapters are totalled separately", () => {
  reloadWith({ version: 2, campaign: { cleared: [1], stars: { 1: 3 }, bestTurns: { 1: 2 }, lastStageId: 2 } });
  assertEqual(summariseChapter(1).stars, 3);
  assertEqual(summariseChapter(1, true).stars, 0, "hard has its own record and this player has none");
});

test("an empty save totals to nothing rather than crashing", () => {
  reloadWith(undefined);
  const sum = summariseChapter(1);
  assertEqual(sum.stars, 0);
  assertEqual(sum.maxStars, 30);
  assertEqual(sum.shots, sum.par, "nothing cleared reads as par, by the same rule as above");
});
