# flow-map

서비스 흐름을 **분기 라인 위 씬 프리뷰**로 조망·편집하는 로컬 도구. 단일 바이너리(Go)로 mac·Windows에서 동작한다.

- 탭(플로우)·분기(트렁크/라운드 커넥터)·범주(⌐¬)·노트·테마·씬 갤러리·드래그 편집·Ctrl+Z
- 데이터는 프로젝트별 폴더(`flow.json` + `scenes/`) — 도구와 분리
- claude.ai/design 연동(선택): 씬별 편집 딥링크, 디자인 시스템 바로가기, flow-sync 스킬

## 실행

```
flow-map <데이터폴더>          # 예: flow-map C:\...\second-brain\sources\assets\hobiting\flow-map
flow-map -port 9000 <폴더>     # 포트 변경
flow-map -no-open <폴더>       # 브라우저 자동 열기 끄기
```

실행하면 `http://127.0.0.1:8123`이 열리고, **모든 편집이 flow.json에 자동 저장**된다(localStorage는 백업).

서명 없는 바이너리라 처음 실행 시 mac은 우클릭 → 열기(또는 `xattr -d com.apple.quarantine flow-map-darwin-arm64`), Windows는 SmartScreen '추가 정보 → 실행'.

### 정적 폴백 (바이너리 없이)

`web/index.html`을 데이터 폴더가 보이는 곳에 두고 `python -m http.server` → `?data=<폴더>/`로 접속.
이 모드에선 편집이 localStorage에 쌓이므로 '🔗 flow.json 연결'(Chrome/Edge) 또는 '내보내기'로 확정해야 한다.

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

## 빌드 / 릴리스

```
go build -o flow-map .        # 로컬 빌드
```

태그를 푸시하면 GitHub Actions가 windows-amd64 / darwin-arm64 / darwin-amd64 바이너리를 빌드해 Release에 첨부한다:

```
git tag v5.0.0 && git push origin v5.0.0
```

버전 이력: [CHANGELOG.md](CHANGELOG.md)
