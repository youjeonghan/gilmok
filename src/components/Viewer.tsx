/* 씬 뷰어 — 카드 클릭으로 열리는 앱 안 오버레이. 라인(Branch seq) 한정으로 ‹ › / ← → 넘김, Esc 닫기.
   순서는 여는 쪽이 정한다: 캔버스 카드 = 소속 Branch의 seq, 루트 카드 = 루트 + 첫 Branch seq, 갤러리 = 같은 그룹 순서. */
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useStore } from '../store';
import { titleOf, themePath, isImageFile } from '../types';

export interface ViewerReq {
  seq: string[];   // 넘길 씬 id 순서 (끝에서 멈춤, 순환 없음)
  index: number;   // 처음 보여줄 위치
  label: string;   // 상단 배지 — Branch 라벨 · 그룹명
}

const ViewerCtx = createContext<{ open: (req: ViewerReq) => void }>({ open: () => {} });
export const useViewer = () => useContext(ViewerCtx);

export function ViewerProvider({ children }: { children: React.ReactNode }) {
  const [st, setSt] = useState<ViewerReq | null>(null);
  const open = useCallback((req: ViewerReq) => {
    if (!req.seq.length) return;
    // 캔버스 노드에 남은 포커스를 걷어내 React Flow의 방향키 이동과 겹치지 않게
    (document.activeElement as HTMLElement | null)?.blur?.();
    setSt({ ...req, index: Math.max(0, Math.min(req.index, req.seq.length - 1)) });
  }, []);
  return (
    <ViewerCtx.Provider value={{ open }}>
      {children}
      {st && <ViewerOverlay st={st} setSt={setSt} />}
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
