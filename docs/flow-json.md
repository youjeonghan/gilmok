# flow.json 스펙

플로우의 단일 정본. 탭·Scene·분기·범주·노트·자유 배치가 전부 이 파일 하나에 있어, AI에게는 이 파일만 읽히면 된다.

```jsonc
{
  "version": 3,

  "service": {
    "name": "하비팅",                      // 헤더에 표시되는 프로젝트명 (창 제목: "길목 — 하비팅")
    "icon": "app-icon.svg",               // 이모지 · 데이터 폴더 상대경로 · URL · data URL
    "designUrl": "https://claude.ai/design/p/<id>"   // (선택) claude.ai/design 프로젝트
  },

  "tabs": [
    { "id": "main", "title": "메인 — 가입·매칭·채팅", "start": "landing" }
    // Tab = 독립 플로우. start = 루트 Scene id (null이면 ＋카드 표시)
  ],

  "scenes": {
    "landing": {
      "title": "사전예약 랜딩 (첫 씬)",    // 표시 이름 — id는 제목 슬러그로 자동 발급, UI 비노출
      "file": "scenes/landing.html",      // default 테마 Scene 경로 · null = 미제작(플레이스홀더)
                                          //   HTML 외에 이미지(png/jpg/webp/gif)도 됨 — 캡처 씬은 "captures/07.jpg"
      "kind": "design",                   // design = 내가 만든 씬 · capture = 가져온 화면(타 서비스 캡처). 없으면 앱이 design으로 보정
      "themes": { "dark": "scenes/landing-dark.html" },  // (선택) 테마별 대체 Scene
      "group": "프리런치",                 // (선택) 카테고리 — Scene 갤러리 그룹
      "updated": "2026-08-01",            // (선택) 갱신일 — 툴팁에 표시
      "note": "카피 A/B 예정"              // (선택) 노트
    }
  },

  "flows": [
    {
      "id": "가입",                        // Branch 식별자
      "tab": "main",                      // 소속 Tab
      "from": "landing",                  // 분기가 갈라져 나오는 Scene (첫 Branch는 start에서 시작)
      "label": "가입",                    // 라벨 텍스트
      "note": "",                         // (선택)
      "seq": ["signup", "onboarding-1"],  // 이 Branch 위 Scene 순서
      "brackets": [
        { "label": "온보딩", "start": 1, "end": 4, "note": "" }  // seq 인덱스 구간 묶기
      ]
    }
  ],

  "layout": {
    "<tabId>": { "offsets": { "<flowId>": { "dx": 0, "dy": 120 } } }
    // 자유 배치 오프셋 — 라벨 드래그로 앱에서 저장됨. 없으면 자동 레이아웃
  }
}
```

## 버전 (선택 — v0.8.0+)

헤더 **⎇ 버전**으로 켠다. 버전 필드가 없으면 위 구조 그대로 동작한다(하위 호환).

```jsonc
{
  "versions": [                                   // 일자형 — 첫 항목이 기준 버전
    { "id": "1.0", "title": "베타", "date": "2026-12-13" },
    { "id": "1.1", "title": "진정성 장치", "tabOrder": ["t-signup", "main"] }  // tabOrder = 상속 순서와 다를 때만
  ],

  // 최상위 tabs / flows / layout / scenes = 기준 버전(1.0)
  "scenes": {
    "chat": {
      "title": "채팅", "file": "scenes/screens/07-chat.html",
      "rev": {
        "1.1": { "file": "scenes/screens/07-chat@1.1.html" },   // 그 버전에서 바뀐 필드만
        "1.2": { "removed": true }                              // 그 버전에서 삭제
      }
    },
    "date-card": { "title": "같이 하기 카드", "file": null, "since": "1.1" }  // 1.1에서 신규
  },

  "versionTabs": {                                 // 그 버전에서 바뀐 Tab 구조 — Tab 단위 통째
    "1.1": {
      "main": { "tab": { "id": "main", "title": "메인", "start": "landing" }, "flows": [ /* … */ ], "layout": { "offsets": {} } },
      "t-old": { "removed": true }
    }
  }
}
```

