import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { FlowDoc, ServerInfo, UIState, normalize } from './types';
import { fetchHealth, postFlow } from './api';

export type AppPhase = 'loading' | 'ready' | 'needProject' | 'loaderr';

interface Store {
  phase: AppPhase;
  errMsg: string;
  doc: FlowDoc | null;
  server: ServerInfo | null;
  DATA: string;
  isServer: boolean;
  activeTab: string;
  setActiveTab: (id: string) => void;
  ui: UIState;
  setUI: (patch: Partial<UIState>) => void;
  /** 앱 자체 테마 (프로젝트와 무관, 전역 저장) */
  appTheme: 'light' | 'dark';
  setAppTheme: (t: 'light' | 'dark') => void;
  /** 씬 파일 외부 변경 세대 — 썸네일 URL 캐시 버스터 */
  thumbVer: number;
  /** 문서 변경 커밋 — 히스토리 스냅샷 + 저장. mutator는 복제본을 수정한다 */
  commit: (mutator: (d: FlowDoc) => void) => void;
  undo: () => void;
  redo: () => void;
  resetToFile: () => Promise<void>;
  patchServer: (p: Partial<ServerInfo>) => void;
}

const Ctx = createContext<Store>(null as any);
export const useStore = () => useContext(Ctx);

const clean = (d: FlowDoc) => JSON.stringify(d);
const cleanPretty = (d: FlowDoc) => JSON.stringify(d, null, 2) + '\n';

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<AppPhase>('loading');
  const [errMsg, setErrMsg] = useState('');
  const [doc, setDoc] = useState<FlowDoc | null>(null);
  const [server, setServer] = useState<ServerInfo | null>(null);
  const [DATA, setDATA] = useState('./');
  const [activeTab, setTab] = useState('all');
  const [ui, setUiState] = useState<UIState>({ sceneTheme: {} });
  const [thumbVer, setThumbVer] = useState(0);
  const [appTheme, setAppThemeState] = useState<'light' | 'dark'>(() => {
    try {
      // 구 'flow-map:' 키 폴백 (개명 마이그레이션)
      return ((localStorage.getItem('gilmok:appTheme') || localStorage.getItem('flow-map:appTheme')) as 'light' | 'dark') || 'light';
    } catch { return 'light'; }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = appTheme;
  }, [appTheme]);
  const setAppTheme = useCallback((t: 'light' | 'dark') => {
    try { localStorage.setItem('gilmok:appTheme', t); } catch {}
    setAppThemeState(t);
  }, []);

  const keys = useRef({ LS: '', LS_TAB: '', LS_UI: '' });
  const dataRef = useRef('./');
  const hist = useRef({ past: [] as string[], future: [] as string[], lastSnap: null as string | null });
  const saveTimer = useRef<any>(null);
  const docRef = useRef<FlowDoc | null>(null);
  docRef.current = doc;
  const serverRef = useRef<ServerInfo | null>(null);
  serverRef.current = server;

  /* ---------- 저장 ---------- */
  const persist = useCallback((d: FlowDoc) => {
    try { localStorage.setItem(keys.current.LS, clean(d)); } catch {}
    if (serverRef.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => { postFlow(cleanPretty(d)).catch(() => {}); }, 400);
    }
  }, []);

  const commit = useCallback((mutator: (d: FlowDoc) => void) => {
    const cur = docRef.current;
    if (!cur) return;
    const next = structuredClone(cur);
    mutator(next);
    const snap = clean(next);
    const h = hist.current;
    if (h.lastSnap !== null && snap !== h.lastSnap) {
      h.past.push(h.lastSnap);
      if (h.past.length > 60) h.past.shift();
      h.future.length = 0;
    }
    h.lastSnap = snap;
    setDoc(next);
    persist(next);
  }, [persist]);

  const undo = useCallback(() => {
    const h = hist.current;
    if (!h.past.length || !docRef.current) return;
    h.future.push(clean(docRef.current));
    const s = h.past.pop()!;
    const d = normalize(JSON.parse(s));
    h.lastSnap = s;
    setDoc(d); persist(d);
  }, [persist]);

  const redo = useCallback(() => {
    const h = hist.current;
    if (!h.future.length || !docRef.current) return;
    h.past.push(clean(docRef.current));
    const s = h.future.pop()!;
    const d = normalize(JSON.parse(s));
    h.lastSnap = s;
    setDoc(d); persist(d);
  }, [persist]);

  /* ---------- UI 상태 ---------- */
  const setUI = useCallback((patch: Partial<UIState>) => {
    setUiState(prev => {
      const next = { ...prev, ...patch };
      try { localStorage.setItem(keys.current.LS_UI, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const setActiveTab = useCallback((id: string) => {
    setTab(id);
    try { localStorage.setItem(keys.current.LS_TAB, id); } catch {}
  }, []);

  const patchServer = useCallback((p: Partial<ServerInfo>) => {
    setServer(prev => (prev ? { ...prev, ...p } : prev));
  }, []);

  const resetToFile = useCallback(async () => {
    try { localStorage.removeItem(keys.current.LS); } catch {}
    location.reload();
  }, []);

  /* ---------- 초기화 (v6 init 포팅) ---------- */
  useEffect(() => {
    (async () => {
      const params = new URLSearchParams(location.search);
      const srv = await fetchHealth();
      const data = ((params.get('data') || (srv ? 'data/' : './')).replace(/\/?$/, '/'));
      const projKey = (srv && srv.projectKey) ? srv.projectKey : data;
      const LS = 'gilmok:' + projKey;
      keys.current = { LS, LS_TAB: LS + ':tab', LS_UI: LS + ':ui' };
      // 구 'flow-map:' 키 마이그레이션 — 프로젝트별 편집본·탭·뷰포트 유지
      try {
        const oldLS = 'flow-map:' + projKey;
        for (const [nk, ok] of [[LS, oldLS], [LS + ':tab', oldLS + ':tab'], [LS + ':ui', oldLS + ':ui']] as const) {
          if (localStorage.getItem(nk) == null) {
            const v = localStorage.getItem(ok);
            if (v != null) localStorage.setItem(nk, v);
          }
        }
      } catch {}
      setServer(srv); serverRef.current = srv;
      setDATA(data); dataRef.current = data;
      setTab(localStorage.getItem(keys.current.LS_TAB) || 'all');
      try {
        const u = JSON.parse(localStorage.getItem(keys.current.LS_UI) || '{}');
        u.sceneTheme = u.sceneTheme || {};
        setUiState(u);
      } catch { setUiState({ sceneTheme: {} }); }

      if (srv && srv.needProject) { setPhase('needProject'); return; }

      if (srv) {
        // 서버 모드: flow.json이 정본 (모든 편집이 자동 저장)
        try {
          const d = normalize(await (await fetch(data + 'flow.json?t=' + Date.now())).json());
          hist.current.lastSnap = clean(d);
          setDoc(d); setPhase('ready');
        } catch {
          setErrMsg('데이터 폴더에 flow.json이 없어요 — 실행 시 선택한 폴더를 확인해주세요. (현재: ' + (srv.dataDir || '?') + ')');
          setPhase('loaderr');
        }
        return;
      }

      // 정적 모드: localStorage 우선, 파일에서 service 백필
      try {
        const s = localStorage.getItem(LS);
        let d: FlowDoc;
        if (s) {
          d = normalize(JSON.parse(s));
          try {
            const base = normalize(await (await fetch(data + 'flow.json')).json());
            const bs = base.service || ({} as any);
            if ((!d.service.name || d.service.name === '서비스') && bs.name && bs.name !== '서비스') d.service.name = bs.name;
            if (!d.service.icon && bs.icon) d.service.icon = bs.icon;
            if (!d.service.designUrl && bs.designUrl) d.service.designUrl = bs.designUrl;
          } catch {}
        } else {
          d = normalize(await (await fetch(data + 'flow.json')).json());
        }
        hist.current.lastSnap = clean(d);
        setDoc(d); setPhase('ready');
      } catch {
        setErrMsg(data + 'flow.json 을 불러오지 못했어요.\n① ?data=경로/ 파라미터 확인\n② 로컬 서버로 열었는지 확인 (python -m http.server)');
        setPhase('loaderr');
      }
    })();
  }, []);

  /* ---------- flow.json 외부 변경 감시 (서버 모드 — AI/외부 편집 자동 반영) ---------- */
  useEffect(() => {
    if (phase !== 'ready' || !serverRef.current) return;
    const es = new EventSource('api/flow-events');
    es.onmessage = async (ev: MessageEvent) => {
      if (ev.data === 'scenes') { setThumbVer(v => v + 1); return; } // 씬 파일만 변경 — 썸네일 갱신
      const cur = docRef.current;
      if (!cur) return;
      try {
        const d = normalize(await (await fetch(dataRef.current + 'flow.json?t=' + Date.now())).json());
        const snap = clean(d);
        if (snap === clean(cur)) return; // 자체 저장 에코는 무시
        // 외부 편집도 실행 취소 히스토리에 쌓는다 (Ctrl+Z로 되돌리기 가능)
        const h = hist.current;
        if (h.lastSnap !== null && snap !== h.lastSnap) {
          h.past.push(h.lastSnap);
          if (h.past.length > 60) h.past.shift();
          h.future.length = 0;
        }
        h.lastSnap = snap;
        setDoc(d);
        try { localStorage.setItem(keys.current.LS, snap); } catch {}
      } catch {}
    };
    return () => es.close();
  }, [phase]);

  /* ---------- 실행 취소 단축키 ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k !== 'z' && k !== 'y') return;
      const t = e.target as HTMLElement | null;
      if (t && /INPUT|TEXTAREA|SELECT/.test(t.tagName)) return;
      if (document.querySelector('dialog[open]')) return;
      e.preventDefault();
      if (k === 'y' || (k === 'z' && e.shiftKey)) redo(); else undo();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  return (
    <Ctx.Provider value={{
      phase, errMsg, doc, server, DATA, isServer: !!server,
      activeTab, setActiveTab, ui, setUI, appTheme, setAppTheme, thumbVer,
      commit, undo, redo, resetToFile, patchServer
    }}>
      {children}
    </Ctx.Provider>
  );
}
