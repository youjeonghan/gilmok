/* 버전 레이어 — flow.json v4 (v0.9.0: 브랜치 트리)
 *
 * 버전은 git처럼 트리다. 각 버전은 parent(부모 버전 id)를 가지며, 첫 항목(versions[0])이 루트 = 기준 버전.
 *   - parent가 없는 구 문서(v0.8 일자형)는 "배열의 바로 앞 버전"을 부모로 본다 → 그대로 선형 체인.
 *   - 어떤 버전이든 부모로 골라 새 버전을 만들 수 있다 → 한 부모에 자식이 여럿 = 브랜치.
 *
 * 저장 형태(raw): 최상위 scenes/tabs/flows/layout = 기준 버전(루트).
 *   - 씬: rev[버전] = 그 버전에서 바뀐 필드만 / { removed: true } = 그 버전에서 삭제
 *         since = 그 버전에서 새로 생긴 씬(최상위 필드가 그 버전 정의) — 그 버전의 자손에서만 보인다
 *   - 탭: versionTabs[버전][탭] = 그 버전에서 바뀐 탭 구조 통째(탭·Branch·배치) / { removed: true }
 *   - 탭 순서: versions[i].tabOrder (상속 순서와 다를 때만)
 * 해석 규칙: "루트 → 선택 버전 경로(체인) 위에서 가장 최근 정의를 쓴다" — 다른 브랜치의 기록은 보이지 않는다.
 *
 * 화면은 resolve()가 만든 평범한 FlowDoc만 다루고, 편집 결과는 absorb()가 부모 체인과 비교해
 * 달라진 씬·탭만 현재 버전 레이어에 기록한다(탭은 copy-on-write).
 * 비교(diff)는 부모가 기본이지만 아무 버전이나 기준(base)으로 지정할 수 있다 — versionMeta(raw, cur, base). */
import type { FlowDoc, Scene, Tab, FlowLane, TabLayout } from './types';

