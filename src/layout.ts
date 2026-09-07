/* 자동 레이아웃 엔진 — flow.json + 실측 크기 → 절대 좌표.
 * v6의 flexbox+실측 오버레이 배치를 좌표 계산으로 포팅했다.
 * 자유 배치(v7.x)는 여기서 계산한 좌표를 초기값으로 doc.layout 오버라이드를 적용하는 식으로 확장한다. */
import { FlowDoc, FlowLane, Tab, flowsFrom } from './types';

/* ---- 배치 상수 (v6 시각 메트릭) ---- */
export const CARD_W = 300;          // 씬 카드 너비 (styles.css .scene/.thumb/.gutter와 함께 바꿀 것)
export const GUTTER = 34;           // 카드 사이 간격(삽입 존 포함)
export const PITCH = CARD_W + GUTTER;
export const THUMB_H = 260;         // 썸네일 높이 — 세로 캡처와 16:10 HTML 썸네일이 모두 contain으로 통째 보이는 크기
export const CARD_CENTER = CARD_W / 2;  // 카드 중심 X (핸들 위치와 일치해야 함)
export const BRACKET_PAD = 52;      // 범주 있을 때 씬 위 여백
export const TRUNK_LEN = 44;        // 트렁크 가로 갈래 길이
export const ARROW_H = 9;           // 화살촉 길이
export const CORNER_R = 10;         // 라운드 코너
export const SEG_GAP = 8;           // 갈래 뿌리 사이 여백
export const DROP_PAD = 8;          // 앵커 아래 여백
export const LBL_ARM = TRUNK_LEN + ARROW_H + 8;  // 트렁크 X → 라벨 왼쪽 거리
export const RHANDLE_X = CARD_W - 5; // 씬 카드 오른쪽 소스 핸들 x (nodes.tsx와 일치)
export const TRUNK_BEND_DX = 35;    // 오른쪽 트렁크: 'r' 핸들 → 세로선 x 오프셋
export const GROUP_GAP = 26;        // 레인 → 자식 그룹 간격
export const BLOCK_GAP = 30;        // 형제 블록 간격
export const LANE_AFTER_LABEL = 24; // 라벨 노드 → 첫 씬 간격 (왼쪽 화살표 여백과 균형)
export const ROOT_TO_LABEL = 82;    // 루트 카드 오른쪽 → 첫 라벨 (화살표 44+9 포함)
export const RCAP_H = 22;           // '첫 씬' 캡션 높이
export const SEC_GAP = 70;          // 전체 탭 섹션 간격
export const CAP_H = 34;            // 섹션 캡션 높이
export const DEFAULT_SCENE_H = THUMB_H + 64;  // 실측 전 씬 노드 높이 추정 (썸네일 + 캡션·배지)
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
  type: 'harrow' | 'trunk' | 'rtrunk';
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

/** Branch 블록(레인+자손 전체)의 지오메트리 — 자유 배치 드래그·충돌 판정용 */
export interface BlockInfo {
  flowId: string;
  tabId: string;
  nodeIds: string[];        // 블록에 속한 모든 노드 (자손 포함)
  flowIds: string[];        // 블록에 속한 플로우 id들 (자신 포함)
}

export interface LayoutResult {
  nodes: LNode[];
  edges: LEdge[];
  lanes: LaneRow[];
  blocks: Record<string, BlockInfo>;
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
  const blocks: Record<string, BlockInfo> = {};
  const blockStack: BlockInfo[] = [];
  const addNode = (n: LNode) => {
    nodes.push(n);
    for (const b of blockStack) b.nodeIds.push(n.id);
  };
  let maxX = 0;

  const sceneH = (nodeId: string) => size(nodeId)?.h ?? DEFAULT_SCENE_H;
  const labelDim = (nodeId: string) => {
    const s = size(nodeId);
    return { w: s?.w ?? DEFAULT_LABEL_W, h: s?.h ?? DEFAULT_LABEL_H };
  };

