/* 버전 레이어 — flow.json v4
 *
 * 저장 형태(raw): 최상위 scenes/tabs/flows/layout = 기준 버전(versions[0]).
 *   - 씬: rev[버전] = 그 버전에서 바뀐 필드만 / { removed: true } = 그 버전에서 삭제
 *         since = 그 버전에서 새로 생긴 씬(최상위 필드가 그 버전 정의)
 *   - 탭: versionTabs[버전][탭] = 그 버전에서 바뀐 탭 구조 통째(탭·Branch·배치) / { removed: true }
 *   - 탭 순서: versions[i].tabOrder (상속 순서와 다를 때만)
 * 해석 규칙: "선택 버전 이하에서 가장 최근 정의를 쓴다" — 바뀌지 않은 건 이전 버전 것을 그대로 상속.
 *
 * 화면은 resolve()가 만든 평범한 FlowDoc만 다루고, 편집 결과는 absorb()가 이전 버전과 비교해
 * 달라진 씬·탭만 현재 버전 레이어에 기록한다(탭은 copy-on-write). */
import type { FlowDoc, Scene, Tab, FlowLane, TabLayout } from './types';

export interface Version {
  id: string;
  title?: string;
  date?: string;
  note?: string;
  /** 상속 순서와 다를 때만 저장되는 탭 순서 */
  tabOrder?: string[];
}

export type SceneRev = Partial<Pick<Scene, 'title' | 'file' | 'kind' | 'themes' | 'group' | 'updated' | 'note'>> & {
  removed?: boolean;
};

export interface TabOverride {
  tab?: Tab;
  flows?: FlowLane[];
  layout?: TabLayout;
  removed?: boolean;
}

interface TabStruct { tab: Tab; flows: FlowLane[]; layout?: TabLayout }

const FIELDS = ['title', 'file', 'kind', 'themes', 'group', 'updated', 'note'] as const;

export const hasVersions = (raw: FlowDoc | null | undefined): boolean =>
  !!(raw && raw.versions && raw.versions.length);

/** 유효한 버전 id (없거나 사라졌으면 마지막 버전) */
export function effectiveVersion(raw: FlowDoc, vid: string | null | undefined): string | null {
  const vs = raw.versions || [];
  if (!vs.length) return null;
  return vs.some(v => v.id === vid) ? (vid as string) : vs[vs.length - 1].id;
}

const vIdx = (raw: FlowDoc, vid: string | null | undefined) =>
  (raw.versions || []).findIndex(v => v.id === vid);

/** 씬의 since 인덱스 — 없거나 모르는 버전이면 기준(0) */
const sinceIdx = (raw: FlowDoc, s: Scene) => {
  if (!s.since) return 0;
  const i = vIdx(raw, s.since);
  return i < 0 ? 0 : i;
};

const pickFields = (s: Partial<Scene>): Scene => ({
  title: s.title ?? '',
  file: s.file ?? null,
  kind: s.kind === 'capture' ? 'capture' : 'design',
  themes: { ...(s.themes || {}) },
  group: s.group ?? '',
  updated: s.updated ?? '',
  note: s.note ?? ''
});

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** k번째 버전에서의 씬 (없으면 null) */
export function sceneAt(raw: FlowDoc, id: string, k: number): Scene | null {
  const s = raw.scenes[id];
  const vs = raw.versions || [];
  if (!s || k < 0) return null;
  const si = sinceIdx(raw, s);
  if (si > k) return null;
  const cur = pickFields(s);
  let alive = true;
  for (let i = si; i <= k && i < vs.length; i++) {
    const r = s.rev?.[vs[i].id];
    if (!r) continue;
    if (r.removed) { alive = false; continue; }
    alive = true;
    FIELDS.forEach(f => {
      if (r[f] !== undefined) (cur as any)[f] = f === 'themes' ? { ...(r.themes || {}) } : r[f];
    });
  }
  return alive ? cur : null;
}

const cleanLayout = (l?: TabLayout): TabLayout | undefined =>
  l && l.offsets && Object.keys(l.offsets).length ? l : undefined;

const normFlow = (f: FlowLane): FlowLane => ({ ...f, brackets: f.brackets || [], note: f.note || '' });

