import type { ServerInfo } from './types';

export async function fetchHealth(): Promise<ServerInfo | null> {
  try {
    const r = await fetch('api/health');
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

export const postFlow = (body: string) =>
  fetch('api/flow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body
  });

export const pickFolder = async (): Promise<{ ok: boolean; dataDir?: string }> =>
  (await fetch('api/pick-folder', { method: 'POST' })).json();

export const useFolder = async (dir: string): Promise<{ ok: boolean; dataDir?: string; error?: string }> =>
  (await fetch('api/use-folder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dir })
  })).json();

export type ProjectRef = { dir: string; name: string };

/** 앱 테마를 config.json에 영속 (fire-and-forget) — Go 서버 등 미지원 환경은 조용히 무시 */
export const saveAppTheme = (t: 'light' | 'dark') => {
  fetch('api/app-theme', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appTheme: t })
  }).catch(() => {});
};

/** 최근 목록(존재 검증됨) + 디스크에서 발견된 flow.json 프로젝트. Go 서버 등 미지원 환경은 null */
export const discoverProjects = async (): Promise<{ ok: boolean; recent: ProjectRef[]; found: ProjectRef[] } | null> => {
  try {
    const r = await fetch('api/discover', { method: 'POST' });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
};

export const newProject = async (name: string): Promise<{ ok: boolean; dataDir?: string; error?: string }> =>
  (await fetch('api/new-project', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  })).json();

export const installSkill = async (): Promise<{ ok: boolean; path?: string; error?: string }> =>
  (await fetch('api/install-skill', { method: 'POST' })).json();

export const openFolder = async (): Promise<{ ok: boolean }> =>
  (await fetch('api/open-folder', { method: 'POST' })).json();

export const updateCheck = async (): Promise<{
  ok: boolean; current?: string; latest?: string; hasUpdate?: boolean; error?: string;
}> => (await fetch('api/update-check', { method: 'POST' })).json();

export const updateDownload = async (): Promise<{ ok: boolean; path?: string; error?: string }> =>
  (await fetch('api/update-download', { method: 'POST' })).json();
