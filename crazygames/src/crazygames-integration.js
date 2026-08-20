/* =========================================================================
 * crazygames-integration.js — CrazyGames SDK 연동.
 *
 * game.js는 단 한 줄도 건드리지 않는다(메인 사이트와 완전히 동일한
 * 파일). 그 대신 이 파일은 순전히 "바깥에서" DOM(모달의 data-open
 * 속성, 버튼 클릭, 키보드)을 관찰해서 SDK 이벤트로 옮기는 역할만 한다.
 * <script src="game.js">보다 뒤에 로드되므로, 여기서 등록하는
 * DOMContentLoaded 리스너는 game.js가 등록한 리스너(= initApp, 보드를
 * 완전히 그린다)보다 항상 "나중에" 실행된다(같은 이벤트의 리스너는
 * 등록 순서대로 실행되므로) — 그래서 아래 로직은 보드가 이미 그려진
 * 상태를 안전하게 가정할 수 있다.
 *
 * 정직하게 남겨두는 한계: gameplayStop 시점에 타이머를 실제로 멈추거나
 * 사운드를 음소거하는 것까지는 game.js 내부 상태(비공개 클로저)에
 * 손대지 않고는 할 수 없다. 대신 광고가 재생되는 동안 보드 전체를
 * 덮는 입력 차단 오버레이를 띄워 클릭/키보드 조작 자체를 막는다 —
 * 실제로 상호작용이 안 되니 타이머가 몇 초 더 흐르는 것 외에는
 * 체감상 "일시정지"와 동일하다. 완전한 타이머/오디오 정지가 필요하면
 * game.js에 아주 작은 export 훅을 추가하는 후속 작업으로 남겨둔다
 * (README 참고).
 * ========================================================================= */