/** k번째 버전에서의 탭 구조 (없으면 null) */
function tabStructAt(raw: FlowDoc, tid: string, k: number): TabStruct | null {
  const vs = raw.versions || [];
  for (let i = Math.min(k, vs.length - 1); i >= 1; i--) {
    const o = raw.versionTabs?.[vs[i].id]?.[tid];
    if (!o) continue;
    if (o.removed) return null;
    const baseTab = raw.tabs.find(t => t.id === tid);
    return {
      tab: o.tab || baseTab || { id: tid, title: tid, start: null },
      flows: (o.flows || []).map(normFlow),
      layout: cleanLayout(o.layout)
    };
  }
  if (k < 0) return null;
  const t = raw.tabs.find(x => x.id === tid);
  if (!t) return null;
  return {
    tab: t,
    flows: raw.flows.filter(f => f.tab === tid).map(normFlow),
    layout: cleanLayout(raw.layout?.[tid])
  };
}

/** k번째 버전의 탭 순서 (extraTabOrderSkip = 이 인덱스의 tabOrder는 무시 — 상속 순서 계산용) */
function tabOrderAt(raw: FlowDoc, k: number, skipOrderAt = -1): string[] {
  const vs = raw.versions || [];
  let order = raw.tabs.map(t => t.id);
  for (let i = 1; i <= k && i < vs.length; i++) {
    const ov = raw.versionTabs?.[vs[i].id] || {};
    Object.keys(ov).forEach(tid => { if (!order.includes(tid)) order.push(tid); });
    const to = vs[i].tabOrder;
    if (to && i !== skipOrderAt) {
      order = [...to.filter(t => order.includes(t)), ...order.filter(t => !to.includes(t))];
    }
  }
  return order;
}

function docAt(raw: FlowDoc, k: number): FlowDoc {
  const scenes: Record<string, Scene> = {};
  Object.keys(raw.scenes).forEach(id => {
    const s = sceneAt(raw, id, k);
    if (s) scenes[id] = s;
  });
  if (k <= 0) {
    // 기준 버전 = 최상위 그대로 (흐름 순서까지 보존해 저장 시 불필요한 diff가 생기지 않게)
    return structuredClone({
      version: raw.version, service: raw.service,
      tabs: raw.tabs, scenes, flows: raw.flows.map(normFlow),
      ...(raw.layout ? { layout: raw.layout } : {})
    });
  }
  const tabs: Tab[] = [];
  const flows: FlowLane[] = [];
  const layout: Record<string, TabLayout> = {};
  tabOrderAt(raw, k).forEach(tid => {
    const st = tabStructAt(raw, tid, k);
    if (!st) return;
    tabs.push(st.tab);
    flows.push(...st.flows);
    if (st.layout) layout[tid] = st.layout;
  });
  return structuredClone({ version: raw.version, service: raw.service, tabs, scenes, flows, layout });
}

/** 선택 버전으로 해석한 평범한 FlowDoc (버전 필드 없음 — 화면·액션은 이것만 다룬다) */
export function resolve(raw: FlowDoc, vid: string | null): FlowDoc {
  if (!hasVersions(raw)) return raw;
  return docAt(raw, vIdx(raw, effectiveVersion(raw, vid)));
}

/* ---------- 편집 결과 → 현재 버전 레이어에 기록 ---------- */

function structsOf(d: FlowDoc): Record<string, TabStruct> {
  const m: Record<string, TabStruct> = {};
  d.tabs.forEach(t => {
    m[t.id] = { tab: t, flows: d.flows.filter(f => f.tab === t.id).map(normFlow), layout: cleanLayout(d.layout?.[t.id]) };
  });
  return m;
}

/** 새 씬 id가 다른 버전에만 있는 씬과 겹치면 새 id로 바꾸고 참조도 함께 바꾼다 */
function renameScene(d: FlowDoc, from: string, to: string) {
  d.scenes[to] = d.scenes[from];
  delete d.scenes[from];
  d.tabs.forEach(t => { if (t.start === from) t.start = to; });
  d.flows.forEach(f => {
    if (f.from === from) f.from = to;
    f.seq = f.seq.map(s => (s === from ? to : s));
  });
}

