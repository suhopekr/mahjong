/* =========================================================================
 * game.js — Mahjong Solitaire
 *
 * 모듈 없이 단일 파일, 아래 섹션 주석으로 논리적으로 구분한다:
 *   [LAYOUT]   좌표 데이터 (레이아웃 추가는 데이터 추가만으로 가능하게)
 *   [RULES]    free 판정 · 매칭 판정 · 남은 짝 계산 · 힌트 탐색
 *   [BOARD]    역순 생성 알고리즘 · 셔플 · 이동 스택(undo)
 *   [SELFTEST] runSelfTest() — 생성 1,000판 풀이 가능 검증
 *   [RENDER]   DOM/SVG 렌더링 (뒤 단계에서 추가)
 *   [UI]       버튼 · 설정 패널 (뒤 단계에서 추가)
 *   [STORAGE]  localStorage (뒤 단계에서 추가)
 *
 * 브라우저(window)와 Node(자체 테스트) 양쪽에서 동작하도록 ROOT를 통해
 * 전역 네임스페이스에 export한다.
 * ========================================================================= */
'use strict';

(function () {
  var ROOT = (typeof window !== 'undefined') ? window : globalThis;
  var MahjongTiles = ROOT.MahjongTiles; // tiles.js가 먼저 로드되어 있어야 함

  /* =======================================================================
   * [LAYOUT] 좌표 데이터
   *
   * 좌표계: (x, y, z) half-tile 정수 그리드. 타일 1개의 폭/높이 = 2 단위.
   * 같은 층(z) 안에서는 2 단위 간격 그리드를 쓰고, 층이 바뀔 때는 1 단위
   * (반 칸)씩 오프셋을 주어 상위 타일이 하위 두 타일 사이에 얹히는 표준
   * 넛징(half-tile overlap) 형태를 만든다.
   *
   * "클래식 거북이(Turtle)" 배치: 바닥 2겹(같은 자리 완전히 겹침, 43장씩)
   * 위에 30 → 16 → 8 → 2장으로 좁아지는 산 모양을 얹고, 중간 높이(z=1)
   * 좌우로 튀어나온 "귀" 타일 2장을 더해 총 144칸.
   * 새 레이아웃은 이 파일 상단에 좌표 배열만 추가하면 된다(로직 불변).
   * ======================================================================= */

  function buildRoundedRect(rows, cols, corner) {
    // rows x cols 사각형에서 네 모서리를 계단식으로 `corner`만큼 깎은
    // 불리언 격자를 반환한다.
    var grid = [];
    for (var r = 0; r < rows; r++) {
      var row = [];
      for (var c = 0; c < cols; c++) {
        var dr = Math.min(r, rows - 1 - r);
        var dc = Math.min(c, cols - 1 - c);
        row.push((dr + dc) >= corner);
      }
      grid.push(row);
    }
    return grid;
  }

  function gridCells(grid) {
    var out = [];
    for (var r = 0; r < grid.length; r++) {
      for (var c = 0; c < grid[r].length; c++) {
        if (grid[r][c]) out.push([r, c]);
      }
    }
    return out;
  }

  function buildTurtleLayout() {
    var BASE_COLS = 11;
    var BASE_ROWS = 5;

    // 층 사이는 항상 half-tile(홀수 폭 차) 오프셋으로 얹혀, 아래 한 장이
    // 위 여러 장에 걸쳐 부분적으로만 덮이는 표준 넛징 구조를 만든다.
    // (동일 폭으로 완전히 겹쳐 쌓으면 역순 생성 시 두 층이 1:1로 종속돼
    // 막다른 상태에 빠지기 쉬우므로 피한다.)
    var layers = [
      { grid: buildRoundedRect(5, 11, 2), z: 0, colWidth: 11, rowHeight: 5 },
      { grid: buildRoundedRect(4, 10, 0), z: 1, colWidth: 10, rowHeight: 4 },
      { grid: buildRoundedRect(5, 7, 1), z: 2, colWidth: 7, rowHeight: 5 },
      { grid: buildRoundedRect(4, 4, 0), z: 3, colWidth: 4, rowHeight: 4 },
      { grid: buildRoundedRect(2, 5, 0), z: 4, colWidth: 5, rowHeight: 2 },
      { grid: buildRoundedRect(1, 2, 0), z: 5, colWidth: 2, rowHeight: 1 },
    ];

    var slots = [];
    layers.forEach(function (layer) {
      var xShift = BASE_COLS - layer.colWidth; // 열 폭 차이를 중앙 정렬(반 칸 오프셋 자연 발생)
      var yShift = BASE_ROWS - layer.rowHeight;
      gridCells(layer.grid).forEach(function (rc) {
        var r = rc[0], c = rc[1];
        slots.push({ x: 2 * c + xShift, y: 2 * r + yShift, z: layer.z });
      });
    });

    // 상징적인 "귀" 타일 2장: z=1, 세로 중앙(y=4)에서 본체 좌우 바깥으로 돌출.
    slots.push({ x: -2, y: 4, z: 1 });
    slots.push({ x: 22, y: 4, z: 1 });

    // 무결성 자체 검증 (레이아웃 데이터 버그는 로드 시점에 바로 드러나야 함)
    if (slots.length !== 144) {
      throw new Error('[layout] turtle layout must have exactly 144 slots, got ' + slots.length);
    }
    var seen = new Set();
    slots.forEach(function (s) {
      var k = s.x + '_' + s.y + '_' + s.z;
      if (seen.has(k)) throw new Error('[layout] duplicate slot coordinate ' + k);
      seen.add(k);
    });

    return slots;
  }

  var LAYOUTS = {
    turtle: {
      id: 'turtle',
      name: 'Turtle (Classic)',
      slots: buildTurtleLayout(),
    },
  };

  /* ---- 슬롯 그래프(인접/피복 관계) 전처리 --------------------------------
   * generateBoard / rules 양쪽에서 재사용하므로 레이아웃당 한 번만 계산해
   * 캐시한다.
   * ------------------------------------------------------------------- */
  function buildSlotGraph(layoutSlots) {
    var n = layoutSlots.length;
    var keyOf = function (x, y, z) { return x + '_' + y + '_' + z; };
    var indexByKey = new Map();
    layoutSlots.forEach(function (s, i) { indexByKey.set(keyOf(s.x, s.y, s.z), i); });

    var byZ = new Map();
    layoutSlots.forEach(function (s, i) {
      if (!byZ.has(s.z)) byZ.set(s.z, []);
      byZ.get(s.z).push(i);
    });
    var zLevels = Array.from(byZ.keys()).sort(function (a, b) { return a - b; });

    var coverOf = new Array(n);
    for (var i = 0; i < n; i++) {
      var s = layoutSlots[i];
      var covers = [];
      for (var zi = 0; zi < zLevels.length; zi++) {
        var z = zLevels[zi];
        if (z <= s.z) continue;
        var bucket = byZ.get(z);
        for (var bi = 0; bi < bucket.length; bi++) {
          var j = bucket[bi];
          var t = layoutSlots[j];
          if (Math.abs(t.x - s.x) < 2 && Math.abs(t.y - s.y) < 2) covers.push(j);
        }
      }
      coverOf[i] = covers;
    }

    var leftOf = new Array(n);
    var rightOf = new Array(n);
    for (var i2 = 0; i2 < n; i2++) {
      var s2 = layoutSlots[i2];
      var lKey = keyOf(s2.x - 2, s2.y, s2.z);
      var rKey = keyOf(s2.x + 2, s2.y, s2.z);
      leftOf[i2] = indexByKey.has(lKey) ? indexByKey.get(lKey) : -1;
      rightOf[i2] = indexByKey.has(rKey) ? indexByKey.get(rKey) : -1;
    }

    return { slots: layoutSlots, n: n, coverOf: coverOf, leftOf: leftOf, rightOf: rightOf, indexByKey: indexByKey, keyOf: keyOf };
  }

  var _graphCache = new Map();
  function getSlotGraph(layoutId) {
    if (!_graphCache.has(layoutId)) {
      _graphCache.set(layoutId, buildSlotGraph(LAYOUTS[layoutId].slots));
    }
    return _graphCache.get(layoutId);
  }

  /* =======================================================================
   * [RULES] free 판정 · 매칭 판정
   * ======================================================================= */

  // 슬롯 idx가 현재 occupied(불리언 배열, 자기 자신 제외 다른 슬롯들의 점유
  // 여부) 기준으로 "열린(free)" 상태인지 판정한다.
  // - 위에 (부분적으로라도) 덮은 타일이 없어야 함
  // - 같은 층에서 왼쪽 또는 오른쪽 중 한쪽이 비어 있어야 함(보드 밖도 "비어있음")
  function isSlotFree(graph, idx, occupied) {
    var covers = graph.coverOf[idx];
    for (var k = 0; k < covers.length; k++) {
      if (occupied[covers[k]]) return false;
    }
    var l = graph.leftOf[idx];
    var r = graph.rightOf[idx];
    var leftEmpty = (l === -1) || !occupied[l];
    var rightEmpty = (r === -1) || !occupied[r];
    return leftEmpty || rightEmpty;
  }

  function tilesMatch(tileIdA, tileIdB) {
    if (!tileIdA || !tileIdB) return false;
    var defA = MahjongTiles.TILE_DEF_BY_ID[tileIdA];
    var defB = MahjongTiles.TILE_DEF_BY_ID[tileIdB];
    if (!defA || !defB) return false;
    return defA.matchGroup === defB.matchGroup;
  }

  // 현재 보드(occupied 배열 + tileId 배열)에서 열린 슬롯 인덱스 목록.
  function computeFreeSlots(graph, occupied) {
    var out = [];
    for (var i = 0; i < graph.n; i++) {
      if (occupied[i] && isSlotFree(graph, i, occupied)) out.push(i);
    }
    return out;
  }

  // 현재 보드에서 매칭 가능한 (열린 & 서로 매칭되는) 짝 전부.
  function computeAvailablePairs(graph, occupied, tileId) {
    var freeSlots = computeFreeSlots(graph, occupied);
    var byGroup = new Map();
    freeSlots.forEach(function (i) {
      var mg = MahjongTiles.TILE_DEF_BY_ID[tileId[i]].matchGroup;
      if (!byGroup.has(mg)) byGroup.set(mg, []);
      byGroup.get(mg).push(i);
    });
    var pairs = [];
    byGroup.forEach(function (list) {
      for (var a = 0; a < list.length; a++) {
        for (var b = a + 1; b < list.length; b++) {
          pairs.push([list[a], list[b]]);
        }
      }
    });
    return pairs;
  }

  function countAvailablePairs(graph, occupied, tileId) {
    // computeAvailablePairs와 동일 로직이지만 배열을 만들지 않고 개수만 셈
    // (표시용으로 자주 호출되므로 가볍게).
    var freeSlots = computeFreeSlots(graph, occupied);
    var byGroup = new Map();
    freeSlots.forEach(function (i) {
      var mg = MahjongTiles.TILE_DEF_BY_ID[tileId[i]].matchGroup;
      byGroup.set(mg, (byGroup.get(mg) || 0) + 1);
    });
    var total = 0;
    byGroup.forEach(function (count) {
      total += (count * (count - 1)) / 2;
    });
    return total;
  }

  /* =======================================================================
   * [BOARD] 역순 생성 알고리즘 · 셔플
   *
   * 원리("제거의 역순 = 배치"): 실제로 꽉 찬 보드를 플레이하며 매 단계
   * 열린(free) 슬롯 두 개를 골라 "제거"해 나가는 과정을 먼저 시뮬레이션
   * 하되, 제거할 때 비로소 그 두 슬롯에 어떤 타일 쌍이 있었는지를 확정
   * (배정)한다. 이 시뮬레이션에서 쓰는 free 판정은 그 순간까지 아직
   * "제거되지 않은"(occupied=true로 남아있는) 슬롯만을 막힘 요소로 보는,
   * 실제 플레이와 완전히 동일한 규칙이다. 따라서 시뮬레이션이 끝까지
   * 성공하면 — 즉 72쌍 전부를 막힘 없이 순서대로 "제거"할 수 있었다면 —
   * 그 제거 순서를 그대로 재생하는 것이 곧 유효한 정답 풀이가 되고, 결과
   * 보드(모든 슬롯에 배정된 타일)는 그 정의상 반드시 풀 수 있다.
   * ======================================================================= */

  function makeRng(seed) {
    // mulberry32 — 결정적(deterministic) 시드 기반 PRNG. 테스트 재현성용.
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function defaultRng() {
    return Math.random();
  }

  function shuffleArray(arr, rng) {
    rng = rng || defaultRng;
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr;
  }

  // 34종 + 꽃 + 계절을 규칙에 맞는 72개 짝(pair)으로 구성한다.
  // 일반 종류(count=4)는 자기 자신끼리 2쌍, 꽃/계절(그룹당 4종×1개)은
  // 그룹 내에서 임의로 짝지어 2쌍씩(와일드카드 매칭이므로 어떤 조합이든 유효).
  function buildPairPool() {
    var instancesByMatchGroup = new Map();
    MahjongTiles.TILE_DEFS.forEach(function (def) {
      for (var i = 0; i < def.count; i++) {
        if (!instancesByMatchGroup.has(def.matchGroup)) instancesByMatchGroup.set(def.matchGroup, []);
        instancesByMatchGroup.get(def.matchGroup).push(def.id);
      }
    });
    var pairs = [];
    instancesByMatchGroup.forEach(function (ids) {
      for (var i = 0; i < ids.length; i += 2) {
        pairs.push([ids[i], ids[i + 1]]);
      }
    });
    return pairs;
  }

  // 범용 버전: 시작 occupied 마스크와 짝 목록을 인자로 받는다.
  // - 새 게임: 마스크 = 전부 true(꽉 찬 보드), 짝 목록 = 정식 72쌍.
  // - 셔플: 마스크 = 아직 제거되지 않은 슬롯만 true, 짝 목록 = 현재 남은
  //   타일들로 구성한 짝 목록(개수는 항상 짝수 — 매칭 쌍만 제거되므로).
  function attemptGenerateGeneric(graph, rng, initialOccupied, pairPool) {
    var n = graph.n;
    var occupied = initialOccupied.slice();
    var tileId = new Array(n).fill(null);
    var shuffledPairs = shuffleArray(pairPool.slice(), rng);
    var order = []; // order[0] = 실제 플레이에서 가장 먼저 제거 가능한 쌍

    for (var p = 0; p < shuffledPairs.length; p++) {
      var candidates = [];
      for (var i = 0; i < n; i++) {
        if (occupied[i] && isSlotFree(graph, i, occupied)) candidates.push(i);
      }
      if (candidates.length < 2) return null; // 막다른 상태 — 이 시도는 폐기
      shuffleArray(candidates, rng);
      var slotA = candidates[0];
      var slotB = candidates[1];
      var pair = shuffledPairs[p];
      if (rng() < 0.5) { tileId[slotA] = pair[0]; tileId[slotB] = pair[1]; }
      else { tileId[slotA] = pair[1]; tileId[slotB] = pair[0]; }
      occupied[slotA] = false; occupied[slotB] = false;
      order.push([slotA, slotB]);
    }

    return { tileId: tileId, constructionOrder: order };
  }

  function attemptGenerate(graph, rng) {
    return attemptGenerateGeneric(graph, rng, new Array(graph.n).fill(true), buildPairPool());
  }

  function generateSolvableBoard(layoutId, rng, maxAttempts) {
    var graph = getSlotGraph(layoutId);
    maxAttempts = maxAttempts || 500;
    for (var attempt = 0; attempt < maxAttempts; attempt++) {
      var result = attemptGenerate(graph, rng);
      if (result) return result;
    }
    return null;
  }

  // 생성 시 기록한 제거 순서를 실제로 처음부터 재생하며, 매 단계 두 슬롯이
  // 그 시점 기준으로 진짜 free였는지, 서로 매칭되는지 검증한다. 성공하면
  // "이 보드를 처음부터 끝까지 완전히 제거하는 순서가 실제로 존재함"이
  // 확인된다 — 셀프테스트의 핵심 검증 로직.
  function verifySolvableByReplay(graph, tileId, constructionOrder) {
    var n = graph.n;
    var occupied = new Array(n).fill(true);
    for (var i = 0; i < constructionOrder.length; i++) {
      var pair = constructionOrder[i];
      var a = pair[0], b = pair[1];
      if (!occupied[a] || !occupied[b]) return false;
      if (!isSlotFree(graph, a, occupied)) return false;
      if (!isSlotFree(graph, b, occupied)) return false;
      if (!tilesMatch(tileId[a], tileId[b])) return false;
      occupied[a] = false; occupied[b] = false;
    }
    for (var k = 0; k < n; k++) {
      if (occupied[k]) return false;
    }
    return true;
  }

  // 독립적인 백트래킹 솔버(추가 검증용). replay와 달리 생성 시 기록한 순서를
  // 그대로 따르지 않고, 매 단계 실제로 가능한 모든 free 매칭 짝을 탐색해
  // "플레이 방식과 무관하게" 완전 클리어 경로가 존재하는지 확인한다.
  function solveBoardExists(graph, tileId, nodeBudget) {
    var n = graph.n;
    var occupied = new Array(n).fill(true);
    var remaining = n;
    var nodes = 0;
    nodeBudget = nodeBudget || 30000;

    function freePairs() {
      var byGroup = new Map();
      for (var i = 0; i < n; i++) {
        if (occupied[i] && isSlotFree(graph, i, occupied)) {
          var mg = MahjongTiles.TILE_DEF_BY_ID[tileId[i]].matchGroup;
          if (!byGroup.has(mg)) byGroup.set(mg, []);
          byGroup.get(mg).push(i);
        }
      }
      var pairs = [];
      byGroup.forEach(function (list) {
        for (var a = 0; a < list.length; a++) {
          for (var b = a + 1; b < list.length; b++) pairs.push([list[a], list[b]]);
        }
      });
      return pairs;
    }

    function dfs() {
      nodes++;
      if (nodes > nodeBudget) return false;
      if (remaining === 0) return true;
      var pairs = freePairs();
      if (pairs.length === 0) return false;
      for (var k = 0; k < pairs.length; k++) {
        var a = pairs[k][0], b = pairs[k][1];
        occupied[a] = false; occupied[b] = false; remaining -= 2;
        if (dfs()) return true;
        occupied[a] = true; occupied[b] = true; remaining += 2;
      }
      return false;
    }

    return { solved: dfs(), nodes: nodes };
  }

  function verifyStructure(tileId) {
    if (tileId.length !== 144) return { ok: false, reason: 'length!=144(' + tileId.length + ')' };
    var expected = new Map();
    MahjongTiles.TILE_DEFS.forEach(function (def) { expected.set(def.id, def.count); });
    var actual = new Map();
    for (var i = 0; i < tileId.length; i++) {
      var id = tileId[i];
      if (!id) return { ok: false, reason: 'empty slot at index ' + i };
      actual.set(id, (actual.get(id) || 0) + 1);
    }
    var mismatch = null;
    expected.forEach(function (count, id) {
      if (actual.get(id) !== count) mismatch = id + ':expected ' + count + ' got ' + (actual.get(id) || 0);
    });
    if (mismatch) return { ok: false, reason: 'multiset mismatch: ' + mismatch };
    return { ok: true };
  }

  /* =======================================================================
   * [GAME] 게임 상태 — 선택/매칭/되돌리기/힌트/셔플
   *
   * 보드 상태는 `tiles` 배열(슬롯 인덱스 → tileId 또는 null(제거됨)) 하나로
   * 표현한다. occupied 불리언 배열은 매번 tiles로부터 파생시켜 쓴다.
   * ======================================================================= */

  function occupiedOf(tiles) {
    var n = tiles.length;
    var occ = new Array(n);
    for (var i = 0; i < n; i++) occ[i] = (tiles[i] != null);
    return occ;
  }

  function createGameState(layoutId, rng) {
    var gen = generateSolvableBoard(layoutId, rng);
    if (!gen) return null;
    return {
      layoutId: layoutId,
      tiles: gen.tileId.slice(),
      history: [],       // undo 스택: {type:'match', a,b,tileA,tileB} | {type:'shuffle', beforeTiles}
      selected: -1,
      startedAt: Date.now(),
      elapsedMsBase: 0,  // 이어하기 시 이전 경과 시간을 더하기 위한 기준값
      timerPaused: false, // "더 이상 짝 없음" 모달이 떠 있는 동안 true
    };
  }

  // 슬롯이 지금 선택 가능한(=free) 상태인지.
  function isSelectable(graph, tiles, idx) {
    if (idx < 0 || idx >= tiles.length || tiles[idx] == null) return false;
    return isSlotFree(graph, idx, occupiedOf(tiles));
  }

  // 두 슬롯이 지금 매칭 제거 가능한지(둘 다 free + 서로 매칭).
  function canMatch(graph, tiles, idxA, idxB) {
    if (idxA === idxB) return false;
    if (tiles[idxA] == null || tiles[idxB] == null) return false;
    var occ = occupiedOf(tiles);
    if (!isSlotFree(graph, idxA, occ)) return false;
    if (!isSlotFree(graph, idxB, occ)) return false;
    return tilesMatch(tiles[idxA], tiles[idxB]);
  }

  // 매칭을 실제로 적용(제거)하고 undo 스택에 기록한다. 호출 전 canMatch로
  // 검증되어 있어야 한다.
  function applyMatch(state, idxA, idxB) {
    var tileA = state.tiles[idxA];
    var tileB = state.tiles[idxB];
    state.history.push({ type: 'match', a: idxA, b: idxB, tileA: tileA, tileB: tileB });
    state.tiles[idxA] = null;
    state.tiles[idxB] = null;
  }

  // 무제한 되돌리기: 스택 맨 위 이동을 취소. 매칭 제거든 셔플이든 모두
  // 되돌릴 수 있다. 반환값: 되돌린 이동의 타입('match'|'shuffle') 또는
  // 스택이 비어 되돌릴 게 없으면 null.
  function undoLastMove(state) {
    var last = state.history.pop();
    if (!last) return null;
    if (last.type === 'match') {
      state.tiles[last.a] = last.tileA;
      state.tiles[last.b] = last.tileB;
    } else if (last.type === 'shuffle') {
      state.tiles = last.beforeTiles.slice();
    }
    return last.type;
  }

  function isBoardCleared(tiles) {
    for (var i = 0; i < tiles.length; i++) {
      if (tiles[i] != null) return false;
    }
    return true;
  }

  function remainingTileCount(tiles) {
    var n = 0;
    for (var i = 0; i < tiles.length; i++) if (tiles[i] != null) n++;
    return n;
  }

  // 화면 구석 "가능한 짝: N" 표시용.
  function remainingPairsCount(graph, tiles) {
    return countAvailablePairs(graph, occupiedOf(tiles), tiles);
  }

  // 힌트: 현재 매칭 가능한 짝 중 하나. rng를 주면 그중 무작위로 골라
  // 매번 같은 짝만 반복 안내하지 않게 한다.
  function findHintPair(graph, tiles, rng) {
    var pairs = computeAvailablePairs(graph, occupiedOf(tiles), tiles);
    if (!pairs.length) return null;
    if (rng) {
      var idx = Math.floor(rng() * pairs.length);
      return pairs[idx];
    }
    return pairs[0];
  }

  // 현재 남은(제거되지 않은) 타일들로 72쌍 방식과 동일하게 matchGroup별로
  // 짝을 구성한다. 매칭 규칙상 남은 타일 수는 항상 매칭 그룹별로 짝수다.
  function buildPairPoolFromTiles(remainingTileIds) {
    var byGroup = new Map();
    remainingTileIds.forEach(function (id) {
      var mg = MahjongTiles.TILE_DEF_BY_ID[id].matchGroup;
      if (!byGroup.has(mg)) byGroup.set(mg, []);
      byGroup.get(mg).push(id);
    });
    var pairs = [];
    byGroup.forEach(function (ids) {
      for (var i = 0; i < ids.length; i += 2) {
        pairs.push([ids[i], ids[i + 1]]);
      }
    });
    return pairs;
  }

  // 셔플: 남은 슬롯들에 대해서만 역순 생성으로 재배치한다. 성공하면 셔플
  // 후에도 100% 풀 수 있는 상태가 보장된다. 재시도 끝에도 실패하면(막다른
  // 레이아웃 조각으로 갈리는 극히 드문 경우) "가능한 최선의 무작위 배치"로
  // 대체하고 guaranteedSolvable:false를 반환해 UI가 새 게임을 권유하게 한다.
  function shuffleRemaining(state, rng, maxAttempts) {
    var graph = getSlotGraph(state.layoutId);
    var occ = occupiedOf(state.tiles);
    var remainingIds = [];
    for (var i = 0; i < state.tiles.length; i++) {
      if (state.tiles[i] != null) remainingIds.push(state.tiles[i]);
    }
    if (remainingIds.length === 0) return { ok: true, guaranteedSolvable: true, noop: true };

    var pairPool = buildPairPoolFromTiles(remainingIds);
    maxAttempts = maxAttempts || 300;
    var result = null;
    for (var attempt = 0; attempt < maxAttempts; attempt++) {
      var r = attemptGenerateGeneric(graph, rng, occ, pairPool);
      if (r) { result = r; break; }
    }

    var beforeTiles = state.tiles.slice();
    var guaranteedSolvable = true;
    var newTiles;

    if (result) {
      newTiles = state.tiles.slice();
      for (var m = 0; m < newTiles.length; m++) {
        if (occ[m]) newTiles[m] = result.tileId[m];
      }
    } else {
      // 최선 배치: 풀림을 보장하지 못한 채 남은 위치에 남은 값들을 무작위로 배치.
      guaranteedSolvable = false;
      var remainingSlots = [];
      for (var s = 0; s < state.tiles.length; s++) {
        if (state.tiles[s] != null) remainingSlots.push(s);
      }
      var shuffledIds = shuffleArray(remainingIds.slice(), rng);
      newTiles = state.tiles.slice();
      for (var k = 0; k < remainingSlots.length; k++) {
        newTiles[remainingSlots[k]] = shuffledIds[k];
      }
    }

    state.history.push({ type: 'shuffle', beforeTiles: beforeTiles });
    state.tiles = newTiles;
    return { ok: true, guaranteedSolvable: guaranteedSolvable };
  }

  /* =======================================================================
   * [SELFTEST] runSelfTest()
   * ======================================================================= */

  function nowMs() {
    if (typeof performance !== 'undefined' && performance.now) return performance.now();
    return Date.now();
  }

  function runSelfTest(options) {
    options = options || {};
    var totalRuns = options.totalRuns || 1000;
    var layoutId = options.layoutId || 'turtle';
    var dfsSampleSize = (options.dfsSampleSize != null) ? options.dfsSampleSize : 50;
    var dfsBudget = options.dfsBudget || 30000;
    var log = options.log !== false;

    var graph = getSlotGraph(layoutId);
    var passCount = 0, failCount = 0;
    var totalGenMs = 0, maxGenMs = 0;
    var failures = [];
    var dfsChecked = 0, dfsSolved = 0;
    var overallStart = nowMs();

    for (var run = 0; run < totalRuns; run++) {
      var rng = makeRng((run * 2654435761 + 1) >>> 0);
      var t0 = nowMs();
      var result = generateSolvableBoard(layoutId, rng);
      var t1 = nowMs();
      var genMs = t1 - t0;
      totalGenMs += genMs;
      if (genMs > maxGenMs) maxGenMs = genMs;

      if (!result) {
        failCount++;
        failures.push({ run: run, reason: 'generation-failed(max attempts exhausted)' });
        continue;
      }

      var struct = verifyStructure(result.tileId);
      if (!struct.ok) {
        failCount++;
        failures.push({ run: run, reason: 'structure:' + struct.reason });
        continue;
      }

      var solvable = verifySolvableByReplay(graph, result.tileId, result.constructionOrder);
      if (!solvable) {
        failCount++;
        failures.push({ run: run, reason: 'replay-not-solvable' });
        continue;
      }

      passCount++;

      if (dfsChecked < dfsSampleSize) {
        dfsChecked++;
        var dfsResult = solveBoardExists(graph, result.tileId, dfsBudget);
        if (dfsResult.solved) dfsSolved++;
      }
    }

    var overallMs = nowMs() - overallStart;

    var summary = {
      totalRuns: totalRuns,
      passCount: passCount,
      failCount: failCount,
      passRatePct: (passCount / totalRuns * 100).toFixed(2),
      avgGenMs: (totalGenMs / totalRuns).toFixed(3),
      maxGenMs: maxGenMs.toFixed(3),
      totalMs: overallMs.toFixed(1),
      dfsSampleSize: dfsChecked,
      dfsSolved: dfsSolved,
      failures: failures.slice(0, 10),
    };

    if (log) {
      console.log('[Mahjong runSelfTest] ' + summary.passCount + '/' + summary.totalRuns +
        ' passed (' + summary.passRatePct + '%), avgGen=' + summary.avgGenMs + 'ms, maxGen=' +
        summary.maxGenMs + 'ms, totalMs=' + summary.totalMs +
        ', dfsIndependentSolve=' + summary.dfsSolved + '/' + summary.dfsSampleSize);
      if (failures.length) {
        console.log('[Mahjong runSelfTest] sample failures:', summary.failures);
      }
    }

    return summary;
  }

  /* =======================================================================
   * Export
   * ======================================================================= */
  ROOT.MahjongGame = ROOT.MahjongGame || {};
  Object.assign(ROOT.MahjongGame, {
    LAYOUTS: LAYOUTS,
    getSlotGraph: getSlotGraph,
    isSlotFree: isSlotFree,
    tilesMatch: tilesMatch,
    computeFreeSlots: computeFreeSlots,
    computeAvailablePairs: computeAvailablePairs,
    countAvailablePairs: countAvailablePairs,
    makeRng: makeRng,
    shuffleArray: shuffleArray,
    buildPairPool: buildPairPool,
    generateSolvableBoard: generateSolvableBoard,
    verifySolvableByReplay: verifySolvableByReplay,
    solveBoardExists: solveBoardExists,
    verifyStructure: verifyStructure,
    runSelfTest: runSelfTest,
    occupiedOf: occupiedOf,
    createGameState: createGameState,
    isSelectable: isSelectable,
    canMatch: canMatch,
    applyMatch: applyMatch,
    undoLastMove: undoLastMove,
    isBoardCleared: isBoardCleared,
    remainingTileCount: remainingTileCount,
    remainingPairsCount: remainingPairsCount,
    findHintPair: findHintPair,
    buildPairPoolFromTiles: buildPairPoolFromTiles,
    shuffleRemaining: shuffleRemaining,
  });

  // Node에서 직접 실행했을 때(node game.js) 자체 테스트가 바로 돌게 한다.
  if (typeof module !== 'undefined' && require.main === module) {
    runSelfTest();
  }

  // 브라우저가 아니면(Node 자체 테스트) 아래 DOM 의존 코드는 건너뛴다.
  if (typeof document === 'undefined') return;

  /* =======================================================================
   * [STORAGE] localStorage — 저장/설정/통계
   *
   * 시크릿 모드 등 localStorage를 쓸 수 없는 환경에서도 게임 자체는 정상
   * 동작해야 하므로 모든 접근을 try-catch로 감싸고, 실패 시 조용히
   * 메모리상에서만 동작(저장/이어하기만 비활성화)한다.
   * ======================================================================= */

  var STORAGE_KEYS = {
    save: 'mahjongSolitaire.v1.save',
    settings: 'mahjongSolitaire.v1.settings',
    stats: 'mahjongSolitaire.v1.stats',
  };

  var storageAvailable = (function () {
    try {
      var k = '__mahjong_probe__';
      window.localStorage.setItem(k, '1');
      window.localStorage.removeItem(k);
      return true;
    } catch (e) {
      return false;
    }
  })();

  function loadJSON(key, fallback) {
    if (!storageAvailable) return fallback;
    try {
      var raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function saveJSON(key, value) {
    if (!storageAvailable) return;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      // 저장 공간 부족 등 — 조용히 무시, 게임 진행에는 지장 없음
    }
  }

  function removeKey(key) {
    if (!storageAvailable) return;
    try { window.localStorage.removeItem(key); } catch (e) { /* ignore */ }
  }

  var DEFAULT_SETTINGS = { tileSize: 'large', tileset: 'big', showFree: true, showTimer: true, sound: false };
  var settings = Object.assign({}, DEFAULT_SETTINGS, loadJSON(STORAGE_KEYS.settings, {}));

  var DEFAULT_STATS = { gamesPlayed: 0, gamesWon: 0, bestTimeMs: null };
  var stats = Object.assign({}, DEFAULT_STATS, loadJSON(STORAGE_KEYS.stats, {}));

  function saveSettings() { saveJSON(STORAGE_KEYS.settings, settings); }
  function saveStats() { saveJSON(STORAGE_KEYS.stats, stats); }

  function saveGameProgress() {
    if (!state) return;
    saveJSON(STORAGE_KEYS.save, {
      layoutId: state.layoutId,
      tiles: state.tiles,
      history: state.history,
      elapsedMsBase: currentElapsedMs(),
      savedAt: Date.now(),
    });
  }
  function clearSavedGame() { removeKey(STORAGE_KEYS.save); }
  function loadSavedGame() { return loadJSON(STORAGE_KEYS.save, null); }

  /* =======================================================================
   * [RENDER] DOM/SVG 렌더링
   * ======================================================================= */

  // 세 단계 모두 자연 크기(스케일 1.0)에서 터치 타겟 48×48px 이상을 만족
  // 하도록 잡는다(스펙 5절). 화면이 좁아 축소해야 할 때도 48px 밑으로는
  // 내려가지 않게 하고(아래 applyFitScale의 동적 MIN_SCALE), 그래도 안
  // 맞으면 가로 스크롤을 허용한다.
  var UNIT_PX = { normal: 23, large: 27, xlarge: 33 };
  var TILE_W_MUL = 2.15;
  var TILE_H_MUL = 2.75;
  var Z_DEPTH_MUL = 0.32;

  function currentUnit() { return UNIT_PX[settings.tileSize] || UNIT_PX.large; }

  function computeLayoutGeometry(slots, unit) {
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, maxZ = 0;
    slots.forEach(function (s) {
      if (s.x < minX) minX = s.x;
      if (s.x > maxX) maxX = s.x;
      if (s.y < minY) minY = s.y;
      if (s.y > maxY) maxY = s.y;
      if (s.z > maxZ) maxZ = s.z;
    });
    var tileW = unit * TILE_W_MUL;
    var tileH = unit * TILE_H_MUL;
    var halfW = tileW / 2;
    var halfH = tileH / 2;
    var depthX = unit * Z_DEPTH_MUL;
    var depthY = unit * Z_DEPTH_MUL;
    var positions = slots.map(function (s) {
      return {
        left: (s.x - minX) * halfW + s.z * depthX,
        top: (s.y - minY) * halfH + (maxZ - s.z) * depthY,
        w: tileW,
        h: tileH,
        z: s.z,
      };
    });
    return {
      positions: positions,
      width: (maxX - minX) * halfW + tileW + maxZ * depthX,
      height: (maxY - minY) * halfH + tileH + maxZ * depthY,
    };
  }

  function svgMarkupFor(tileId) {
    var def = MahjongTiles.TILE_DEF_BY_ID[tileId];
    var inner = (settings.tileset === 'classic') ? MahjongTiles.classicArtFor(def) : MahjongTiles.bigTextArtFor(def);
    return '<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">' + inner + '</svg>';
  }

  function createTileElement(i, tileId, geometry) {
    var pos = geometry.positions[i];
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tile-btn';
    btn.dataset.slot = String(i);
    btn.style.left = pos.left + 'px';
    btn.style.top = pos.top + 'px';
    btn.style.width = pos.w + 'px';
    btn.style.height = pos.h + 'px';
    btn.style.zIndex = String(pos.z * 1000 + i);
    var face = document.createElement('span');
    face.className = 'tile-face';
    face.innerHTML = svgMarkupFor(tileId);
    btn.appendChild(face);
    return btn;
  }

  function updateTileStatus(btn, tileId, free, selected, hinted) {
    var def = MahjongTiles.TILE_DEF_BY_ID[tileId];
    btn.dataset.free = free ? 'true' : 'false';
    btn.dataset.selected = selected ? 'true' : 'false';
    btn.dataset.hint = hinted ? 'true' : 'false';
    btn.tabIndex = free ? 0 : -1;
    btn.disabled = !free;
    var label = MahjongTiles.tileAriaName(def) + (selected ? ', selected' : (free ? ', selectable' : ', locked'));
    btn.setAttribute('aria-label', label);
  }

  var boardEl, viewportEl, boardScaleWrapEl, liveRegionEl;
  var tileElements = [];
  var geometry = null;
  var graph = getSlotGraph('turtle');
  var hintSlots = new Set();

  function removeTileElement(i, animate) {
    var el = tileElements[i];
    if (!el || el.dataset.removing === '1') return;
    el.dataset.removing = '1';
    el.dataset.free = 'false';
    el.dataset.selected = 'false';
    el.dataset.hint = 'false';
    el.classList.add('is-removing');
    el.disabled = true;
    el.tabIndex = -1;
    el.setAttribute('aria-hidden', 'true');
    var delay = animate ? 170 : 0;
    setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
      if (tileElements[i] === el) tileElements[i] = null;
    }, delay);
  }

  function syncBoard(animate) {
    var occ = occupiedOf(state.tiles);
    for (var i = 0; i < graph.n; i++) {
      var tileId = state.tiles[i];
      var el = tileElements[i];
      if (tileId == null) {
        if (el) removeTileElement(i, animate);
        continue;
      }
      if (!el) {
        el = createTileElement(i, tileId, geometry);
        boardEl.appendChild(el);
        tileElements[i] = el;
      }
      var free = isSlotFree(graph, i, occ);
      updateTileStatus(el, tileId, free, state.selected === i, hintSlots.has(i));
    }
  }

  var BOARD_VIEWPORT_VPAD = 40; // .board-viewport padding: 20px 위+아래(style.css와 동기화 필요)
  var BOTTOM_BREATHING_ROOM = 20; // 보드 아래 살짝 여백(뷰포트 바닥에 딱 붙지 않게)

  function applyFitScale() {
    // 48px 터치 타겟 최소값 밑으로는 절대 축소하지 않는다 — 그 이상 좁거나
    // 낮으면 축소 대신 board-viewport의 스크롤에 맡긴다.
    var tileWNatural = currentUnit() * TILE_W_MUL;
    var MIN_SCALE = Math.min(1, 48 / tileWNatural);

    var availableW = Math.max(120, viewportEl.clientWidth - 40);
    var scaleW = geometry.width > availableW ? availableW / geometry.width : 1;

    // 데스크톱에서 헤더+툴바+보드가 스크롤 없이 한 화면에 들어오도록,
    // 뷰포트 높이에서 "보드 위쪽에 이미 차지하고 있는 공간"을 뺀 나머지만
    // 세로로 허용한다. offsetTop은 문서 흐름상의 위치라 현재 스크롤
    // 위치와 무관하다(getBoundingClientRect().top을 쓰면 사용자가 이미
    // 스크롤한 상태에서 재계산될 때 값이 틀어진다). 모바일처럼 세로
    // 공간이 애초에 빠듯한 화면에서는 이 값이 MIN_SCALE 아래로 내려가
    // 자연히 세로 스크롤로 넘어간다(강제로 욱여넣지 않음).
    var availableH = Math.max(140, window.innerHeight - viewportEl.offsetTop - BOARD_VIEWPORT_VPAD - BOTTOM_BREATHING_ROOM);
    var scaleH = geometry.height > availableH ? availableH / geometry.height : 1;

    var scale = Math.max(MIN_SCALE, Math.min(1, scaleW, scaleH));

    boardEl.style.width = geometry.width + 'px';
    boardEl.style.height = geometry.height + 'px';
    boardEl.style.setProperty('--fit-scale', String(scale));
    boardScaleWrapEl.style.width = (geometry.width * scale) + 'px';
    boardScaleWrapEl.style.height = (geometry.height * scale) + 'px';
  }

  function fullRender() {
    geometry = computeLayoutGeometry(graph.slots, currentUnit());
    boardEl.innerHTML = '';
    tileElements = new Array(graph.n).fill(null);
    syncBoard(false);
    applyFitScale();
  }

  function announce(msg) {
    if (liveRegionEl) liveRegionEl.textContent = msg;
  }

  /* =======================================================================
   * [UI] 버튼 · 설정 패널 · 모달 · 사운드 · 키보드 · 타이머
   * ======================================================================= */

  var state = null;
  var timerIntervalId = null;
  var audioCtx = null;
  var pendingResume = null;

  function rng() { return Math.random(); }

  function formatTime(ms) {
    var totalSec = Math.max(0, Math.round(ms / 1000));
    var h = Math.floor(totalSec / 3600);
    var m = Math.floor((totalSec % 3600) / 60);
    var s = totalSec % 60;
    var mm = (h > 0 ? String(m).padStart(2, '0') : String(m));
    var ss = String(s).padStart(2, '0');
    return h > 0 ? (h + ':' + mm + ':' + ss) : (mm.padStart(2, '0') + ':' + ss);
  }

  function currentElapsedMs() {
    if (!state) return 0;
    // 타이머가 일시정지 상태면 그 순간 스냅샷(elapsedMsBase)에서 멈춰
    // 있어야 한다 — 통계·최단기록·자동저장 어디서 호출되든 정지 구간이
    // 시간에 섞여 들어가면 안 되므로, 계산 자체를 여기서 한 곳에서 막는다.
    if (state.timerPaused) return state.elapsedMsBase;
    return state.elapsedMsBase + (Date.now() - state.startedAt);
  }

  // "더 이상 짝 없음" 모달이 떠 있는 동안 경과 시간이 흐르지 않게 한다.
  function pauseElapsedTimer() {
    if (!state || state.timerPaused) return;
    state.elapsedMsBase = currentElapsedMs(); // 일시정지 시점까지의 경과를 스냅샷
    state.timerPaused = true;
    stopTimerLoop();
  }
  function resumeElapsedTimer() {
    if (!state || !state.timerPaused) return;
    state.timerPaused = false;
    state.startedAt = Date.now(); // 스냅샷 이후부터 다시 흐르게 기준점 갱신
    startTimerLoop();
  }

  function ensureAudio() {
    if (audioCtx) return audioCtx;
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = new Ctx();
    return audioCtx;
  }

  // 오디오 파일 없이 Web Audio로 짧고 부드러운 톤을 생성한다.
  function playSound(kind) {
    if (!settings.sound) return;
    var ctx = ensureAudio();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    var notes = kind === 'match' ? [660, 880] : [520];
    var t0 = ctx.currentTime;
    notes.forEach(function (freq, idx) {
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      var start = t0 + idx * 0.07;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.12, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.18);
    });
  }

  // ---- 모달 제어 ----------------------------------------------------------
  var modalWin, modalStuck, modalResume, settingsPanel;
  var stuckTitleEl, stuckMessageEl, stuckActionsEl;
  function openModal(el) { el.dataset.open = 'true'; }
  function closeModal(el) { el.dataset.open = 'false'; }

  // ---- 상태 표시 갱신 -------------------------------------------------------
  var pairsCountEl, timerDisplayEl, undoBtn;

  function updateStatusStrip() {
    pairsCountEl.textContent = String(remainingPairsCount(graph, state.tiles));
    timerDisplayEl.textContent = formatTime(currentElapsedMs());
    undoBtn.disabled = state.history.length === 0;
  }

  function startTimerLoop() {
    stopTimerLoop();
    timerIntervalId = setInterval(function () {
      timerDisplayEl.textContent = formatTime(currentElapsedMs());
    }, 1000);
  }
  function stopTimerLoop() {
    if (timerIntervalId) { clearInterval(timerIntervalId); timerIntervalId = null; }
  }

  function afterStateChange() {
    saveGameProgress();
    updateStatusStrip();
    if (isBoardCleared(state.tiles)) {
      onWin();
      return;
    }
    if (remainingPairsCount(graph, state.tiles) === 0) {
      handleNoMoreMatches();
    }
  }

  /* ---- "더 이상 짝 없음" 처리: 자동 셔플 ------------------------------------
   * 버튼으로 사용자가 고르게 하는 대신, 짧게 안내만 하고 자동으로 셔플해
   * 게임을 이어간다. 재배치로도 풀 수 있는 판을 만들 수 없거나(예외),
   * 셔플을 해도 계속 막히는 상태가 반복되면(무한 루프 방지) 그때만 새
   * 게임을 권하는 모달로 전환한다.
   * ------------------------------------------------------------------------- */
  var AUTO_SHUFFLE_DELAY_MS = 2500;
  var MAX_CONSECUTIVE_AUTO_SHUFFLES = 3;
  var consecutiveAutoShuffles = 0;
  var pendingStuckTimeoutId = null;
  var modalStuckMode = null; // 'waiting' | 'giveup' | null

  function clearPendingStuckTimeout() {
    if (pendingStuckTimeoutId) { clearTimeout(pendingStuckTimeoutId); pendingStuckTimeoutId = null; }
  }

  function handleNoMoreMatches() {
    if (consecutiveAutoShuffles >= MAX_CONSECUTIVE_AUTO_SHUFFLES) {
      showGiveUpModal('loop');
      return;
    }
    modalStuckMode = 'waiting';
    stuckTitleEl.textContent = 'No more matches';
    stuckMessageEl.textContent = 'No more matches — shuffling the tiles...';
    stuckActionsEl.hidden = true;
    pauseElapsedTimer();
    openModal(modalStuck);
    announce('No more matches. Shuffling the tiles automatically.');
    clearPendingStuckTimeout();
    pendingStuckTimeoutId = setTimeout(runAutoShuffle, AUTO_SHUFFLE_DELAY_MS);
  }

  // 모달을 탭/클릭하면 대기 없이 바로 진행(요구사항 4).
  function skipStuckWaitIfPending() {
    if (modalStuckMode !== 'waiting' || !pendingStuckTimeoutId) return;
    clearPendingStuckTimeout();
    runAutoShuffle();
  }

  function runAutoShuffle() {
    clearPendingStuckTimeout();
    closeModal(modalStuck);
    modalStuckMode = null;
    resumeElapsedTimer();

    // shuffleRemaining은 undo 스택에 {type:'shuffle', beforeTiles}를 그대로
    // 남기므로, 자동 셔플 이후에도 셔플 전 상태로 되돌리기가 가능하다
    // (요구사항 5 — 별도 처리 불필요, 기존 함수를 그대로 재사용).
    var result = shuffleRemaining(state, rng);
    consecutiveAutoShuffles++;
    hintSlots.clear();
    fullRender();
    saveGameProgress();
    updateStatusStrip();

    if (!result.guaranteedSolvable) {
      // 예외 처리(요구사항 6): 풀 수 있는 재배치를 만들지 못한 경우에만
      // 최선의 배치를 적용해 두고 새 게임을 권하는 모달로 전환한다.
      showGiveUpModal('unsolvable');
      return;
    }

    announce('Tiles shuffled, game continues.');

    // 셔플 직후에도 이론상 다시 막힌 상태일 수 있으니 재확인한다. 이 경우
    // handleNoMoreMatches가 consecutiveAutoShuffles 값을 보고 다시 자동
    // 셔플할지, 무한 루프 방지 모달로 넘어갈지 알아서 판단한다.
    if (remainingPairsCount(graph, state.tiles) === 0) {
      handleNoMoreMatches();
    }
  }

  function showGiveUpModal(reason) {
    modalStuckMode = 'giveup';
    clearPendingStuckTimeout();
    pauseElapsedTimer();
    stuckTitleEl.textContent = "Let's start fresh";
    stuckMessageEl.textContent = (reason === 'loop')
      ? "Still stuck after a few shuffles. Starting a new game is recommended."
      : "We couldn't find another solvable arrangement. Starting a new game is recommended.";
    stuckActionsEl.hidden = false;
    openModal(modalStuck);
    announce(stuckMessageEl.textContent);
  }

  function onWin() {
    stopTimerLoop();
    var elapsed = currentElapsedMs();
    stats.gamesWon++;
    if (stats.bestTimeMs == null || elapsed < stats.bestTimeMs) stats.bestTimeMs = elapsed;
    saveStats();
    clearSavedGame();
    renderStats();
    document.getElementById('win-time').textContent = formatTime(elapsed);
    openModal(modalWin);
    announce('Congratulations! You cleared the board in ' + formatTime(elapsed) + '.');
  }

  // ---- 게임 동작 ------------------------------------------------------------
  // silent===true 일 때만 "이어하기 여부를 묻기 전 배경에 깔아둘 보드"를
  // 준비만 하는 특수 경로로 취급한다(통계 미집계·알림 없음). 이 함수는
  // addEventListener('click', startNewGame)처럼 리스너로 직접 등록되기도
  // 하는데, 그 경우 브라우저가 첫 인자로 (참인) Event 객체를 넘기므로
  // `!silent` 같은 느슨한 체크를 쓰면 버튼 클릭이 항상 "silent" 취급되는
  // 버그가 생긴다 — 반드시 엄격 비교(=== true)로 판별해야 한다.
  function startNewGame(silent) {
    var isSilent = silent === true;
    clearPendingStuckTimeout();
    modalStuckMode = null;
    consecutiveAutoShuffles = 0;
    closeModal(modalWin);
    closeModal(modalStuck);
    closeModal(modalResume);
    var gen = createGameState('turtle', rng);
    if (!gen) {
      announce('Could not generate a board. Please try again.');
      return;
    }
    state = gen;
    hintSlots.clear();
    fullRender();
    if (!isSilent) {
      stats.gamesPlayed++;
      saveStats();
    }
    afterStateChange();
    startTimerLoop();
    if (!isSilent) announce('New game started. 144 tiles on the board.');
  }

  function resumeSavedGame(saved) {
    clearPendingStuckTimeout();
    modalStuckMode = null;
    consecutiveAutoShuffles = 0;
    closeModal(modalStuck);
    state = {
      layoutId: saved.layoutId || 'turtle',
      tiles: saved.tiles.slice(),
      history: saved.history || [],
      selected: -1,
      startedAt: Date.now(),
      elapsedMsBase: saved.elapsedMsBase || 0,
      timerPaused: false,
    };
    hintSlots.clear();
    fullRender();
    updateStatusStrip();
    startTimerLoop();
    announce('Game resumed.');
  }

  function doUndo() {
    // "짝 없음" 대기/안내 모달이 떠 있는 도중 되돌리기가 눌리면(예: 키보드
    // 단축키 U) 예정된 자동 셔플을 취소하고 타이머 일시정지도 풀어야
    // 상태가 꼬이지 않는다.
    clearPendingStuckTimeout();
    modalStuckMode = null;
    closeModal(modalStuck);
    resumeElapsedTimer();

    var type = undoLastMove(state);
    if (!type) { announce('Nothing to undo.'); return; }
    consecutiveAutoShuffles = 0; // 되돌리기는 "막힘 연쇄"를 끊는 새로운 시도로 취급
    state.selected = -1;
    hintSlots.clear();
    fullRender();
    saveGameProgress();
    updateStatusStrip();
    announce('Move undone.');

    // 되돌린 결과가 다시 막힌 상태일 수도 있다(예: 셔플 전으로 되돌아간 경우).
    if (remainingPairsCount(graph, state.tiles) === 0) {
      handleNoMoreMatches();
    }
  }

  function doHint() {
    var pair = findHintPair(graph, state.tiles, rng);
    if (!pair) { announce('No hints available right now.'); return; }
    hintSlots = new Set(pair);
    syncBoard(false);
    announce('Hint: a matching pair is highlighted.');
    setTimeout(function () {
      hintSlots.clear();
      syncBoard(false);
    }, 1600);
  }

  // 일부 브라우저(특히 접두사 붙은 webkit* 구현)는 프라미스를 반환하지
  // 않거나 동기적으로 예외를 던지기도 하므로 try/catch로 감싼다.
  function toggleFullscreen() {
    var doc = document;
    try {
      var isFs = doc.fullscreenElement || doc.webkitFullscreenElement;
      if (isFs) {
        var exit = doc.exitFullscreen || doc.webkitExitFullscreen;
        if (exit) exit.call(doc);
        return;
      }
      var target = document.getElementById('main');
      var req = target.requestFullscreen || target.webkitRequestFullscreen;
      if (!req) { announce('Full screen is not supported on this browser.'); return; }
      var result = req.call(target);
      if (result && typeof result.catch === 'function') {
        result.catch(function () { announce('Could not enter full screen.'); });
      }
    } catch (e) {
      announce('Full screen is not available right now.');
    }
  }

  function onTileActivate(i) {
    if (state.tiles[i] == null) return;
    var occ = occupiedOf(state.tiles);
    if (!isSlotFree(graph, i, occ)) return; // 잠긴 타일은 무시
    playSound('click');
    if (state.selected === i) {
      state.selected = -1;
      syncBoard(false);
      return;
    }
    if (state.selected === -1) {
      state.selected = i;
      syncBoard(false);
      var def0 = MahjongTiles.TILE_DEF_BY_ID[state.tiles[i]];
      announce(MahjongTiles.tileAriaName(def0) + ' selected.');
      return;
    }
    if (canMatch(graph, state.tiles, state.selected, i)) {
      var a = state.selected, b = i;
      state.selected = -1;
      hintSlots.delete(a); hintSlots.delete(b);
      applyMatch(state, a, b);
      consecutiveAutoShuffles = 0; // 실제 진행이 있었으니 "막힘 연쇄" 카운트 초기화
      playSound('match');
      syncBoard(true);
      afterStateChange();
      announce('Matched and removed.');
    } else {
      state.selected = i;
      syncBoard(false);
      var def1 = MahjongTiles.TILE_DEF_BY_ID[state.tiles[i]];
      announce(MahjongTiles.tileAriaName(def1) + ' selected.');
    }
  }

  // ---- 설정 패널 UI 동기화 ---------------------------------------------------
  function applySettingsToDOM() {
    document.body.dataset.tileSize = settings.tileSize;
    document.body.dataset.tileset = settings.tileset;
    document.body.dataset.showFree = settings.showFree ? 'true' : 'false';
    document.body.dataset.showTimer = settings.showTimer ? 'true' : 'false';

    var sizeInput = document.querySelector('input[name="tile-size"][value="' + settings.tileSize + '"]');
    if (sizeInput) sizeInput.checked = true;
    var setInput = document.querySelector('input[name="tileset"][value="' + settings.tileset + '"]');
    if (setInput) setInput.checked = true;
    document.getElementById('toggle-free').checked = settings.showFree;
    document.getElementById('toggle-timer').checked = settings.showTimer;
    document.getElementById('toggle-sound').checked = settings.sound;
  }

  function renderStats() {
    document.getElementById('stat-games').textContent = String(stats.gamesPlayed);
    document.getElementById('stat-wins').textContent = String(stats.gamesWon);
    document.getElementById('stat-best').textContent = stats.bestTimeMs != null ? formatTime(stats.bestTimeMs) : '—';
  }

  /* =======================================================================
   * Bootstrap
   * ======================================================================= */
  function initApp() {
    boardEl = document.getElementById('board');
    viewportEl = document.getElementById('board-viewport');
    boardScaleWrapEl = document.querySelector('.board-scale-wrap');
    liveRegionEl = document.getElementById('live-region');
    pairsCountEl = document.getElementById('pairs-count');
    timerDisplayEl = document.getElementById('timer-display');
    undoBtn = document.getElementById('btn-undo');
    modalWin = document.getElementById('modal-win');
    modalStuck = document.getElementById('modal-stuck');
    modalResume = document.getElementById('modal-resume');
    settingsPanel = document.getElementById('settings-panel');
    stuckTitleEl = document.getElementById('stuck-title');
    stuckMessageEl = document.getElementById('stuck-message');
    stuckActionsEl = document.getElementById('stuck-actions');

    applySettingsToDOM();
    renderStats();

    boardEl.addEventListener('click', function (e) {
      var btn = e.target.closest('.tile-btn');
      if (!btn || btn.disabled) return;
      onTileActivate(Number(btn.dataset.slot));
    });

    document.getElementById('btn-new-game').addEventListener('click', startNewGame);
    document.getElementById('btn-undo').addEventListener('click', doUndo);
    document.getElementById('btn-hint').addEventListener('click', doHint);
    document.getElementById('btn-fullscreen').addEventListener('click', toggleFullscreen);
    document.getElementById('btn-settings').addEventListener('click', function () { openModal(settingsPanel); });
    document.getElementById('btn-settings-close').addEventListener('click', function () { closeModal(settingsPanel); });

    document.getElementById('btn-stuck-newgame').addEventListener('click', startNewGame);
    // 대기 중(모달 안내 문구를 보여주는 동안)에만 탭/클릭으로 대기를
    // 건너뛰고 바로 셔플한다(요구사항 4) — New Game 버튼 클릭도 이 리스너를
    // 거치지만 그때는 modalStuckMode가 'giveup'이라 아무 일도 하지 않는다.
    modalStuck.addEventListener('click', skipStuckWaitIfPending);
    document.getElementById('btn-win-newgame').addEventListener('click', startNewGame);
    document.getElementById('btn-resume-continue').addEventListener('click', function () {
      closeModal(modalResume);
      if (pendingResume) { resumeSavedGame(pendingResume); pendingResume = null; }
    });
    document.getElementById('btn-resume-newgame').addEventListener('click', function () {
      closeModal(modalResume);
      pendingResume = null;
      clearSavedGame();
      startNewGame();
    });

    document.querySelectorAll('input[name="tile-size"]').forEach(function (input) {
      input.addEventListener('change', function () {
        settings.tileSize = input.value;
        saveSettings();
        applySettingsToDOM();
        fullRender();
      });
    });
    document.querySelectorAll('input[name="tileset"]').forEach(function (input) {
      input.addEventListener('change', function () {
        settings.tileset = input.value;
        saveSettings();
        applySettingsToDOM();
        fullRender();
      });
    });
    document.getElementById('toggle-free').addEventListener('change', function (e) {
      settings.showFree = e.target.checked;
      saveSettings();
      applySettingsToDOM();
    });
    document.getElementById('toggle-timer').addEventListener('change', function (e) {
      settings.showTimer = e.target.checked;
      saveSettings();
      applySettingsToDOM();
    });
    document.getElementById('toggle-sound').addEventListener('change', function (e) {
      settings.sound = e.target.checked;
      saveSettings();
      if (settings.sound) ensureAudio();
    });

    window.addEventListener('resize', function () {
      if (geometry) applyFitScale();
    });

    document.addEventListener('keydown', function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      var key = e.key.toLowerCase();
      if (key === 'u') { doUndo(); }
      else if (key === 'h') { doHint(); }
      else if (key === 'n') { startNewGame(); }
      else { return; }
      e.preventDefault();
    });

    // 이어하기 프롬프트: 저장된 게임이 있으면 먼저 물어보고, 없으면 바로 새 게임.
    // saved 데이터는 미리 변수에 담아둔다 — startNewGame()이 뒤에서 즉시
    // localStorage 저장을 덮어쓰므로, 이후 "이어하기"는 저장소를 다시 읽지
    // 않고 이 캡처된 값을 그대로 사용해야 한다.
    var saved = loadSavedGame();
    if (saved && Array.isArray(saved.tiles) && saved.tiles.length === graph.n && !saved.tiles.every(function (t) { return t == null; })) {
      pendingResume = saved;
      startNewGame(true); // 뒤에 깔릴 새 보드를 우선 준비(모달이 덮음) — 통계에는 집계 안 함
      stopTimerLoop();
      openModal(modalResume);
    } else {
      startNewGame();
    }
  }

  document.addEventListener('DOMContentLoaded', initApp);
})();
