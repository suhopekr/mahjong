#!/usr/bin/env node
/* =========================================================================
 * crazygames/build.js — CrazyGames 제출용 빌드 생성기
 *
 * 이 디렉토리(crazygames/)는 완전히 별도의 빌드 파이프라인이다. 메인
 * 사이트(index.html, daily.html, style.css, game.js, tiles.js 등)는 이
 * 스크립트가 "읽기만" 하고 절대 수정하지 않는다 — 사이트 코드에 손대지
 * 않고 별도로 분리해달라는 요구사항 그대로다.
 *
 * 하는 일:
 *   1. 루트의 index.html을 읽어 CrazyGames 제출에 맞지 않는 부분만 문자열
 *      치환으로 제거/수정한다(GA4, 자체 광고 슬롯, 외부 링크, SEO 본문,
 *      Full Screen 버튼은 숨김 처리 — 완전히 지우면 game.js의 무가드
 *      getElementById 호출이 크래시난다, 아래 주석 참고).
 *   2. style.css/tiles.js/game.js는 바이트 단위로 그대로 복사한다(진짜
 *      게임 로직은 완전히 동일해야 하므로).
 *   3. crazygames.css(Full Screen 버튼 숨김 등 아주 작은 오버라이드)와
 *      crazygames-integration.js(SDK 연동)를 새로 만든다.
 *   4. 전부 crazygames/dist/ 에 쓴다.
 *
 * 실행: node crazygames/build.js  (레포 루트 어디서 실행해도 됨)
 * ========================================================================= */
'use strict';

var fs = require('fs');
var path = require('path');
var execSync = require('child_process').execSync;

var ROOT = path.join(__dirname, '..');
var DIST = path.join(__dirname, 'dist');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function must(str, needle, label) {
  if (str.indexOf(needle) === -1) {
    throw new Error(
      '[build] 예상한 텍스트를 index.html에서 못 찾았습니다: ' + label +
      '\n(루트 index.html이 바뀌면 이 빌드 스크립트도 같이 손봐야 합니다.)'
    );
  }
}

function removeOnce(str, needle, label) {
  must(str, needle, label);
  return str.split(needle).join('');
}

// startMarker부터(포함) endMarker까지(포함) 잘라내고 그 자리를 replacement로
// 채운다. 둘 다 must()로 존재를 검증한 뒤에만 자르므로, 앞으로 루트
// index.html의 들여쓰기/문구가 바뀌어 검색 문자열이 어긋나면(indexOf가
// -1을 반환) "슬쩍" 엉뚱한 위치를 잘라내는 대신 즉시 에러로 멈춘다 —
// 이 실수를 실제로 한 번 했었다(sidebar 제거 시 끝 마커의 들여쓰기가
// 틀려서 -1이 나왔는데 거기에 문자열 길이를 더해버려 파일 앞부분 근처의
// 엉뚱한 오프셋을 끝점으로 써서 문서 전체가 통째로 두 번 이어붙는 사고가
// 났다 — start만 검증하고 end는 검증을 빼먹은 게 원인).
function sliceOut(html, startMarker, endMarker, replacement, label) {
  must(html, startMarker, label + ' (start)');
  must(html, endMarker, label + ' (end)');
  var start = html.indexOf(startMarker);
  var end = html.indexOf(endMarker, start) + endMarker.length;
  if (end <= start) {
    throw new Error('[build] ' + label + ': end marker가 start marker보다 앞에 있습니다 — 검색 문자열을 확인하세요.');
  }
  return html.slice(0, start) + replacement + html.slice(end);
}

/* -------------------------------------------------------------------------
 * index.html 변환
 * ---------------------------------------------------------------------- */
