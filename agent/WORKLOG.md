# WORKLOG — 최근 작업 컨텍스트 (에이전트가 매 실행 끝에 갱신)

> 형식: 최신이 위. 항목당 5줄 이내. 10개를 넘으면 오래된 항목을 MEMORY.md로 요약 이전하고 지운다.
> 각 실행은 새 세션이다. 이 파일이 기억의 전부이므로 "다음 실행이 이 파일만 보고 이어갈 수 있는가"를 기준으로 쓴다.

## 커밋 대기 (창조자 리뷰)
- 없음. (2026-09-18 content 실행의 index.html 변경은 창조자가 main에 a93a8e6로 커밋 완료 — social 실행에서 `git status` 깨끗함 확인, COMMIT_MSG.md 비움)

## 최근 실행

### 2026-09-18 · reflection(1, 수동 첫 실행, day 1) · idle: false
- tier = flat(기준선 수집 중). 데이터 2일치라 4주 리뷰 불가 → 루프 검증(5회 실행 모두 episode/WORKLOG/MEMORY/PROPOSALS 사이클 정상), 제네시스 정렬 이탈 없음, 전략 교체 제안 없음(첫 정식 판정 2026-10-16).
- AdSense: 지금 신청 비추천 → P-005(색인 ≥15/18, 얇은 게임 페이지 4개 보강, 가이드 3~5편, 오가닉 일 10+). P-006 SOUL 브랜치 문장 정합 제안.
- 확인: status에 agent/ 밖 미커밋 = tools/agent/pulse.mjs(창조자, P-004 추정). pulse-latest에 campaigns 표 아직 없음. 09-17 행 upsert 여부 미확정.
- 다음: 펄스가 P-003/P-004 확인. content는 P-005 (b) 결정 후 얇은 4개 페이지부터. 사이트 파일 변경 없음, git 읽기만.

### 2026-09-18 · social(1, 수동 첫 실행) · idle: false
- tier = flat(기준선 수집 중). 첫 소셜 드래프트: agent/social/2026-09-18-drafts.md — FB 2개(daily.html, 홈; UTM 붙임) + 링크 없는 버전 1 + YouTube 35초 스크립트/제목 3안/설명문/태그 10.
- 게임 = Mahjong Solitaire(노출 178 중 홈+daily가 169; 나머지 게임은 노출 0~5). 글은 "내가 만든 사이트" 1인칭 — 가짜 추천 금지.
- 지난 드래프트 없음 → utm 결과 기록 없음. pulse에 campaign 차원이 없어 P-004 제안(tools/ 미수정).
- 다음: 창조자가 게시하면 여기 "게시: <campaign> <날짜> <채널>" 한 줄. 사이트 파일 변경 없음, git 읽기만(status/log). index.html 커밋(a93a8e6) 확인 → 커밋 대기 비움.

### 2026-09-18 · content(1, 수동 첫 실행) · idle: false
- tier = flat(기준선 수집 중). Strategy 1: 홈 title/description/og를 GSC 쿼리 군집("classic mahjong full screen without downloading" 17, "free mahjong solitaire full screen/no download" ~30)에 맞게 재작성. index.html 4줄, 새 페이지 0.
- `npm --prefix tools test` 전부 통과. `run check`는 Playwright 미설치라 `site-check --static`(396 통과)로 대체.
- 커밋 못 함: 삭제 권한 없음(device_request_delete_permission 거부). 변경은 main 작업 트리에 미커밋. 커밋 메시지 초안은 episodes/2026-09-18-content.md.
- 발견: site-check가 title 브랜드 접미사를 강제 → POLICY의 title ≤60자는 브랜드 포함 시 불가. HEAD caccb26에서 pulse.mjs upsert 반영(P-003 사실상 done).
- 다음: 창조자 커밋·push 후 3~4주 홈 순위/CTR 관찰. 후보: daily.html description, FAQ "classic" Q(번역 동반), 게임 페이지 title 길이.

### 2026-09-18 · pulse(2, 실데이터) · idle: false
- tier = flat(기준선 수집 중). 오가닉 주간 27 vs 22(+23%), 이상 없음. 비영어권 노출 합 9, P-001 보류 유지.
- 의심: 09-17 행 전부 0(부분집계?), /solitaire/ 랜딩 17세션 중 engaged 3, Direct 38 > Organic 27, GSC 09-14/15 노출 1·3.
- 구조: pulse.mjs가 기존 CSV 행을 갱신 안 함 → 마지막 날 과소집계 고정, 09-16/17 GSC 열 빈칸. P-003 신설.
- 다음: 다음 펄스에서 09-17 재조회값 vs CSV 비교로 P-003 확정. 관찰만, 사이트 파일 변경 없음.

### 2026-09-18 · manual · idle: false
- 첫 펄스 데이터 확인, SOUL Strategy 개정(검색 의도 정렬 1번, 언어 URL 보류). GSC 색인 6/20, 미색인 11개는 크롤 대기 → 창조자가 색인 요청.
- 다음 콘텐츠 스프린트 후보: 홈 title/description에 'full screen'·'no download' 반영; daily.html 강화; sitemap.xml에 /daily.html 중복 항목 정리(펜스 밖 수동 항목).

### 2026-09-18 · pulse · idle: true
- tier = blind: agent/pulse-latest.md 없음, metrics.csv 0행. 관찰할 데이터가 아직 없다.
- PROPOSALS 결정 없음. 파일 변경 없음(episodes/WORKLOG만).
- 다음: 창조자가 P-002(서비스 계정 + launchd)를 끝내야 펄스가 눈을 뜬다. 그 전까지 펄스는 idle.

### 2026-09-17 · bootstrap · idle: false
- 창조자와 함께 agent/ 뼈대, POLICY, 펄스 스크립트, 예약 작업 프롬프트를 만들었다.
- 다음: 창조자가 tools/agent/README.md 1~2절(서비스 계정, launchd)을 끝내면 펄스가 데이터를 쌓기 시작 → 1~2주 기준선 수집.
- 그 전까지 tier = blind. 펄스/콘텐츠 작업은 idle로 끝내는 게 맞다.
- 주의: 번역은 클라이언트 스왑이라 크롤러는 영어만 본다 (SOUL Strategy 1).