(function () {
  'use strict';

  var SDK = null; // window.CrazyGames.SDK — 준비되면 채운다.

  function getSdk() {
    if (SDK) return SDK;
    if (window.CrazyGames && window.CrazyGames.SDK) SDK = window.CrazyGames.SDK;
    return SDK;
  }

  // SDK 호출은 전부 이 함수를 거친다 — crazygames.com이 아닌 도메인(로컬
  // 테스트, 프리뷰 등)에서는 SDK 메서드가 "disabled" 환경으로 예외를 던질
  // 수 있다고 공식 문서에 나와 있어서(other domains: methods throw
  // errors), 어디서 열든 게임 자체는 절대 안 죽게 전부 try-catch로 감싼다.
  function safeSdkCall(fn) {
    try {
      fn();
    } catch (e) {
      // 조용히 무시 — SDK가 없거나(로컬 테스트) disabled 환경이어도
      // 게임 진행에는 전혀 지장이 없어야 한다.
    }
  }

  function sdkGameLoadingStop() {
    safeSdkCall(function () {
      var sdk = getSdk();
      if (sdk && sdk.game) sdk.game.sdkGameLoadingStop();
    });
  }

  var gameplayActive = null; // null=아직 모름, true=진행 중, false=멈춤 — 중복 호출 방지용
  function setGameplayActive(active) {
    if (gameplayActive === active) return; // 이미 같은 상태면 중복 호출 안 함
    gameplayActive = active;
    safeSdkCall(function () {
      var sdk = getSdk();
      if (!sdk || !sdk.game) return;
      if (active) sdk.game.gameplayStart();
      else sdk.game.gameplayStop();
    });
  }

  // ---- 게임플레이 시작/중단: 모달·설정 패널·모바일 메뉴 시트 중 하나라도
  // 열려 있으면 "중단", 전부 닫혀 있으면 "진행 중"으로 본다. 이 게임은
  // 별도 메인 메뉴 화면 없이 로딩 직후 바로 보드가 보이므로, 초기 상태도
  // 이 규칙 하나로 정확히 판정된다(예: 저장된 판이 있어 "이어하기?" 모달이
  // 뜬 채로 시작하면 그 자체가 이미 "중단" 상태로 올바르게 잡힌다). ------
  var WATCHED_SELECTOR = '.modal-overlay, .settings-panel, .mobile-menu-sheet';

  function anyWatchedElementOpen() {
    var els = document.querySelectorAll(WATCHED_SELECTOR);
    for (var i = 0; i < els.length; i++) {
      if (els[i].dataset.open === 'true') return true;
    }
    return false;
  }

  function syncGameplayState() {
    setGameplayActive(!anyWatchedElementOpen());
  }

  function watchGameplayState() {
    var observer = new MutationObserver(syncGameplayState);
    var els = document.querySelectorAll(WATCHED_SELECTOR);
    for (var i = 0; i < els.length; i++) {
      observer.observe(els[i], { attributes: true, attributeFilter: ['data-open'] });
    }
    syncGameplayState(); // 초기 상태 반영
  }

  // ---- 입력 차단 오버레이: 광고가 재생되는 동안만 보드 클릭/키보드를
  // 막는다. game.js 내부에는 전혀 손대지 않고 순수하게 위에 덮는 방식이라,
  // 광고가 끝나자마자 지우면 게임은 원래 상태 그대로 남아 있다. ---------
  var overlayEl = null;
  function showAdOverlay() {
    if (overlayEl) return;
    overlayEl = document.createElement('div');
    overlayEl.setAttribute('aria-hidden', 'true');
    overlayEl.style.cssText = 'position:fixed;inset:0;z-index:99999;background:transparent;';
    document.body.appendChild(overlayEl);
  }
  function hideAdOverlay() {
    if (!overlayEl) return;
    overlayEl.remove();
    overlayEl = null;
  }

  // ---- 중간(midgame) 광고 요청 -----------------------------------------
  // 요구사항: 게임 진행 중 강제 삽입 금지, "새 게임 시작" 같은 자연스러운
  // 지점에서만. CrazyGames 정책도 동일하다 — 활성 플레이 중/게임 시작
  // 순간에는 금지, 최대 3분에 1회. 그래서 "실제로 새 보드가 생성되는
  // 순간"만 정확히 잡아 그 시점(=자연스러운 휴지점)에만 요청한다.
  var MIDGAME_AD_MIN_INTERVAL_MS = 3 * 60 * 1000;
  var SKIP_FIRST_N_NEW_GAMES = 1; // 세션 첫 "New Game" 한 번은 건너뛴다(과도하게 이르게 광고가 뜨는 것 방지)
  var lastMidgameAdAt = 0;
  var explicitNewGameCount = 0; // 페이지 로딩 시 자동으로 뜨는 첫 판은 카운트 안 됨(아래 참고)

  function requestMidgameAd() {
    var sdk = getSdk();
    if (!sdk || !sdk.ad) return;
    var now = Date.now();
    if (now - lastMidgameAdAt < MIDGAME_AD_MIN_INTERVAL_MS) return; // SDK도 자체 빈도 제한을 두지만, 우리 쪽에서도 이중으로 지킨다
    lastMidgameAdAt = now;

    safeSdkCall(function () {
      showAdOverlay();
      setGameplayActive(false); // 모달과 무관하게, 광고 자체가 하나의 "중단" 상태
      sdk.ad.requestAd('midgame', {
        adStarted: function () {
          // 오디오 음소거는 game.js 내부 상태(설정값)를 건드려야 해서
          // 이 파일만으로는 못 하지만(README의 알려진 한계 참고), 클릭/
          // 키보드 차단은 이미 showAdOverlay로 걸려 있다.
        },
        adFinished: function () {
          hideAdOverlay();
          syncGameplayState();
        },
        adError: function () {
          hideAdOverlay();
          syncGameplayState();
        },
      });
    });
  }

  function maybeRequestMidgameAd() {
    explicitNewGameCount++;
    if (explicitNewGameCount <= SKIP_FIRST_N_NEW_GAMES) return; // "게임 시작 시점" 자체는 광고 금지 정책과 겹치므로 스킵
    requestMidgameAd();
  }

  // 실제로 새 판이 시작되는 매 순간마다 해야 할 일(광고 체크 + 힌트 리셋)을
  // 한 곳에 묶는다 — 아래 두 섹션 모두 "새 판 시작 지점"을 정확히 잡는 게
  // 핵심이라 감지 로직을 공유한다.
  function onNewGameStarted() {
    resetHintsForNewGame();
    maybeRequestMidgameAd();
  }

  // "New Game"으로 실제로 이어지는 모든 경로를 건다:
  //   - 확인 모달을 거쳐서 시작하는 경우(진행 중인 판이 있었던 경우) —
  //     이 버튼들을 누르면 반드시 실제로 새 판이 시작된다.
  var CONFIRMED_NEW_GAME_IDS = [
    'btn-newgame-confirm-start', // "정말 새 게임?" 확인
    'btn-stuck-newgame',         // 완전히 막혀 재배치 불가일 때의 새 게임
    'btn-win-newgame',           // 승리 후 새 게임 — 승리 화면을 먼저 보여준 뒤
                                  // "New Game"을 누르는 이 시점에만 광고를 건다
                                  // (승리 직후 즉시 광고 금지 요구사항 그대로).
    'btn-resume-newgame',        // "이어하기?" 프롬프트에서 새 게임 선택
  ];
  CONFIRMED_NEW_GAME_IDS.forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('click', onNewGameStarted);
  });

  //   - btn-new-game(-mobile)/키보드 N: 진행 중인 판이 없으면 game.js가
  //     확인 없이 "바로" 새 게임을 시작한다. 이 경우엔 클릭 직후 확인
  //     모달이 열렸는지(=진행 중이라 사용자 결정을 더 기다려야 하는지)를
  //     한 틱 뒤에 확인해서, 안 열렸으면 "이미 시작된 것"으로 보고 지금
  //     광고 체크를 한다. 열렸으면 위 btn-newgame-confirm-start 리스너가
  //     실제 결정 시점에 알아서 처리한다.
  function checkImmediateNewGame() {
    setTimeout(function () {
      var confirmModal = document.getElementById('modal-newgame-confirm');
      var confirmOpen = confirmModal && confirmModal.dataset.open === 'true';
      if (!confirmOpen) onNewGameStarted();
    }, 0);
  }
  ['btn-new-game', 'btn-new-game-mobile'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('click', checkImmediateNewGame);
  });
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (String(e.key).toLowerCase() === 'n') checkImmediateNewGame();
  });

  // ---- 힌트 제한 + 보상형(rewarded) 광고 (CrazyGames 빌드 전용 기능) -----
  // game.js는 힌트 횟수 제한이라는 개념 자체를 모른다(사이트 자체 버전은
  // 무제한). 이 섹션은 게임 로직에 전혀 손대지 않고, Hint 버튼 클릭/'H'
  // 키를 game.js의 핸들러보다 "먼저" 가로채는 방식으로만 구현한다:
  //   document 레벨의 캡처(capture) 단계 리스너는 버블 단계에서 실행되는
  //   버튼 자신의 리스너(game.js가 등록)보다 항상 먼저 실행된다 — capture는
  //   이벤트가 target까지 내려가는 "도중"에 실행되고, target 위의 리스너는
  //   그 다음(at-target) 단계에서 실행되기 때문이다. 등록 순서와 무관하게
  //   phase 자체로 순서가 보장되므로, 여기서 stopPropagation()을 부르면
  //   game.js의 doHint()는 아예 호출되지 않는다.
  var HINT_FREE_PER_GAME = 3;
  var HINT_STORAGE_KEY = 'crazygamesMahjong.hintsRemaining.v1';

  function loadHintsRemaining() {
    try {
      var raw = window.localStorage.getItem(HINT_STORAGE_KEY);
      if (raw === null) return HINT_FREE_PER_GAME;
      var n = parseInt(raw, 10);
      return (isFinite(n) && n >= 0) ? n : HINT_FREE_PER_GAME;
    } catch (e) {
      return HINT_FREE_PER_GAME; // localStorage 접근 불가(사생활 보호 모드 등) — 매번 기본값
    }
  }
  var hintsRemaining = loadHintsRemaining();

  function saveHintsRemaining() {
    try { window.localStorage.setItem(HINT_STORAGE_KEY, String(hintsRemaining)); } catch (e) { /* 무시 */ }
  }

  function ensureHintBadge(btn) {
    if (!btn) return null;
    var badge = btn.querySelector('.cg-hint-count');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'cg-hint-count';
      btn.appendChild(badge);
    }
    return badge;
  }
  function updateHintBadge() {
    ['btn-hint', 'btn-hint-mobile'].forEach(function (id) {
      var badge = ensureHintBadge(document.getElementById(id));
      if (badge) badge.textContent = ' (' + hintsRemaining + ')';
    });
  }

  function resetHintsForNewGame() {
    hintsRemaining = HINT_FREE_PER_GAME;
    saveHintsRemaining();
    updateHintBadge();
  }
  function consumeHint() {
    hintsRemaining = Math.max(0, hintsRemaining - 1);
    saveHintsRemaining();
    updateHintBadge();
  }
  function isHintExhausted() {
    return hintsRemaining <= 0;
  }

  // ---- "힌트 소진" 다이얼로그 — 기존 사이트 모달과 같은
  // .modal-overlay/.modal-box/.modal-actions 클래스를 그대로 써서(style.css는
  // 이 빌드에서도 완전히 동일한 파일) 별도 CSS 없이도 나머지 모달과 똑같이
  // 보인다. innerHTML은 전혀 쓰지 않고 전부 createElement + textContent로만
  // 조립한다.
  var hintDialogEl = null;
  function ensureHintDialog() {
    if (hintDialogEl) return hintDialogEl;

    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'modal-cg-hint-limit';
    overlay.dataset.open = 'false';

    var box = document.createElement('div');
    box.className = 'modal-box';
    box.setAttribute('role', 'alertdialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', 'cg-hint-limit-title');

    var h2 = document.createElement('h2');
    h2.id = 'cg-hint-limit-title';
    h2.textContent = 'Out of hints';

    var p = document.createElement('p');
    p.textContent = 'Out of hints. Watch a short ad for 3 more, or keep playing.';

    var actions = document.createElement('div');
    actions.className = 'modal-actions';

    var watchBtn = document.createElement('button');
    watchBtn.type = 'button';
    watchBtn.className = 'btn';
    watchBtn.id = 'btn-cg-hint-watch-ad';
    watchBtn.textContent = 'Watch ad';
    watchBtn.addEventListener('click', requestRewardedHintAd);

    var notNowBtn = document.createElement('button');
    notNowBtn.type = 'button';
    notNowBtn.className = 'btn';
    notNowBtn.id = 'btn-cg-hint-not-now';
    notNowBtn.textContent = 'Not now';
    notNowBtn.addEventListener('click', closeHintDialog);

    actions.appendChild(watchBtn);
    actions.appendChild(notNowBtn);
    box.appendChild(h2);
    box.appendChild(p);
    box.appendChild(actions);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    hintDialogEl = overlay;
    return overlay;
  }
  function openHintDialog() {
    ensureHintDialog();
    hintDialogEl.dataset.open = 'true';
    // 이 엘리먼트는 초기 watchGameplayState() 이후에 동적으로 생성되므로
    // MutationObserver 대상에 없다 — 기존 광고 오버레이와 같은 방식으로
    // 직접 gameplayStop을 알린다.
    setGameplayActive(false);
  }
  function closeHintDialog() {
    if (!hintDialogEl) return;
    hintDialogEl.dataset.open = 'false';
    syncGameplayState(); // 다른 모달이 열려있지 않다면 gameplayStart로 복귀
  }

  // 보상형 광고 요청 — 기존 midgame 광고와 완전히 같은 처리를 재사용한다
  // (입력 차단 오버레이 표시, gameplayStop 통지). 광고 자체가 게임 타이머를
  // 진짜로 멈추거나 사운드를 음소거하지는 못한다 — README의 기존 known
  // limitation과 동일한 이유(game.js 내부 상태는 이 파일에서 접근 불가).
  function grantHintReward() {
    hintsRemaining += HINT_FREE_PER_GAME;
    saveHintsRemaining();
    updateHintBadge();
    hideAdOverlay();
    closeHintDialog();
    syncGameplayState();
  }
  function abortHintReward() {
    // 실패/에러/취소 — 충전 없이 조용히 원래 상태로 복귀.
    hideAdOverlay();
    closeHintDialog();
    syncGameplayState();
  }
  function requestRewardedHintAd() {
    var sdk = getSdk();
    if (!sdk || !sdk.ad) { closeHintDialog(); return; } // SDK 없음(로컬/차단 환경) — 조용히 닫고 복귀, 충전 없음
    closeHintDialog(); // 다이얼로그부터 닫고 광고 오버레이를 띄운다(이중 오버레이 방지)
    showAdOverlay();
    setGameplayActive(false);
    try {
      sdk.ad.requestAd('rewarded', {
        adStarted: function () {},
        adFinished: function () { grantHintReward(); },
        // 문서상 rewarded도 시작/종료/에러 콜백만 제공한다 — 광고를 중간에
        // 닫거나 스킵한 경우도 SDK가 adFinished 대신 adError로 알려준다.
        adError: function () { abortHintReward(); },
      });
    } catch (e) {
      // requestAd 자체가 동기적으로 던지는 경우(다른 도메인의 disabled
      // 환경 등) — 오버레이/다이얼로그가 뜬 채로 멈추지 않도록 반드시 정리.
      abortHintReward();
    }
  }

  function isHintTarget(el) {
    return !!(el && el.closest && el.closest('#btn-hint, #btn-hint-mobile'));
  }
  document.addEventListener('click', function (e) {
    if (!isHintTarget(e.target)) return;
    if (isHintExhausted()) {
      e.preventDefault();
      e.stopPropagation(); // game.js의 doHint() 리스너(버튼 자신, at-target 단계)까지 못 가게 막는다
      openHintDialog();
      return;
    }
    consumeHint();
  }, true); // capture: true — game.js의 버튼 클릭 리스너보다 먼저 실행되도록

  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (String(e.key).toLowerCase() !== 'h') return;
    if (isHintExhausted()) {
      e.preventDefault();
      e.stopPropagation(); // game.js의 document keydown 리스너(버블 단계)보다 먼저 막는다
      openHintDialog();
      return;
    }
    consumeHint();
  }, true); // capture: true — 같은 이유

  // ---- 부트스트랩 -------------------------------------------------------
  // game.js의 DOMContentLoaded 리스너(= initApp, 보드를 완전히 그림)는
  // 이 파일보다 앞선 <script> 태그에서 등록됐으므로 반드시 먼저 실행된다.
  document.addEventListener('DOMContentLoaded', function () {
    sdkGameLoadingStop();
    watchGameplayState();
    updateHintBadge(); // 저장돼 있던(또는 기본 3인) 남은 힌트 개수를 버튼에 반영
  });
})();
