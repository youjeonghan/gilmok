/* flow.json 스키마 (v3) — 의미 구조는 v6과 동일, layout은 자유 배치용 확장(선택) */

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
  file: string | null;
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

/** 자유 배치(v7.x) — 탭별 좌표 오버라이드. 의미 구조와 분리된 프레젠테이션 데이터 */
export interface TabLayout {
  mode: 'auto' | 'free';
  pos: Record<string, { x: number; y: number }>; // key = 노드 인스턴스 id
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
  canPick: boolean;
  canUpdate: boolean;
  canTerm?: boolean;
}

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
  });
  return d as FlowDoc;
}

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