export interface Version {
  id: string;
  title?: string;
  date?: string;
  note?: string;
  /** 부모 버전 id — 없으면 배열의 바로 앞 버전(구 일자형 호환). 루트(versions[0])는 무시 */
  parent?: string;
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

/* ---------- 트리 ---------- */

/** 부모 버전 id (루트면 null) — parent가 없거나 잘못됐으면 배열의 바로 앞 버전 */
export function parentOf(raw: FlowDoc, vid: string): string | null {
  const vs = raw.versions || [];
  const i = vIdx(raw, vid);
  if (i <= 0) return null;
  const p = vs[i].parent;
  // 부모는 반드시 배열에서 앞에 있어야 한다(순환 방지) — 아니면 일자형 폴백
  if (p && p !== vid) {
    const pi = vIdx(raw, p);
    if (pi >= 0 && pi < i) return p;
  }
  return vs[i - 1].id;
}

/** 루트 → vid 경로 (버전 id 배열). 모르는 버전이면 [] */
export function chainOf(raw: FlowDoc, vid: string | null | undefined): string[] {
  if (vIdx(raw, vid) < 0) return [];
  const out: string[] = [];
  let cur: string | null = vid as string;
  while (cur && out.length <= (raw.versions || []).length) {
    out.unshift(cur);
    cur = parentOf(raw, cur);
  }
  return out;
}

export function childrenOf(raw: FlowDoc, vid: string): string[] {
  return (raw.versions || []).filter(v => v.id !== vid && parentOf(raw, v.id) === vid).map(v => v.id);
}

/** 트리를 깊이 우선으로 펼친 목록 — 메뉴 표시용 (depth = 들여쓰기, last = 형제 중 마지막) */
export function treeRows(raw: FlowDoc): { v: Version; depth: number; guides: boolean[]; last: boolean }[] {
  const vs = raw.versions || [];
  if (!vs.length) return [];
  const rows: { v: Version; depth: number; guides: boolean[]; last: boolean }[] = [];
  const walk = (id: string, depth: number, guides: boolean[], last: boolean) => {
    const v = vs.find(x => x.id === id)!;
    rows.push({ v, depth, guides, last });
    const kids = childrenOf(raw, id);
    kids.forEach((k, i) => walk(k, depth + 1, [...guides, !last], i === kids.length - 1));
  };
  walk(vs[0].id, 0, [], true);
  return rows;
}

/** 공통 조상 (두 체인이 마지막으로 겹치는 버전) */
export function commonAncestor(raw: FlowDoc, a: string, b: string): string | null {
  const ca = chainOf(raw, a), cb = new Set(chainOf(raw, b));
  for (let i = ca.length - 1; i >= 0; i--) if (cb.has(ca[i])) return ca[i];
  return null;
}

/* ---------- 해석 ---------- */

/** 씬이 처음 생긴 버전 — 없거나 모르는 버전이면 루트 */
const sinceOf = (raw: FlowDoc, s: Scene): string => {
  const vs = raw.versions || [];
  if (s.since && vIdx(raw, s.since) >= 0) return s.since;
  return vs.length ? vs[0].id : '';
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

/** 체인 끝 버전에서의 씬 (없으면 null) */
export function sceneOn(raw: FlowDoc, id: string, chain: string[]): Scene | null {
  const s = raw.scenes[id];
  if (!s || !chain.length) return null;
  if (!hasVersions(raw)) return pickFields(s);
  const si = chain.indexOf(sinceOf(raw, s));
  if (si < 0) return null; // 다른 브랜치에서 생긴 씬
  const cur = pickFields(s);
  let alive = true;
  for (let i = si; i < chain.length; i++) {
    const r = s.rev?.[chain[i]];
    if (!r) continue;
    if (r.removed) { alive = false; continue; }
    alive = true;
    FIELDS.forEach(f => {
      if (r[f] !== undefined) (cur as any)[f] = f === 'themes' ? { ...(r.themes || {}) } : r[f];
    });
  }
  return alive ? cur : null;
}

/** 버전 vid에서의 씬 (없으면 null) */
export const sceneAt = (raw: FlowDoc, id: string, vid: string | null): Scene | null =>
  sceneOn(raw, id, chainOf(raw, vid));

const cleanLayout = (l?: TabLayout): TabLayout | undefined =>
  l && l.offsets && Object.keys(l.offsets).length ? l : undefined;

const normFlow = (f: FlowLane): FlowLane => ({ ...f, brackets: f.brackets || [], note: f.note || '' });

/** 체인 끝 버전에서의 탭 구조 (없으면 null) */
function tabStructOn(raw: FlowDoc, tid: string, chain: string[]): TabStruct | null {
  if (!chain.length) return null;
  for (let i = chain.length - 1; i >= 1; i--) {
    const o = raw.versionTabs?.[chain[i]]?.[tid];
    if (!o) continue;
    if (o.removed) return null;
    const baseTab = raw.tabs.find(t => t.id === tid);
    return {
      tab: o.tab || baseTab || { id: tid, title: tid, start: null },
      flows: (o.flows || []).map(normFlow),
      layout: cleanLayout(o.layout)
    };
  }
  const t = raw.tabs.find(x => x.id === tid);
  if (!t) return null;
  return {
    tab: t,
    flows: raw.flows.filter(f => f.tab === tid).map(normFlow),
    layout: cleanLayout(raw.layout?.[tid])
  };
}

/** 체인 끝 버전의 탭 순서 (skipLastOrder = 체인 끝 버전의 tabOrder는 무시 — 상속 순서 계산용) */
function tabOrderOn(raw: FlowDoc, chain: string[], skipLastOrder = false): string[] {
  let order = raw.tabs.map(t => t.id);
  for (let i = 1; i < chain.length; i++) {
    const ov = raw.versionTabs?.[chain[i]] || {};
    Object.keys(ov).forEach(tid => { if (!order.includes(tid)) order.push(tid); });
    const to = raw.versions!.find(v => v.id === chain[i])?.tabOrder;
    if (to && !(skipLastOrder && i === chain.length - 1)) {
      order = [...to.filter(t => order.includes(t)), ...order.filter(t => !to.includes(t))];
    }
  }
  return order;
}

function docOn(raw: FlowDoc, chain: string[]): FlowDoc {
  const scenes: Record<string, Scene> = {};
  Object.keys(raw.scenes).forEach(id => {
    const s = sceneOn(raw, id, chain);
    if (s) scenes[id] = s;
  });
  if (chain.length <= 1) {
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
  tabOrderOn(raw, chain).forEach(tid => {
    const st = tabStructOn(raw, tid, chain);
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
  return docOn(raw, chainOf(raw, effectiveVersion(raw, vid)));
}

/* ---------- 편집 결과 → 현재 버전 레이어에 기록 ---------- */

function structsOf(d: FlowDoc): Record<string, TabStruct> {
  const m: Record<string, TabStruct> = {};
  d.tabs.forEach(t => {
    m[t.id] = { tab: t, flows: d.flows.filter(f => f.tab === t.id).map(normFlow), layout: cleanLayout(d.layout?.[t.id]) };
  });
  return m;
}

/** 새 씬 id가 다른 버전(브랜치)에만 있는 씬과 겹치면 새 id로 바꾸고 참조도 함께 바꾼다 */
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
  const V = effectiveVersion(out, vid)!;
  const chain = chainOf(out, V);
  const pchain = chain.slice(0, -1);
  const isRoot = chain.length <= 1;
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
      out.scenes[id] = isRoot ? pickFields(a) : { ...pickFields(a), since: V };
      return;
    }
    const s = out.scenes[id];
    if (!s) return;
    const own = sinceOf(out, s) === V; // 이 버전에서 태어난 씬 — 최상위 필드가 곧 이 버전 정의
    if (b && !a) {
      if (own) delete out.scenes[id];
      else { s.rev = s.rev || {}; s.rev[V] = { removed: true }; }
      return;
    }
    if (same(pickFields(b), pickFields(a))) return;
    if (own) {
      FIELDS.forEach(f => { (s as any)[f] = (pickFields(a) as any)[f]; });
      return;
    }
    const inh = sceneOn(raw, id, pchain);
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
  if (isRoot) {
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
    const inh = tabStructOn(raw, tid, pchain);
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

  const natural = tabOrderOn(out, chain, true).filter(t => aT[t]);
  const want = after.tabs.map(t => t.id);
  const vr = out.versions!.find(v => v.id === V)!;
  if (same(natural, want)) delete vr.tabOrder;
  else vr.tabOrder = want;
  return out;
}

/* ---------- 버전 메타 (배지·diff 오버레이용) ---------- */

export type VerStatus = 'new' | 'changed' | 'same';

export interface SceneVerInfo {
  /** 비교 기준(base) 대비 상태 — diff 오버레이 */
  status: VerStatus;
  /** 부모 대비 상태 — 이 버전에서 정의했는지(상속 오버레이·되돌리기) */
  own: VerStatus;
  /** 지금 정의가 마지막으로 바뀐 버전 (체인 위) */
  from: string;
}

export interface VersionMeta {
  enabled: boolean;
  versions: Version[];
  cur: string | null;
  /** 루트로부터의 깊이 (루트 = 0) */
  depth: number;
  chain: string[];
  parent: Version | null;
  /** 비교 기준 버전 — 지정 안 하면 부모. 루트에서 지정 안 하면 null */
  base: Version | null;
  /** 기준을 사용자가 직접 골랐는지 (부모가 아닌 버전) */
  baseCustom: boolean;
  scene: Record<string, SceneVerInfo>;
  tab: Record<string, SceneVerInfo>;
  /** 기준 버전엔 있었는데 이 버전엔 없는 것 */
  removedScenes: { id: string; title: string }[];
  removedTabs: { id: string; title: string }[];
}

export const EMPTY_META: VersionMeta = {
  enabled: false, versions: [], cur: null, depth: 0, chain: [], parent: null, base: null, baseCustom: false,
  scene: {}, tab: {}, removedScenes: [], removedTabs: []
};

export function versionMeta(raw: FlowDoc | null, vid: string | null, baseVid?: string | null): VersionMeta {
  if (!raw || !hasVersions(raw)) return EMPTY_META;
  const vs = raw.versions!;
  const cur = effectiveVersion(raw, vid)!;
  const chain = chainOf(raw, cur);
  const pid = parentOf(raw, cur);
  const custom = !!baseVid && baseVid !== cur && vIdx(raw, baseVid) >= 0 && baseVid !== pid;
  const bid = custom ? baseVid! : pid;
  const find = (id: string | null) => (id ? vs.find(v => v.id === id) || null : null);
  const meta: VersionMeta = {
    enabled: true, versions: vs, cur, depth: chain.length - 1, chain,
    parent: find(pid), base: find(bid), baseCustom: custom,
    scene: {}, tab: {}, removedScenes: [], removedTabs: []
  };
  const bchain = bid ? chainOf(raw, bid) : [];
  const pchain = chain.slice(0, -1);
  const st = (now: unknown, before: unknown, has: boolean): VerStatus =>
    !has ? 'same' : !before ? 'new' : !same(now, before) ? 'changed' : 'same';

  Object.keys(raw.scenes).forEach(id => {
    const now = sceneOn(raw, id, chain);
    const before = bchain.length ? sceneOn(raw, id, bchain) : null;
    if (now) {
      const par = pchain.length ? sceneOn(raw, id, pchain) : null;
      // 지금 정의가 마지막으로 바뀐 버전 = 체인 위에서 정의가 바로 앞과 달라진 가장 최근 지점
      let from = chain[0];
      for (let i = chain.length - 1; i >= 1; i--) {
        if (!same(sceneOn(raw, id, chain.slice(0, i + 1)), sceneOn(raw, id, chain.slice(0, i)))) { from = chain[i]; break; }
      }
      meta.scene[id] = { status: st(now, before, !!bchain.length), own: st(now, par, !!pchain.length), from };
    } else if (before) {
      meta.removedScenes.push({ id, title: before.title || id });
    }
  });
  const tidsNow = tabOrderOn(raw, chain);
  const tidsBase = bchain.length ? tabOrderOn(raw, bchain) : [];
  tidsNow.forEach(tid => {
    const now = tabStructOn(raw, tid, chain);
    if (!now) return;
    const before = bchain.length ? tabStructOn(raw, tid, bchain) : null;
    const par = pchain.length ? tabStructOn(raw, tid, pchain) : null;
    let from = chain[0];
    for (let i = chain.length - 1; i >= 1; i--) {
      if (!same(tabStructOn(raw, tid, chain.slice(0, i + 1)), tabStructOn(raw, tid, chain.slice(0, i)))) { from = chain[i]; break; }
    }
    meta.tab[tid] = { status: st(now, before, !!bchain.length), own: st(now, par, !!pchain.length), from };
  });
  tidsBase.forEach(tid => {
    if (meta.tab[tid]) return;
    const before = tabStructOn(raw, tid, bchain);
    if (before) meta.removedTabs.push({ id: tid, title: before.tab.title || tid });
  });
  return meta;
}

/* ---------- 버전 관리 조작 (raw 직접 변경) ---------- */

/** 버전 관리 시작 — 지금 문서를 기준 버전으로 */
export function startVersioning(raw: FlowDoc, base: Version, next?: Version) {
  raw.versions = [base, ...(next ? [{ ...next, parent: base.id }] : [])];
}

/** 새 버전 — parent를 지정하면 그 버전에서 갈라진다(브랜치). 없으면 마지막 버전 위에 */
export function addVersion(raw: FlowDoc, v: Version) {
  const vs = raw.versions || [];
  const parent = v.parent && vs.some(x => x.id === v.parent) ? v.parent : vs.length ? vs[vs.length - 1].id : undefined;
  raw.versions = [...vs, { ...v, ...(parent ? { parent } : {}) }];
}

/** 구 일자형 문서의 암묵적 부모를 parent 필드로 굳힌다 — 버전을 지우거나 끼워 넣어도 트리가 유지되게 */
export function pinParents(raw: FlowDoc) {
  (raw.versions || []).forEach((v, i) => {
    if (i === 0) { delete v.parent; return; }
    v.parent = parentOf(raw, v.id)!;
  });
}

/** 버전 삭제 — 자식이 없는 버전(가지 끝)만. 그 버전의 기록(신규 씬·씬 변경·탭 구조)을 함께 지운다 */
export function deleteVersion(raw: FlowDoc, V: string): boolean {
  const vs = raw.versions || [];
  const i = vIdx(raw, V);
  if (i <= 0 || childrenOf(raw, V).length) return false;
  pinParents(raw);
  Object.keys(raw.scenes).forEach(id => {
    const s = raw.scenes[id];
    if (s.since === V) { delete raw.scenes[id]; return; }
    if (s.rev) { delete s.rev[V]; if (!Object.keys(s.rev).length) delete s.rev; }
  });
  if (raw.versionTabs) {
    delete raw.versionTabs[V];
    if (!Object.keys(raw.versionTabs).length) delete raw.versionTabs;
  }
  raw.versions = vs.filter(v => v.id !== V);
  return true;
}

/** 마지막 버전 삭제 (구 API 호환) */
export function deleteLastVersion(raw: FlowDoc) {
  const vs = raw.versions || [];
  if (vs.length >= 2) deleteVersion(raw, vs[vs.length - 1].id);
}

/** 버전 관리 해제 — 기준 버전 하나만 남았을 때, 버전 필드를 걷어낸 평범한 문서로 */
export function stopVersioning(raw: FlowDoc): FlowDoc {
  const flat = resolve(raw, raw.versions?.[0]?.id || null);
  return structuredClone(flat);
}

/** 이 버전에서의 씬 변경을 되돌려 부모 버전 것을 상속 */
export function revertScene(raw: FlowDoc, vid: string, id: string) {
  const s = raw.scenes[id];
  if (!s || !s.rev) return;
  delete s.rev[vid];
  if (!Object.keys(s.rev).length) delete s.rev;
}

/** 이 버전에서의 탭 구조 변경을 되돌려 부모 버전 것을 상속 */
export function revertTab(raw: FlowDoc, vid: string, tid: string) {
  const ov = raw.versionTabs?.[vid];
  if (!ov) return;
  delete ov[tid];
  if (!Object.keys(ov).length) delete raw.versionTabs![vid];
  if (raw.versionTabs && !Object.keys(raw.versionTabs).length) delete raw.versionTabs;
}

/** 다음 버전 id 제안 — 부모가 가지 끝이면 마지막 숫자 +1 (1.0 → 1.1), 이미 자식이 있으면 갈래 번호 (1.0 → 1.0.1) */
export function suggestNextId(vs: Version[], parent?: string, raw?: FlowDoc): string {
  const taken = (id: string) => vs.some(v => v.id === id);
  const p = parent || (vs.length ? vs[vs.length - 1].id : '1.0');
  const hasKids = raw ? childrenOf(raw, p).length > 0 : false;
  if (hasKids) {
    let n = 1;
    while (taken(p + '.' + n)) n++;
    return p + '.' + n;
  }
  const m = p.match(/^(.*?)(\d+)$/);
  if (!m) { let n = 1; while (taken(p + '.' + n)) n++; return p + '.' + n; }
  let id = m[1] + (Number(m[2]) + 1);
  while (taken(id)) id = id + '.1';
  return id;
}

/** 비교 넘김 순서 — 현재 문서의 플로우 등장 순서(탭 시작 → Branch seq) → 나머지 → 기준에만 있던(삭제) 씬 */
export function diffOrder(doc: FlowDoc, m: VersionMeta): string[] {
  const seen: string[] = [];
  const add = (id: string | null | undefined) => { if (id && !seen.includes(id)) seen.push(id); };
  doc.tabs.forEach(t => {
    add(t.start);
    doc.flows.filter(f => f.tab === t.id).forEach(f => { add(f.from); f.seq.forEach(add); });
  });
  Object.keys(doc.scenes).forEach(add);
  const changed = seen.filter(id => m.scene[id] && m.scene[id].status !== 'same');
  return [...changed, ...m.removedScenes.map(s => s.id)];
}

/* ---------- 정본(루트) 승격 — v0.10.0 ----------
 * 고른 버전을 트리의 새 루트(정본)로 다시 세운다(re-root). git으로 치면 그 갈래를 main으로 삼는 것.
 *   - 모든 버전의 해석 결과(화면에 보이는 플로우)는 그대로다. 바뀌는 건 부모-자식 방향뿐:
 *     루트 → … → V 경로가 뒤집혀 V가 루트, 옛 루트는 경로를 따라 V의 자손이 된다. 다른 갈래는 붙어 있던 버전 아래 그대로.
 *   - 방법: 버전별 해석본을 스냅샷으로 떠 두고, 새 트리 기준으로 다시 인코딩(최상위 = V, 나머지는 부모 대비 차이만)
 *   - 인코딩 후 모든 버전을 다시 해석해 스냅샷과 같은지 검증한다. 하나라도 다르면 원본을 건드리지 않고 실패를 돌려준다. */

/** 비교용 정규형 — 흐름은 탭 순서로 묶고, 빈 배치는 제거 */
function canon(d: FlowDoc) {
  const tabs = d.tabs.map(t => ({ id: t.id, title: t.title, start: t.start }));
  const flows = tabs.flatMap(t => d.flows.filter(f => f.tab === t.id).map(normFlow));
  const layout: Record<string, TabLayout> = {};
  tabs.forEach(t => { const l = cleanLayout(d.layout?.[t.id]); if (l) layout[t.id] = l; });
  const scenes: Record<string, Scene> = {};
  Object.keys(d.scenes).sort().forEach(id => { scenes[id] = pickFields(d.scenes[id]); });
  return JSON.stringify({ tabs, flows, layout, scenes });
}

export interface PromoteResult { ok: boolean; raw?: FlowDoc; error?: string }

export function promoteVersion(raw0: FlowDoc, V: string): PromoteResult {
  const vs0 = raw0.versions || [];
  if (!vs0.length || vIdx(raw0, V) < 0) return { ok: false, error: '버전을 찾을 수 없어요.' };
  if (vs0[0].id === V) return { ok: false, error: '이미 정본(기준) 버전이에요.' };

  // 1) 스냅샷 — 버전별 해석본
  const snap: Record<string, FlowDoc> = {};
  vs0.forEach(v => { snap[v.id] = docOn(raw0, chainOf(raw0, v.id)); });

  // 2) 새 트리 — 무방향 트리를 V에서 다시 매단다
  const adj: Record<string, string[]> = {};
  vs0.forEach(v => { adj[v.id] = []; });
  vs0.forEach(v => { const p = parentOf(raw0, v.id); if (p) { adj[v.id].push(p); adj[p].push(v.id); } });
  const par: Record<string, string | null> = { [V]: null };
  const order: string[] = [];
  const q = [V];
  while (q.length) {
    const x = q.shift()!;
    order.push(x);
    // 원래 배열 순서를 따라 자식 순서를 안정적으로
    adj[x].slice().sort((a, b) => vIdx(raw0, a) - vIdx(raw0, b)).forEach(y => {
      if (y in par) return;
      par[y] = x; q.push(y);
    });
  }
  const chainN = (id: string) => { const c: string[] = []; let x: string | null = id; while (x) { c.unshift(x); x = par[x]; } return c; };
  const depth = (id: string) => chainN(id).length - 1;

  // 3) 최상위 = V
  const R = snap[V];
  const out: FlowDoc = {
    version: raw0.version, service: raw0.service,
    tabs: structuredClone(R.tabs), flows: structuredClone(R.flows), scenes: {},
    ...(R.layout && Object.keys(R.layout).length ? { layout: structuredClone(R.layout) } : {})
  } as FlowDoc;
  out.versions = order.map(id => {
    const v = structuredClone(vs0.find(x => x.id === id)!);
    delete v.parent; delete v.tabOrder;
    if (par[id]) v.parent = par[id]!;
    return v;
  });

  // 4) 씬 — 태어난 버전(존재하는 버전들 중 가장 위) + 부모 대비 차이
  const allIds = new Set<string>();
  order.forEach(v => Object.keys(snap[v].scenes).forEach(id => allIds.add(id)));
  for (const id of allIds) {
    const E = order.filter(v => snap[v].scenes[id]);
    const B = E.slice().sort((a, b) => depth(a) - depth(b))[0];
    const bad = E.find(v => !chainN(v).includes(B));
    if (bad) return { ok: false, error: `Scene 「${snap[bad].scenes[id].title || id}」이(가) 서로 떨어진 갈래(v${B}, v${bad})에 따로 있어 새 트리로 옮길 수 없어요.` };
    const s: Scene = { ...pickFields(snap[B].scenes[id]) };
    if (B !== V) s.since = B;
    const rev: Record<string, SceneRev> = {};
    order.forEach(v => {
      if (v === B || !chainN(v).includes(B)) return;
      const now = snap[v].scenes[id] ? pickFields(snap[v].scenes[id]) : null;
      const p = par[v]!;
      const prev = snap[p].scenes[id] ? pickFields(snap[p].scenes[id]) : null;
      if (!now && !prev) return;
      if (!now) { rev[v] = { removed: true }; return; }
      const d: SceneRev = {};
      FIELDS.forEach(f => { if (!prev || !same((prev as any)[f], (now as any)[f])) (d as any)[f] = (now as any)[f]; });
      if (Object.keys(d).length) rev[v] = d;
    });
    if (Object.keys(rev).length) s.rev = rev;
    out.scenes[id] = s;
  }

  // 5) 탭 구조 — 부모 대비 달라진 탭만 통째로 (copy-on-write와 같은 형태)
  const vt: Record<string, Record<string, TabOverride>> = {};
  order.forEach(v => {
    if (v === V) return;
    const a = structsOf(snap[v]), b = structsOf(snap[par[v]!]);
    const ov: Record<string, TabOverride> = {};
    new Set([...Object.keys(a), ...Object.keys(b)]).forEach(tid => {
      if (same(a[tid], b[tid])) return;
      if (!a[tid]) ov[tid] = { removed: true };
      else ov[tid] = { tab: a[tid].tab, flows: a[tid].flows, ...(a[tid].layout ? { layout: a[tid].layout } : {}) };
    });
    if (Object.keys(ov).length) vt[v] = ov;
  });
  if (Object.keys(vt).length) out.versionTabs = vt;

  // 6) 탭 순서 — 위에서부터 차례로 (부모의 tabOrder가 먼저 정해져야 자식의 자연 순서를 계산할 수 있다)
  order.forEach(v => {
    if (v === V) return;
    const chain = chainN(v);
    const want = snap[v].tabs.map(t => t.id);
    const natural = tabOrderOn(out, chain, true).filter(t => want.includes(t));
    if (!same(natural, want)) out.versions!.find(x => x.id === v)!.tabOrder = want;
  });

  // 7) 검증 — 모든 버전이 승격 전과 똑같이 보이는지
  for (const v of order) {
    if (canon(docOn(out, chainOf(out, v))) !== canon(snap[v])) {
      return { ok: false, error: `검증 실패 — v${v}가 승격 전과 다르게 보여요. 원본은 그대로 두었어요.` };
    }
  }
  return { ok: true, raw: out };
}

/* ---------- 버전 그래프 (git 브랜치 GUI 형태) ---------- */

export interface GraphRow {
  v: Version;
  /** 레인(세로 줄) 번호 — 첫 자식은 부모 레인을 잇고, 둘째 자식부터 새 레인 */
  lane: number;
  parent: string | null;
  parentLane: number | null;
  depth: number;
  children: number;
}

/** 위에서부터 최신 순(배열 뒤쪽이 위)으로 그릴 행과 레인 */
export function graphRows(raw: FlowDoc): { rows: GraphRow[]; lanes: number } {
  const vs = raw.versions || [];
  const lane: Record<string, number> = {};
  let next = 0;
  vs.forEach((v, i) => {
    const p = i === 0 ? null : parentOf(raw, v.id);
    if (!p) { lane[v.id] = next++; return; }
    const sib = childrenOf(raw, p);
    lane[v.id] = sib[0] === v.id ? lane[p] : next++;
  });
  const rows = vs.map((v, i) => {
    const p = i === 0 ? null : parentOf(raw, v.id);
    return { v, lane: lane[v.id], parent: p, parentLane: p ? lane[p] : null, depth: chainOf(raw, v.id).length - 1, children: childrenOf(raw, v.id).length };
  }).reverse();
  return { rows, lanes: next };
}
