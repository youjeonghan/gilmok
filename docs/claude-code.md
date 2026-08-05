# Claude Code 연동

## ⌨ 내장 터미널

![내장 터미널](shot-terminal.png)

헤더 맨 오른쪽 **패널 아이콘**을 누르면 우측에 터미널이 열리고, **데이터 폴더에서 `claude` CLI가 바로 실행**된다.

- **로컬 로그인·구독 그대로** — API 키 불필요. 이 컴퓨터에서 `claude`에 로그인돼 있으면 끝.
- AI가 flow.json을 고치면 캔버스에 **즉시 반영**되고 Ctrl+Z로 되돌릴 수 있다.
- 패널을 닫아도 세션은 유지된다 — 다시 열면 이어서 보인다. **⟳ 재시작**으로 새 세션.
- 활용 예: "온보딩 뒤에 결제 Scene 3개 추가하고 분기로 연결해줘", "이 플로우에서 이탈 지점 분석해줘"

## flow-sync 스킬 (claude.ai/design 미러)

`service.designUrl`이 설정된 상태에서 헤더 **⤓ 스킬 설치**를 누르면, 데이터 폴더가 속한 git 레포의 `.claude/skills/flow-sync/`에 스킬이 설치된다.

- Claude Code에서 `/flow-sync` — claude.ai/design의 원격 Scene을 로컬 `scenes/`로 동기화
- 새 Scene의 id는 파일명 기준으로 발급(중복 시 `_2`), 기존 id는 절대 바꾸지 않는다

## claude.ai/design 바로가기

`service.designUrl`을 설정(⚙)하면:

- 헤더 **↗ 디자인 시스템** — 디자인 프로젝트 열기
- Scene 카드 호버 **↗ 디자인** — 해당 Scene 편집 딥링크 (`?file=<원격경로>`, 로컬 `scenes/` 접두사 제거 규약)
