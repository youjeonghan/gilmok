/* React Flow 캔버스 — 자동 레이아웃 결과를 렌더하고 편집 인터랙션을 처리한다 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, BackgroundVariant, Controls, MiniMap,
  ViewportPortal, applyNodeChanges, useReactFlow, useUpdateNodeInternals,
  type Node, type Edge, type NodeChange, type NodeTypes, type EdgeTypes, type Viewport
} from '@xyflow/react';
import { useStore } from '../store';
import { useActions } from '../actions';
import { titleOf, bracketAt, themePath, thumbUrl, FlowLane } from '../types';
import {
  computeLayout, sceneNodeIdFor, CARD_W, type LaneRow, type LNode
} from '../layout';
import { CanvasCtx, suppressClicks, type CanvasUIState } from '../canvasui';
import { SceneNode, LabelNode, BracketNode, SeccapNode, AddStartNode } from './nodes';
import { HArrowEdge, TrunkEdge } from './edges';

const nodeTypes: NodeTypes = {
  scene: SceneNode, label: LabelNode, bracket: BracketNode,
  seccap: SeccapNode, addstart: AddStartNode
};
const edgeTypes: EdgeTypes = { harrow: HArrowEdge, trunk: TrunkEdge };

/* ---------- 드래그 고스트 (화면 좌표, body 직속) ---------- */
function makeGhost(title: string) {
  const g = document.createElement('div');
  g.id = 'ghost';
  const t = document.createElement('span');
  t.textContent = title;
  const gs = document.createElement('span');
  gs.className = 'gs';
  g.appendChild(t); g.appendChild(gs);
  document.body.appendChild(g);
  return {
    move(x: number, y: number) { g.style.left = (x + 14) + 'px'; g.style.top = (y + 10) + 'px'; },
    status(txt: string, join: boolean) { gs.textContent = txt; gs.className = 'gs' + (join ? ' join' : ''); },
    remove() { g.remove(); }
  };
}
type Ghost = ReturnType<typeof makeGhost>;

interface MemEntry { sid: string; brIdx: number | null; origIdx: number }
interface SceneDrag {
  kind: 'scene';
  flowId: string; idx: number; sid: string; nodeId: string;
  ghost: Ghost;
  cur: { lane: LaneRow; mem: MemEntry[]; xs: number[] } | null;
  slot: number | null;
  join: number | null;
}
interface LabelDrag {
  kind: 'label';
  flowId: string;
  tabId: string;
  ghost: Ghost;
  targets: { nodeId: string; sid: string; x: number; y: number; w: number; h: number }[];
  hit: { nodeId: string; sid: string } | null;
  /* 자유 배치 (블록 통째 이동) */
  origin: { x: number; y: number };
  subtree: Set<string>;
  basePos: Map<string, { x: number; y: number }>;
  statics: { x: number; y: number; w: number; h: number }[];
  delta: { dx: number; dy: number };
  moved: boolean;
  invalid: boolean;
}

function CanvasInner({ view }: { view: string }) {
  const { doc, ui, setUI, appTheme, server } = useStore();
  const acts = useActions();
  const { screenToFlowPosition, fitView, setViewport, getViewport, zoomIn, zoomOut } = useReactFlow();
  const dark = appTheme === 'dark';

  // 외부(테스트·향후 AI 패널)에서 뷰포트 제어용
  useEffect(() => {
    (window as any).__flowmapRF = { fitView, setViewport, getViewport, zoomIn, zoomOut };
    return () => { delete (window as any).__flowmapRF; };
  }, [fitView, setViewport, getViewport, zoomIn, zoomOut]);

  /* ---- 실측 크기 수집 ---- */
  const sizesRef = useRef(new Map<string, { w: number; h: number }>());
  const pillRef = useRef(new Map<string, number>());
  const [sizesVer, setSizesVer] = useState(0);
  const bumpTimer = useRef<any>(null);
  /* 트레일링 디바운스 — 초기 측정 폭주 중에 노드 배열을 갈아끼우면
     RF의 dimension 디스패치와 경합해 측정이 통째로 유실될 수 있다.
     이벤트가 잠잠해진 뒤(120ms) 한 번만 레이아웃을 재계산한다. */
  const bumpSizes = useCallback(() => {
    clearTimeout(bumpTimer.current);
    bumpTimer.current = setTimeout(() => setSizesVer(v => v + 1), 120);
  }, []);
  const reportPill = useCallback((fid: string, w: number) => {
    const prev = pillRef.current.get(fid);
    if (prev == null || Math.abs(prev - w) > 0.5) {
      pillRef.current.set(fid, w);
      bumpSizes();
    }
  }, [bumpSizes]);

  /* ---- 레이아웃 ---- */
  const layout = useMemo(() => {
    if (!doc) return { nodes: [], edges: [], lanes: [], blocks: {}, height: 0, width: 0 };
    return computeLayout(
      doc, view,
      id => sizesRef.current.get(id) || null,
      fid => pillRef.current.get(fid) ?? null
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, view, sizesVer]);

  const layoutPos = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    layout.nodes.forEach(n => m.set(n.id, { x: n.x, y: n.y }));
    return m;
  }, [layout]);

  const toRF = (n: LNode): Node => ({
    id: n.id, type: n.type, position: { x: n.x, y: n.y }, data: n.data,
    draggable: n.draggable, selectable: n.selectable,
    style: n.w != null ? { width: n.w, height: n.h } : undefined,
    zIndex: n.z
  });

  const [rfNodes, setRfNodes] = useState<Node[]>([]);
  useEffect(() => {
    setRfNodes(prev => {
      const prevMap = new Map(prev.map(n => [n.id, n]));
      return layout.nodes.map(n => {
        const p = prevMap.get(n.id);
        // measured를 보존해야 RF가 노드를 '측정 대기(hidden)'로 되돌리지 않는다
        return { ...toRF(n), selected: p?.selected ?? false, measured: p?.measured };
      });
    });
  }, [layout]);

  /* 노드 배열 재구성이 RF의 dimension 이벤트와 경합하면 일부 노드가 measured 없이
     (=hidden, 미니맵 제외, 엣지 미표시) 갇힐 수 있다 — 감지해서 강제 재측정 */
  /* 안전망 — 그래도 measured 없이 갇힌 노드가 있으면 강제 재측정 */
  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => {
    const t = setTimeout(() => {
      setRfNodes(cur => {
        const missing = cur.filter(n => !n.measured || (n.measured as any).width == null).map(n => n.id);
        if (missing.length) updateNodeInternals(missing);
        return cur;
      });
    }, 400);
    return () => clearTimeout(t);
  }, [layout, updateNodeInternals]);

  const rfEdges = useMemo<Edge[]>(() => layout.edges.map(e => ({
    id: e.id, type: e.type, source: e.source, sourceHandle: e.sourceHandle,
    target: e.target, targetHandle: e.targetHandle, data: e.data,
    selectable: false, focusable: false
  })), [layout]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    let dim = false;
    for (const ch of changes) {
      if (ch.type === 'dimensions' && ch.dimensions) {
        const prev = sizesRef.current.get(ch.id);
        if (!prev || Math.abs(prev.w - ch.dimensions.width) > 0.5 || Math.abs(prev.h - ch.dimensions.height) > 0.5) {
          sizesRef.current.set(ch.id, { w: ch.dimensions.width, h: ch.dimensions.height });
          dim = true;
        }
      }
    }
    setRfNodes(ns => applyNodeChanges(changes, ns));
    if (dim) bumpSizes();
  }, [bumpSizes]);

  const resetPositions = useCallback(() => {
    setRfNodes(prev => prev.map(n => {
      const p = layoutPos.get(n.id);
      return { ...n, className: undefined, position: p ? { x: p.x, y: p.y } : n.position };
    }));
  }, [layoutPos]);

  /* ---- 인터랙션 일시 상태 ---- */
  const [cui, setCui] = useState<CanvasUIState>({ shift: null, hotBracket: null, anchorTarget: null, dragSrc: null });
  const [dropbar, setDropbar] = useState<{ x: number; y: number; h: number } | null>(null);
  const [invalidBox, setInvalidBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; flowId: string; lo: number; hi: number; count: number } | null>(null);
  const dragRef = useRef<SceneDrag | LabelDrag | null>(null);

  /* ---- 씬/라벨 드래그 ---- */
  const onNodeDragStart = useCallback((e: any, node: Node) => {
    if (!doc) return;
    if (node.type === 'scene') {
      const d = node.data as any;
      if (!d.flowId || d.isRoot) return;
      dragRef.current = {
        kind: 'scene', flowId: d.flowId, idx: d.idx, sid: d.sid, nodeId: node.id,
        ghost: makeGhost(titleOf(doc, d.sid)), cur: null, slot: null, join: null
      };
      document.body.classList.add('noselect');
      setCui(c => ({ ...c, dragSrc: node.id }));
    } else if (node.type === 'label') {
      const d = node.data as any;
      const f = doc.flows.find(x => x.id === d.flowId);
      if (!f) return;
      const block = layout.blocks[d.flowId];
      const subtree = new Set(block?.nodeIds ?? []);
      // 재앵커 대상: 같은 탭의 씬 중, 이 블록(자기 서브트리)에 속하지 않는 것
      const subtreeSids = new Set<string>();
      (block?.flowIds ?? [d.flowId]).forEach(fid => {
        doc.flows.find(x => x.id === fid)?.seq.forEach(s => subtreeSids.add(s));
      });
      // 첫 Branch는 재앵커 대상 없음(이동만) — from을 바꾸면 루트 구조가 깨지므로
      const targets = d.isRootFirst ? [] : layout.nodes
        .filter(n => n.type === 'scene' && (n.data as any).tabId === f.tab && !subtreeSids.has((n.data as any).sid))
        .map(n => ({
          nodeId: n.id, sid: (n.data as any).sid, x: n.x, y: n.y,
          w: CARD_W, h: sizesRef.current.get(n.id)?.h ?? 196
        }));
      const estH = (n: LNode) => sizesRef.current.get(n.id)?.h ?? (n.h ?? (n.type === 'scene' ? 196 : 30));
      const estW = (n: LNode) => sizesRef.current.get(n.id)?.w ?? (n.w ?? (n.type === 'scene' ? CARD_W : 92));
      const basePos = new Map<string, { x: number; y: number }>();
      layout.nodes.forEach(n => { if (subtree.has(n.id)) basePos.set(n.id, { x: n.x, y: n.y }); });
      const statics = layout.nodes
        .filter(n => !subtree.has(n.id) && (n.type === 'scene' || n.type === 'label' || n.type === 'bracket'))
        .map(n => ({ x: n.x, y: n.y, w: estW(n), h: estH(n) }));
      dragRef.current = {
        kind: 'label', flowId: d.flowId, tabId: d.tabId,
        ghost: makeGhost('Branch 「' + f.label + '」 이동'), targets, hit: null,
        origin: { ...node.position }, subtree, basePos, statics,
        delta: { dx: 0, dy: 0 }, moved: false, invalid: false
      };
      document.body.classList.add('noselect');
    }
  }, [doc, layout]);

  const onNodeDrag = useCallback((e: any, node: Node) => {
    const drag = dragRef.current;
    if (!drag || !doc) return;
    drag.ghost.move(e.clientX, e.clientY);
    const p = screenToFlowPosition({ x: e.clientX, y: e.clientY });

    if (drag.kind === 'label') {
      // 재앵커 대상 히트 (Scene 위)
      let hit: LabelDrag['hit'] = null;
      for (const t of drag.targets) {
        if (p.x >= t.x && p.x <= t.x + t.w && p.y >= t.y && p.y <= t.y + t.h) { hit = t; break; }
      }
      drag.hit = hit;
      setCui(c => (c.anchorTarget === (hit?.nodeId ?? null) ? c : { ...c, anchorTarget: hit?.nodeId ?? null }));
      // 자유 배치 — 라벨의 현재 위치에서 델타 계산, 블록 전체를 함께 이동
      const dx = node.position.x - drag.origin.x;
      const dy = node.position.y - drag.origin.y;
      drag.delta = { dx, dy };
      drag.moved = drag.moved || Math.hypot(dx, dy) > 3;
      // 충돌: 이동한 블록의 각 노드 영역이 블록 밖 노드와 겹치면 invalid
      const M = 6;
      let invalid = false;
      if (drag.moved && !hit) {
        outer: for (const [id, bp] of drag.basePos) {
          const s = sizesRef.current.get(id);
          const w = s?.w ?? CARD_W, h = s?.h ?? 60;
          const x1 = bp.x + dx, y1 = bp.y + dy;
          for (const r of drag.statics) {
            if (x1 < r.x + r.w + M && x1 + w + M > r.x && y1 < r.y + r.h + M && y1 + h + M > r.y) {
              invalid = true; break outer;
            }
          }
        }
      }
      drag.invalid = invalid;
      setRfNodes(prev => prev.map(n => {
        if (!drag.subtree.has(n.id)) return n;
        const bp = drag.basePos.get(n.id)!;
        const pos = n.id === node.id ? n.position : { x: bp.x + dx, y: bp.y + dy };
        return { ...n, position: pos };
      }));
      // 겹침이면 이동 중인 블록 전체를 하나의 빨간 박스로 감싼다
      if (invalid) {
        let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
        for (const [id, bp] of drag.basePos) {
          const s = sizesRef.current.get(id);
          const w = s?.w ?? CARD_W, h = s?.h ?? 60;
          x1 = Math.min(x1, bp.x + dx); y1 = Math.min(y1, bp.y + dy);
          x2 = Math.max(x2, bp.x + dx + w); y2 = Math.max(y2, bp.y + dy + h);
        }
        setInvalidBox({ x: x1 - 12, y: y1 - 12, w: x2 - x1 + 24, h: y2 - y1 + 24 });
      } else setInvalidBox(null);
      drag.ghost.status(
        hit ? `「${titleOf(doc, hit.sid)}」에서 Branch (재앵커)`
          : invalid ? '다른 Branch와 겹쳐요 — 놓으면 원위치'
            : '이동 (놓아서 배치)',
        !!hit || (!invalid && drag.moved));
      return;
    }

    // 씬 재배치 — 레인 히트 테스트 (flow 좌표)
    const lane = layout.lanes.find(l =>
      p.y >= l.laneTop - 6 && p.y <= l.sceneY + l.laneH + 6 &&
      p.x >= l.left - 20 && p.x <= l.right + 40);
    if (!lane) {
      drag.cur = null; drag.slot = null; drag.join = null;
      setDropbar(null);
      setCui(c => ({ ...c, shift: null, hotBracket: null }));
      drag.ghost.status('여기엔 놓을 수 없어요 (놓으면 원위치)', false);
      return;
    }
    const f = doc.flows.find(x => x.id === lane.flowId)!;
    if (!drag.cur || drag.cur.lane.flowId !== lane.flowId) {
      const brIdxAt = (i: number) => {
        const bi = (f.brackets || []).findIndex(b => i >= b.start && i <= b.end);
        return bi >= 0 ? bi : null;
      };
      const mem: MemEntry[] = f.seq
        .map((sid, i) => ({ sid, brIdx: brIdxAt(i), origIdx: i }))
        .filter(m => !(f.id === drag.flowId && m.origIdx === drag.idx));
      drag.cur = { lane, mem, xs: mem.map(m => lane.sceneXs[m.origIdx]) };
    }
    const { mem, xs } = drag.cur;
    let t = xs.length;
    for (let i = 0; i < xs.length; i++) {
      if (p.x < xs[i] + CARD_W / 2) { t = i; break; }
    }
    let gapL = t > 0 ? xs[t - 1] + CARD_W : lane.left + 130;
    const gapR = t < xs.length ? xs[t] : Math.min(gapL + 120, lane.right);
    if (t === 0) gapL = Math.max(lane.left, gapR - 120);
    const pr = gapR > gapL ? (p.x - gapL) / (gapR - gapL) : 0.5;
    const bl = t > 0 ? mem[t - 1].brIdx : null;
    const br = t < mem.length ? mem[t].brIdx : null;
    let join: number | null = null;
    if (bl != null && br != null && bl === br) join = bl;
    else if (bl != null && br != null) join = pr < 1 / 3 ? bl : (pr > 2 / 3 ? br : null);
    else if (bl != null) join = pr < 1 / 2 ? bl : null;
    else if (br != null) join = pr > 1 / 2 ? br : null;
    drag.slot = t; drag.join = join;

    const entryIdxOf: Record<string, number> = {};
    mem.forEach((m, i) => { entryIdxOf[sceneNodeIdFor(f, m.origIdx)] = i; });
    setCui(c => ({
      ...c,
      shift: { flowId: lane.flowId, fromEntryIdx: t, entryIdxOf },
      hotBracket: join != null ? { flowId: lane.flowId, bi: join } : null
    }));
    setDropbar({
      x: (gapL + gapR) / 2,
      y: lane.laneTop + ((f.brackets || []).length ? 60 : 8),
      h: 120
    });
    const crossing = f.id !== drag.flowId ? '「' + f.label + '」 라인으로 · ' : '';
    drag.ghost.status(
      crossing + (join != null ? 'Bracket 「' + f.brackets[join].label + '」에 편입' : '독립 (Bracket 없음)'),
      join != null);
  }, [doc, layout, screenToFlowPosition]);

  const onNodeDragStop = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    document.body.classList.remove('noselect');
    drag.ghost.remove();
    suppressClicks();
    setCui({ shift: null, hotBracket: null, anchorTarget: null, dragSrc: null });
    setDropbar(null);
    setInvalidBox(null);
    if (drag.kind === 'label') {
      const f = doc?.flows.find(x => x.id === drag.flowId);
      if (drag.hit && f && drag.hit.sid !== f.from) {
        acts.reanchorFlow(drag.flowId, drag.hit.sid);       // Scene 위에 놓음 = 재앵커
      } else if (drag.moved && !drag.invalid && !drag.hit
        && (Math.abs(drag.delta.dx) > 2 || Math.abs(drag.delta.dy) > 2)) {
        acts.moveBranch(drag.flowId, drag.tabId, drag.delta.dx, drag.delta.dy); // 자유 배치 커밋
      }
      resetPositions(); // 겹침(invalid)이거나 취소면 원위치, 커밋이면 레이아웃이 재계산
      return;
    }
    if (drag.cur && drag.slot != null) {
      acts.moveScene(drag.flowId, drag.idx, drag.sid, drag.cur.lane.flowId, drag.slot, drag.join);
    }
    resetPositions();
  }, [doc, acts, resetPositions]);

  /* ---- Shift 박스 선택 → 우클릭 범주 ---- */
  const openSelectionMenu = useCallback(async (e: React.MouseEvent | MouseEvent, nodes: Node[]) => {
    e.preventDefault();
    const scenes = nodes.filter(n => n.type === 'scene' && (n.data as any).flowId && !(n.data as any).isRoot);
    if (!scenes.length) return;
    const laneIds = [...new Set(scenes.map(n => (n.data as any).flowId as string))];
    if (laneIds.length > 1) {
      setMenu(null);
      return;
    }
    const idxs = scenes.map(n => (n.data as any).idx as number);
    setMenu({
      x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY,
      flowId: laneIds[0], lo: Math.min(...idxs), hi: Math.max(...idxs), count: scenes.length
    });
  }, []);

  const clearSelection = useCallback(() => {
    setRfNodes(ns => ns.map(n => (n.selected ? { ...n, selected: false } : n)));
  }, []);

  useEffect(() => {
    const onDown = (ev: MouseEvent) => {
      if (!(ev.target as HTMLElement).closest('#ctx')) setMenu(null);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  /* ---- 미니맵 실사 썸네일 ---- */
  const miniInfo = useMemo(() => {
    const m: Record<string, { kind: string; url?: string }> = {};
    if (!doc) return m;
    for (const n of layout.nodes) {
      if (n.type === 'scene') {
        const sid = (n.data as any).sid as string;
        const sc = doc.scenes[sid];
        const theme = ui.sceneTheme[sid] || ui.globalTheme || 'default';
        const p = sc ? themePath(sc, theme) : null;
        m[n.id] = {
          kind: 'scene',
          url: server?.canThumb && p ? thumbUrl(p, sc?.updated) : undefined
        };
      } else {
        m[n.id] = { kind: n.type };
      }
    }
    return m;
  }, [layout, doc, ui.sceneTheme, ui.globalTheme, server]);

  const MiniNode = useCallback((p: any) => {
    const info = miniInfo[p.id];
    if (!info) return null;
    if (info.kind === 'scene') {
      return info.url
        ? <image href={info.url} x={p.x} y={p.y} width={p.width} height={p.height}
            preserveAspectRatio="xMidYMin slice" />
        : <rect x={p.x} y={p.y} width={p.width} height={p.height} rx={10}
            fill={dark ? '#8A5A50' : '#EBB3A6'} />;
    }
    if (info.kind === 'bracket') {
      return <rect x={p.x} y={p.y} width={p.width} height={p.height} rx={6}
        fill={dark ? '#3E5A54' : '#BFD5D0'} />;
    }
    return null; // 라벨·캡션은 미니맵에서 생략
  }, [miniInfo, dark]);

  /* ---- 뷰포트 저장/복원 ---- */
  const savedVp = ui.viewport?.[view];
  const onMoveEnd = useCallback((e: unknown, vp: Viewport) => {
    if (!e) return; // 프로그램적 이동(fitView 등)은 저장하지 않음
    autofit.current = false;
    setUI({ viewport: { ...(ui.viewport || {}), [view]: vp } });
  }, [setUI, ui.viewport, view]);

  /* 초기 로드: 실측 크기가 잡히는 동안(첫 1.5초) 레이아웃이 바뀔 때마다 다시 fit —
     저장된 뷰포트가 있거나 사용자가 이미 움직였으면 건드리지 않는다 */
  const autofit = useRef(!savedVp);
  const mountedAt = useRef(Date.now());
  useEffect(() => {
    if (!autofit.current || Date.now() - mountedAt.current > 1500) return;
    const t = setTimeout(() => {
      if (autofit.current) fitView({ padding: 0.08, maxZoom: 1 });
    }, 80);
    return () => clearTimeout(t);
  }, [layout, fitView]);

  if (!doc) return null;

  return (
    <CanvasCtx.Provider value={{
      ...cui, lanes: layout.lanes, reportPill,
      bracketPreview: null, setBracketPreview: () => {}
    }}>
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStart={onNodeDragStart}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onSelectionContextMenu={openSelectionMenu}
        onNodeContextMenu={(e, node) => {
          const sel = rfNodes.filter(n => n.selected);
          if (sel.length) openSelectionMenu(e, sel.some(n => n.id === node.id) ? sel : [...sel]);
        }}
        onPaneContextMenu={e => e.preventDefault()}
        defaultViewport={savedVp}
        fitView={!savedVp}
        fitViewOptions={{ padding: 0.08, maxZoom: 1 }}
        onMoveEnd={onMoveEnd}
        minZoom={0.12}
        maxZoom={2}
        panOnScroll
        panOnDrag={false}
        panActivationKeyCode="Space"
        zoomOnScroll={false}
        zoomActivationKeyCode={['Meta', 'Control']}
        selectionKeyCode="Shift"
        selectNodesOnDrag={false}
        nodeDragThreshold={8}
        nodesConnectable={false}
        deleteKeyCode={null}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={26} size={1.4}
          color={dark ? '#2E3134' : '#E1DDD3'} />
        <Controls showInteractive={false} position="bottom-left" />
        <MiniMap
          position="bottom-right"
          pannable zoomable
          nodeComponent={MiniNode}
          maskColor={dark ? 'rgba(27,29,31,.78)' : 'rgba(244,242,237,.75)'}
        />
        {dropbar && (
          <ViewportPortal>
            <div className="dropbar" style={{ left: dropbar.x, top: dropbar.y, height: dropbar.h }} />
          </ViewportPortal>
        )}
        {invalidBox && (
          <ViewportPortal>
            <div className="mvbox" style={{
              left: invalidBox.x, top: invalidBox.y, width: invalidBox.w, height: invalidBox.h
            }} />
          </ViewportPortal>
        )}
      </ReactFlow>
      {menu && (
        <div id="ctx" style={{ left: menu.x, top: menu.y }}>
          <button onClick={() => {
            const m = menu; setMenu(null); clearSelection();
            acts.makeBracket(m.flowId, m.lo, m.hi);
          }}>⌐ Bracket으로 묶기 ({menu.count}개 Scene)</button>
          <button onClick={() => { setMenu(null); clearSelection(); }}>선택 해제</button>
        </div>
      )}
    </CanvasCtx.Provider>
  );
}

export function FlowCanvas({ view }: { view: string }) {
  return (
    <ReactFlowProvider>
      <CanvasInner key={view} view={view} />
    </ReactFlowProvider>
  );
}
