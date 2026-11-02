/* 씬 뷰어 — 카드 클릭으로 열리는 앱 안 오버레이. 라인(Branch seq) 한정으로 ‹ › / ← → 넘김, Esc 닫기.
   순서는 여는 쪽이 정한다: 캔버스 카드 = 소속 Branch의 seq, 루트 카드 = 루트 + 첫 Branch seq, 갤러리 = 같은 그룹 순서. */
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useStore } from '../store';
import { titleOf, themePath, isImageFile } from '../types';
import { commonAncestor } from '../versions';

export interface ViewerReq {
  seq: string[];   // 넘길 씬 id 순서 (끝에서 멈춤, 순환 없음)
  index: number;   // 처음 보여줄 위치
  label: string;   // 상단 배지 — Branch 라벨 · 그룹명
}

/** 버전 비교 — 기준 버전(base)과 현재 버전의 같은 Scene을 나란히. ids = 넘길 Scene 순서(차이 있는 것들) */
export interface CompareReq { ids: string[]; index: number }

const ViewerCtx = createContext<{ open: (req: ViewerReq) => void; compare: (req: CompareReq) => void }>({ open: () => {}, compare: () => {} });
export const useViewer = () => useContext(ViewerCtx);

export function ViewerProvider({ children }: { children: React.ReactNode }) {
  const [st, setSt] = useState<ViewerReq | null>(null);
  const [cmp, setCmp] = useState<CompareReq | null>(null);
  const compare = useCallback((req: CompareReq) => {
    if (!req.ids.length) return;
    (document.activeElement as HTMLElement | null)?.blur?.();
    setCmp({ ...req, index: Math.max(0, Math.min(req.index, req.ids.length - 1)) });
  }, []);
  const open = useCallback((req: ViewerReq) => {
    if (!req.seq.length) return;
    // 캔버스 노드에 남은 포커스를 걷어내 React Flow의 방향키 이동과 겹치지 않게
    (document.activeElement as HTMLElement | null)?.blur?.();
    setSt({ ...req, index: Math.max(0, Math.min(req.index, req.seq.length - 1)) });
  }, []);
  return (
    <ViewerCtx.Provider value={{ open, compare }}>
      {children}
      {st && <ViewerOverlay st={st} setSt={setSt} />}
      {cmp && <CompareOverlay st={cmp} setSt={setCmp} />}
    </ViewerCtx.Provider>
  );
}

function ViewerOverlay({ st, setSt }: { st: ViewerReq; setSt: (s: ViewerReq | null) => void }) {
  const { doc, DATA, ui } = useStore();
  const n = st.seq.length;
  const sid = st.seq[st.index];
  const sc = doc?.scenes[sid] || { title: sid, file: null, kind: 'design' as const, themes: {} as Record<string, string>, note: '' };
  const theme = ui.sceneTheme[sid] || ui.globalTheme || 'default';
  const path = themePath(sc as any, theme);
  const close = useCallback(() => setSt(null), [setSt]);
  const go = useCallback((d: number) => {
    const i = st.index + d;
    if (i < 0 || i >= n) return;
    setSt({ ...st, index: i });
  }, [st, n, setSt]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'Escape') close();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    // capture 단계 — 캔버스(React Flow)·스토어(Ctrl+Z) 핸들러보다 먼저 받아 방향키·Esc를 독점
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [go, close]);

  if (!doc) return null;
  const title = titleOf(doc, sid);
  return (
    <div className="viewer" onClick={close} role="dialog" aria-label="씬 뷰어">
      <div className="vtop" onClick={e => e.stopPropagation()}>
        {st.label && <span className="vlabel">{st.label}</span>}
        <span className="vpos">{st.index + 1} / {n}</span>
        <b title={sid + (sc.updated ? ' · ' + sc.updated : '')}>{title}</b>
        {sc.kind === 'capture' && <span className="vkind">📷 캡처</span>}
        {theme !== 'default' && <span className="vkind">{theme}</span>}
        <span className="sp" />
        {path && <button onClick={() => window.open(DATA + path, '_blank')} title="실물 크기 새 창으로 열기">↗ 새 창</button>}
        <button onClick={close} title="닫기 (Esc)">✕</button>
      </div>
      <button className="vnav prev" disabled={st.index === 0} title="이전 (←)"
        onClick={e => { e.stopPropagation(); go(-1); }}>‹</button>
      <div className="vbody" onClick={e => e.stopPropagation()}>
        {!path
          ? <div className="vempty">{theme === 'default' ? '미제작' : `'${theme}' 테마 미등록`}</div>
          : isImageFile(path)
            ? <img key={path} src={DATA + path + (sc.updated ? '?v=' + encodeURIComponent(sc.updated) : '')} alt={title} />
            : <iframe key={path} src={DATA + path} title={title} />}
      </div>
      <button className="vnav next" disabled={st.index >= n - 1} title="다음 (→)"
        onClick={e => { e.stopPropagation(); go(1); }}>›</button>
      {sc.note && <div className="vnote" onClick={e => e.stopPropagation()}>{sc.note}</div>}
    </div>
  );
}

