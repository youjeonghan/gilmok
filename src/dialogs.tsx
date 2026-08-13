import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useStore } from './store';
import { titleOf } from './types';

/* ---------- 타입 ---------- */
export interface AskField {
  key: string;
  label?: string;
  placeholder?: string;
  value?: string;
  type?: 'text' | 'select' | 'segment' | 'file';
  options?: { label: string; value: string }[];
  accept?: string;
  showWhen?: { key: string; value: string };
  onPick?: (v: string) => void; // segment 클릭 시 즉시 호출 (라이브 적용용)
}
export interface NoteCtx { title: string; value: string; onSave: (v: string) => void }
export interface PickBoundary { label: string; bracketIdx: number }
export interface PickResult { pick: string; title: string; includeIdx: number }

interface DialogAPI {
  ask: (title: string, fields: AskField[]) => Promise<Record<string, any> | null>;
  askInfo: (msg: string) => Promise<void>;
  askConfirm: (msg: string) => Promise<boolean>;
  openNote: (ctx: NoteCtx) => void;
  pickScene: (boundary: PickBoundary[]) => Promise<PickResult | null>;
  openExport: (text: string) => void;
}

const Ctx = createContext<DialogAPI>(null as any);
export const useDialogs = () => useContext(Ctx);

/* ---------- ask 다이얼로그 ---------- */
interface AskState {
  title: string;
  fields: AskField[];
  mode: 'form' | 'info' | 'confirm';
  msg?: string;
  resolve: (v: any) => void;
}

