/* flow.json 스키마 (v3) — 의미 구조는 v6과 동일, layout은 자유 배치용 확장(선택).
   kind는 v0.7.14에서 추가 — 없던 문서는 normalize가 'design'으로 보정한다 */

export interface Service {
  name: string;
  icon: string;
  designUrl?: string;
}

export interface Tab {
  id: string;
  title: string;
  start: string | null;
}

export interface Scene {
  title: string;
  file: string | null;            // HTML 또는 이미지(png/jpg/webp/gif) 경로 · null = 미제작
  kind: 'design' | 'capture';    // design = 내가 만든 씬(기본) · capture = 가져온 화면(타 서비스 캡처 등)
  themes: Record<string, string>;
  group?: string;
  updated?: string;
  note?: string;
}

export interface Bracket {
  label: string;
  start: number;
  end: number;
  note?: string;
}

export interface FlowLane {
  id: string;
  tab: string;
  from: string;
  label: string;
  note?: string;
  seq: string[];
  brackets: Bracket[];
}

/** 자유 배치 — Branch(플로우)별 오프셋. 자동 배치 좌표에 더해지며,
 *  해당 블록 '뒤'(레이아웃 순서상 이후)의 블록들도 함께 밀린다. 의미 구조와 분리. */
export interface TabLayout {
  // key = flow id. side = 부착 방향(스냅으로 지정 시 저장 — 'b' 카드 하단 / 'r' 카드 오른쪽, 없으면 위치로 자동 판정)
  offsets: Record<string, { dx: number; dy: number; side?: 'b' | 'r' }>;
}

export interface FlowDoc {
  version: number;
  service: Service;
  tabs: Tab[];
  scenes: Record<string, Scene>;
  flows: FlowLane[];
  layout?: Record<string, TabLayout>;
}

export interface ServerInfo {
  version: string;
  appName?: string;
  dataDir: string;
  projectKey: string;
  skillInstalled: boolean;
  needProject: boolean;
  recent?: string[];
  appTheme?: string;
  canPick: boolean;
  canUpdate: boolean;
  canTerm?: boolean;
  canThumb?: boolean;
  canNewWindow?: boolean; // Electron: 새 창(프로세스 하나 더) 지원
}

/** 씬 썸네일 PNG URL (서버 모드) — v로 캐시 무효화 */
export const thumbUrl = (file: string, v?: string) =>
  'api/thumb?f=' + encodeURIComponent(file) + (v ? '&v=' + encodeURIComponent(v) : '');

/** localStorage에 저장하는 로컬 UI 상태 (문서 아님) */
export interface UIState {
  sceneTheme: Record<string, string>;
  globalTheme?: string;
  pickBig?: boolean;
  viewport?: Record<string, { x: number; y: number; zoom: number }>; // 탭별 뷰포트
  termOpen?: boolean;
  termW?: number;
}

export function normalize(d: any): FlowDoc {
  d = d || {};
  d.service = d.service || { name: '서비스', icon: '' };
  d.tabs = d.tabs || [];
  d.flows = (d.flows || []).map((f: any) => ({ brackets: [], note: '', ...f }));
  d.scenes = d.scenes || {};
  Object.values(d.scenes as Record<string, Scene>).forEach(s => {
    s.themes = s.themes || {};
    s.note = s.note || '';
    s.kind = s.kind === 'capture' ? 'capture' : 'design'; // 구 문서 보정 — 다음 저장 때 파일에 기록됨
  });
  return d as FlowDoc;
}

/** 이미지 씬 여부 — 확장자로 판별. 렌더링 경로(썸네일 캡처 대신 <img>)만 결정하며 kind와는 별개 축 */
export const isImageFile = (f: string | null | undefined): boolean =>
  !!f && /\.(png|jpe?g|webp|gif)$/i.test(f);

export const titleOf = (doc: FlowDoc, id: string) =>
  (doc.scenes[id] && doc.scenes[id].title) || id;

export const themePath = (sc: Scene, theme: string): string | null =>
  theme === 'default' ? sc.file : (sc.themes || {})[theme] || null;

export const flowsFrom = (doc: FlowDoc, id: string, tabId: string) =>
  doc.flows.filter(f => f.from === id && f.tab === tabId);

export const bracketAt = (f: FlowLane, i: number): Bracket | null =>
  (f.brackets || []).find(b => i >= b.start && i <= b.end) || null;

/* 범주 index 보정 — v6 로직 그대로 (includeIdx = 경계 삽입을 포함시킬 범주의 인덱스, -1이면 없음) */
export function bracketsOnInsert(f: FlowLane, idx: number, includeIdx: number) {
  (f.brackets || []).forEach((b, bi) => {
    if (bi === includeIdx) {
      if (idx <= b.start) b.end++;
      else if (idx <= b.end + 1) b.end++;
    } else {
      if (idx <= b.start) { b.start++; b.end++; }
      else if (idx <= b.end) { b.end++; }
    }
  });
}
export function bracketsOnRemove(f: FlowLane, idx: number) {
  f.brackets = (f.brackets || []).filter(b => {
    if (idx < b.start) { b.start--; b.end--; }
    else if (idx <= b.end) { b.end--; }
    return b.end >= b.start;
  });
}
