# MEMORY — 축적된 사실 (semantic memory)

> 한 줄에 사실 하나. 출처와 날짜를 괄호로. 추측은 `(가설)` 표시. 500줄을 넘으면 오래된 것부터 통합.

## 사이트
- 12개 게임, 14개 언어. 게임 목록의 단일 출처는 games.json (creator, 2026-09-17)
- 번역은 localStorage `site.v1.lang` 기반 클라이언트 스왑. 크롤러는 영어만 본다 (CLAUDE.md, 2026-09-17)
- 가이드 페이지 템플릿: guides/how-to-play-mahjong-solitaire.html (2026-09-17)
- 광고 SDK 없음. ad-slot div만 예약되어 있음 (CLAUDE.md)

## 플레이어
- Meta 광고 데이터에서 참여 시청자의 ~84%가 65+ 여성 (creator, 2026-09)
- 광고 크리에이티브는 "no timer, no rush, just you and your coffee" 톤이 향수/도전 톤보다 나았다 (creator, 2026-09)

## 데이터 품질
- GA4는 창조자의 자체 테스트 트래픽 노이즈 이력이 있다. Direct가 Paid Social보다 큰 이상치. 기준선은 필터 확인 이후부터 (creator, 2026-09)
- Meta A/B는 변형당 ~100 LPV 전에는 결론 금지 (creator, 2026-09)
- (2026-09-18 HEAD caccb26에서 upsert로 수정됨 — 아래는 수정 전 사실) pulse.mjs는 CSV에 이미 있는 날짜 행을 갱신하지 않았다(`have.has(d)`). 06:30 로컬 실행이라 '어제' 행은 GA4 부분집계로 고정될 수 있고, 09-16/09-17 행의 GSC 열은 빈칸으로 남는다 (펄스, 2026-09-18)
- 09-11..17 주: Direct 38 > Organic 27, /solitaire/ 랜딩 17세션 중 engaged 3(18%) — 테스트/저품질 direct 의심, 미확정 (펄스, 2026-09-18)

## 검색
- 2026-08-19..09-15 GSC: 노출 178, 클릭 0, 홈 평균 순위 79 (8페이지). 노출 받는 페이지는 4개뿐(/, daily, five-in-a-row, privacy). 새 게임 페이지(solitaire 등)는 아직 노출 0 (펄스, 2026-09-18)
- 검색어 의도는 거의 전부 "free mahjong solitaire" + "full screen" + "no download" 조합. 'full screen'과 'no download'가 핵심 수식어 (펄스, 2026-09-18)
- /daily.html이 "daily mahjong challenge"류에서 순위 ~40으로 홈보다 높다 — 롱테일 진입점 후보 (펄스, 2026-09-18)
- 국가별 노출: USA 135, CAN 16, GBR 10, AUS 8. 비영어권은 합쳐도 10 미만 → 언어별 URL(P-001)은 지금 우선순위 낮음 (펄스, 2026-09-18)
- 오가닉 세션은 2026-09-04부터 시작해 하루 2~9. 8/21~28의 하루 30~45 세션은 Paid Social 기간 (펄스, 2026-09-18)
- 2026-09-10 game_start 22/win 13 급증은 세션 5개에서 나온 것 → 창조자 테스트로 추정 (가설) (펄스, 2026-09-18)
- 오가닉 주간 세션: 09-04..10 = 22, 09-11..17 = 27(09-17 부분집계 가능). 첫 주간 기준선 (펄스, 2026-09-18)
- 브랜드 근접 쿼리 "easy mahjong online free", "free easy mahjong" 노출 각 1, "free mahjong for seniors no download" 노출 1 — 소량이지만 'easy'가 검색어로 존재 (GSC 08-19..09-15, 펄스 2026-09-18)

- GSC 쿼리 최대 단일 군집은 "free classic mahjong full screen without downloading/no download" 17회. 'classic'이 검색어에 있는데 홈 title/description에는 없었음 → 2026-09-18 content 실행에서 반영 (GSC 08-19..09-15, content 2026-09-18)
- 홈 title은 2026-09-18 content 실행에서 "Free Classic Mahjong Solitaire — Full Screen, No Download | Easy Classics"로 변경(미커밋). 같은 페이지 반복 수정 카운트 1회 (content, 2026-09-18)

## 사이트 검증 규칙
- tools/site-check.mjs는 모든 페이지 <title>이 브랜드("| Easy Classics")로 끝나야 통과시킨다 → title ≤60자(POLICY 체크리스트)는 브랜드 포함으로는 불가능, 핵심어를 앞 ~57자에 두는 것으로 해석 (content, 2026-09-18)
- `npm --prefix tools run check`는 Playwright(tools/node_modules)가 있어야 완주. 없으면 `node tools/site-check.mjs --static`으로 정적 검사만 가능 (content, 2026-09-18)
- 데스크톱 브리지 VM에서 삭제 권한 요청이 자동 분류기에 의해 거부될 수 있음(2026-09-18 content). 거부되면 git 쓰기 명령 없이 파일 변경만 남긴다 (_common.md 규칙)

## 실패한 것 / 하지 말 것
- CrazyGames 재제출은 장르 포화로 거부 위험 높음 — 추진하지 않음 (creator, 2026-09)

## 운영 환경
- Claude 세션(클라우드, 데스크톱 브리지 VM 모두)은 Google API·GitHub 등 외부 네트워크에 못 나간다. 데이터 수집은 Mac launchd, push는 창조자 (2026-09-17)
- 예약 작업 프롬프트는 agent/prompts/*.md가 원본. 스케줄러의 프롬프트는 그 파일을 읽으라는 한 줄뿐이다 (2026-09-17)
- GSC 색인 보고서(2026-09-18, 창조자 확인): 색인 6 / 미색인 14. 9/4쯤 미색인이 5→14로 급증 = 새 게임 9개 페이지가 사이트맵에 오른 시점. 사유: Discovered-not indexed 11(크롤 대기, 창조자가 색인 요청 중), Page with redirect 3(정상). 색인 보고서는 API로 못 보므로 펄스는 GSC "노출 받는 페이지 수"를 대리 지표로 쓴다 (2026-09-18)