export function absorb(raw: FlowDoc, vid: string | null, before: FlowDoc, after0: FlowDoc): FlowDoc {
  const out = structuredClone(raw);
  const after = structuredClone(after0);
  const vs = out.versions!;
  const k = vIdx(out, effectiveVersion(out, vid));
  const V = vs[k].id;
  out.service = after.service;

  // ---- 씬 id 충돌 정리
  Object.keys(after.scenes).forEach(id => {
    if (before.scenes[id] || !out.scenes[id]) return;
    let n = 2;
    while (out.scenes[id + '_' + n] || after.scenes[id + '_' + n]) n++;
    renameScene(after, id, id + '_' + n);
  });

  // ---- 씬
  const ids = new Set([...Object.keys(before.scenes), ...Object.keys(after.scenes)]);
  ids.forEach(id => {
    const b = before.scenes[id], a = after.scenes[id];
    if (a && !b) {
      out.scenes[id] = k === 0 ? pickFields(a) : { ...pickFields(a), since: V };
      return;
    }
    const s = out.scenes[id];
    if (!s) return;
    const si = sinceIdx(out, s);
    if (b && !a) {
      if (si === k) delete out.scenes[id];
      else { s.rev = s.rev || {}; s.rev[V] = { removed: true }; }
      return;
    }
    if (same(pickFields(b), pickFields(a))) return;
    if (si === k) {
      FIELDS.forEach(f => { (s as any)[f] = (pickFields(a) as any)[f]; });
      return;
    }
    const inh = sceneAt(raw, id, k - 1);
    const pa = pickFields(a);
    const diff: SceneRev = {};
    FIELDS.forEach(f => {
      if (!inh || !same((inh as any)[f], (pa as any)[f])) (diff as any)[f] = (pa as any)[f];
    });
    s.rev = s.rev || {};
    if (Object.keys(diff).length) s.rev[V] = diff;
    else delete s.rev[V];
    if (!Object.keys(s.rev).length) delete s.rev;
  });

  // ---- 탭·Branch·배치
  if (k === 0) {
    out.tabs = after.tabs;
    out.flows = after.flows;
    if (after.layout && Object.keys(after.layout).length) out.layout = after.layout;
    else delete out.layout;
    return out;
  }
  const bT = structsOf(before), aT = structsOf(after);
  out.versionTabs = out.versionTabs || {};
  const ov = (out.versionTabs[V] = out.versionTabs[V] || {});
  new Set([...Object.keys(bT), ...Object.keys(aT)]).forEach(tid => {
    if (same(bT[tid], aT[tid])) return;
    const inh = tabStructAt(raw, tid, k - 1);
    const a = aT[tid];
    if (!a) {
      if (inh) ov[tid] = { removed: true };
      else delete ov[tid];
    } else if (inh && same(a, inh)) {
      delete ov[tid];
    } else {
      ov[tid] = { tab: a.tab, flows: a.flows, ...(a.layout ? { layout: a.layout } : {}) };
    }
  });
  if (!Object.keys(ov).length) delete out.versionTabs[V];
  if (!Object.keys(out.versionTabs).length) delete out.versionTabs;

  const natural = tabOrderAt(out, k, k).filter(t => aT[t]);
  const want = after.tabs.map(t => t.id);
  if (same(natural, want)) delete vs[k].tabOrder;
  else vs[k].tabOrder = want;
  return out;
}

/* ---------- 버전 메타 (배지·diff 오버레이용) ---------- */

export type VerStatus = 'new' | 'changed' | 'same';

export interface VersionMeta {
  enabled: boolean;
  versions: Version[];
  cur: string | null;
  idx: number;
  prev: Version | null;
  /** 현재 버전의 각 씬: 직전 대비 상태 + 지금 정의가 마지막으로 바뀐 버전 */
  scene: Record<string, { status: VerStatus; from: string }>;
  tab: Record<string, { status: VerStatus; from: string }>;
  /** 직전 버전엔 있었는데 이 버전에서 사라진 것 */
  removedScenes: { id: string; title: string }[];
  removedTabs: { id: string; title: string }[];
}

export const EMPTY_META: VersionMeta = {
  enabled: false, versions: [], cur: null, idx: -1, prev: null,
  scene: {}, tab: {}, removedScenes: [], removedTabs: []
};

