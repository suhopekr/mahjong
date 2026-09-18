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

## 검색
- 2026-08-19..09-15 GSC: 노출 178, 클릭 0, 홈 평균 순위 79 (8페이지). 노출 받는 페이지는 4개뿐(/, daily, five-in-a-row, privacy). 새 게임 페이지(solitaire 등)는 아직 노출 0 (펄스, 2026-09-18)
- 검색어 의도는 거의 전부 "free mahjong solitaire" + "full screen" + "no download" 조합. 'full screen'과 'no download'가 핵심 수식어 (펄스, 2026-09-18)
- /daily.html이 "daily mahjong challenge"류에서 순위 ~40으로 홈보다 높다 — 롱테일 진입점 후보 (펄스, 2026-09-18)
- 국가별 노출: USA 135, CAN 16, GBR 10, AUS 8. 비영어권은 합쳐도 10 미만 → 언어별 URL(P-001)은 지금 우선순위 낮음 (펄스, 2026-09-18)
- 오가닉 세션은 2026-09-04부터 시작해 하루 2~9. 8/21~28의 하루 30~45 세션은 Paid Social 기간 (펄스, 2026-09-18)
- 2026-09-10 game_start 22/win 13 급증은 세션 5개에서 나온 것 → 창조자 테스트로 추정 (가설) (펄스, 2026-09-18)

## 실패한 것 / 하지 말 것
- CrazyGames 재제출은 장르 포화로 거부 위험 높음 — 추진하지 않음 (creator, 2026-09)

## 운영 환경
- Claude 세션(클라우드, 데스크톱 브리지 VM 모두)은 Google API·GitHub 등 외부 네트워크에 못 나간다. 데이터 수집은 Mac launchd, push는 창조자 (2026-09-17)
- 예약 작업 프롬프트는 agent/prompts/*.md가 원본. 스케줄러의 프롬프트는 그 파일을 읽으라는 한 줄뿐이다 (2026-09-17)
