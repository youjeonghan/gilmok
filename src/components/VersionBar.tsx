/* ⎇ 버전 — 헤더의 버전 선택기(브랜치 트리) · 오버레이 토글(상속/diff) · 기준 버전 대비 diff 패널 */
import React, { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { useDialogs } from '../dialogs';
import { useViewer } from './Viewer';
import {
  startVersioning, addVersion, deleteVersion, stopVersioning,
  revertScene, revertTab, suggestNextId, treeRows, childrenOf, diffOrder, commonAncestor
} from '../versions';

export function VersionBar() {
  const { raw, ver, verMeta: m, setVersion, setVersionBase, commitRaw, ui, setUI } = useStore();
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
      <button className="verstart" title="버전별 플로우 관리 — 바뀌지 않은 Scene·Tab은 부모 버전 것을 그대로 상속, 어느 버전에서든 갈라져 나갈 수 있음(브랜치)"
        onClick={start}>⎇ 버전</button>
    );
  }

  const vs = m.versions;
  const curV = vs.find(v => v.id === m.cur)!;
  const rows = treeRows(raw);

  /** 새 버전 — 부모를 골라 그 위에 쌓는다(이미 자식이 있으면 갈래가 하나 더 생김) */
  const addNew = async (parent?: string) => {
    setOpen(false);
    const p0 = parent || m.cur!;
    const r = await dialogs.ask('새 버전', [
      {
        key: 'parent', label: '어느 버전에서 갈라질까요 — 부모 버전', type: 'select', value: p0,
        options: rows.map(x => ({ label: '　'.repeat(x.depth) + 'v' + x.v.id + (x.v.title ? ' · ' + x.v.title : ''), value: x.v.id }))
      },
      { key: 'id', label: '버전 이름', value: suggestNextId(vs, p0, raw) },
      { key: 'title', label: '설명 (선택)', placeholder: '예: 결제 개편 / A안' }
    ]);
    if (!r || !r.id) return;
    const id = String(r.id).trim();
    if (vs.some(v => v.id === id)) { await dialogs.askInfo('같은 이름의 버전이 이미 있어요.'); return; }
    const p = String(r.parent || p0);
    commitRaw(d => { addVersion(d, { id, parent: p, ...(r.title ? { title: r.title } : {}) }); });
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

  const isLeaf = childrenOf(raw, curV.id).length === 0;
  const delCur = async () => {
    setOpen(false);
    if (!(await dialogs.askConfirm('v' + curV.id + ' 버전을 삭제할까요?\n이 버전에서 새로 만든 Scene·Scene 변경·Tab 구조 변경 기록이 함께 지워져요.'))) return;
    const back = m.parent?.id || vs[0].id;
    commitRaw(d => { deleteVersion(d, curV.id); });
    if (ui.verBase === curV.id) setVersionBase(null);
    setVersion(back);
  };

  const stop = async () => {
    setOpen(false);
    if (!(await dialogs.askConfirm('버전 관리를 해제할까요? 기준 버전(v' + vs[0].id + ')이 평범한 플로우로 남아요.'))) return;
    commitRaw(d => stopVersioning(d));
  };

  /** 비교 기준으로 지정 — diff도 함께 켠다 */
  const pickBase = (id: string) => {
    if (id === m.cur) return;
    setVersionBase(m.parent?.id === id ? null : id);
    setUI({ verDiff: true });
  };

  return (
    <span className="verbar" ref={ref}>
      <button className={'verpick' + (open ? ' on' : '')} title="버전 선택 · 관리 (브랜치 트리)"
        onClick={() => setOpen(o => !o)}>
        ⎇ v{curV.id}{curV.title ? <span className="vt"> {curV.title}</span> : null} ▾
      </button>
      {open && (
        <div className="vermenu">
          <div className="vm-hint">클릭 = 이 버전 보기 · ⑂ = 여기서 갈라지기 · 비교 = 이 버전을 기준으로 diff</div>
          {rows.map(({ v, depth, guides, last }) => (
            <div key={v.id}
              className={'vm-item tree' + (v.id === ver ? ' on' : '') + (m.base?.id === v.id ? ' isbase' : '')}
              title={(v.note || '') + (v.date ? ' · ' + v.date : '')}
              onClick={() => { setVersion(v.id); setOpen(false); }}>
              {guides.slice(1).map((g, i) => <span key={i} className={'vm-g' + (g ? ' line' : '')} />)}
              {depth > 0 && <span className={'vm-g ' + (last ? 'elbow' : 'tee')} />}
              <span className="vm-dot" />
              <b>v{v.id}</b>
              {v.title && <span className="vm-title">{v.title}</span>}
              {depth === 0 && <span className="vm-tag">기준</span>}
              <span className="vm-sub" onClick={e => e.stopPropagation()}>
                <span title={'v' + v.id + '에서 새 버전으로 갈라지기'} onClick={() => addNew(v.id)}>⑂</span>
                {v.id !== m.cur && <span className={m.base?.id === v.id ? 'on' : ''}
                  title={'v' + v.id + '을(를) 비교 기준으로 — 지금 보는 v' + m.cur + '과 diff'}
                  onClick={() => { pickBase(v.id); setOpen(false); }}>비교</span>}
              </span>
            </div>
          ))}
          <div className="pm-sep" />
          <div className="vm-item vm-act" onClick={() => addNew()}>＋ 새 버전… <span className="vm-title">(부모 선택 가능)</span></div>
          <div className="vm-item vm-act" onClick={editCur}>✎ 이 버전 정보…</div>
          {vs.length > 1 && isLeaf && curV.id !== vs[0].id &&
            <div className="vm-item vm-act vm-danger" onClick={delCur}>v{curV.id} 삭제…</div>}
          {vs.length === 1 && <div className="vm-item vm-act" onClick={stop}>버전 관리 해제…</div>}
        </div>
      )}
      {vs.length > 1 && (
        <span className="gtheme vtoggles">
          {m.depth > 0 && <span className={'tchip wide' + (ui.verInherit ? ' on' : '')}
            title="상속 보기 — 부모 쪽 버전 것을 그대로 쓰는 Scene은 흐리게 + 출처 버전 표시"
            onClick={() => setUI({ verInherit: !ui.verInherit })}>상속</span>}
          <span className={'tchip wide' + (ui.verDiff ? ' on' : '')}
            title={m.base ? 'v' + m.base.id + ' 대비 — 신규·변경 표시 + 삭제 목록 (기준은 패널·메뉴에서 변경)' : '비교 기준 버전을 골라 diff'}
            onClick={() => setUI({ verDiff: !ui.verDiff })}>diff{m.base ? ' ↔ v' + m.base.id : ''}</span>
        </span>
      )}
    </span>
  );
}