function buildIndexHtml() {
  var html = read('index.html');

  // ---- 1) <head> 교체: 메타/OG/JSON-LD/GA4/Vercel Analytics 전부 들어내고
  //         CrazyGames SDK 로 바꾼다. index.html의 <head> 전체를 정확히
  //         한 번에 교체한다 — 부분 치환보다 확실하고, head 안의 내용이
  //         전부 "이 사이트 전용"(도메인 canonical, OG 이미지 절대경로,
  //         JSON-LD 등)이라 어차피 거의 다 안 쓴다.
  var headStart = html.indexOf('<head>');
  var headEnd = html.indexOf('</head>') + '</head>'.length;
  if (headStart === -1 || headEnd === -1) throw new Error('[build] <head> 블록을 못 찾았습니다.');
  var newHead = [
    '<head>',
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
    '<title>Mahjong Solitaire</title>',
    '',
    '<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 100 100\'%3E%3Crect width=\'100\' height=\'100\' rx=\'18\' fill=\'%23146b4c\'/%3E%3Crect x=\'18\' y=\'18\' width=\'64\' height=\'64\' rx=\'10\' fill=\'%23fbf7ec\'/%3E%3Ctext x=\'50\' y=\'66\' font-size=\'46\' text-anchor=\'middle\' font-family=\'serif\' fill=\'%23146b4c\'%3E中%3C/text%3E%3C/svg%3E">',
    '',
    '<link rel="stylesheet" href="style.css">',
    '<link rel="stylesheet" href="crazygames.css">',
    '',
    '<!-- CrazyGames SDK — 일반 <script src> 태그(async/defer 아님)라 다음',
    '     줄이 실행될 때는 window.CrazyGames가 이미 준비돼 있다고 보장된다.',
    '     "로딩 시작"은 여기서 최대한 일찍 알려야 정확하다(전체 로딩 시간',
    '     측정 기준점) — game.js/tiles.js가 실제로 받아지기도 전이다. -->',
    '<script src="https://sdk.crazygames.com/crazygames-sdk-v2.js"></script>',
    '<script>',
    '  if (window.CrazyGames && window.CrazyGames.SDK && window.CrazyGames.SDK.game) {',
    '    window.CrazyGames.SDK.game.sdkGameLoadingStart();',
    '  }',
    '</script>',
    '</head>',
  ].join('\n');
  html = html.slice(0, headStart) + newHead + html.slice(headEnd);

  // ---- 2) 헤더 타이틀/부제 문구 조정.
  //         - "Free Mahjong Solitaire" → "Mahjong Solitaire": 포털 안에서는
  //           "무료"라는 말 자체가 의미 없다(포털의 모든 게임이 무료).
  //         - 부제에서 "no download, no time limit"과 Daily Challenge 링크를
  //           제거 — 둘 다 포털 맥락에서는 당연하거나(다운로드 없음) 존재하지
  //           않는 기능(Daily Challenge는 이 빌드에 없음)이라 의미가 없다.
  must(html, '<h1>Free Mahjong Solitaire</h1>', 'header title');
  html = html.replace('<h1>Free Mahjong Solitaire</h1>', '<h1>Mahjong Solitaire</h1>');
  html = html.replace(
    '<p class="tagline">Match tiles, clear the board — no download, no time limit.\n' +
    '    <a href="/daily.html">Try today\'s Daily Challenge →</a></p>',
    '<p class="tagline">Match tiles, clear the board.</p>'
  );

  // ---- 3) 광고 사이드바(자체 AdSense 슬롯) + 게임 아래 SEO 본문/FAQ 섹션
  //         제거. CrazyGames는 자체 광고 시스템을 iframe 밖/포털 차원에서
  //         붙이므로 우리 쪽 placeholder가 있으면 안 된다.
  html = sliceOut(
    html,
    '    <aside class="sidebar"',
    '    </aside>\n  </div>',
    '    </div>',
    'sidebar aside'
  );

  html = sliceOut(
    html,
    '  <!-- AD SLOT: adsense (desktop footer 728x90) -->',
    '  </section>\n</main>',
    '</main>',
    'footer ad slot + content section'
  );

  // ---- 4) 사이트 푸터(About/Privacy/Contact/Daily Challenge 링크) 제거.
  html = sliceOut(
    html,
    '<footer class="site-footer">',
    '</footer>',
    '',
    'site footer'
  );
  html = html.replace(/\n{3,}/g, '\n\n'); // 위 두 블록 제거로 생긴 빈 줄 정리

  // ---- 5) 모바일 메뉴 시트의 Daily Challenge 링크 제거.
  html = removeOnce(
    html,
    '    <a class="btn mobile-menu-btn" href="/daily.html">Daily Challenge</a>\n',
    'mobile menu Daily Challenge link'
  );

  // ---- 6) Full Screen 버튼: 완전히 지우면 안 된다 — game.js가
  //         document.getElementById('btn-fullscreen')/('btn-fullscreen-mobile')를
  //         가드 없이 바로 .addEventListener 하기 때문에(index.html/
  //         daily.html 둘 다 이 버튼이 항상 있다고 전제하고 짠 코드),
  //         엘리먼트를 지우면 게임 전체가 초기화 단계에서 죽는다.
  //         CrazyGames는 "커스텀 전체화면 버튼 금지"만 요구하므로,
  //         DOM에는 남겨두고 crazygames.css로 완전히 숨겨서(display:none)
  //         "존재는 하지만 아무도 못 보고 못 누르는" 상태로 만든다 —
  //         game.js 자체는 단 한 글자도 안 건드린다.
  must(html, 'id="btn-fullscreen"', 'desktop fullscreen button');
  must(html, 'id="btn-fullscreen-mobile"', 'mobile fullscreen button');

  // ---- 7) 승리 모달의 "Try today's Daily Challenge" 줄 제거 (이 필드는
  //         game.js에서 이미 존재 여부를 가드하고 읽으므로 지워도 안전).
  html = removeOnce(
    html,
    '    <!-- 오늘 데일리 챌린지를 아직 안 끝냈을 때만(game.js가 hidden 토글) -->\n' +
    '    <p id="win-daily-cta" hidden><a class="btn" href="/daily.html">Try today\'s Daily Challenge</a></p>\n',
    'win-daily-cta paragraph'
  );

  // ---- 8) 홈 화면 추가 안내 모달 제거 — 포털 iframe 안에서는 의미가
  //         없는 기능(이 모달도 game.js에서 존재 여부를 가드하고 읽으므로
  //         지워도 안전 — maybeShowInstallHint/dismissInstallHint 둘 다
  //         `if (!el) return`).
  var installHintStart = html.indexOf('<!-- 배지 3개 이상 모으면 딱 한 번만 뜨는 안내');
  var installHintEnd = html.indexOf('<div class="modal-overlay" id="modal-newgame-confirm"');
  must(html, '<!-- 배지 3개 이상 모으면 딱 한 번만 뜨는 안내', 'install hint modal start');
  must(html, '<div class="modal-overlay" id="modal-newgame-confirm"', 'newgame-confirm modal start');
  html = html.slice(0, installHintStart) + html.slice(installHintEnd);

  // ---- 9) 스크립트 태그: tiles.js/game.js는 그대로 두고(파일 자체는
  //         안 건드림), CrazyGames 연동 스크립트를 그 뒤에 추가한다 —
  //         game.js의 DOMContentLoaded 리스너가 먼저 등록되므로(스크립트
  //         선언 순서 = 리스너 등록 순서), 이 연동 스크립트의
  //         DOMContentLoaded 콜백은 initApp()이 보드를 완전히 다 그린
  //         "다음"에 실행된다는 게 보장된다(새로 만드는 게 아니라 이미
  //         일어난 렌더링을 관찰만 함).
  html = removeOnce(
    html,
    '<script src="tiles.js"></script>\n<script src="game.js"></script>\n',
    'tiles.js/game.js script tags'
  );
  html = html.replace(
    '</body>',
    '<script src="tiles.js"></script>\n' +
    '<script src="game.js"></script>\n' +
    '<script src="crazygames-integration.js"></script>\n' +
    '</body>'
  );

  return html;
}

