# 예약 작업: 콘텐츠 스프린트 (주 1회)

`agent/prompts/_common.md`의 부팅 절차를 먼저 따른다. tier가 `declining`/`blind`면 콘텐츠를 만들지 않고 진단만 하고 끝낸다.

목표: 검색에서 실제로 찾는 질문에 답하는 페이지를 **최대 2개** 만들거나, 기존 페이지의 title/description/FAQ를 데이터 근거로 개선한다.

절차:
0. 시작 시 `GIT_OPTIONAL_LOCKS=0 git status --short`에 agent/ 밖 미커밋 변경이 있으면 창조자 리뷰 대기 중이므로 새 변경을 만들지 않고 진단·후보 정리만 한다.
1. 후보 고르기 — 근거는 순서대로: (a) pulse-latest의 GSC 쿼리 중 노출은 있는데 CTR 낮거나 순위 8~30위인 것, (b) MEMORY의 미해결 질문, (c) SOUL Strategy 2의 가이드 페이지 목록 중 아직 없는 게임. 웹 검색으로 그 검색어의 상위 결과가 무엇에 답하는지 확인한다(읽기만).
2. 만들기 — 템플릿은 `guides/how-to-play-mahjong-solitaire.html`. CLAUDE.md의 CSP·i18n 규칙, POLICY의 검증 체크리스트를 지킨다. 65+ 독자: 짧은 문단, 큰 글씨, 단계별 번호, 이미지 없이도 이해되게.
3. `games.json`은 건드리지 않는다(게임 추가는 dangerous). guides 페이지는 sitemap.xml에 수동 항목이 필요하면 `<!-- games:sitemap -->` 펜스 **밖**에 추가한다.
4. `npm --prefix tools test`가 통과해야 한다 (`run check`는 Playwright가 없으면 `node tools/site-check.mjs --static`으로 대체).
5. 커밋하지 않는다. `agent/COMMIT_MSG.md`에 커밋 메시지 초안(영어, 근거 데이터 인용, 끝에 `Agent: growth`)을 쓰고 WORKLOG "커밋 대기"에 변경 파일과 제안 브랜치명을 적는다.
6. episodes에 "왜 이 페이지인가"를 검색어·수치로 남긴다. 창조자가 diff만 보고 승인할 수 있게 마지막 응답에 변경 파일 목록과 커밋 명령 한 줄(`git switch -c agent/... && git add <files> && git commit -F agent/COMMIT_MSG.md`).

하지 않는 것: 사이트 구조·네비·홈 변경, 게임 페이지 h1 변경, 광고 마크업, 파일 삭제. 필요하면 PROPOSALS.
