/* ⎇ 버전 그래프 — git 브랜치 GUI처럼 버전 트리를 레인·점·선으로 보여 주고,
 * 행마다 부모 대비 변경 요약 + 보기 · 비교 · 갈라지기 · 정본으로 만들기 */
import React, { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { useDialogs } from '../dialogs';
import { graphRows, versionMeta, promoteVersion, chainOf } from '../versions';

const ROW_H = 58, LANE_W = 22, PAD = 18, R = 6;
const LANE_COLORS = ['var(--jade)', 'var(--primary)', '#5b6ee1', '#b7791f', '#8e5bd6', '#2f8f9d', '#c2536b'];
const laneColor = (l: number) => LANE_COLORS[l % LANE_COLORS.length];

export function VersionGraph({ onClose, onBranch }: { onClose: () => void; onBranch: (parent: string) => void }) {
  const { raw, ver, verMeta: m, setVersion, setVersionBase, setUI, commitRaw } = useStore();
  const dialogs = useDialogs();
  const [sel, setSel] = useState<string | null>(ver);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const g = useMemo(() => (raw ? graphRows(raw) : { rows: [], lanes: 0 }), [raw]);
  /** 부모 대비 변경 수 — 행 요약용 */
  const stats = useMemo(() => {
    const out: Record<string, { add: number; chg: number; del: number; tab: number }> = {};
    if (!raw) return out;
    g.rows.forEach(r => {
      if (!r.parent) return;
      const vm = versionMeta(raw, r.v.id, null);
      const sc = Object.values(vm.scene);
      out[r.v.id] = {
        add: sc.filter(s => s.status === 'new').length,
        chg: sc.filter(s => s.status === 'changed').length,
        del: vm.removedScenes.length,
        tab: Object.values(vm.tab).filter(t => t.status !== 'same').length + vm.removedTabs.length
      };
    });
    return out;
  }, [raw, g]);

  if (!raw) return null;
  const rootId = raw.versions![0].id;
  const yOf = new Map<string, number>();
  g.rows.forEach((r, i) => yOf.set(r.v.id, PAD + i * ROW_H + ROW_H / 2));
  const xOf = (lane: number) => PAD + lane * LANE_W;
  const gw = PAD * 2 + Math.max(0, g.lanes - 1) * LANE_W;
  const gh = PAD * 2 + g.rows.length * ROW_H;

  const view = (id: string) => { setVersion(id); onClose(); };
  const compare = (id: string) => {
    if (!ver || id === ver) return;
    setVersionBase(m.parent?.id === id ? null : id);
    setUI({ verDiff: true });
    onClose();
  };
  const promote = async (id: string) => {
    const chain = chainOf(raw, id);
    const flipped = chain.slice(0, -1).reverse().map(x => 'v' + x).join(' → ');
    const ok = await dialogs.askConfirm(
      `v${id}을(를) 정본(기준 버전)으로 만들까요?\n\n` +
      `· v${id}이(가) 트리의 맨 위(루트)가 되고, 지금 정본 v${rootId}은(는) 그 아래 버전이 돼요.\n` +
      `  뒤집히는 경로: v${id} → ${flipped}\n` +
      `· 다른 갈래는 붙어 있던 버전 아래 그대로 남아요.\n` +
      `· 모든 버전의 내용(Scene·Branch·배치)은 그대로예요 — 부모-자식 방향만 바뀌어요.\n` +
      `· 실행 취소(Ctrl/Cmd+Z)로 되돌릴 수 있어요.`
    );
    if (!ok) return;
    const res = promoteVersion(raw, id);
    if (!res.ok) { await dialogs.askInfo('정본으로 만들지 못했어요.\n' + (res.error || '')); return; }
    commitRaw(() => res.raw!);
    setVersionBase(null);
    setVersion(id);
  };

  const selRow = g.rows.find(r => r.v.id === sel) || null;
  const selStat = sel ? stats[sel] : null;

  return (
    <div className="vgraph-wrap" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="vgraph">
        <div className="vg-head">
          <b>⎇ 버전 그래프</b>
          <span className="vg-hint">위가 최신 · 같은 색 줄 = 같은 갈래 · ★ = 정본 · 행 클릭 = 선택, 더블클릭 = 이 버전 보기</span>
          <span className="vg-x" title="닫기 (Esc)" onClick={onClose}>✕</span>
        </div>
        <div className="vg-body">
          <div className="vg-list" style={{ minHeight: gh }}>
            <svg className="vg-svg" width={gw} height={gh}>
              {g.rows.map(r => {
                if (!r.parent || r.parentLane === null) return null;
                const x1 = xOf(r.parentLane), y1 = yOf.get(r.parent)!;
                const x2 = xOf(r.lane), y2 = yOf.get(r.v.id)!;
                const d = x1 === x2
                  ? `M${x1},${y1} L${x2},${y2}`
                  : `M${x1},${y1} C${x1},${y1 - ROW_H * 0.6} ${x2},${y1 - ROW_H * 0.4} ${x2},${y1 - ROW_H} L${x2},${y2}`;
                return <path key={r.v.id} d={d} fill="none" stroke={laneColor(r.lane)} strokeWidth={2.4} strokeLinecap="round" />;
              })}
              {g.rows.map(r => {
                const x = xOf(r.lane), y = yOf.get(r.v.id)!;
                const isRoot = r.v.id === rootId, isCur = r.v.id === ver;
                return (
                  <g key={r.v.id}>
                    {isCur && <circle cx={x} cy={y} r={R + 5} fill="none" stroke={laneColor(r.lane)} strokeOpacity={0.35} strokeWidth={3} />}
                    <circle cx={x} cy={y} r={isRoot ? R + 1.5 : R} fill={isCur ? laneColor(r.lane) : 'var(--surface)'}
                      stroke={laneColor(r.lane)} strokeWidth={2.6} />
                  </g>
                );
              })}
            </svg>
            {g.rows.map((r, i) => {
              const st = stats[r.v.id];
              const isRoot = r.v.id === rootId;
              return (
                <div key={r.v.id}
                  className={'vg-row' + (r.v.id === sel ? ' sel' : '') + (r.v.id === ver ? ' cur' : '')}
                  style={{ top: PAD + i * ROW_H, height: ROW_H, paddingLeft: gw + 6 }}
                  onClick={() => setSel(r.v.id)} onDoubleClick={() => view(r.v.id)}>
                  <div className="vg-main">
                    <span className="vg-id" style={{ color: laneColor(r.lane) }}>{isRoot && '★ '}v{r.v.id}</span>
                    {r.v.title && <span className="vg-title">{r.v.title}</span>}
                    {isRoot && <span className="vg-tag root">정본</span>}
                    {r.v.id === ver && <span className="vg-tag cur">보는 중</span>}
                    {m.base?.id === r.v.id && <span className="vg-tag base">비교 기준</span>}
                    <span className="vg-sp" />
                    {r.v.date && <span className="vg-date">{r.v.date}</span>}
                  </div>
                  <div className="vg-sub">
                    {r.parent ? <>
                      <span className="vg-from">v{r.parent}에서</span>
                      {st && (st.add + st.chg + st.del + st.tab) === 0 && <span className="vg-none">변경 없음</span>}
                      {st && st.add > 0 && <span className="vbadge new">신규 {st.add}</span>}
                      {st && st.chg > 0 && <span className="vbadge changed">변경 {st.chg}</span>}
                      {st && st.del > 0 && <span className="vbadge removed">삭제 {st.del}</span>}
                      {st && st.tab > 0 && <span className="vbadge tab">Tab {st.tab}</span>}
                    </> : <span className="vg-from">트리의 시작 · 다른 버전은 모두 여기서 갈라져요</span>}
                    {r.children > 1 && <span className="vg-fork">⑂ 갈래 {r.children}</span>}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="vg-side">
            {selRow ? <>
              <div className="vs-id" style={{ color: laneColor(selRow.lane) }}>{selRow.v.id === rootId && '★ '}v{selRow.v.id}</div>
              {selRow.v.title && <div className="vs-title">{selRow.v.title}</div>}
              <div className="vs-meta">
                {selRow.v.id === rootId ? '정본 (기준 버전)' : '부모 v' + selRow.parent}
                {selRow.v.date ? ' · ' + selRow.v.date : ''}
                {' · 깊이 ' + selRow.depth}
                {selRow.children ? ' · 자식 ' + selRow.children : ' · 가지 끝'}
              </div>
              {selStat && <div className="vs-stat">
                <span className="vbadge new">신규 {selStat.add}</span>
                <span className="vbadge changed">변경 {selStat.chg}</span>
                <span className="vbadge removed">삭제 {selStat.del}</span>
                <span className="vbadge tab">Tab {selStat.tab}</span>
              </div>}
              {selRow.v.note && <div className="vs-note">{selRow.v.note}</div>}
              <div className="vs-acts">
                <button className="primary" onClick={() => view(selRow.v.id)}>이 버전 보기</button>
                {ver && selRow.v.id !== ver &&
                  <button onClick={() => compare(selRow.v.id)}>지금 보는 v{ver}과 비교</button>}
                <button onClick={() => { onClose(); onBranch(selRow.v.id); }}>⑂ 여기서 갈라지기</button>
                {selRow.v.id !== rootId &&
                  <button className="promote" onClick={() => promote(selRow.v.id)}>★ 정본으로 만들기</button>}
              </div>
            </> : <div className="vs-empty">왼쪽에서 버전을 고르세요</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
