/* React Flow 커스텀 노드 — 씬 카드 / 분기 라벨 / 범주 / 섹션 캡션 / 첫 씬 추가 */
import React, { useEffect, useRef, useState } from 'react';
import { Handle, Position, NodeProps, useReactFlow } from '@xyflow/react';
import { useStore } from '../store';
import { useActions } from '../actions';
import { titleOf, themePath } from '../types';
import { useCanvasUI, clickSuppressed } from '../canvasui';
import { InlineEdit } from './InlineEdit';
import { CARD_W, THUMB_H, RCAP_H, CARD_CENTER } from '../layout';

const HIDDEN_HANDLE: React.CSSProperties = {
  opacity: 0, pointerEvents: 'none', width: 1, height: 1,
  minWidth: 1, minHeight: 1, border: 0, background: 'transparent'
};

export function designEditUrl(designUrl: string | undefined, file: string | null): string | null {
  if (!designUrl || !file) return null;
  const remote = file.replace(/^scenes\//, '');
  return designUrl + (designUrl.includes('?') ? '&' : '?') + 'file=' + encodeURIComponent(remote);
}

/* ---------- 씬 카드 본체 (RF 노드와 갤러리에서 공용) ---------- */
export function SceneCardBody({ sid, flowId, idx, tabId, isRoot, inCanvas }: {
  sid: string;
  flowId: string | null;
  idx: number;
  tabId: string | null;
  isRoot?: boolean;
  inCanvas?: boolean;
}) {
  const { doc, DATA, ui, setUI } = useStore();
  const acts = useActions();
  if (!doc) return null;
  const sc = doc.scenes[sid] || { title: sid, file: null, themes: {} as Record<string, string> };
  const theme = ui.sceneTheme[sid] || ui.globalTheme || 'default';
  const path = themePath(sc as any, theme);
  const du = designEditUrl(doc.service?.designUrl, sc.file);

  const themeNames = ['default', 'light', 'dark',
    ...Object.keys(sc.themes || {}).filter(t => t !== 'light' && t !== 'dark'), '+'];

  return (
    <>
      <div className={'thumb' + (path ? ' click' : ' empty')}
        title={path ? '클릭=새 탭에서 열기 · 드래그=이동' : undefined}
        onClick={() => {
          if (clickSuppressed()) return;
          if (path) window.open(DATA + path, '_blank');
        }}>
        {path
          ? <iframe key={path} src={DATA + path} loading="lazy" tabIndex={-1} />
          : (theme === 'default' ? '미제작' : `'${theme}' 테마 미등록`)}
        <div className="themes nodrag">
          {themeNames.map(t => {
            const label = t === 'default' ? 'D' : t === 'light' ? 'L' : t === 'dark' ? 'N' : t === '+' ? '＋' : t.slice(0, 2);
            return (
              <span key={t}
                className={'tchip' + (t === theme ? ' on' : '')}
                title={t === '+' ? '테마 직접 등록' : (t + ' 테마' + (themePath(sc as any, t) ? '' : ' (미등록)'))}
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
        <b>{titleOf(doc, sid)}</b>
        {sc.group && <span className="grp nodrag" title="claude.ai/design 디자인 시스템 카테고리 (@dsCard group)">{sc.group}</span>}
        <span className="meta">{sid}{sc.updated ? ' · ' + sc.updated : ''}</span>
      </div>
      {sc.note
        ? <div className="snote nodrag" title="클릭해서 노트 편집"
            onMouseDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); acts.openSceneNote(sid); }}>{sc.note}</div>
        : <span className="addnote nodrag"
            onMouseDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); acts.openSceneNote(sid); }}>Add note</span>}
      <div className="acts nodrag">
        {tabId && <button title="이 씬에서 새 분기 라인 추가"
          onMouseDown={e => e.stopPropagation()}
          onClick={() => acts.addBranch(sid, tabId)}>⑂ 분기</button>}
        {du && <button title="클로드 디자인에서 이 씬 편집"
          onMouseDown={e => e.stopPropagation()}
          onClick={() => window.open(du, '_blank')}>↗ 디자인</button>}
        {flowId && !isRoot && <button title="이 라인에서 제거 (씬 자체는 유지)"
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
      {d.isRoot && <div className="rcap">첫 씬</div>}
      <SceneCardBody sid={d.sid} flowId={d.flowId} idx={d.idx} tabId={d.tabId} isRoot={d.isRoot} inCanvas />
      {d.flowId && !d.isRoot && (
        <div className="gutter nodrag">
          <button className="ins" title="여기에 씬 삽입"
            onMouseDown={e => e.stopPropagation()}
            onClick={() => acts.insertAt(d.flowId!, d.idx + 1)}>＋</button>
        </div>
      )}
      <Handle type="source" position={Position.Bottom} id="b"
        style={{ ...HIDDEN_HANDLE, left: CARD_CENTER, bottom: 0 }} />
      <Handle type="source" position={Position.Right} id="r"
        style={{ ...HIDDEN_HANDLE, left: 217, top: (d.isRoot ? RCAP_H : 0) + THUMB_H / 2 }} />
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
            className={'lbl' + (d.isRootFirst ? '' : ' grab')}
            title={d.isRootFirst ? '클릭=라벨 수정' : '클릭=라벨 수정 · 드래그=분기를 다른 씬으로 이동'}
            onSave={v => acts.renameFlow(d.flowId, v)}
          />
          <Handle type="target" position={Position.Left} id="l"
            style={{ ...HIDDEN_HANDLE, left: 0, top: '50%' }} />
          <Handle type="source" position={Position.Bottom} id="b"
            style={{ ...HIDDEN_HANDLE, left: '50%', bottom: 0 }} />
        </span>
        {/* 호버 툴바 — 절대배치라 라벨 노드 폭(=씬 시작 위치)에 영향 없음 */}
        <span className="ltools nodrag nopan">
          <button title="맨 앞에 씬 삽입"
            onMouseDown={e => e.stopPropagation()}
            onClick={() => acts.insertAt(d.flowId, 0)}>＋</button>
          <button title={`'${f.label}' 분기 라인 삭제`}
            onMouseDown={e => e.stopPropagation()}
            onClick={() => acts.deleteFlow(d.flowId)}>분기 삭제</button>
        </span>
      </div>
      {f.note
        ? <div className="fnote nodrag" title="클릭해서 노트 편집"
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
          <InlineEdit value={b.label} title="클릭해서 범주 이름 수정"
            onSave={v => acts.renameBracket(d.flowId, d.bi, v)} />
          <span className="bx" title="범주 삭제"
            onClick={e => { e.stopPropagation(); acts.deleteBracket(d.flowId, d.bi); }}>✕</span>
        </span>
        <div className={'bnl nodrag nopan' + (b.note ? '' : ' empty')}
          title={b.note ? '클릭해서 노트 편집' : '범주 노트 추가'}
          onClick={e => { e.stopPropagation(); acts.openBracketNote(d.flowId, d.bi); }}>
          {b.note || 'Add note'}
        </div>
        <span className="bh left nodrag nopan" title="드래그해서 범주 범위 조절"
          onMouseDown={e => startResize(e, 'left')} />
        <span className="bh right nodrag nopan" title="드래그해서 범주 범위 조절"
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
    <div className="seccap link nodrag" title="이 플로우 탭으로 이동"
      onClick={() => setActiveTab(d.tabId)}>⌁ {d.title}</div>
  );
}

/* ---------- 첫 씬 추가 카드 ---------- */
export function AddStartNode({ data }: NodeProps) {
  const d = data as { tabId: string };
  const acts = useActions();
  return (
    <div className="scene nogutter" style={{ width: CARD_W }}>
      <div className="rcap">첫 씬</div>
      <div className="thumb empty addstart nodrag" title="첫 씬 추가"
        onClick={() => acts.setStart(d.tabId)}>＋</div>
    </div>
  );
}