export function versionMeta(raw: FlowDoc | null, vid: string | null): VersionMeta {
  if (!raw || !hasVersions(raw)) return EMPTY_META;
  const vs = raw.versions!;
  const cur = effectiveVersion(raw, vid)!;
  const k = vIdx(raw, cur);
  const meta: VersionMeta = {
    enabled: true, versions: vs, cur, idx: k, prev: k > 0 ? vs[k - 1] : null,
    scene: {}, tab: {}, removedScenes: [], removedTabs: []
  };
  Object.keys(raw.scenes).forEach(id => {
    const now = sceneAt(raw, id, k);
    const before = sceneAt(raw, id, k - 1);
    if (now) {
      // 지금 정의가 마지막으로 바뀐 버전 = 정의가 직전 버전과 달라진 가장 최근 인덱스
      let from = 0;
      for (let i = k; i >= 1; i--) {
        if (!same(sceneAt(raw, id, i), sceneAt(raw, id, i - 1))) { from = i; break; }
      }
      meta.scene[id] = {
        status: k > 0 && !before ? 'new' : k > 0 && !same(now, before) ? 'changed' : 'same',
        from: vs[from].id
      };
    } else if (before) {
      meta.removedScenes.push({ id, title: before.title || id });
    }
  });
  const tidsNow = tabOrderAt(raw, k);
  const tidsPrev = k > 0 ? tabOrderAt(raw, k - 1) : [];
  tidsNow.forEach(tid => {
    const now = tabStructAt(raw, tid, k);
    if (!now) return;
    const before = k > 0 ? tabStructAt(raw, tid, k - 1) : null;
    let from = 0;
    for (let i = k; i >= 1; i--) {
      if (!same(tabStructAt(raw, tid, i), tabStructAt(raw, tid, i - 1))) { from = i; break; }
    }
    meta.tab[tid] = {
      status: k > 0 && !before ? 'new' : k > 0 && !same(now, before) ? 'changed' : 'same',
      from: vs[from].id
    };
  });
  tidsPrev.forEach(tid => {
    if (meta.tab[tid]) return;
    const before = tabStructAt(raw, tid, k - 1);
    if (before) meta.removedTabs.push({ id: tid, title: before.tab.title || tid });
  });
  return meta;
}

/* ---------- 버전 관리 조작 (raw 직접 변경) ---------- */

/** 버전 관리 시작 — 지금 문서를 기준 버전으로 */
export function startVersioning(raw: FlowDoc, base: Version, next?: Version) {
  raw.versions = [base, ...(next ? [next] : [])];
}

export function addVersion(raw: FlowDoc, v: Version) {
  raw.versions = [...(raw.versions || []), v];
}

/** 마지막 버전 삭제 — 그 버전의 기록(신규 씬·씬 변경·탭 구조)을 함께 지운다 */
export function deleteLastVersion(raw: FlowDoc) {
  const vs = raw.versions || [];
  if (vs.length < 2) return;
  const V = vs[vs.length - 1].id;
  Object.keys(raw.scenes).forEach(id => {
    const s = raw.scenes[id];
    if (s.since === V) { delete raw.scenes[id]; return; }
    if (s.rev) { delete s.rev[V]; if (!Object.keys(s.rev).length) delete s.rev; }
  });
  if (raw.versionTabs) {
    delete raw.versionTabs[V];
    if (!Object.keys(raw.versionTabs).length) delete raw.versionTabs;
  }
  raw.versions = vs.slice(0, -1);
}

/** 버전 관리 해제 — 기준 버전 하나만 남았을 때, 버전 필드를 걷어낸 평범한 문서로 */
export function stopVersioning(raw: FlowDoc): FlowDoc {
  const flat = resolve(raw, raw.versions?.[0]?.id || null);
  return structuredClone(flat);
}

/** 이 버전에서의 씬 변경을 되돌려 직전 버전 것을 상속 */
export function revertScene(raw: FlowDoc, vid: string, id: string) {
  const s = raw.scenes[id];
  if (!s || !s.rev) return;
  delete s.rev[vid];
  if (!Object.keys(s.rev).length) delete s.rev;
}

/** 이 버전에서의 탭 구조 변경을 되돌려 직전 버전 것을 상속 */
export function revertTab(raw: FlowDoc, vid: string, tid: string) {
  const ov = raw.versionTabs?.[vid];
  if (!ov) return;
  delete ov[tid];
  if (!Object.keys(ov).length) delete raw.versionTabs![vid];
  if (raw.versionTabs && !Object.keys(raw.versionTabs).length) delete raw.versionTabs;
}

/** 다음 버전 id 제안 — 마지막 숫자를 1 올린다 (1.0 → 1.1, v2 → v3) */
export function suggestNextId(vs: Version[]): string {
  const last = vs.length ? vs[vs.length - 1].id : '1.0';
  const m = last.match(/^(.*?)(\d+)$/);
  if (!m) return last + '.1';
  let id = m[1] + (Number(m[2]) + 1);
  while (vs.some(v => v.id === id)) id = id + '.1';
  return id;
}