  /** 한 플로우 블록(레인 + 그 아래 자식 그룹들) 배치. 반환: 블록 전체 높이(오프셋 포함 —
   *  이후 형제 블록들이 함께 밀린다). */
  function layoutBlock(f: FlowLane, tab: Tab, baseLabelX: number, baseYTop: number,
    ancestors: Set<string>, isRootFirst: boolean): number {
    // 자유 배치 오프셋 — 자동 좌표에 더해진다 (첫 Branch 포함)
    const off = doc.layout?.[tab.id]?.offsets?.[f.id] || { dx: 0, dy: 0 };
    const labelX = baseLabelX + off.dx;
    const yTop = baseYTop + off.dy;
    const binfo: BlockInfo = { flowId: f.id, tabId: tab.id, nodeIds: [], flowIds: [f.id] };
    blocks[f.id] = binfo;
    for (const b of blockStack) b.flowIds.push(f.id);
    blockStack.push(binfo);

    const brPad = (f.brackets || []).length ? BRACKET_PAD : 0;
    const sceneY = yTop + brPad;
    const lblId = `lbl:${f.id}`;
    const ld = labelDim(lblId);
    const labelY = sceneY + THUMB_H / 2 - PILL_CENTER_Y;
    addNode({
      id: lblId, type: 'label', x: labelX, y: labelY, z: 3, // 호버 툴바가 씬 위로 뜨도록
      draggable: true, selectable: false,
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
      addNode({
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
      addNode({
        id: `br:${f.id}:${bi}`, type: 'bracket',
        x: left - 7, y: sceneY - 58, w: right - left + 14, h: 44, z: 5,
        draggable: false, selectable: false,
        data: { flowId: f.id, bi, tabId: tab.id }
      });
    });
    const laneBottom = sceneY + laneH;
    // 자식 분기 그룹 — 오른쪽 부모의 그룹을 먼저(위에) 배치해
    // 왼쪽 부모의 트렁크가 앞 블록 카드를 가로지르지 않게 한다 (겹침 해소)
    let childY = laneBottom + GROUP_GAP;
    let grew = false;
    const groups: { i: number; subs: FlowLane[] }[] = [];
    f.seq.forEach((sid, i) => {
      if (ancestors.has(sid)) return;
      const subs = flowsFrom(doc, sid, tab.id);
      if (subs.length) groups.push({ i, subs });
    });
    groups.sort((a, b) => sceneXs[b.i] - sceneXs[a.i]);
    for (const { i, subs } of groups) {
      const sid = f.seq[i];
      const parentNid = sceneNodeIdFor(f, i);
      const anchorX = sceneXs[i] + CARD_CENTER;
      const parentBottom = sceneY + sceneH(parentNid);
      const cardRight = sceneXs[i] + CARD_W;
      const rHandleY = sceneY + THUMB_H / 2;
      let prevArmB: number | null = null;
      let prevArmR: number | null = null;
      for (const cf of subs) {
        const cOff = (doc.layout?.[tab.id]?.offsets?.[cf.id]) || { dx: 0, dy: 0 };
        const cBrPad = (cf.brackets || []).length ? BRACKET_PAD : 0;
        const armY = childY + cOff.dy + cBrPad + THUMB_H / 2; // 자식 라벨 알약 중심 y (오프셋 반영)
        // 부착 방향 — 스냅으로 지정된 side 우선, 없으면 위치로 자동(라벨이 카드 오른쪽 밖이면 'r')
        const explicit = cOff.side === 'r' || cOff.side === 'b' ? cOff.side : null;
        const bottomBase = anchorX + LBL_ARM;
        const side = explicit ?? (bottomBase + cOff.dx - cardRight >= 20 ? 'r' : 'b');
        // 명시 'r'이면 라벨 베이스도 오른쪽 트렁크 정위치로 (오프셋 0 = 정렬된 자리)
        const cLabelX = explicit === 'r' ? sceneXs[i] + RHANDLE_X + TRUNK_BEND_DX + LBL_ARM : bottomBase;
        edges.push(side === 'r'
          ? {
              id: `et:${cf.id}`, type: 'rtrunk',
              source: parentNid, sourceHandle: 'r',
              target: `lbl:${cf.id}`, targetHandle: 'l',
              data: { bendDX: TRUNK_BEND_DX, startDY: prevArmR == null ? null : prevArmR + SEG_GAP - rHandleY }
            }
          : {
              id: `et:${cf.id}`, type: 'trunk',
              source: parentNid, sourceHandle: 'b',
              target: `lbl:${cf.id}`, targetHandle: 'l',
              // 소스 핸들(부모 하단) 기준 상대값 — 드래그 중에도 뿌리가 라이브로 따라온다
              data: { startDY: prevArmB == null ? DROP_PAD : prevArmB + SEG_GAP - parentBottom }
            });
        if (side === 'r') prevArmR = armY; else prevArmB = armY;
        const h = layoutBlock(cf, tab, cLabelX, childY, new Set([...ancestors, sid]), false);
        childY += h + BLOCK_GAP;
        grew = true;
      }
    }
    blockStack.pop();
    const bottom = grew ? childY - BLOCK_GAP : laneBottom;
    return bottom - baseYTop;
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
      // 루트에서 갈라지는 2번째+ 플로우 — 기본은 첫 Scene 카드 '오른쪽'에서 나와 아래로 꺾이는 트렁크
      // (본류와 같은 면에서 출발해 이어져 보인다). 블록을 카드 아래로 끌어다 놓으면 하단 트렁크로 자동 전환.
      if (fs.length > 1) {
        const rootNodeBottom = firstSceneY - RCAP_H + sceneH(rootId);
        const rootRight = rootX + CARD_W;
        const rHandleY = firstSceneY + THUMB_H / 2;
        const baseLabelX = rootX + RHANDLE_X + TRUNK_BEND_DX + LBL_ARM;
        let childY = bottom + GROUP_GAP;
        let prevArmB: number | null = null;
        let prevArmR: number | null = null;
        fs.slice(1).forEach(cf => {
          const cOff = (doc.layout?.[tab.id]?.offsets?.[cf.id]) || { dx: 0, dy: 0 };
          const cBrPad = (cf.brackets || []).length ? BRACKET_PAD : 0;
          const armY = childY + cOff.dy + cBrPad + THUMB_H / 2;
          const explicit = cOff.side === 'r' || cOff.side === 'b' ? cOff.side : null;
          const side = explicit ?? (baseLabelX + cOff.dx - rootRight >= 20 ? 'r' : 'b');
          // 명시 'b'이면 라벨 베이스를 하단 트렁크 정위치로
          const cBase = explicit === 'b' ? rootX + CARD_CENTER + LBL_ARM : baseLabelX;
          edges.push(side === 'r'
            ? {
                id: `et:${cf.id}`, type: 'rtrunk',
                source: rootId, sourceHandle: 'r',
                target: `lbl:${cf.id}`, targetHandle: 'l',
                data: { bendDX: TRUNK_BEND_DX, startDY: prevArmR == null ? null : prevArmR + SEG_GAP - rHandleY }
              }
            : {
                id: `et:${cf.id}`, type: 'trunk',
                source: rootId, sourceHandle: 'b',
                target: `lbl:${cf.id}`, targetHandle: 'l',
                data: { startDY: prevArmB == null ? DROP_PAD : prevArmB + SEG_GAP - rootNodeBottom }
              });
          if (side === 'r') prevArmR = armY; else prevArmB = armY;
          const h = layoutBlock(cf, tab, cBase, childY, new Set([startSid]), false);
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
    return { nodes, edges, lanes, blocks, height: y, width: maxX };
  }
  const tab = doc.tabs.find(t => t.id === view);
  if (tab) {
    const h = layoutTab(tab, 0, 0);
    return { nodes, edges, lanes, blocks, height: h, width: maxX };
  }
  return { nodes, edges, lanes, blocks, height: 0, width: 0 };
}
