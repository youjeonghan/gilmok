/* 문서 변경 액션 — 모든 편집은 여기서 commit을 통해 이뤄진다 */
import { useStore } from './store';
import { useDialogs } from './dialogs';
import { titleOf, bracketsOnInsert, bracketsOnRemove, bracketAt, FlowLane } from './types';

export function useActions() {
  const { doc, commit } = useStore();
  const dialogs = useDialogs();

  const newSceneId = (scenes: Record<string, any>) => {
    let n = 1;
    while (scenes['new-' + n]) n++;
    return 'new-' + n;
  };

  return {
    /* ---- 씬 ---- */
    openSceneNote(sid: string) {
      if (!doc) return;
      dialogs.openNote({
        title: titleOf(doc, sid),
        value: doc.scenes[sid]?.note || '',
        onSave: v => commit(d => { if (d.scenes[sid]) d.scenes[sid].note = v; })
      });
    },
    async addTheme(sid: string) {
      if (!doc) return;
      const r = await dialogs.ask('테마 등록 — <em>' + titleOf(doc, sid) + '</em>', [
        { key: 'name', label: '테마 이름', placeholder: '예: dark / xmas' },
        { key: 'path', label: '씬 파일 경로 (flow.json 기준 상대 경로)', placeholder: 'scenes-dark/landing.html' }
      ]);
      if (!r || !r.name || !r.path) return null;
      commit(d => {
        const sc = d.scenes[sid];
        if (!sc) return;
        sc.themes = sc.themes || {};
        sc.themes[r.name] = r.path;
      });
      return r.name as string;
    },
    removeFromLane(flowId: string, idx: number) {
      commit(d => {
        const f = d.flows.find(x => x.id === flowId);
        if (!f) return;
        f.seq.splice(idx, 1);
        bracketsOnRemove(f, idx);
      });
    },
    /* ---- 삽입 ---- */
    async insertAt(flowId: string, idx: number) {
      if (!doc) return;
      const f = doc.flows.find(x => x.id === flowId);
      if (!f) return;
      const boundary = (f.brackets || [])
        .map((b, bi) => ({ b, bi }))
        .filter(({ b }) => idx === b.start || idx === b.end + 1)
        .map(({ b, bi }) => ({ label: b.label, bracketIdx: bi }));
      const r = await dialogs.pickScene(boundary);
      if (!r) return;
      commit(d => {
        const df = d.flows.find(x => x.id === flowId)!;
        let id = r.pick;
        if (id === '__new__') {
          if (!r.title) return;
          id = newSceneId(d.scenes);
          d.scenes[id] = { title: r.title, file: null, group: '', updated: '', note: '', themes: {} };
        }
        df.seq.splice(idx, 0, id);
        bracketsOnInsert(df, idx, r.includeIdx);
      });
    },
    async setStart(tabId: string) {
      const r = await dialogs.pickScene([]);
      if (!r) return;
      commit(d => {
        const t = d.tabs.find(x => x.id === tabId);
        if (!t) return;
        let id = r.pick;
        if (id === '__new__') {
          if (!r.title) return;
          id = newSceneId(d.scenes);
          d.scenes[id] = { title: r.title, file: null, group: '', updated: '', note: '', themes: {} };
        }
        t.start = id;
      });
    },
    /* ---- 분기 ---- */
    async addBranch(sid: string, tabId: string) {
      if (!doc) return;
      const r = await dialogs.ask('분기 추가 — <em>' + titleOf(doc, sid) + '</em> 에서', [
        { key: 'label', label: '분기 라벨', placeholder: '예: 가입 / 미가입' }
      ]);
      if (!r || !r.label) return;
      commit(d => {
        d.flows.push({
          id: 'f-' + Date.now().toString(36), tab: tabId, from: sid,
          label: r.label, note: '', seq: [], brackets: []
        });
      });
    },
    renameFlow(flowId: string, v: string) {
      commit(d => { const f = d.flows.find(x => x.id === flowId); if (f) f.label = v; });
    },
    openFlowNote(flowId: string) {
      if (!doc) return;
      const f = doc.flows.find(x => x.id === flowId);
      if (!f) return;
      dialogs.openNote({
        title: '분기 「' + f.label + '」',
        value: f.note || '',
        onSave: v => commit(d => { const df = d.flows.find(x => x.id === flowId); if (df) df.note = v; })
      });
    },
    async deleteFlow(flowId: string) {
      if (!doc) return;
      const f = doc.flows.find(x => x.id === flowId);
      if (!f) return;
      if (!(await dialogs.askConfirm(`'${f.label}' 분기를 삭제할까요? (씬 자체는 유지)`))) return;
      commit(d => { d.flows = d.flows.filter(x => x.id !== flowId); });
    },
    reanchorFlow(flowId: string, sid: string) {
      commit(d => { const f = d.flows.find(x => x.id === flowId); if (f) f.from = sid; });
    },
    /* ---- 범주 ---- */
    renameBracket(flowId: string, bi: number, v: string) {
      commit(d => {
        const b = d.flows.find(x => x.id === flowId)?.brackets?.[bi];
        if (b) b.label = v;
      });
    },
    deleteBracket(flowId: string, bi: number) {
      commit(d => {
        const f = d.flows.find(x => x.id === flowId);
        if (f) f.brackets.splice(bi, 1);
      });
    },
    openBracketNote(flowId: string, bi: number) {
      if (!doc) return;
      const b = doc.flows.find(x => x.id === flowId)?.brackets?.[bi];
      if (!b) return;
      dialogs.openNote({
        title: '범주 「' + b.label + '」',
        value: b.note || '',
        onSave: v => commit(d => {
          const db = d.flows.find(x => x.id === flowId)?.brackets?.[bi];
          if (db) db.note = v;
        })
      });
    },
    resizeBracket(flowId: string, bi: number, start: number, end: number) {
      commit(d => {
        const b = d.flows.find(x => x.id === flowId)?.brackets?.[bi];
        if (b) { b.start = start; b.end = end; }
      });
    },
    async makeBracket(flowId: string, lo: number, hi: number) {
      if (!doc) return;
      const f = doc.flows.find(x => x.id === flowId);
      if (!f) return;
      const overlapping = (f.brackets || []).map((b, bi) => ({ b, bi }))
        .filter(({ b }) => hi >= b.start && lo <= b.end);
      if (overlapping.length > 1) {
        await dialogs.askInfo('선택 범위가 두 개 이상의 범주와 겹쳐요 — 하나의 범주만 겹치게 선택해주세요.');
        return;
      }
      if (overlapping.length === 1) {
        const { bi } = overlapping[0];
        commit(d => {
          const b = d.flows.find(x => x.id === flowId)!.brackets[bi];
          b.start = Math.min(b.start, lo); b.end = Math.max(b.end, hi);
        });
        return;
      }
      const r = await dialogs.ask('범주 만들기', [{ key: 'label', label: '범주 이름', placeholder: '예: 온보딩' }]);
      if (r && r.label) {
        commit(d => {
          const df = d.flows.find(x => x.id === flowId)!;
          df.brackets = df.brackets || [];
          df.brackets.push({ label: r.label, start: lo, end: hi, note: '' });
        });
      }
    },
    /* ---- 씬 이동 (드래그 재배치) ---- */
    moveScene(srcFlowId: string, srcIdx: number, sid: string,
      tgtFlowId: string, slot: number, joinBracketIdx: number | null) {
      commit(d => {
        const src = d.flows.find(x => x.id === srcFlowId)!;
        const tgt = d.flows.find(x => x.id === tgtFlowId)!;
        const entries = tgt.seq
          .map((s, i) => ({ s, i }))
          .filter(({ i }) => !(tgt === src && i === srcIdx))
          .map(({ s, i }) => ({ sid: s, br: bracketAt(tgt, i) }));
        const joinBr = joinBracketIdx != null ? tgt.brackets[joinBracketIdx] : null;
        if (tgt !== src) {
          src.seq.splice(srcIdx, 1);
          bracketsOnRemove(src, srcIdx);
        }
        entries.splice(slot, 0, { sid, br: joinBr });
        tgt.seq = entries.map(e => e.sid);
        tgt.brackets = (tgt.brackets || []).filter(b => {
          const idxs = entries.map((e, i) => (e.br === b ? i : -1)).filter(i => i >= 0);
          if (!idxs.length) return false;
          b.start = Math.min(...idxs);
          b.end = Math.max(...idxs);
          return true;
        });
      });
    },
    /* ---- 탭 ---- */
    async addTab(): Promise<string | null> {
      if (!doc) return null;
      const r = await dialogs.ask('새 플로우 탭', [
        { key: 'title', label: '탭 이름', placeholder: '예: 운영자 플로우' }
      ]);
      if (!r || !r.title) return null;
      if (doc.tabs.some(t => t.title === r.title)) {
        await dialogs.askInfo('같은 이름의 탭이 이미 있어요 — 탭 이름은 유니크해야 해요.');
        return null;
      }
      const id = 't-' + Date.now().toString(36);
      commit(d => { d.tabs.push({ id, title: r.title, start: null }); });
      return id;
    },
    async deleteTab(tabId: string, title: string) {
      if (!(await dialogs.askConfirm(`'${title}' 탭과 그 분기 라인들을 삭제할까요? (씬 자체는 유지)`))) return false;
      commit(d => {
        d.tabs = d.tabs.filter(t => t.id !== tabId);
        d.flows = d.flows.filter(f => f.tab !== tabId);
      });
      return true;
    }
  };
}