/* -------------------------------------------------------------------------
 * crazygames.css — 아주 작은 오버라이드만. style.css는 손대지 않는다.
 * ---------------------------------------------------------------------- */
var CRAZYGAMES_CSS = [
  '/* crazygames.css — style.css 위에 얹는 아주 작은 오버라이드.',
  ' * style.css 자체는 메인 사이트와 완전히 동일한 파일을 그대로 쓴다. */',
  '',
  '/* CrazyGames는 커스텀 인게임 전체화면 버튼을 금지한다(전체화면은',
  ' * 포털이 자체 제공). 버튼 엘리먼트 자체는 game.js가 가드 없이',
  ' * getElementById().addEventListener()로 참조하므로 DOM에서 지우면',
  ' * 초기화가 깨진다 — 그래서 지우는 대신 완전히 숨긴다. */',
  '#btn-fullscreen,',
  '#btn-fullscreen-mobile {',
  '  display: none !important;',
  '}',
  '',
  '/* Hint 버튼 옆 남은 무료 힌트 개수 표시 — crazygames-integration.js가',
  ' * 텍스트 노드 뒤에 붙이는 span. 순수 표시용, game.js는 모름. */',
  '.cg-hint-count {',
  '  opacity: 0.75;',
  '  font-variant-numeric: tabular-nums;',
  '}',
  '',
].join('\n');

