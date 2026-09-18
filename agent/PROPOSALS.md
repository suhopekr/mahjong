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