**해석 규칙 — "선택 버전 이하에서 가장 최근 정의를 쓴다."**

- Scene: 기준(또는 `since`) 정의에 `rev`를 버전 순서대로 덮어쓴다. `removed`면 그 버전부터 없음(이후 `rev`에 필드가 오면 다시 생김).
- Tab: 선택 버전 이하에서 가장 최근의 `versionTabs[버전][탭]`을 통째로 쓴다. 없으면 기준(최상위)의 Tab·Branch·배치.
- 바뀌지 않은 건 기록하지 않는다 — 기록이 없으면 이전 버전 것을 상속.
- 앱에서 편집하면 자동으로 이 형태로 기록된다. 외부(AI)에서 고칠 때도 같은 규칙을 지킨다: 특정 버전만 바꾸려면 최상위가 아니라 `rev[버전]`·`versionTabs[버전]`을 고친다.
- 버전용 Scene 파일은 같은 폴더에 `<이름>@<버전>.html`로 둔다(카드 호버 ⎇ 버튼이 만들어 줌).

## id 규칙

- **Scene id** = 내부 키(파일 매핑·seq 참조·AI 참조). 앱에서 만들면 **제목 슬러그로 자동 발급**, 중복 시 `_2`, `_3`…
- 이미 쓰이는 id는 바꾸지 않는다 — seq·from 참조가 함께 깨진다.
- 제목(title)은 언제든 자유롭게 바꿔도 된다.

## 캡처 씬 — 가져온 화면을 내 플로우처럼

타 서비스 화면을 캡처해 씬으로 넣을 수 있다. 이미지도 HTML 씬과 **완전히 같은 자격**으로 seq·Branch·Bracket·노트·테마·갤러리에 들어간다.

```jsonc
"chat-room": {
  "title": "채팅방",                        // 비워 두고 나중에 채워도 된다 (빈 제목은 카드에 id 표시)
  "file": "captures/07.jpg",               // 데이터 폴더 아래 captures/ · 확장자로 이미지 판별
  "kind": "capture",                       // 카드에 📷 캡처 배지 · '↗ 디자인' 딥링크 숨김
  "themes": { "dark": "captures/12.jpg" }, // 테마별 대체도 이미지 가능
  "group": "채팅", "updated": "2026-09-08", "note": ""
}
```

- **폴더**: `captures/`는 `scenes/`와 나란히 둔다. `scenes/`는 claude.ai/design 미러라서 flow-sync가 건드리지만 `captures/`는 동기화 대상이 아니다.
- **파일명**: `captures/NN.jpg` 또는 `captures/NN-슬러그.jpg`. `NN`은 폴더 안 최대 번호 +1(두 자리 0패딩, 100장부터 세 자리). **번호는 추가한 순서일 뿐 플로우 순서가 아니다** — 순서의 정본은 flow.json이며, 파일명은 바꾸지 않는다(`file` 참조 보호).
- **kind는 형식이 아니라 출처**: 렌더링(썸네일 캡처 vs `<img>`)은 확장자로 정하고, `kind`는 "내가 만든 것 / 가져온 것"만 말한다. SingleFile로 저장한 HTML 캡처는 `kind: "capture"`에 `.html`, 내 디자인의 PNG 내보내기는 `kind: "design"`에 `.png`가 맞다.
- **교체**: 자체 화면이 나오면 `file`을 HTML 경로로, `kind`를 `design`으로 바꾸면 끝. id·라인 위치는 그대로다.
- 이미지를 base64로 flow.json에 박지 않는다 — 파일이 커져 AI가 읽기 어려워진다.

## 외부 편집

- 에디터·AI·git 등 밖에서 flow.json을 고치면 앱이 감지해 **즉시 리로드**한다 (앱 자체 저장은 제외).
- 외부 변경도 앱의 Ctrl+Z 히스토리에 들어가 되돌릴 수 있다.
- 데이터 폴더를 git으로 관리하면 언제든 복구 가능 — 권장.
