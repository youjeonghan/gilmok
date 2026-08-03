/* 자동 레이아웃 엔진 — flow.json + 실측 크기 → 절대 좌표.
 * v6의 flexbox+실측 오버레이 배치를 좌표 계산으로 포팅했다.
 * 자유 배치(v7.x)는 여기서 계산한 좌표를 초기값으로 doc.layout 오버라이드를 적용하는 식으로 확장한다. */
import { FlowDoc, FlowLane, Tab, flowsFrom } from './types';

/* ---- 배치 상수 (v6 시각 메트릭) ---- */
export const CARD_W = 222;          // 씬 카드 너비
export const GUTTER = 34;           // 카드 사이 간격(삽입 존 포함)
export const PITCH = CARD_W + GUTTER;
export const THUMB_H = 132;
export const CARD_CENTER = 111;     // 카드 중심 X (핸들 위치와 일치해야 함)
export const BRACKET_PAD = 52;      // 범주 있을 때 씬 위 여백
export const TRUNK_LEN = 44;        // 트렁크 가로 갈래 길이
export const ARROW_H = 9;           // 화살촉 길이
export const CORNER_R = 10;         // 라운드 코너
export const SEG_GAP = 8;           // 갈래 뿌리 사이 여백
export const DROP_PAD = 8;          // 앵커 아래 여백
export const LBL_ARM = TRUNK_LEN + ARROW_H + 8;  // 트렁크 X → 라벨 왼쪽 거리
export const GROUP_GAP = 26;        // 레인 → 자식 그룹 간격
export const BLOCK_GAP = 30;        // 형제 블록 간격
export const LANE_AFTER_LABEL = 10; // 라벨 노드 → 첫 씬 간격
export const ROOT_TO_LABEL = 82;    // 루트 카드 오른쪽 → 첫 라벨 (화살표 44+9 포함)
export const RCAP_H = 22;           // '첫 씬' 캡션 높이
export const SEC_GAP = 70;          // 전체 탭 섹션 간격
export const CAP_H = 34;            // 섹션 캡션 높이
export const DEFAULT_SCENE_H = 196;
export const DEFAULT_LABEL_W = 92;
export const DEFAULT_LABEL_H = 24;
export const PILL_CENTER_Y = 12;    // 라벨 노드 안 알약 중심 y

export interface LNode {
  id: string;
  type: 'scene' | 'label' | 'bracket' | 'seccap' | 'addstart';
  x: number; y: number;
  w?: number; h?: number;
  z?: number;
  draggable: boolean;
  selectable: boolean;
  data: any;
}
export interface LEdge {
  id: string;
  type: 'harrow' | 'trunk';
  source: string; sourceHandle: string;
  target: string; targetHandle: string;
  data?: any;
}
/** 드래그 재배치용 레인 지오메트리 (flow 좌표계) */
export interface LaneRow {
  flowId: string;
  tabId: string;
  sceneY: number;       // 씬 카드 top
  laneTop: number;      // 범주 포함 top
  laneH: number;
  scenesX0: number;     // 첫 씬 x
  sceneXs: number[];    // 각 씬 x
  left: number;         // 라벨 x (히트 영역 왼끝)
  right: number;        // 히트 영역 오른끝
}

export interface LayoutResult {
  nodes: LNode[];
  edges: LEdge[];
  lanes: LaneRow[];
  height: number;
  width: number;
}

type SizeFn = (id: string) => { w: number; h: number } | null;

/** 레인 i번째 씬의 노드 인스턴스 id (동일 씬 중복 등장 대응) */
export function sceneNodeIdFor(f: FlowLane, i: number): string {
  const sid = f.seq[i];
  let occ = 0;
  for (let k = 0; k < i; k++) if (f.seq[k] === sid) occ++;
  return `sc:${f.id}:${sid}:${occ}`;
}

