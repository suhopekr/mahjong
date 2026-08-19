/* =========================================================================
 * tiles.js — 타일셋 데이터 (Tile Set Data)
 *
 * 34종 일반 타일 + 꽃(Flower) 4종 + 계절(Season) 4종의 정의와,
 * "클래식"(전통 문양 SVG) / "큰 글씨"(대비 우선 숫자+색상) 두 타일셋의
 * 렌더링 정보를 담는다. 게임 로직(game.js)과 분리해 v2에서 타일셋 추가나
 * 다국어 라벨 교체가 데이터 수정만으로 가능하게 한다.
 * ========================================================================= */

/* ---- 타일 종류 정의 ------------------------------------------------------
 * id: 고유 문자열 키
 * group: 'dots' | 'bamboo' | 'chars' | 'wind' | 'dragon' | 'flower' | 'season'
 * rank: 숫자(1-9) 또는 바람/용/꽃/계절 식별자
 * label: 접근성 및 큰 글씨 타일셋용 짧은 텍스트
 * matchGroup: 매칭 판정에 쓰는 키. 꽃/계절은 그룹 전체가 서로 매칭되므로
 *             그룹명을 그대로 matchGroup으로 쓰고, 그 외에는 id 자체가 matchGroup.
 * ------------------------------------------------------------------------ */
const TILE_DEFS = (function buildTileDefs() {
  const defs = [];

  // 색상은 전부 타일 바탕(크림색)에서 WCAG AA(4.5:1) 이상 대비를 확인한
  // 값으로 골랐다(저시력 사용자가 큰 글씨 타일셋에서 즉시 구분해야 하므로).
  const suits = [
    { group: 'dots', name: 'Dots', color: '#1d4ed8' },   // 통 = 파랑
    { group: 'bamboo', name: 'Bamboo', color: '#166534' }, // 삭 = 초록
    { group: 'chars', name: 'Characters', color: '#c2410c' }, // 만 = 주황
  ];
  suits.forEach(function (suit) {
    for (let n = 1; n <= 9; n++) {
      const id = suit.group + '-' + n;
      defs.push({
        id: id,
        group: suit.group,
        rank: n,
        label: suit.name + ' ' + n,
        shortLabel: String(n),
        color: suit.color,
        matchGroup: id,
        count: 4,
      });
    }
  });

  const winds = [
    { rank: 'E', name: 'East Wind', glyph: '東' },
    { rank: 'S', name: 'South Wind', glyph: '南' },
    { rank: 'W', name: 'West Wind', glyph: '西' },
    { rank: 'N', name: 'North Wind', glyph: '北' },
  ];
  winds.forEach(function (w) {
    const id = 'wind-' + w.rank;
    defs.push({
      id: id,
      group: 'wind',
      rank: w.rank,
      label: w.name,
      shortLabel: w.rank,
      glyph: w.glyph,
      color: '#7c3aed', // 바람 = 보라 계열
      matchGroup: id,
      count: 4,
    });
  });

  const dragons = [
    { rank: 'red', name: 'Red Dragon', glyph: '中', color: '#b91c1c', shortLabel: 'RD' },
    { rank: 'green', name: 'Green Dragon', glyph: '發', color: '#166534', shortLabel: 'GD' },
    // shortLabel은 'WD'(2글자)로 — 'W' 한 글자만 쓰면 West Wind와 큰 글씨
    // 타일셋에서 똑같아 보여 구분이 안 된다.
    { rank: 'white', name: 'White Dragon', glyph: '白', color: '#475569', shortLabel: 'WD' },
  ];
  dragons.forEach(function (d) {
    const id = 'dragon-' + d.rank;
    defs.push({
      id: id,
      group: 'dragon',
      rank: d.rank,
      label: d.name,
      shortLabel: d.shortLabel,
      glyph: d.glyph,
      color: d.color,
      matchGroup: id,
      count: 4,
    });
  });

  // 꽃/계절은 내부적으로는 4개의 서로 다른 id(Plum/Orchid/... 등, 이제는
  // 표시에 쓰지 않지만 슬롯 구분·디버깅용으로 id/rank는 그대로 유지)로
  // 존재하지만, 어느 것끼리든 서로 매칭되는 와일드카드 그룹이라 사용자가
  // "이게 저거랑 같은 건가?"를 따질 필요가 없다. 그래서 표시(아트)와
  // aria-label을 4장 전부 동일하게 통일한다 — label 자체가 매칭 규칙을
  // 설명하도록("Season tile, matches any season").
  const flowerNames = ['Plum', 'Orchid', 'Bamboo', 'Chrysanthemum'];
  flowerNames.forEach(function (name, i) {
    defs.push({
      id: 'flower-' + i,
      group: 'flower',
      rank: i + 1,
      name: name, // 참고용(표시에는 쓰지 않음)
      label: 'Flower tile, matches any flower',
      shortLabel: 'F' + (i + 1), // 클래식 타일셋에서만 개별 구분용으로 사용
      color: '#be185d',
      matchGroup: 'flower', // 꽃끼리는 서로 아무거나 매칭
      count: 1,
    });
  });

  const seasonNames = ['Spring', 'Summer', 'Autumn', 'Winter'];
  seasonNames.forEach(function (name, i) {
    defs.push({
      id: 'season-' + i,
      group: 'season',
      rank: i + 1,
      name: name, // 참고용(표시에는 쓰지 않음)
      label: 'Season tile, matches any season',
      shortLabel: 'S' + (i + 1), // 클래식 타일셋에서만 개별 구분용으로 사용
      color: '#0e7490',
      matchGroup: 'season', // 계절끼리는 서로 아무거나 매칭
      count: 1,
    });
  });

  return defs;
})();