function AskDialog({ st, close }: { st: AskState | null; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [vals, setVals] = useState<Record<string, string>>({});
  const files = useRef<Record<string, File | null>>({});

  useEffect(() => {
    if (st) {
      const init: Record<string, string> = {};
      st.fields.forEach(f => { init[f.key] = f.value || (f.type === 'select' || f.type === 'segment' ? (f.options?.[0]?.value ?? '') : ''); });
      setVals(init);
      files.current = {};
      ref.current?.showModal();
      setTimeout(() => {
        const first = ref.current?.querySelector('input,select') as HTMLInputElement | null;
        first?.focus(); first?.select?.();
      }, 30);
    } else ref.current?.close();
  }, [st]);

  if (!st) return <dialog ref={ref} />;
  const ok = () => {
    if (st.mode === 'confirm') { st.resolve(true); close(); return; }
    if (st.mode === 'info') { st.resolve(undefined); close(); return; }
    const out: Record<string, any> = {};
    st.fields.forEach(f => {
      out[f.key] = f.type === 'file' ? (files.current[f.key] || null) : (vals[f.key] || '').trim();
    });
    st.resolve(out); close();
  };
  const cancel = () => { st.resolve(st.mode === 'confirm' ? false : null); close(); };
  return (
    <dialog ref={ref} onCancel={e => { e.preventDefault(); cancel(); }}>
      <div className="dlg">
        <h2 dangerouslySetInnerHTML={{ __html: st.title }} />
        {st.mode !== 'form' && <div className="msg">{st.msg}</div>}
        {st.mode === 'form' && st.fields.map(f => {
          const visible = !f.showWhen || vals[f.showWhen.key] === f.showWhen.value;
          if (!visible) return null;
          return (
            <div key={f.key}>
              {f.label && <label>{f.label}</label>}
              {f.type === 'segment' ? (
                <div className="seg">
                  {(f.options || []).map(o => (
                    <button key={o.value} type="button" className={vals[f.key] === o.value ? 'on' : ''}
                      onClick={() => { setVals(v => ({ ...v, [f.key]: o.value })); f.onPick?.(o.value); }}>
                      {o.label}
                    </button>
                  ))}
                </div>
              ) : f.type === 'select' ? (
                <select value={vals[f.key] || ''} onChange={e => setVals(v => ({ ...v, [f.key]: e.target.value }))}>
                  {(f.options || []).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : f.type === 'file' ? (
                <input type="file" accept={f.accept} onChange={e => { files.current[f.key] = e.target.files?.[0] || null; }} />
              ) : (
                <input value={vals[f.key] || ''} placeholder={f.placeholder || ''}
                  onChange={e => setVals(v => ({ ...v, [f.key]: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') ok(); }} />
              )}
            </div>
          );
        })}
        <div className="row">
          {st.mode !== 'info' && <button onClick={cancel}>취소</button>}
          <button className="pri" onClick={ok}>확인</button>
        </div>
      </div>
    </dialog>
  );
}

/* ---------- 노트 다이얼로그 ---------- */
function NoteDialog({ st, close }: { st: NoteCtx | null; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [txt, setTxt] = useState('');
  useEffect(() => {
    if (st) { setTxt(st.value || ''); ref.current?.showModal(); }
    else ref.current?.close();
  }, [st]);
  if (!st) return <dialog ref={ref} />;
  return (
    <dialog ref={ref} onCancel={close}>
      <div className="dlg">
        <h2>노트 — {st.title}</h2>
        <textarea id="noteTxt" value={txt} placeholder="의도, 미결 사항, AI에게 남길 컨텍스트…"
          onChange={e => setTxt(e.target.value)} autoFocus />
        <div className="row">
          <button className="grow" onClick={() => { st.onSave(''); close(); }}>노트 삭제</button>
          <button onClick={close}>취소</button>
          <button className="pri" onClick={() => { st.onSave(txt.trim()); close(); }}>저장</button>
        </div>
      </div>
    </dialog>
  );
}

/* ---------- 씬 삽입 다이얼로그 ---------- */
interface PickState { boundary: PickBoundary[]; resolve: (v: PickResult | null) => void }

function PickDialog({ st, close }: { st: PickState | null; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { doc, DATA, ui, setUI } = useStore();
  const [picked, setPicked] = useState('__new__');
  const [title, setTitle] = useState('');
  const [posIdx, setPosIdx] = useState(-1);
  useEffect(() => {
    if (st) {
      setPicked('__new__'); setTitle(''); setPosIdx(-1);
      const dlg = ref.current!;
      dlg.style.margin = ''; dlg.style.left = ''; dlg.style.top = '';
      dlg.showModal();
      // 좌상단 고정 — 작게/크게 전환 시 오른쪽·아래로만 커지도록
      requestAnimationFrame(() => {
        const r = dlg.getBoundingClientRect();
        dlg.style.margin = '0'; dlg.style.left = r.left + 'px'; dlg.style.top = r.top + 'px';
      });
    } else ref.current?.close();
  }, [st]);
  if (!st || !doc) return <dialog ref={ref} id="pickDlg" />;
  const big = !!ui.pickBig;
  const done = (v: PickResult | null) => { st.resolve(v); close(); };
  const ok = () => done({ pick: picked, title: title.trim(), includeIdx: posIdx >= 0 ? st.boundary[posIdx].bracketIdx : -1 });
  const rows: { val: string; label: string; file: string | null; tag?: string }[] = [
    { val: '__new__', label: '✦ 새 Scene', file: null },
    ...Object.keys(doc.scenes).map(id => ({
      val: id, label: titleOf(doc, id), file: doc.scenes[id].file,
      tag: doc.scenes[id].file ? undefined : '미제작'
    }))
  ];
  return (
    <dialog ref={ref} id="pickDlg" className={big ? 'big' : ''} onCancel={e => { e.preventDefault(); done(null); }}>
      <div className="dlg">
        <h2 style={{ display: 'flex', alignItems: 'center' }}>Scene 삽입
          <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 4 }}>
            {([['S', false], ['L', true]] as const).map(([lb, b]) => (
              <span key={lb} className={'tchip' + (big === b ? ' on' : '')}
                onClick={() => setUI({ pickBig: b })}>{lb}</span>
            ))}
          </span>
        </h2>
        <div className={'picklist' + (big ? ' big' : '')}>
          {rows.map(r => (
            <div key={r.val} className={'pickrow' + (picked === r.val ? ' on' : '')}
              onClick={() => setPicked(r.val)}>
              <span>{r.label}</span>
              {r.tag && <span className="tag">{r.tag}</span>}
              <div className={'pv' + (r.file ? '' : ' none')}>
                {r.file
                  ? <iframe src={DATA + r.file} loading="lazy" tabIndex={-1} />
                  : (r.val === '__new__' ? 'new' : '—')}
              </div>
            </div>
          ))}
        </div>
        {picked === '__new__' && (
          <div><label>새 Scene 제목</label>
            <input value={title} placeholder="예: 결제 확인" autoFocus
              onChange={e => setTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') ok(); }} />
          </div>
        )}
        {st.boundary.length > 0 && (
          <div><label>위치</label>
            <select value={String(posIdx)} onChange={e => setPosIdx(parseInt(e.target.value, 10))}>
              <option value="-1">독립 (Bracket 밖)</option>
              {st.boundary.map((b, i) => (
                <option key={i} value={String(i)}>Bracket 「{b.label}」에 포함</option>
              ))}
            </select>
          </div>
        )}
        <div className="row">
          <button onClick={() => done(null)}>취소</button>
          <button className="pri" onClick={ok}>확인</button>
        </div>
      </div>
    </dialog>
  );
}

/* ---------- 내보내기 다이얼로그 ---------- */
function ExportDialog({ text, close }: { text: string | null; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (text != null) { ref.current?.showModal(); setTimeout(() => ta.current?.select(), 30); }
    else ref.current?.close();
  }, [text]);
  return (
    <dialog ref={ref} id="exportDlg" onCancel={close}>
      <div className="dlg">
        <h2>flow.json 내보내기 — 아래 내용을 붙여넣기</h2>
        <textarea id="exportTxt" ref={ta} readOnly value={text || ''} spellCheck={false} />
        <div className="row">
          <button onClick={() => {
            ta.current?.select();
            navigator.clipboard?.writeText(text || '').catch(() => document.execCommand('copy'));
          }}>복사</button>
          <button onClick={close}>닫기</button>
        </div>
      </div>
    </dialog>
  );
}

/* ---------- Provider ---------- */
export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [askSt, setAskSt] = useState<AskState | null>(null);
  const [noteSt, setNoteSt] = useState<NoteCtx | null>(null);
  const [pickSt, setPickSt] = useState<PickState | null>(null);
  const [exportTxt, setExportTxt] = useState<string | null>(null);

  const api: DialogAPI = {
    ask: (title, fields) => new Promise(res => setAskSt({ title, fields, mode: 'form', resolve: res })),
    askInfo: msg => new Promise(res => setAskSt({ title: '안내', fields: [], mode: 'info', msg, resolve: res })),
    askConfirm: msg => new Promise(res => setAskSt({ title: '확인', fields: [], mode: 'confirm', msg, resolve: res })),
    openNote: ctx => setNoteSt(ctx),
    pickScene: boundary => new Promise(res => setPickSt({ boundary, resolve: res })),
    openExport: text => setExportTxt(text)
  };

  return (
    <Ctx.Provider value={api}>
      {children}
      <AskDialog st={askSt} close={() => setAskSt(null)} />
      <NoteDialog st={noteSt} close={() => setNoteSt(null)} />
      <PickDialog st={pickSt} close={() => setPickSt(null)} />
      <ExportDialog text={exportTxt} close={() => setExportTxt(null)} />
    </Ctx.Provider>
  );
}
