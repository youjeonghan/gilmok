# flow-map

서비스 흐름을 **분기 라인 위 씬 프리뷰**로 조망·편집하는 데스크톱 앱(Electron). mac·Windows 지원.

- 탭(플로우)·분기(트렁크/라운드 커넥터)·범주(⌐¬)·노트·테마·씬 갤러리·드래그 편집·Ctrl+Z
- 데이터는 프로젝트별 폴더(`flow.json` + `scenes/`) — 도구와 분리, **편집은 flow.json에 자동 저장**
- claude.ai/design 연동(선택): 씬별 편집 딥링크, 디자인 시스템 바로가기, flow-sync 스킬 설치 버튼
- **앱 내 '⟳ 업데이트 확인'** — 새 릴리스를 확인하고 설치 파일을 받아 수동 업데이트(서명/공증 불필요 구조)

## 설치 / 사용

1. [Releases](https://github.com/youjeonghan/flow-map/releases)에서 설치 파일 다운로드
   - Windows: `flow-map-setup-<버전>.exe` (SmartScreen 경고 시 '추가 정보 → 실행')
   - mac: `flow-map-<버전>-arm64.dmg` (Gatekeeper 차단 시 시스템 설정 → 개인정보 보호 및 보안에서 허용)
2. 실행 → **📂 프로젝트 폴더 열기**로 `flow.json`이 있는 데이터 폴더 선택 (마지막 프로젝트 기억)
3. 편집은 자동 저장. 업데이트는 **⟳ 업데이트 확인** 버튼 (private 릴리스는 `gh` CLI 로그인 또는 설정의 GitHub 토큰 필요)

### 개발 실행

```
npm install
npm start                  # 현재 소스로 실행
npx electron-builder --win # 로컬 인스톨러 빌드
```

### Go 서버 (헤드리스/폴백)

`main.go` — 뷰어를 내장한 단일 바이너리 서버. 릴리스의 `flow-map-server-*`.

```
flow-map-server <데이터폴더>   # 브라우저로 열림, flow.json 자동 저장
```

## 데이터 폴더 규약

```
<project>/flow-map/
  flow.json     # 플로우 정본 — 아래 스키마
  scenes/…      # 씬 HTML (self-contained). claude.ai/design 미러라면 scenes/<원격경로>
```

## flow.json 스키마

```jsonc
{
  "version": 3,
  "service": { "name": "하비팅", "icon": "../app-icon.svg",    // 이모지·이미지 경로/URL·업로드(data URL)
               "designUrl": "https://claude.ai/design/p/<id>" }, // (선택) 클로드 디자인 프로젝트 —
                                                                 // 헤더 바로가기 + 씬별 편집 딥링크 + 스킬 설치 버튼
  "tabs":   [ { "id", "title", "start" } ],          // 탭 = 독립 플로우, start = 루트 씬 id (null = ＋카드)
  "scenes": { "<id>": {
      "title",                                        // 표시 이름
      "file",                                         // default 테마 씬 경로 · null = 미제작
      "themes": { "dark": "…" },                      // 테마별 대체 씬
      "group",                                        // (선택) 카테고리 — 갤러리 그룹·디자인 시스템 그룹
      "updated", "note" } },
  "flows":  [ { "id", "tab", "from", "label", "note",
                "seq": ["sceneId", ...],
                "brackets": [ { "label", "start", "end", "note" } ] } ]
}
```

- **id vs 제목**: 제목은 표시용, id는 내부 키(파일 매핑·seq 참조·AI 참조). 빈 씬은 id 자동 발급(`new-N`).
- 플로우·분기·범주·노트가 flow.json 하나에 있으므로 AI에게는 이 파일만 읽히면 된다.

## claude.ai/design 연동 (선택)

`service.designUrl`을 설정(⚙)하면:
- 헤더 '↗ 디자인 시스템' + 씬 카드 '↗ 디자인'(딥링크 `?file=<원격경로>`, 로컬 `scenes/` 접두사 제거 규약)
- 헤더 '⤓ 스킬 설치' — 데이터 폴더가 속한 git 레포의 `.claude/skills/flow-sync/`에 [flow-sync 스킬](skills/flow-sync/SKILL.md)을 설치. 이후 Claude Code에서 `/flow-sync`로 원격 씬 동기화.

## 릴리스

태그를 푸시하면 GitHub Actions가 Windows 인스톨러(NSIS)·mac dmg/zip·Go 서버 바이너리를 빌드해 Release에 첨부한다:

```
git tag v6.0.0 && git push origin v6.0.0
```

버전 이력: [CHANGELOG.md](CHANGELOG.md)