const TILE_DEF_BY_ID = (function () {
  const map = Object.create(null);
  TILE_DEFS.forEach(function (d) { map[d.id] = d; });
  return map;
})();

/* ---- 타일 풀 생성 ---------------------------------------------------------
 * 144개 타일 인스턴스(각 타일 정의를 count만큼)를 만든다.
 * 꽃/계절은 count=1이지만 각각 4종이 있어 4장씩 채워진다.
 * ------------------------------------------------------------------------- */
function buildTilePool() {
  const pool = [];
  TILE_DEFS.forEach(function (def) {
    for (let i = 0; i < def.count; i++) {
      pool.push(def.id);
    }
  });
  return pool; // length === 144
}

/* ---- 클래식 타일셋 SVG 렌더러 --------------------------------------------
 * 인라인 SVG만 사용(이미지 파일 금지). group별로 전통 문양을 단순화해 그린다.
 * 함수는 <svg> 내부에 들어갈 마크업 문자열을 반환한다(뷰박스 0 0 100 100 기준).
 * ------------------------------------------------------------------------- */
const ClassicTileArt = {
  dots: function (n) {
    // 통(Dots): n개의 원을 격자 배치
    const layouts = {
      1: [[50, 50]],
      2: [[32, 32], [68, 68]],
      3: [[28, 28], [50, 50], [72, 72]],
      4: [[30, 30], [70, 30], [30, 70], [70, 70]],
      5: [[30, 30], [70, 30], [50, 50], [30, 70], [70, 70]],
      6: [[30, 25], [70, 25], [30, 50], [70, 50], [30, 75], [70, 75]],
      7: [[30, 20], [70, 20], [50, 40], [30, 60], [70, 60], [30, 82], [70, 82]],
      8: [[30, 18], [70, 18], [30, 38], [70, 38], [30, 62], [70, 62], [30, 82], [70, 82]],
      9: [[30, 20], [50, 20], [70, 20], [30, 50], [50, 50], [70, 50], [30, 80], [50, 80], [70, 80]],
    };
    const pts = layouts[n] || layouts[1];
    return pts.map(function (p) {
      return '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="9" fill="#2563eb" stroke="#1e3a8a" stroke-width="1.5"/>';
    }).join('');
  },
  bamboo: function (n) {
    // 삭(Bamboo): n개의 세로 대나무 막대(1은 새 모양 대신 단순 큰 막대로 대체)
    const cols = n === 1 ? [50] : buildColumns(n);
    return cols.map(function (x, i) {
      const y = 15 + (i % 3) * 0; // simple vertical stalks
      return '<rect x="' + (x - 6) + '" y="18" width="12" height="64" rx="5" fill="#16a34a" stroke="#14532d" stroke-width="1.5"/>' +
             '<line x1="' + x + '" y1="34" x2="' + x + '" y2="34" stroke="#14532d"/>' +
             '<line x1="' + (x - 6) + '" y1="40" x2="' + (x + 6) + '" y2="40" stroke="#14532d" stroke-width="1.5"/>' +
             '<line x1="' + (x - 6) + '" y1="60" x2="' + (x + 6) + '" y2="60" stroke="#14532d" stroke-width="1.5"/>';
    }).join('');
    function buildColumns(count) {
      const rows = count <= 3 ? [count] : count <= 6 ? [Math.ceil(count / 2), Math.floor(count / 2)] : [3, 3, count - 6];
      const out = [];
      let idx = 0;
      rows.forEach(function (rowCount, ri) {
        const y = 22 + ri * 28;
        for (let i = 0; i < rowCount; i++) {
          const spacing = 100 / (rowCount + 1);
          out.push(spacing * (i + 1));
        }
      });
      return out.slice(0, count);
    }
  },
  chars: function (n) {
    // 만(Characters): 숫자 한자 + 萬 글자로 단순화
    const hanzi = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
    return '<text x="50" y="46" text-anchor="middle" font-size="34" font-family="serif" fill="#ea580c">' + hanzi[n - 1] + '</text>' +
           '<text x="50" y="80" text-anchor="middle" font-size="26" font-family="serif" fill="#9a3412">萬</text>';
  },
  wind: function (glyph) {
    return '<circle cx="50" cy="50" r="38" fill="none" stroke="#7c3aed" stroke-width="3"/>' +
           '<text x="50" y="64" text-anchor="middle" font-size="42" font-family="serif" fill="#7c3aed">' + glyph + '</text>';
  },
  dragon: function (glyph, color) {
    return '<rect x="14" y="14" width="72" height="72" rx="10" fill="none" stroke="' + color + '" stroke-width="3"/>' +
           '<text x="50" y="64" text-anchor="middle" font-size="42" font-family="serif" fill="' + color + '">' + glyph + '</text>';
  },
  flower: function (label) {
    // 문양(개별 꽃 형태)은 유지하되, 꽃 4장 전부에 공통 테두리 색을 둘러
    // "이 4장은 같은 와일드카드 그룹"임을 한눈에 알 수 있게 한다.
    return '<rect x="4" y="4" width="92" height="92" rx="12" fill="none" stroke="#be185d" stroke-width="3"/>' +
           '<circle cx="50" cy="55" r="20" fill="#fbcfe8" stroke="#be185d" stroke-width="2"/>' +
           '<path d="M50 20 Q60 40 50 55 Q40 40 50 20 Z" fill="#be185d"/>' +
           '<text x="50" y="85" text-anchor="middle" font-size="14" font-family="sans-serif" fill="#831843">' + label + '</text>';
  },
  season: function (label) {
    // 계절도 동일하게 공통 테두리 색으로 그룹을 표시한다.
    return '<rect x="4" y="4" width="92" height="92" rx="12" fill="none" stroke="#0e7490" stroke-width="3"/>' +
           '<circle cx="50" cy="50" r="28" fill="none" stroke="#0e7490" stroke-width="3"/>' +
           '<path d="M50 26 L58 46 L50 74 L42 46 Z" fill="#0e7490"/>' +
           '<text x="50" y="90" text-anchor="middle" font-size="13" font-family="sans-serif" fill="#164e63">' + label + '</text>';
  },
};