/** 기준 버전 대비 요약 — diff를 켰을 때만 캔버스 왼쪽 아래에 뜬다 */
export function VersionDiffPanel() {
  const { raw, doc, ver, verMeta: m, ui, setUI, commitRaw, setVersionBase } = useStore();
  const dialogs = useDialogs();
  const viewer = useViewer();
  if (!raw || !doc || !m.enabled || m.versions.length < 2 || !ui.verDiff || !ver) return null;

  const baseSel = (
    <select value={m.base?.id || ''} title="비교 기준 버전"
      onChange={e => setVersionBase(e.target.value === (m.parent?.id || '') ? null : e.target.value || null)}>
      {!m.base && <option value="">기준 선택…</option>}
      {treeRows(raw).filter(x => x.v.id !== m.cur).map(x => (
        <option key={x.v.id} value={x.v.id}>
          {'　'.repeat(x.depth)}v{x.v.id}{x.v.title ? ' · ' + x.v.title : ''}{x.v.id === m.parent?.id ? ' (부모)' : ''}
        </option>
      ))}
    </select>
  );

  if (!m.base) {
    return (
      <div className="verpanel">
        <div className="vp-head"><b>v{ver}</b> ↔ {baseSel}
          <span className="vp-x" title="diff 끄기" onClick={() => setUI({ verDiff: false })}>✕</span></div>
        <div className="vp-empty">기준 버전에는 부모가 없어요 — 비교할 버전을 고르세요</div>
      </div>
    );
  }

  const sc = Object.entries(m.scene);
  const added = sc.filter(([, s]) => s.status === 'new');
  const changed = sc.filter(([, s]) => s.status === 'changed');
  const tabs = Object.entries(m.tab).filter(([, t]) => t.status !== 'same');
  const title = (id: string) => doc.scenes[id]?.title || id;
  const tabTitle = (id: string) => doc.tabs.find(t => t.id === id)?.title || id;
  const order = diffOrder(doc, m);
  const cmp = (id?: string) => {
    if (!order.length) return;
    viewer.compare({ ids: order, index: id ? Math.max(0, order.indexOf(id)) : 0 });
  };
  // 되돌리기는 부모 대비 변경일 때만 의미 있다 (기준이 부모가 아니면 숨김)
  const canRevert = !m.baseCustom;

  const revScene = async (id: string, label: string, removed?: boolean) => {
    if (!(await dialogs.askConfirm(`「${label}」의 v${ver} ${removed ? '삭제를 취소하고' : '변경을 되돌려'} 부모 버전 것을 쓸까요?`))) return;
    commitRaw(d => { revertScene(d, ver, id); });
  };
  const revTab = async (id: string, label: string) => {
    if (!(await dialogs.askConfirm(`Tab 「${label}」의 v${ver} 구조 변경을 되돌려 부모 버전 것을 쓸까요?`))) return;
    commitRaw(d => { revertTab(d, ver, id); });
  };

  const ca = commonAncestor(raw, m.base.id, ver);
  // 기준이 조상이면 신규/삭제, 아니면(형제 갈래·자손) 어느 쪽에만 있는지로 표기
  const lineal = ca === m.base.id;
  const L = lineal ? { add: '신규', del: '삭제' } : { add: '이 버전에만', del: '기준에만' };
  const relation = ca === m.base.id ? (m.baseCustom ? '조상' : '부모')
    : ca === ver ? '자손' : ca ? '갈래 · 공통 조상 v' + ca : '';
  const empty = !added.length && !changed.length && !m.removedScenes.length && !tabs.length && !m.removedTabs.length;
  return (
    <div className="verpanel">
      <div className="vp-head">
        {baseSel} <b>→ v{ver}</b>
        <span className="vp-sp" />
        {order.length > 0 && <span className="vp-cmp" title="차이 나는 Scene을 기준 ↔ 현재 나란히 넘겨 보기" onClick={() => cmp()}>⇆ 나란히 비교</span>}
        <span className="vp-x" title="diff 끄기" onClick={() => setUI({ verDiff: false })}>✕</span>
      </div>
      <div className="vp-path">{relation && <>기준 v{m.base.id} = 현재의 {relation} · </>}{L.add} {added.length} · 변경 {changed.length} · {L.del} {m.removedScenes.length}</div>
      {empty && <div className="vp-empty">기준 버전과 차이가 없어요</div>}
      {added.length > 0 && <div className="vp-sec"><span className="vbadge new">{L.add}</span>
        {added.map(([id]) => <span key={id} className="vp-it click" title="나란히 비교" onClick={() => cmp(id)}>{title(id)}</span>)}</div>}
      {changed.length > 0 && <div className="vp-sec"><span className="vbadge changed">변경</span>
        {changed.map(([id, s]) => (
          <span key={id} className="vp-it click" title="나란히 비교" onClick={() => cmp(id)}>{title(id)}
            {canRevert && s.own === 'changed' && <span className="vp-rev" title="부모 버전으로 되돌리기"
              onClick={e => { e.stopPropagation(); revScene(id, title(id)); }}>↺</span>}
          </span>
        ))}</div>}
      {m.removedScenes.length > 0 && <div className="vp-sec"><span className="vbadge removed">{L.del}</span>
        {m.removedScenes.map(s => (
          <span key={s.id} className={'vp-it click' + (lineal ? ' gone' : '')} title="나란히 비교" onClick={() => cmp(s.id)}>{s.title}
            {canRevert && <span className="vp-rev" title="삭제 취소"
              onClick={e => { e.stopPropagation(); revScene(s.id, s.title, true); }}>↺</span>}
          </span>
        ))}</div>}
      {(tabs.length > 0 || m.removedTabs.length > 0) && <div className="vp-sec"><span className="vbadge tab">Tab</span>
        {tabs.map(([id, t]) => (
          <span key={id} className="vp-it">{tabTitle(id)} <em>{t.status === 'new' ? '신규' : '구조 변경'}</em>
            {canRevert && t.own === 'changed' && <span className="vp-rev" title="부모 버전 구조로 되돌리기" onClick={() => revTab(id, tabTitle(id))}>↺</span>}
          </span>
        ))}
        {m.removedTabs.map(t => (
          <span key={t.id} className="vp-it gone">{t.title} <em>삭제</em>
            {canRevert && <span className="vp-rev" title="삭제 취소" onClick={() => revTab(t.id, t.title)}>↺</span>}
          </span>
        ))}</div>}
    </div>
  );
}
