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