/* ---------- 버전 비교 오버레이 — 기준 버전 ↔ 현재 버전 나란히 ---------- */
type PaneScene = { title: string; file: string | null; note?: string; updated?: string } | null;

function ComparePane({ label, sc, data, side }: { label: string; sc: PaneScene; data: string; side: 'base' | 'cur' }) {
  return (
    <div className={'cpane ' + side}>
      <div className="cp-head"><span className="cp-ver">{label}</span>{sc && <b>{sc.title}</b>}</div>
      <div className="cp-body">
        {!sc
          ? <div className="vempty">이 버전엔 없는 Scene</div>
          : !sc.file
            ? <div className="vempty">미제작</div>
            : isImageFile(sc.file)
              ? <img key={sc.file} src={data + sc.file + (sc.updated ? '?v=' + encodeURIComponent(sc.updated) : '')} alt={sc.title} />
              : <iframe key={sc.file} src={data + sc.file} title={sc.title} />}
      </div>
      {sc?.note ? <div className="cp-note">{sc.note}</div> : null}
    </div>
  );
}

function CompareOverlay({ st, setSt }: { st: CompareReq; setSt: (s: CompareReq | null) => void }) {
  const { doc, raw, baseDoc, verMeta: m, DATA } = useStore();
  const n = st.ids.length;
  const sid = st.ids[st.index];
  const close = useCallback(() => setSt(null), [setSt]);
  const go = useCallback((d: number) => {
    const i = st.index + d;
    if (i < 0 || i >= n) return;
    setSt({ ...st, index: i });
  }, [st, n, setSt]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'Escape') close();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [go, close]);
  if (!doc || !m.base) return null;
  const a = baseDoc?.scenes[sid] || null;
  const b = doc.scenes[sid] || null;
  const lineal = !!raw && commonAncestor(raw, m.base.id, m.cur!) === m.base.id;
  const status = !a ? (lineal ? '신규' : '이 버전에만') : !b ? (lineal ? '삭제' : '기준에만') : (m.scene[sid]?.status === 'same' ? '같음' : '변경');
  const fields: string[] = [];
  if (a && b) {
    if (a.title !== b.title) fields.push('제목');
    if (a.file !== b.file) fields.push('파일');
    if ((a.note || '') !== (b.note || '')) fields.push('노트');
    if (JSON.stringify(a.themes || {}) !== JSON.stringify(b.themes || {})) fields.push('테마');
    if ((a.group || '') !== (b.group || '')) fields.push('그룹');
  }
  const curV = m.versions.find(v => v.id === m.cur);
  return (
    <div className="viewer compare" onClick={close} role="dialog" aria-label="버전 비교">
      <div className="vtop" onClick={e => e.stopPropagation()}>
        <span className="vlabel">v{m.base.id} ↔ v{m.cur}</span>
        <span className="vpos">{st.index + 1} / {n}</span>
        <b>{(b || a)?.title || sid}</b>
        <span className={'vbadge ' + (!a ? 'new' : !b ? 'removed' : 'changed')}>{status}</span>
        {fields.length > 0 && <span className="vkind">바뀐 것: {fields.join('·')}</span>}
        <span className="sp" />
        <button onClick={close} title="닫기 (Esc)">✕</button>
      </div>
      <button className="vnav prev" disabled={st.index === 0} title="이전 차이 (←)"
        onClick={e => { e.stopPropagation(); go(-1); }}>‹</button>
      <div className="cbody" onClick={e => e.stopPropagation()}>
        <ComparePane label={'v' + m.base.id + (m.base.title ? ' · ' + m.base.title : '')} sc={a} data={DATA} side="base" />
        <ComparePane label={'v' + m.cur + (curV?.title ? ' · ' + curV.title : '')} sc={b} data={DATA} side="cur" />
      </div>
      <button className="vnav next" disabled={st.index >= n - 1} title="다음 차이 (→)"
        onClick={e => { e.stopPropagation(); go(1); }}>›</button>
    </div>
  );
}
