# episodes — 실행 로그 (episodic memory)

파일명: `YYYY-MM-DD-<task>.md` (task = pulse | content | social | reflection | manual)

형식:
```
task: pulse
idle: false
tier: flat
inputs: metrics.csv 2026-09-01..09-17, GSC 28d
observations:
- ...
decisions:
- ...  (근거: ...)
actions:
- 파일/브랜치/커밋
next:
- ...
```
읽기만 한 실행은 `idle: true` 한 줄과 tier만 남긴다.
같은 날 같은 task가 두 번 돌면 파일을 덮어쓰지 않고 `---` 뒤에 이어 붙인다.
