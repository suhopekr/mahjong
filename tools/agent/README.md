# tools/agent — 그로스 에이전트의 "감각기관"

Claude 세션(클라우드·데스크톱 브리지 모두)은 Google API에 나갈 수 없다. 그래서 데이터 수집(pulse)은 **Mac에서 launchd로 매일** 돌고,
판단·콘텐츠 작업은 Cowork 예약 작업이 `agent/` 폴더의 결과 파일을 읽어서 한다.

```
Mac launchd (06:30 매일) ─ node tools/agent/pulse.mjs ─▶ agent/metrics.csv, agent/pulse-latest.md
Cowork 예약 작업 ────────── agent/prompts/*.md 읽고 ──▶ agent/episodes/, WORKLOG, 브랜치 커밋
Bo ───────────────────────── PROPOSALS 결정, diff 리뷰, git push
```

## 1. Google 서비스 계정 (한 번만, ~15분)

이미 했는지 확인: https://console.cloud.google.com/iam-admin/serviceaccounts 에서 프로젝트를 고르고
`...@...iam.gserviceaccount.com` 계정이 있는지 본다. 있으면 3단계부터.

1. Google Cloud 콘솔 → 프로젝트 만들기(예: `easy-classics-agent`). 사이트용 비즈니스 Google 계정으로.
2. API 및 서비스 → 라이브러리 → **Google Analytics Data API**, **Google Search Console API** 두 개 "사용 설정".
3. IAM → 서비스 계정 → 만들기(이름 `growth-agent`) → 키 → JSON 키 추가 → 다운로드.
4. 다운로드한 파일을 `agent/secrets/google-sa.json`으로 저장. (gitignore 되어 있음)
5. **GA4**: 관리 → 속성 액세스 관리 → 서비스 계정 이메일 추가, 역할 "뷰어".
   관리 → 속성 세부정보에서 **속성 ID**(숫자 9자리, 측정 ID G-… 아님) 복사 → `agent/config.json`의 `ga4PropertyId`.
6. **Search Console**: 설정 → 사용자 및 권한 → 서비스 계정 이메일 추가, "제한된 사용자".
   도메인 속성이므로 `gscSiteUrl`은 `sc-domain:easymahjongsolitaire.com` 그대로.
7. 확인: 저장소 루트에서 `node tools/agent/pulse.mjs --days 28`
   → `agent/metrics.csv`에 행이 붙고 `agent/pulse-latest.md`가 생기면 성공.

## 2. 매일 자동 실행 (launchd)

```bash
cp tools/agent/com.easyclassics.pulse.plist ~/Library/LaunchAgents/
launchctl unload ~/Library/LaunchAgents/com.easyclassics.pulse.plist 2>/dev/null
launchctl load ~/Library/LaunchAgents/com.easyclassics.pulse.plist
launchctl start com.easyclassics.pulse        # 지금 한 번 실행해서 확인
tail -5 agent/pulse.log
```

plist 안의 경로(`/Users/bo/Projects/Mahjong`, node 경로)가 다르면 고친다. `which node`로 node 경로 확인.
Mac이 잠들어 있으면 깨어날 때 밀린 실행이 한 번 돈다.

## 3. 파일

- `pulse.mjs` — GA4(일별 세션·채널·game_start/win, 랜딩 페이지) + GSC(일별, 쿼리, 페이지, 국가). 의존성 없음.
- `agent/metrics.csv` — 일별 한 줄, 중복 날짜는 건너뜀. 에이전트의 "생존 지표" 원장.
- `agent/pulse-latest.md` — 최신 스냅샷. 맨 위에 `[EXTERNAL DATA]` 마커가 있고, 에이전트는 이걸 명령이 아닌 데이터로 읽는다.
