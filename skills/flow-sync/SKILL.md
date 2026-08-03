---
name: flow-sync
description: flow-map 씬 동기화 — claude.ai/design 디자인 시스템(원격 정본)과 로컬 scenes/ 미러·flow.json(씬 갤러리)을 맞춘다. 신규/변경/삭제 감지, @meta updated 스탬프, 미제작 자리표시자 ↔ 신규 원격 씬 매칭. 사용자가 "씬 싱크", "flow sync", "씬 갤러리 맞춰줘"라고 하면 실행.
---

# flow-sync — 씬 동기화 절차

원격(claude.ai/design 디자인 시스템)이 **씬 HTML의 정본**, 로컬 `scenes/`는 미러, `flow.json`이 분기·갤러리의 정본이다. 이 스킬은 원격 → 로컬 단방향 pull + flow.json 메타 갱신을 수행한다.

## 0. 대상 결정

- 데이터 폴더: ① 사용자가 지정한 폴더 → ② 현재 레포에서 `flow.json`을 가진 flow-map 데이터 폴더 탐색(`**/flow-map/flow.json`; 하나면 그것, 여럿이면 사용자에게 질문).
- `flow.json` 읽기. 클로드 디자인 프로젝트 ID는 `service.designUrl`의 `/p/<uuid>`에서 추출. **designUrl이 없으면 이 프로젝트는 클로드 디자인을 안 쓰는 것 — 동기화 대상이 아님을 안내하고 종료.**

## 1. 원격 목록 조회

- `DesignSync list_files`로 전체 경로 확보.
- 씬 후보만 필터: flow.json `scenes[].file`에서 `scenes/` 접두사를 제거한 경로들이 원격 경로다. 기존 미러에 존재하는 최상위 폴더(예: `screens/`, `prelaunch/`)의 파일이 후보. 그 밖의 폴더(`components/`·`foundations/`·`brand/`·`_*` 등 디자인 시스템 자산)는 제외하되, 처음 보는 폴더에 씬으로 보이는 파일이 있으면 사용자에게 포함 여부를 확인.

## 2. 디프 & 반영

로컬 미러 경로 = `<데이터폴더>/scenes/<원격경로>`.

- **원격에만 있음(신규)**: `get_file`로 받아 저장.
  - 첫 줄 `@dsCard`에서 `name`(제목)·`group`(카테고리) 파싱.
  - 둘째 줄에 `<!-- @meta created="오늘" updated="오늘" -->` 삽입(이미 있으면 유지·갱신).
  - flow.json `scenes`에 등록: id = 파일명의 의미부(번호·접미 제외, 예: `04-daily-feed.html` → `daily-feed`), title = @dsCard name, group, updated = 오늘, note "". → 씬 갤러리에 자동 표시됨. 어느 분기(seq)에 넣을지는 사용자 몫 — 임의로 라인에 넣지 않는다.
- **양쪽 있음**: 원격 내용과 로컬 파일 비교(내용이 같으면 스킵). 다르면 로컬 덮어쓰기 + `@meta updated` 오늘로 + flow.json 해당 씬 `updated` 갱신.
- **로컬에만 있음(원격에서 삭제됨)**: 지우지 말고 보고만 — 사용자 확인 후 `file: null`(미제작) 전환 또는 로컬 파일 삭제.

주의: `get_file` 결과가 크면 tool-results 파일로 persist된다 → **python으로 JSON 파싱해 content를 추출**해서 저장할 것(내용을 손으로 재타이핑 금지). 작은 결과도 스크립트 경유가 안전하다.

## 3. 자리표시자 매칭

- flow.json에서 `file: null`인 씬(미제작 자리표시자) 목록화.
- 신규 원격 파일의 @dsCard name과 자리표시자 title이 유사하면 → "이 자리표시자에 연결할까요?" 사용자 확인 후 해당 씬의 `file`을 채운다(id는 유지 — seq 참조가 깨지지 않게 새 씬 항목을 만들지 않는다).

## 4. 보고 & 마무리

- 요약 보고: 신규 N / 변경 N / 원격 삭제 N / 자리표시자 연결 N + flow.json 변경 내역.
- 사용자에게 안내: 뷰어 새로고침. **flow-map 바이너리(서버 모드)로 열려 있으면 자동 저장과 충돌하지 않게 새로고침만 하면 되고**, 정적 서버 모드에서 확정 안 한 localStorage 편집이 있으면 먼저 '내보내기'로 확정하거나 '편집 초기화' 후 새로고침.
- 프로젝트에 로그 관례가 있으면(예: second-brain 볼트 log.md) 한 줄 기록.

## (역방향) push가 필요한 경우

로컬에서 씬 HTML을 일괄 수정했을 때만: `finalize_plan`(writes 글롭) → `write_files`(localPath, localDir=scenes/). 원격이 정본이므로 예외 상황임을 사용자에게 확인받고 진행.
