/* ⎇ 버전 — 헤더의 버전 선택기 · 오버레이 토글(상속/diff) · 직전 대비 diff 패널 */
import React, { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { useDialogs } from '../dialogs';
import {
  startVersioning, addVersion, deleteLastVersion, stopVersioning,
  revertScene, revertTab, suggestNextId
} from '../versions';

export function VersionBar() {
  const { raw, ver, verMeta: m, setVersion, commitRaw, ui, setUI } = useStore();
  const dialogs = useDialogs();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  if (!raw) return null;

  if (!m.enabled) {
    const start = async () => {
      const r = await dialogs.ask('버전 관리 시작', [
        { key: 'base', label: '지금 플로우를 기준 버전으로 — 버전 이름', value: '1.0' },
        { key: 'baseTitle', label: '기준 버전 설명 (선택)', placeholder: '예: 베타' },
        { key: 'next', label: '바로 만들 다음 버전 (비우면 기준 버전만)', value: '1.1' }
      ]);
      if (!r || !r.base) return;
      const base = String(r.base).trim(), next = String(r.next || '').trim();
      if (next && next === base) { await dialogs.askInfo('다음 버전 이름이 기준 버전과 같아요.'); return; }
      commitRaw(d => {
        startVersioning(d, { id: base, ...(r.baseTitle ? { title: r.baseTitle } : {}) }, next ? { id: next } : undefined);
      });
      setVersion(next || base);
    };
    return (
      <button className="verstart" title="버전별 플로우 관리 — 바뀌지 않은 Scene·Tab은 이전 버전 것을 그대로 상속"
        onClick={start}>⎇ 버전</button>
    );
  }

  const vs = m.versions;
  const curV = vs[m.idx];
  const last = vs[vs.length - 1];

  const addNew = async () => {
    setOpen(false);
    const r = await dialogs.ask('새 버전', [
      { key: 'id', label: '버전 이름 — 마지막 버전(v' + last.id + ') 위에 쌓여요', value: suggestNextId(vs) },
      { key: 'title', label: '설명 (선택)', placeholder: '예: 결제 개편' }
    ]);
    if (!r || !r.id) return;
    const id = String(r.id).trim();
    if (vs.some(v => v.id === id)) { await dialogs.askInfo('같은 이름의 버전이 이미 있어요.'); return; }
    commitRaw(d => { addVersion(d, { id, ...(r.title ? { title: r.title } : {}) }); });
    setVersion(id);
  };

  const editCur = async () => {
    setOpen(false);
    const r = await dialogs.ask('버전 정보 — v' + curV.id, [
      { key: 'title', label: '설명', value: curV.title || '' },
      { key: 'date', label: '날짜 (선택)', value: curV.date || '', placeholder: 'YYYY-MM-DD' },
      { key: 'note', label: '메모 (선택)', value: curV.note || '' }
    ]);
    if (!r) return;
    commitRaw(d => {
      const v = d.versions!.find(x => x.id === curV.id);
      if (!v) return;
      (['title', 'date', 'note'] as const).forEach(k => {
        if (r[k]) v[k] = r[k]; else delete v[k];
      });
    });
  };

  const delLast = async () => {
    setOpen(false);
    if (!(await dialogs.askConfirm('마지막 버전 v' + last.id + '를 삭제할까요?\n이 버전에서 새로 만든 Scene·Scene 변경·Tab 구조 변경 기록이 함께 지워져요.'))) return;
    commitRaw(d => { deleteLastVersion(d); });
    setVersion(vs[vs.length - 2].id);
  };

  const stop = async () => {
    setOpen(false);
    if (!(await dialogs.askConfirm('버전 관리를 해제할까요? 기준 버전(v' + vs[0].id + ')이 평범한 플로우로 남아요.'))) return;
    commitRaw(d => stopVersioning(d));
  };

  return (
    <span className="verbar" ref={ref}>
      <button className={'verpick' + (open ? ' on' : '')} title="버전 선택 · 관리"
        onClick={() => setOpen(o => !o)}>
        ⎇ v{curV.id}{curV.title ? <span className="vt"> {curV.title}</span> : null} ▾
      </button>
      {open && (
        <div className="vermenu">
          {[...vs].reverse().map(v => {
            const i = vs.indexOf(v);
            return (
              <div key={v.id} className={'vm-item' + (v.id === ver ? ' on' : '')}
                title={(v.note || '') + (v.date ? ' · ' + v.date : '')}
                onClick={() => { setVersion(v.id); setOpen(false); }}>
                <b>v{v.id}</b>
                {v.title && <span className="vm-title">{v.title}</span>}
                {i === 0 && <span className="vm-tag">기준</span>}
              </div>
            );
          })}
          <div className="pm-sep" />
          <div className="vm-item vm-act" onClick={addNew}>＋ 새 버전…</div>
          <div className="vm-item vm-act" onClick={editCur}>✎ 이 버전 정보…</div>
          {vs.length > 1 && <div className="vm-item vm-act vm-danger" onClick={delLast}>마지막 버전(v{last.id}) 삭제…</div>}
          {vs.length === 1 && <div className="vm-item vm-act" onClick={stop}>버전 관리 해제…</div>}
        </div>
      )}
      {m.idx > 0 && (
        <span className="gtheme vtoggles">
          <span className={'tchip wide' + (ui.verInherit ? ' on' : '')}
            title="상속 보기 — 이전 버전 것을 그대로 쓰는 Scene은 흐리게 + 출처 버전 표시"
            onClick={() => setUI({ verInherit: !ui.verInherit })}>상속</span>
          <span className={'tchip wide' + (ui.verDiff ? ' on' : '')}
            title={'직전 버전(v' + m.prev?.id + ') 대비 — 신규·변경 표시 + 삭제 목록'}
            onClick={() => setUI({ verDiff: !ui.verDiff })}>diff</span>
        </span>
      )}
    </span>
  );
}

/** 직전 버전 대비 요약 — diff를 켰을 때만 캔버스 왼쪽 아래에 뜬다 */
export function VersionDiffPanel() {
  const { doc, ver, verMeta: m, ui, setUI, commitRaw } = useStore();
  const dialogs = useDialogs();
  if (!doc || !m.enabled || m.idx <= 0 || !ui.verDiff || !ver) return null;
  const sc = Object.entries(m.scene);
  const added = sc.filter(([, s]) => s.status === 'new');
  const changed = sc.filter(([, s]) => s.status === 'changed');
  const tabs = Object.entries(m.tab).filter(([, t]) => t.status !== 'same');
  const title = (id: string) => doc.scenes[id]?.title || id;
  const tabTitle = (id: string) => doc.tabs.find(t => t.id === id)?.title || id;

  const revScene = async (id: string, label: string, removed?: boolean) => {
    if (!(await dialogs.askConfirm(`「${label}」의 v${ver} ${removed ? '삭제를 취소하고' : '변경을 되돌려'} 직전 버전 것을 쓸까요?`))) return;
    commitRaw(d => { revertScene(d, ver, id); });
  };
  const revTab = async (id: string, label: string) => {
    if (!(await dialogs.askConfirm(`Tab 「${label}」의 v${ver} 구조 변경을 되돌려 직전 버전 것을 쓸까요?`))) return;
    commitRaw(d => { revertTab(d, ver, id); });
  };

  const empty = !added.length && !changed.length && !m.removedScenes.length && !tabs.length && !m.removedTabs.length;
  return (
    <div className="verpanel">
      <div className="vp-head">
        <b>v{m.prev?.id} → v{ver}</b>
        <span className="vp-sum">신규 {added.length} · 변경 {changed.length} · 삭제 {m.removedScenes.length}</span>
        <span className="vp-x" title="diff 끄기" onClick={() => setUI({ verDiff: false })}>✕</span>
      </div>
      {empty && <div className="vp-empty">직전 버전과 차이가 없어요 — 전부 상속 중</div>}
      {added.length > 0 && <div className="vp-sec"><span className="vbadge new">신규</span>
        {added.map(([id]) => <span key={id} className="vp-it">{title(id)}</span>)}</div>}
      {changed.length > 0 && <div className="vp-sec"><span className="vbadge changed">변경</span>
        {changed.map(([id]) => (
          <span key={id} className="vp-it">{title(id)}
            <span className="vp-rev" title="직전 버전으로 되돌리기" onClick={() => revScene(id, title(id))}>↺</span>
          </span>
        ))}</div>}
      {m.removedScenes.length > 0 && <div className="vp-sec"><span className="vbadge removed">삭제</span>
        {m.removedScenes.map(s => (
          <span key={s.id} className="vp-it gone">{s.title}
            <span className="vp-rev" title="삭제 취소" onClick={() => revScene(s.id, s.title, true)}>↺</span>
          </span>
        ))}</div>}
      {(tabs.length > 0 || m.removedTabs.length > 0) && <div className="vp-sec"><span className="vbadge tab">Tab</span>
        {tabs.map(([id, t]) => (
          <span key={id} className="vp-it">{tabTitle(id)} <em>{t.status === 'new' ? '신규' : '구조 변경'}</em>
            {t.status === 'changed' && <span className="vp-rev" title="직전 버전 구조로 되돌리기" onClick={() => revTab(id, tabTitle(id))}>↺</span>}
          </span>
        ))}
        {m.removedTabs.map(t => (
          <span key={t.id} className="vp-it gone">{t.title} <em>삭제</em>
            <span className="vp-rev" title="삭제 취소" onClick={() => revTab(t.id, t.title)}>↺</span>
          </span>
        ))}</div>}
    </div>
  );
}
