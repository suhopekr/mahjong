// test/tips.test.js
// The tip line is the one place in this game that speaks to the player in
// sentences, and every failure mode is a social one rather than a crash:
// telling someone the same thing twice, telling them to turn a phone they
// are not holding, or explaining the pit on a board that has none. So the
// tests here are mostly about WHICH tip, not whether one appears.
const { test, assertEqual, assertTrue } = await import("./harness.js");
const {
  TIPS, TIP_IDS, CHAPTER_TIPS, chapterTip, tipForLoss,
} = await import("../src/game/tips.js");

const loss = (over = {}, seen = []) =>
  tipForLoss(
    {
      stage: { obstacles: [] },
      mutual: false,
      ownGoals: 0,
      opponentsLeft: 1,
      lossStreak: 0,
      shotsOverPar: 0,
      ...over,
    },
    seen
  );

// game/briefings.js's kindOf() reads a zone's friction to tell sand from
// ice (>= 1 is sand), so the fixtures carry the real numbers from the
// campaign rather than a bare type.
const SAND = { type: "zone", friction: 3.4 };
const ICE = { type: "zone", friction: 0.32 };
const withObstacles = (...obstacles) => ({
  obstacles: obstacles.map((o) => (typeof o === "string" ? { type: o } : o)),
});

test("every tip in the catalogue is a real sentence", () => {
  for (const id of TIP_IDS) {
    const tip = TIPS[id];
    assertEqual(tip.id, id, `${id} carries its own id`);
    assertTrue(tip.text.length > 30, `${id} says something`);
    assertTrue(/[.?]$/.test(tip.text), `${id} ends in a full stop`);
    // The voice rule from the file header, and the one most likely to be
    // broken by a later hand: tips are advice, not announcements.
    assertTrue(!tip.text.includes("!"), `${id} does not shout`);
  }
});

test("ids are unique, which is what the save leans on", () => {
  assertEqual(new Set(TIP_IDS).size, TIP_IDS.length);
});

test("every chapter tip names a real tip, and none is used twice", () => {
  for (const id of CHAPTER_TIPS) assertTrue(id in TIPS, `${id} exists`);
  assertEqual(new Set(CHAPTER_TIPS).size, CHAPTER_TIPS.length, "no repeats across chapters");
});

test("a chapter gets its own tip", () => {
  assertEqual(chapterTip(1, []).id, CHAPTER_TIPS[0]);
  assertEqual(chapterTip(3, []).id, CHAPTER_TIPS[2]);
});

test("and falls forward when a loss card already gave it away", () => {
  // The realistic case: the player met a bumper stage, lost on it, and
  // was told about bumpers there. The chapter card must not repeat it.
  const seen = [CHAPTER_TIPS[0]];
  assertEqual(chapterTip(1, seen).id, CHAPTER_TIPS[1], "takes the next unseen one");
});

test("and goes quiet rather than repeating once they are spent", () => {
  assertEqual(chapterTip(1, [...CHAPTER_TIPS]), null);
  assertEqual(chapterTip(99, []).id, CHAPTER_TIPS[0], "a chapter past the list still gets something");
});

test("beating yourself is named before anything else", () => {
  assertEqual(loss({ mutual: true }).id, "mutual", "a mutual wipeout is its own lesson");
  assertEqual(loss({ ownGoals: 2 }).id, "overshoot");
  assertEqual(
    loss({ ownGoals: 2, stage: withObstacles("hole") }).id,
    "pit",
    "own stones lost on a board with a pit gets the pit tip, not the generic one"
  );
});

test("the board decides when the player did nothing obviously wrong", () => {
  assertEqual(loss({ stage: withObstacles("hole") }).id, "pit");
  assertEqual(loss({ stage: withObstacles(SAND) }).id, "sand");
  assertEqual(loss({ stage: withObstacles(ICE) }).id, "ice");
  assertEqual(loss({ stage: withObstacles(ICE, SAND) }).id, "sand", "sand is named first when a stage has both");
  assertEqual(loss({ stage: withObstacles("portal") }).id, "portal");
  assertEqual(loss({ stage: withObstacles("bumper") }).id, "bumper");
});

test("and how the match was going when it does not", () => {
  assertEqual(loss({ opponentsLeft: 4 }).id, "edge", "a board still full of theirs");
  assertEqual(loss({ lossStreak: 3 }).id, "setup", "stuck on this stage");
  assertEqual(loss({ shotsOverPar: 4 }).id, "thin", "spending shots without taking stones");
});

test("nothing is ever said twice", () => {
  const seen = [];
  for (let i = 0; i < TIP_IDS.length + 3; i++) {
    const tip = loss({}, seen);
    if (!tip) break;
    assertTrue(!seen.includes(tip.id), `${tip.id} was not already given`);
    seen.push(tip.id);
  }
  assertEqual(loss({}, seen), null, "and the line goes away once they are spent");
});

test("the toast's own tip never turns up on a result card", () => {
  // `landscape` belongs to the orientation toast. A result card offering
  // to turn your phone sideways would be the game losing track of where
  // it is.
  const seen = [];
  for (let i = 0; i < TIP_IDS.length + 3; i++) {
    const tip = loss({}, seen);
    if (!tip) break;
    assertTrue(tip.id !== "landscape", `${tip.id} is card-appropriate`);
    seen.push(tip.id);
  }
  assertTrue(seen.length > 0, "some tips did appear");
});