function classicArtFor(def) {
  switch (def.group) {
    case 'dots': return ClassicTileArt.dots(def.rank);
    case 'bamboo': return ClassicTileArt.bamboo(def.rank);
    case 'chars': return ClassicTileArt.chars(def.rank);
    case 'wind': return ClassicTileArt.wind(def.glyph);
    case 'dragon': return ClassicTileArt.dragon(def.glyph, def.color);
    case 'flower': return ClassicTileArt.flower(def.shortLabel);
    case 'season': return ClassicTileArt.season(def.shortLabel);
    default: return '';
  }
}

/* ---- 큰 글씨 타일셋(기본값) 렌더러 ----------------------------------------
 * 노안/저시력 사용자를 위해 큰 숫자 + 단순 아이콘 + 색상 코딩.
 * ------------------------------------------------------------------------- */
const SUIT_ICON = {
  dots: '●',   // ● 원
  bamboo: '‖', // ‖ 막대 느낌
  chars: '万',  // 万 (간체, 큰 글씨셋은 단순 아이콘 목적이라 무방)
};

function bigTextArtFor(def) {
  const color = def.color;
  if (def.group === 'dots' || def.group === 'bamboo' || def.group === 'chars') {
    const icon = SUIT_ICON[def.group];
    return (
      '<rect x="6" y="6" width="88" height="88" rx="12" fill="' + color + '" opacity="0.12"/>' +
      '<text x="50" y="52" text-anchor="middle" font-size="46" font-weight="700" font-family="system-ui, sans-serif" fill="' + color + '">' + def.rank + '</text>' +
      '<text x="50" y="82" text-anchor="middle" font-size="22" font-family="system-ui, sans-serif" fill="' + color + '">' + icon + '</text>'
    );
  }
  if (def.group === 'wind' || def.group === 'dragon') {
    // 용은 2글자 코드(RD/GD/WD)를 쓰므로(West Wind와 혼동 방지) 한 글자보다
    // 살짝 작게 렌더링해 타일 안에 넉넉히 들어가게 한다.
    var fontSize = def.shortLabel.length > 1 ? 32 : 40;
    return (
      '<rect x="6" y="6" width="88" height="88" rx="12" fill="' + color + '" opacity="0.12"/>' +
      '<text x="50" y="60" text-anchor="middle" font-size="' + fontSize + '" font-weight="700" font-family="system-ui, sans-serif" fill="' + color + '">' + def.shortLabel + '</text>'
    );
  }
  // 꽃/계절은 어느 것끼리든 서로 매칭되는 와일드카드라 4장을 굳이 구분해
  // 보여줄 필요가 없다(오히려 "저 둘은 번호가 다른데 매칭되네?" 하는
  // 혼란만 준다). 그래서 개별 rank 대신 공통 아이콘 + 공통 라벨로 4장
  // 전부 완전히 동일하게 그린다.
  if (def.group === 'flower') {
    return (
      '<rect x="6" y="6" width="88" height="88" rx="12" fill="' + color + '" opacity="0.15"/>' +
      // 꽃잎 4장짜리 단순 아이콘(모양으로도 구분되게, 색만으로 구분하지 않음)
      '<circle cx="50" cy="35" r="11" fill="' + color + '"/>' +
      '<circle cx="35" cy="48" r="11" fill="' + color + '"/>' +
      '<circle cx="65" cy="48" r="11" fill="' + color + '"/>' +
      '<circle cx="50" cy="58" r="11" fill="' + color + '"/>' +
      '<circle cx="50" cy="48" r="7" fill="#fffaf0"/>' +
      '<text x="50" y="82" text-anchor="middle" font-size="22" font-weight="700" font-family="system-ui, sans-serif" fill="' + color + '">FLW</text>'
    );
  }
  if (def.group === 'season') {
    return (
      '<rect x="6" y="6" width="88" height="88" rx="12" fill="' + color + '" opacity="0.15"/>' +
      // 잎/물방울 모양의 단순 아이콘
      '<path d="M50 16 C67 34 67 56 50 68 C33 56 33 34 50 16 Z" fill="' + color + '"/>' +
      '<text x="50" y="86" text-anchor="middle" font-size="22" font-weight="700" font-family="system-ui, sans-serif" fill="' + color + '">SSN</text>'
    );
  }
  return '';
}

/* ---- 접근성 라벨 ----------------------------------------------------------
 * aria-label에 쓰일 사람이 읽는 이름.
 * ------------------------------------------------------------------------- */
function tileAriaName(def) {
  return def.label;
}

/* 전역 네임스페이스로 노출 (모듈 시스템 없이 game.js에서 바로 사용).
 * 브라우저에서는 window, Node(자체 테스트)에서는 globalThis에 붙인다. */
(function () {
  var ROOT = (typeof window !== 'undefined') ? window : globalThis;
  ROOT.MahjongTiles = {
    TILE_DEFS: TILE_DEFS,
    TILE_DEF_BY_ID: TILE_DEF_BY_ID,
    buildTilePool: buildTilePool,
    classicArtFor: classicArtFor,
    bigTextArtFor: bigTextArtFor,
    tileAriaName: tileAriaName,
  };
})();