export function computeLayout(
  doc: FlowDoc,
  view: string, // 'all' | tabId
  size: SizeFn,
  pillW: (flowId: string) => number | null
): LayoutResult {
  const nodes: LNode[] = [];
  const edges: LEdge[] = [];
  const lanes: LaneRow[] = [];
  let maxX = 0;

  const sceneH = (nodeId: string) => size(nodeId)?.h ?? DEFAULT_SCENE_H;
  const labelDim = (nodeId: string) => {
    const s = size(nodeId);
    return { w: s?.w ?? DEFAULT_LABEL_W, h: s?.h ?? DEFAULT_LABEL_H };
  };

  /** 한 플로우 블록(레인 + 그 아래 자식 그룹들) 배치. 반환: 블록 전체 높이 */
  function layoutBlock(f: FlowLane, tab: Tab, labelX: number, yTop: number,
    ancestors: Set<string>, isRootFirst: boolean): number {
    const brPad = (f.brackets || []).length ? BRACKET_PAD : 0;
    const sceneY = yTop + brPad;
    const lblId = `lbl:${f.id}`;
    const ld = labelDim(lblId);
    const labelY = sceneY + THUMB_H / 2 - PILL_CENTER_Y;
    nodes.push({
      id: lblId, type: 'label', x: labelX, y: labelY,
      draggable: !isRootFirst, selectable: false,
      data: { flowId: f.id, tabId: tab.id, isRootFirst }
    });
    const scenesX0 = labelX + ld.w + LANE_AFTER_LABEL;
    const sceneXs: number[] = [];
    let laneH = THUMB_H;
    f.seq.forEach((sid, i) => {
      const nid = sceneNodeIdFor(f, i);
      const x = scenesX0 + i * PITCH;
      sceneXs.push(x);
      laneH = Math.max(laneH, sceneH(nid));
      nodes.push({
        id: nid, type: 'scene', x, y: sceneY,
        draggable: true, selectable: true,
        data: { sid, flowId: f.id, idx: i, tabId: tab.id }
      });
    });
    const laneRight = f.seq.length ? sceneXs[f.seq.length - 1] + CARD_W : scenesX0 + 40;
    maxX = Math.max(maxX, laneRight);
    lanes.push({
      flowId: f.id, tabId: tab.id, sceneY, laneTop: yTop, laneH,
      scenesX0, sceneXs, left: labelX, right: laneRight + 60
    });
    // 범주 바
    (f.brackets || []).forEach((b, bi) => {
      if (!f.seq.length) return;
      const s = Math.max(0, Math.min(b.start, f.seq.length - 1));
      const e = Math.max(s, Math.min(b.end, f.seq.length - 1));
      const left = sceneXs[s], right = sceneXs[e] + CARD_W;
      nodes.push({
        id: `br:${f.id}:${bi}`, type: 'bracket',
        x: left - 7, y: sceneY - 58, w: right - left + 14, h: 44, z: 5,
        draggable: false, selectable: false,
        data: { flowId: f.id, bi, tabId: tab.id }
      });
    });
    const laneBottom = sceneY + laneH;
    // 자식 분기 그룹 — 레인의 각 씬에서 갈라지는 플로우들
    let childY = laneBottom + GROUP_GAP;
    let grew = false;
    f.seq.forEach((sid, i) => {
      if (ancestors.has(sid)) return;
      const subs = flowsFrom(doc, sid, tab.id);
      if (!subs.length) return;
      const parentNid = sceneNodeIdFor(f, i);
      const anchorX = sceneXs[i] + CARD_CENTER;
      const parentBottom = sceneY + sceneH(parentNid);
      let prevArmY: number | null = null;
      subs.forEach(cf => {
        const cLabelX = anchorX + LBL_ARM;
        const cBrPad = (cf.brackets || []).length ? BRACKET_PAD : 0;
        const armY = childY + cBrPad + THUMB_H / 2; // 자식 라벨 알약 중심 y
        edges.push({
          id: `et:${cf.id}`, type: 'trunk',
          source: parentNid, sourceHandle: 'b',
          target: `lbl:${cf.id}`, targetHandle: 'l',
          data: { startY: prevArmY == null ? parentBottom + DROP_PAD : prevArmY + SEG_GAP }
        });
        prevArmY = armY;
        const h = layoutBlock(cf, tab, cLabelX, childY, new Set([...ancestors, sid]), false);
        childY += h + BLOCK_GAP;
        grew = true;
      });
    });
    const bottom = grew ? childY - BLOCK_GAP : laneBottom;
    return bottom - yTop;
  }

  /** 탭 하나 배치. 반환: 섹션 높이 */
  function layoutTab(tab: Tab, x0: number, y0: number): number {
    if (!tab.start) {
      nodes.push({
        id: `add:${tab.id}`, type: 'addstart', x: x0, y: y0,
        draggable: false, selectable: false, data: { tabId: tab.id }
      });
      return 200;
    }
    const startSid = tab.start;
    const rootId = `sc:root:${tab.id}`;
    const fs = flowsFrom(doc, startSid, tab.id);
    const rootX = x0;
    const firstBrPad = fs.length && (fs[0].brackets || []).length ? BRACKET_PAD : 0;
    const flowsY = y0 + RCAP_H;              // 첫 블록 yTop
    const firstSceneY = flowsY + firstBrPad; // 첫 레인 씬 top = 루트 카드 top
    nodes.push({
      id: rootId, type: 'scene', x: rootX, y: firstSceneY - RCAP_H,
      draggable: false, selectable: false,
      data: { sid: startSid, flowId: null, idx: 0, tabId: tab.id, isRoot: true }
    });
    let bottom = firstSceneY + sceneH(rootId);
    if (fs.length) {
      const firstLabelX = rootX + CARD_W + ROOT_TO_LABEL;
      const h0 = layoutBlock(fs[0], tab, firstLabelX, flowsY, new Set([startSid]), true);
      edges.push({
        id: `er:${fs[0].id}`, type: 'harrow',
        source: rootId, sourceHandle: 'r',
        target: `lbl:${fs[0].id}`, targetHandle: 'l'
      });
      bottom = Math.max(bottom, flowsY + h0);
      // 루트에서 갈라지는 2번째+ 플로우 — 첫 라벨 아래 트렁크로 앵커
      if (fs.length > 1) {
        const firstLblId = `lbl:${fs[0].id}`;
        const fld = labelDim(firstLblId);
        const pw = pillW(fs[0].id);
        const anchorX = firstLabelX + (pw != null ? pw / 2 : fld.w / 2);
        const firstLabelY = firstSceneY + THUMB_H / 2 - PILL_CENTER_Y;
        const anchorBottom = firstLabelY + fld.h;
        let childY = bottom + GROUP_GAP;
        let prevArmY: number | null = null;
        fs.slice(1).forEach(cf => {
          const cLabelX = anchorX + LBL_ARM;
          const cBrPad = (cf.brackets || []).length ? BRACKET_PAD : 0;
          const armY = childY + cBrPad + THUMB_H / 2;
          edges.push({
            id: `et:${cf.id}`, type: 'trunk',
            source: firstLblId, sourceHandle: 'b',
            target: `lbl:${cf.id}`, targetHandle: 'l',
            data: { startY: prevArmY == null ? anchorBottom + DROP_PAD : prevArmY + SEG_GAP }
          });
          prevArmY = armY;
          const h = layoutBlock(cf, tab, cLabelX, childY, new Set([startSid]), false);
          childY += h + BLOCK_GAP;
        });
        bottom = childY - BLOCK_GAP;
      }
    }
    return bottom - y0;
  }

  if (view === 'all') {
    let y = 0;
    doc.tabs.forEach(t => {
      nodes.push({
        id: `cap:${t.id}`, type: 'seccap', x: 0, y,
        draggable: false, selectable: false, data: { tabId: t.id, title: t.title }
      });
      const h = layoutTab(t, 0, y + CAP_H);
      y += CAP_H + h + SEC_GAP;
    });
    return { nodes, edges, lanes, height: y, width: maxX };
  }
  const tab = doc.tabs.find(t => t.id === view);
  if (tab) {
    const h = layoutTab(tab, 0, 0);
    return { nodes, edges, lanes, height: h, width: maxX };
  }
  return { nodes, edges, lanes, height: 0, width: 0 };
}