/* -------------------------------------------------------------------------
 * crazygames-integration.js — SDK 연동. game.js는 한 줄도 안 건드리고,
 * 전부 바깥에서 DOM/클릭/키보드를 관찰하는 방식으로 연결한다.
 * ---------------------------------------------------------------------- */
var INTEGRATION_JS = fs.readFileSync(path.join(__dirname, 'src', 'crazygames-integration.js'), 'utf8');

/* -------------------------------------------------------------------------
 * 실행
 * ---------------------------------------------------------------------- */
function main() {
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  fs.writeFileSync(path.join(DIST, 'index.html'), buildIndexHtml());
  fs.writeFileSync(path.join(DIST, 'style.css'), read('style.css')); // 바이트 그대로 복사
  fs.writeFileSync(path.join(DIST, 'tiles.js'), read('tiles.js'));   // 바이트 그대로 복사
  fs.writeFileSync(path.join(DIST, 'game.js'), read('game.js'));     // 바이트 그대로 복사
  fs.writeFileSync(path.join(DIST, 'crazygames.css'), CRAZYGAMES_CSS);
  fs.writeFileSync(path.join(DIST, 'crazygames-integration.js'), INTEGRATION_JS);

  var fileCount = fs.readdirSync(DIST).length;
  var totalBytes = fs.readdirSync(DIST).reduce(function (sum, f) {
    return sum + fs.statSync(path.join(DIST, f)).size;
  }, 0);
  console.log('[build] crazygames/dist/ 생성 완료 — 파일 ' + fileCount + '개, ' +
    (totalBytes / 1024).toFixed(1) + ' KB (CrazyGames 제한: 50MB, 1500개 파일)');

  // ---- zip 패키징 — CrazyGames는 index.html이 zip 루트 바로 아래
  // 있어야 한다고 요구하므로, dist/ 안으로 cd한 뒤 그 안의 내용만 담는다
  // (dist라는 디렉토리 자체를 담지 않음). `zip` CLI가 없는 환경(윈도우
  // 등)에서는 이 단계만 건너뛰고 dist/ 폴더를 안내한다 — 빌드 자체가
  // 실패하는 일은 없게 한다.
  var zipPath = path.join(__dirname, 'mahjong-solitaire-crazygames.zip');
  try {
    fs.rmSync(zipPath, { force: true });
    execSync('zip -r -X -q ' + JSON.stringify(zipPath) + ' .', { cwd: DIST, stdio: 'inherit' });
    var zipSize = fs.statSync(zipPath).size;
    console.log('[build] ' + path.relative(process.cwd(), zipPath) + ' 생성 완료 — ' +
      (zipSize / 1024).toFixed(1) + ' KB');
  } catch (e) {
    console.log('[build] zip CLI를 못 찾았거나 실패했습니다 — crazygames/dist/ 폴더를 직접 압축해서 제출하세요.');
    console.log('        (' + e.message + ')');
  }
}

main();
