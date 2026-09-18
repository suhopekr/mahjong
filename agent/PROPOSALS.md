# PROPOSALS — 창조자 승인 대기열

> 에이전트가 할 수 없는 것(POLICY의 dangerous)을 여기에 제안한다. Bo가 각 항목 아래 `결정:` 줄을 달면 에이전트는 다음 실행에 그것을 명령으로 읽는다.
> 상태: open / approved / rejected / done

## P-001 · 언어별 URL + hreflang 구조 (deferred — 2026-09-18 비영어권 노출 <10, SOUL Strategy 5로 보류)
- 배경: 14개 언어 번역이 클라이언트 스왑이라 검색 엔진에는 영어 페이지 하나로만 보인다. 번역 작업의 SEO 수익이 0.
- 제안: 펄스 2주치 GSC 국가별 노출 데이터를 모은 뒤, 비영어권 노출이 의미 있는 상위 2~3개 언어부터 정적 언어 경로(/es/solitaire/ 등)를 생성하는 방안을 설계해서 다시 올린다. 지금은 결정 요청이 아니라 예고.
- 비용: $0 (빌드 도구 추가 필요할 수 있음)
- 결정:

## P-002 · 펄스 데이터 소스 연결 (done 2026-09-18)
- 배경: 에이전트가 관찰할 눈이 필요하다. GA4 Data API + Search Console API, 서비스 계정 1개.
- 제안: tools/agent/README.md 절차대로 서비스 계정 JSON을 agent/secrets/google-sa.json에 두고 GA4 속성·GSC 도메인 속성에 뷰어 권한 부여.
- 비용: $0
- 결정:

## P-003 · 펄스 CSV 행 갱신(과소집계 고정 방지) (done 2026-09-18 — pulse.mjs upsert, commit caccb26)
- 배경: tools/agent/pulse.mjs는 이미 있는 날짜 행을 건너뛴다. launchd가 06:30 로컬에 '어제'(daysAgo(1))를 긁으면 GA4 처리 지연으로 부분집계된 값이 CSV에 영구 고정된다(09-17: organic 0 / engaged 0 / start 0 — 전체 기간 유일). GSC는 3일 지연이라 09-16/09-17 행의 GSC 열도 영영 빈칸. 이후 주간 이동평균(tier 판정)이 매주 마지막 날 과소집계를 안고 간다.
- 제안(창조자 판단, 에이전트는 tools/ 미수정): (a) 최근 3일 행은 실행 때마다 덮어쓰기, 또는 (b) gaEnd를 daysAgo(2)로 늦추고 GSC 열은 값이 생기면 채우기. 검증: 다음 펄스의 pulse-latest.md 09-17 값과 CSV 09-17 행을 비교.
- 비용: $0
- 에이전트 메모(2026-09-18 content): git HEAD caccb26에서 tools/agent/pulse.mjs가 최근 날짜 행을 덮어쓰는 upsert로 이미 바뀌었음. 창조자가 done으로 닫아도 될 듯.
- 결정:

## P-004 · 펄스에 캠페인별 세션 열 추가 (done 2026-09-18 — pulse-latest.md에 'GA4 campaigns' 표 추가)
- 배경: 소셜 드래프트 링크에 utm_campaign을 붙였지만 pulse.mjs가 sessionCampaignName 차원을 뽑지 않아, 게시 결과를 다음 소셜 실행이 자동으로 읽을 수 없다. 지금은 GA4 "top landing pages" 표에 쿼리스트링째로 걸릴 때만 보인다(fbclid 행들처럼).
- 제안(창조자 판단, tools/ 미수정): pulse-latest.md에 "GA4 sessions by campaign (28d)" 표 하나 추가 — dimensions `sessionCampaignName`, `sessionSource`; metrics sessions, engagedSessions. utm이 없는 세션은 "(not set)"으로 한 줄.
- 비용: $0
- 결정:

## P-005 · AdSense 신청 시점 — 지금은 보류, 조건 4개 충족 후 신청 (approved 2026-09-18)
- 배경(저장소·펄스 직접 확인): 필수 페이지(about/contact/privacy/terms) ✓. sitemap 고유 URL 18. 게임 페이지 12 중 8개는 1,100~1,400단어+FAQ로 충분하지만 4개(dots-and-boxes 361단어, four-ball-billiards 391, stone-flick 398, shuffleboard 309)는 FAQ 없이 얇다. 가이드 1편. 색인 6/20(미색인 11 크롤 대기). 오가닉 하루 2~9(주 27), GSC 클릭 0, 운영 약 1개월. AdSense는 공식 트래픽 최저선이 없지만 "가치가 낮은 콘텐츠/콘텐츠 부족" 거절이 게임 사이트에 흔하고, 리뷰어는 캔버스가 아닌 텍스트와 색인 상태를 본다. 거절되면 재신청까지 보통 2주+ 대기라 한 번에 통과하는 쪽이 싸다.
- 의견: **지금 신청하지 않는다.** 아래 4개가 채워지면 신청(예상 4~6주, 2026-10-16 리플렉션에서 재판정):
  (1) GSC 색인 ≥ 15/18 (미색인 11개 중 대부분 해소 — 창조자 색인 요청 결과),
  (2) 얇은 게임 페이지 4개에 How-to/Tips + FAQ(JSON-LD) 추가해 800단어 이상,
  (3) 가이드 3~5편(현재 1편; solitaire·freecell·word-search 우선),
  (4) 오가닉 세션 2주 연속 하루 10 이상(또는 주 70+), GSC 클릭 > 0.
- 승인 후에만 필요한 것(지금 하지 말 것): ads.txt, 광고 스크립트, ad-slot 활성화.
- 결정 요청: (a) 위 기준에 동의하는지, (b) 조건 (2)를 에이전트가 content 실행에서 해도 되는지 — 게임 페이지 본문에 섹션을 **추가**하는 일이라 POLICY caution(FAQ 문안 수정)과 dangerous(게임 UI 변경)의 경계. 보드/게임 로직은 건드리지 않고 기존 8개 페이지의 섹션 구조를 그대로 복제하는 범위로 한정.
- 비용: $0
- 결정: (a) 기준 동의. (b) 허용 — 얇은 게임 페이지 4개에 How-to/Tips + FAQ(JSON-LD) 섹션 추가 OK. 게임 로직·보드·UI는 그대로, 기존 8개 페이지의 섹션 구조를 복제하는 범위. 일반 원칙: 큰 변화가 아니고, 비용이 들지 않고, 법적 문제가 없으면 안전한 것으로 보고 진행해도 된다. (Bo, 2026-09-18)

## P-006 · SOUL 수정 제안 — Boundaries의 브랜치 문장을 커밋 규칙과 맞추기 (approved+done 2026-09-18)
- 배경: SOUL Boundaries는 "`main`에 커밋하지 않는다. 항상 `agent/<날짜>-<topic>` 브랜치."인데, POLICY 커밋 규칙과 _common.md는 "에이전트는 git 쓰기 명령을 하지 않는다, 창조자가 커밋한다"로 운용 중(09-18 content 실행이 그렇게 끝남). 모순은 아니지만 SOUL 문장이 실제 절차와 다르다.
- 제안 문구: "`main`에 커밋하지 않는다. 사이트 변경은 작업 트리에 남기고 `agent/COMMIT_MSG.md`에 메시지를 쓴다; 커밋·브랜치·push는 창조자가 한다(POLICY 커밋 규칙)."
- 비용: $0
- 결정:

