/* React Flow 커스텀 노드 — 씬 카드 / 분기 라벨 / 범주 / 섹션 캡션 / 첫 씬 추가 */
import React, { useEffect, useRef, useState } from 'react';
import { Handle, Position, NodeProps, useReactFlow } from '@xyflow/react';
import { useStore } from '../store';
import { useActions } from '../actions';
import { titleOf, themePath, thumbUrl, isImageFile, flowsFrom } from '../types';
import { useViewer, ViewerReq } from './Viewer';
import { useCanvasUI, clickSuppressed } from '../canvasui';
import { InlineEdit } from './InlineEdit';
import { CARD_W, THUMB_H, RCAP_H, CARD_CENTER, RHANDLE_X } from '../layout';

const HIDDEN_HANDLE: React.CSSProperties = {
  opacity: 0, pointerEvents: 'none', width: 1, height: 1,
  minWidth: 1, minHeight: 1, border: 0, background: 'transparent'
};

export function designEditUrl(designUrl: string | undefined, file: string | null): string | null {
  if (!designUrl || !file) return null;
  const remote = file.replace(/^scenes\//, '');
  return designUrl + (designUrl.includes('?') ? '&' : '?') + 'file=' + encodeURIComponent(remote);
}

/** 씬 미리보기 — 이미지 파일이면 그대로 <img>, HTML은 서버 모드면 PNG 썸네일, 아니면(또는 실패 시) 라이브 iframe 폴백 */
export function ScenePreview({ file, v }: { file: string; v?: string }) {
  const { DATA, server, thumbVer } = useStore();
  const [fail, setFail] = useState(false);
  useEffect(() => { setFail(false); }, [file]);
  if (isImageFile(file)) {
    return <img className="snap img" src={DATA + file + (v ? '?v=' + encodeURIComponent(v) : '')} loading="lazy" alt="" />;
  }
  if (server?.canThumb && !fail) {
    return <img className="snap" src={thumbUrl(file, (v || '') + '-' + thumbVer)} loading="lazy" alt=""
      onError={() => setFail(true)} />;
  }
  return <iframe key={file} src={DATA + file} loading="lazy" tabIndex={-1} />;
}

/* ---------- 씬 카드 본체 (RF 노드와 갤러리에서 공용) ---------- */
export function SceneCardBody({ sid, flowId, idx, tabId, isRoot, inCanvas, nav }: {
  sid: string;
  flowId: string | null;
  idx: number;
  tabId: string | null;
  isRoot?: boolean;
  inCanvas?: boolean;
  /** 뷰어 넘김 순서를 여는 쪽이 지정할 때 (갤러리 = 그룹 순서). 없으면 소속 Branch seq / 루트 + 첫 Branch */
  nav?: ViewerReq;
}) {
  const { doc, ui, setUI } = useStore();
  const acts = useActions();
  const viewer = useViewer();
  if (!doc) return null;
  /* 뷰어 순서 — 그 라인에 한정 */
  const navFor = (): ViewerReq => {
    if (nav) return nav;
    if (flowId) {
      const f = doc.flows.find(x => x.id === flowId);
      if (f) return { seq: f.seq, index: idx, label: f.label };
    }
    if (isRoot && tabId) {
      const f = flowsFrom(doc, sid, tabId)[0];
      if (f) return { seq: [sid, ...f.seq], index: 0, label: f.label };
    }
    return { seq: [sid], index: 0, label: '' };
  };
  const sc = doc.scenes[sid] || { title: sid, file: null, kind: 'design' as const, themes: {} as Record<string, string> };
  const theme = ui.sceneTheme[sid] || ui.globalTheme || 'default';
  const path = themePath(sc as any, theme);
  // 가져온 화면(capture)·이미지 파일은 클로드 디자인 딥링크 대상이 아니다
  const du = sc.kind === 'capture' || isImageFile(sc.file) ? null : designEditUrl(doc.service?.designUrl, sc.file);

  const themeNames = ['default', 'light', 'dark',
    ...Object.keys(sc.themes || {}).filter(t => t !== 'light' && t !== 'dark'), '+'];

  return (
    <>
      <div className={'thumb' + (path ? ' click' : ' empty')}
        title={path ? '클릭=뷰어로 열기 (‹ › 로 라인 넘김) · 드래그=이동' : undefined}
        onClick={() => {
          if (clickSuppressed()) return;
          viewer.open(navFor());
        }}>
        {path
          ? <ScenePreview file={path} v={sc.updated} />
          : (theme === 'default' ? '미제작' : `'${theme}' 테마 미등록`)}
        <div className="themes nodrag">
          {themeNames.map(t => {
            const label = t === 'default' ? 'D' : t === 'light' ? 'L' : t === 'dark' ? 'N' : t === '+' ? '＋' : t.slice(0, 2);
            return (
              <span key={t}
                className={'tchip' + (t === theme ? ' on' : '')}
                title={t === '+' ? '테마 등록' : (t + (themePath(sc as any, t) ? '' : ' (미등록)'))}
                onMouseDown={e => e.stopPropagation()}
                onClick={async e => {
                  e.stopPropagation();
                  if (t === '+') {
                    const name = await acts.addTheme(sid);
                    if (name) setUI({ sceneTheme: { ...ui.sceneTheme, [sid]: name } });
                    return;
                  }
                  setUI({ sceneTheme: { ...ui.sceneTheme, [sid]: t } });
                }}>{label}</span>
            );
          })}
        </div>
      </div>
      <div className="cap">
        {/* id·수정일은 카드에 노출하지 않고 제목 툴팁으로만 (텍스트 다이어트) */}
        <b title={sid + (sc.updated ? ' · ' + sc.updated : '')}>{titleOf(doc, sid)}</b>
        {sc.group && <span className="grp nodrag" title="클로드 디자인 카테고리 (@dsCard group)">{sc.group}</span>}
        {sc.kind === 'capture' && <span className="kind nodrag" title="가져온 화면 (kind: capture) — 자체 씬으로 교체 예정">📷 캡처</span>}
      </div>
      {sc.note
        ? <div className="snote nodrag" title="노트 편집"
            onMouseDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); acts.openSceneNote(sid); }}>{sc.note}</div>
        : <span className="addnote nodrag"
            onMouseDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); acts.openSceneNote(sid); }}>Add note</span>}
      <div className="acts nodrag">
        {tabId && <button title="이 Scene에서 Branch 추가"
          onMouseDown={e => e.stopPropagation()}
          onClick={() => acts.addBranch(sid, tabId)}>⑂ Branch</button>}
        {du && <button title="클로드 디자인에서 편집"
          onMouseDown={e => e.stopPropagation()}
          onClick={() => window.open(du, '_blank')}>↗ 디자인</button>}
        {flowId && !isRoot && <button title="이 라인에서 제거 (Scene은 유지)"
          onMouseDown={e => e.stopPropagation()}
          onClick={() => acts.removeFromLane(flowId, idx)}>✕</button>}
      </div>
    </>
  );
}

/* ---------- 씬 노드 ---------- */
export function SceneNode({ id, data }: NodeProps) {
  const d = data as { sid: string; flowId: string | null; idx: number; tabId: string | null; isRoot?: boolean };
  const acts = useActions();
  const cui = useCanvasUI();
  const shifted = !!(cui.shift && d.flowId === cui.shift.flowId
    && cui.shift.entryIdxOf[id] != null
    && cui.shift.entryIdxOf[id] >= cui.shift.fromEntryIdx);
  const cls = 'scene'
    + (d.isRoot || !d.flowId ? ' nogutter' : '')
    + (cui.anchorTarget === id ? ' anchor-target' : '')
    + (cui.dragSrc === id ? ' drag-src' : '');
  return (
    <div className={cls} style={{
      width: CARD_W,
      transform: shifted ? 'translateX(26px)' : undefined,
      transition: 'transform .13s ease'
    }}>
      {d.isRoot && <div className="rcap">첫 Scene</div>}
      <SceneCardBody sid={d.sid} flowId={d.flowId} idx={d.idx} tabId={d.tabId} isRoot={d.isRoot} inCanvas />
      {d.flowId && !d.isRoot && (
        <div className="gutter nodrag">
          <button className="ins" title="여기에 Scene 삽입"
            onMouseDown={e => e.stopPropagation()}
            onClick={() => acts.insertAt(d.flowId!, d.idx + 1)}>＋</button>
        </div>
      )}
      <Handle type="source" position={Position.Bottom} id="b"
        style={{ ...HIDDEN_HANDLE, left: CARD_CENTER, bottom: 0 }} />
      <Handle type="source" position={Position.Right} id="r"
        style={{ ...HIDDEN_HANDLE, left: RHANDLE_X, top: (d.isRoot ? RCAP_H : 0) + THUMB_H / 2 }} />
      <Handle type="target" position={Position.Left} id="l"
        style={{ ...HIDDEN_HANDLE, left: 5, top: (d.isRoot ? RCAP_H : 0) + THUMB_H / 2 }} />
    </div>
  );
}

/* ---------- 분기 라벨 노드 ---------- */
export function LabelNode({ id, data }: NodeProps) {
  const d = data as { flowId: string; tabId: string; isRootFirst: boolean };
  const { doc } = useStore();
  const acts = useActions();
  const { reportPill } = useCanvasUI();
  const pillRef = useRef<HTMLSpanElement>(null);
  const f = doc?.flows.find(x => x.id === d.flowId);
  useEffect(() => {
    if (pillRef.current) reportPill(d.flowId, pillRef.current.offsetWidth);
  });
  if (!f) return null;
  return (
    <div className="lblnode">
      <div className="row1">
        <span ref={pillRef} style={{ position: 'relative', display: 'inline-block' }}>
          <InlineEdit
            value={f.label}
            className="lbl grab"
            title={d.isRootFirst ? '클릭=이름 수정 · 드래그=이동' : '클릭=이름 수정 · 드래그=이동/재앵커'}
            onSave={v => acts.renameFlow(d.flowId, v)}
          />
          <Handle type="target" position={Position.Left} id="l"
            style={{ ...HIDDEN_HANDLE, left: 0, top: '50%' }} />
          <Handle type="source" position={Position.Bottom} id="b"
            style={{ ...HIDDEN_HANDLE, left: '50%', bottom: 0 }} />
        </span>
        {/* 호버 툴바 — 절대배치라 라벨 노드 폭(=씬 시작 위치)에 영향 없음 */}
        <span className="ltools nodrag nopan">
          <button title="맨 앞에 Scene 삽입"
            onMouseDown={e => e.stopPropagation()}
            onClick={() => acts.insertAt(d.flowId, 0)}>＋</button>
          <button title={`Branch '${f.label}' 삭제`}
            onMouseDown={e => e.stopPropagation()}
            onClick={() => acts.deleteFlow(d.flowId)}>Branch 삭제</button>
        </span>
      </div>
      {f.note
        ? <div className="fnote nodrag" title="노트 편집"
            onMouseDown={e => e.stopPropagation()}
            onClick={() => acts.openFlowNote(d.flowId)}>{f.note}</div>
        : <span className="addnote nodrag"
            onMouseDown={e => e.stopPropagation()}
            onClick={() => acts.openFlowNote(d.flowId)}>Add note</span>}
    </div>
  );
}

/* ---------- 범주 노드 ---------- */
export function BracketNode({ id, data }: NodeProps) {
  const d = data as { flowId: string; bi: number; tabId: string };
  const { doc } = useStore();
  const acts = useActions();
  const cui = useCanvasUI();
  const { screenToFlowPosition } = useReactFlow();
  const [preview, setPreview] = useState<{ left: number; width: number } | null>(null);
  const f = doc?.flows.find(x => x.id === d.flowId);
  const b = f?.brackets?.[d.bi];
  if (!f || !b) return null;
  const hot = cui.hotBracket && cui.hotBracket.flowId === d.flowId && cui.hotBracket.bi === d.bi;

  const startResize = (e: React.MouseEvent, side: 'left' | 'right') => {
    e.preventDefault(); e.stopPropagation();
    const lane = cui.lanes.find(l => l.flowId === d.flowId);
    if (!lane) return;
    const others = (f.brackets || []).filter((_, i) => i !== d.bi);
    const cur = { start: b.start, end: b.end };
    const nodeX = lane.sceneXs[Math.max(0, Math.min(b.start, lane.sceneXs.length - 1))] - 7;
    document.body.classList.add('noselect');
    const move = (ev: MouseEvent) => {
      const fx = screenToFlowPosition({ x: ev.clientX, y: ev.clientY }).x;
      const n = lane.sceneXs.length;
      if (side === 'right') {
        const rightLimits = others.filter(o => o.start > b.end).map(o => o.start - 1);
        const maxEnd = Math.min(n - 1, ...(rightLimits.length ? rightLimits : [n - 1]));
        let end = b.start;
        for (let ci = 0; ci < n; ci++) {
          if (ci < b.start || ci > maxEnd) continue;
          if (fx > lane.sceneXs[ci] + 24) end = ci;
        }
        cur.end = end;
      } else {
        const leftLimits = others.filter(o => o.end < b.start).map(o => o.end + 1);
        const minStart = Math.max(0, ...(leftLimits.length ? leftLimits : [0]));
        let start = b.end;
        for (let ci = n - 1; ci >= 0; ci--) {
          if (ci > b.end || ci < minStart) continue;
          if (fx < lane.sceneXs[ci] + CARD_W - 24) start = ci;
        }
        cur.start = start;
      }
      const left = lane.sceneXs[cur.start] - 7 - nodeX;
      const width = lane.sceneXs[cur.end] + CARD_W + 7 - (lane.sceneXs[cur.start] - 7);
      setPreview({ left, width });
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      document.body.classList.remove('noselect');
      setPreview(null);
      acts.resizeBracket(d.flowId, d.bi, cur.start, cur.end);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  return (
    <div className="bracketnode">
      <div className={'bracket' + (hot ? ' hot' : '')}
        style={preview ? { left: preview.left + 7, width: preview.width - 14, right: 'auto' } : undefined}>
        <span className="blbl nodrag nopan">
          <InlineEdit value={b.label} title="클릭=이름 수정"
            onSave={v => acts.renameBracket(d.flowId, d.bi, v)} />
          <span className="bx" title="Bracket 삭제"
            onClick={e => { e.stopPropagation(); acts.deleteBracket(d.flowId, d.bi); }}>✕</span>
        </span>
        <div className={'bnl nodrag nopan' + (b.note ? '' : ' empty')}
          title={b.note ? '노트 편집' : '노트 추가'}
          onClick={e => { e.stopPropagation(); acts.openBracketNote(d.flowId, d.bi); }}>
          {b.note || 'Add note'}
        </div>
        <span className="bh left nodrag nopan" title="드래그=범위 조절"
          onMouseDown={e => startResize(e, 'left')} />
        <span className="bh right nodrag nopan" title="드래그=범위 조절"
          onMouseDown={e => startResize(e, 'right')} />
      </div>
    </div>
  );
}

/* ---------- 섹션 캡션 ---------- */
export function SeccapNode({ data }: NodeProps) {
  const d = data as { tabId: string; title: string };
  const { setActiveTab } = useStore();
  return (
    <div className="seccap link nodrag" title="이 Tab으로 이동"
      onClick={() => setActiveTab(d.tabId)}>🔀 {d.title}</div>
  );
}

/* ---------- 첫 씬 추가 카드 ---------- */
export function AddStartNode({ data }: NodeProps) {
  const d = data as { tabId: string };
  const acts = useActions();
  return (
    <div className="scene nogutter" style={{ width: CARD_W }}>
      <div className="rcap">첫 Scene</div>
      <div className="thumb empty addstart nodrag" title="첫 Scene 지정"
        onClick={() => acts.setStart(d.tabId)}>＋</div>
    </div>
  );
}
