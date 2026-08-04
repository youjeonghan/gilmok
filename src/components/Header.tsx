/* 상단 헤더 — 서비스 브랜드 · 전체 테마 · 도구 버튼 · 탭 */
import React, { useEffect, useState } from 'react';
import { useStore } from '../store';
import { useActions } from '../actions';
import { useDialogs } from '../dialogs';
import { pickFolder, installSkill, updateCheck, updateDownload, openFolder } from '../api';

/** 우측 패널 토글 아이콘 (□| 레이아웃) */
function PanelIcon({ open }: { open: boolean }) {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16">
      <rect x="1.5" y="2.5" width="13" height="11" rx="2.5" fill="none"
        stroke="currentColor" strokeWidth="1.5" />
      <line x1="9.75" y1="2.5" x2="9.75" y2="13.5" stroke="currentColor" strokeWidth="1.5" />
      {open && <rect x="10.5" y="3.25" width="3.25" height="9.5" rx="1" fill="currentColor" opacity=".55" />}
    </svg>
  );
}

const VER = '7.2';
const APP_NAME = '길목'; // 저장소·실행파일명은 flow-map 유지, 표시 이름만 길목

/** 앱 로고 — 씬 카드 두 장을 ㄴ자 커넥터로 잇는 글리프 */
function AppLogo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flex: 'none' }}>
      <rect x="1.5" y="2.5" width="10" height="7.5" rx="2" fill="#E8563C" />
      <path d="M 5 10 V 16.5 Q 5 18.5 7 18.5 H 10.2" fill="none" stroke="#C9432C"
        strokeWidth="2" strokeLinecap="round" />
      <path d="M 10 16.2 L 12.6 18.5 L 10 20.8 Z" fill="#C9432C" />
      <rect x="13" y="14.5" width="9.5" height="7" rx="2" fill="#1F6E63" />
    </svg>
  );
}

export function Header() {
  const { doc, server, DATA, isServer, ui, setUI, appTheme, setAppTheme, activeTab, setActiveTab, commit, resetToFile, patchServer } = useStore();
  const acts = useActions();
  const dialogs = useDialogs();
  const [updState, setUpdState] = useState<'idle' | 'checking' | 'downloading'>('idle');

  const s = doc?.service || { name: '서비스', icon: '' };

  useEffect(() => {
    document.title = (s.name ? s.name + ' — ' : '') + APP_NAME;
  }, [s.name]);

  if (!doc) return null;

  const icon = (s.icon || '').trim();
  const iconIsImg = /\.(png|svg|jpe?g|webp|gif|ico)$/i.test(icon) || icon.includes('/');

  const openSettings = async () => {
    const hasUploaded = (s.icon || '').startsWith('data:');
    const r = await dialogs.ask('Settings', [
      {
        key: 'appTheme', label: 'App theme', type: 'select', value: appTheme,
        options: [{ label: 'Light', value: 'light' }, { label: 'Dark', value: 'dark' }]
      },
      { key: 'name', label: 'Project name', value: s.name || '' },
      {
        key: 'icon',
        label: 'Project icon — emoji or image path/URL' + (hasUploaded ? ' (current: uploaded image)' : ''),
        value: hasUploaded ? '' : (s.icon || ''), placeholder: '🧩 or icon.svg'
      },
      { key: 'iconFile', label: 'Or upload an image file (overrides the field above)', type: 'file', accept: 'image/*' },
      {
        key: 'designUrl', label: 'Claude Design project URL (scene deep links)',
        value: s.designUrl || '', placeholder: 'https://claude.ai/design/p/…'
      }
    ]);
    if (!r) return;
    if (r.appTheme === 'light' || r.appTheme === 'dark') setAppTheme(r.appTheme);
    let nextIcon: string = r.icon || '';
    if (r.iconFile) {
      nextIcon = await new Promise<string>(res => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result as string);
        fr.readAsDataURL(r.iconFile);
      });
    } else if (!r.icon && hasUploaded) {
      nextIcon = s.icon; // 파일 미선택 + 입력 비움 → 기존 업로드 유지
    }
    commit(d => { d.service = { name: r.name || 'Project', icon: nextIcon, designUrl: r.designUrl || '' }; });
  };

  const onUpdate = async () => {
    setUpdState('checking');
    try {
      const r = await updateCheck();
      setUpdState('idle');
      if (!r.ok) { await dialogs.askInfo('Update check failed: ' + (r.error || '')); return; }
      if (!r.hasUpdate) { await dialogs.askInfo('You are on the latest version (v' + r.current + ')'); return; }
      if (await dialogs.askConfirm('v' + r.latest + ' is available. Download now?\n(Update manually with the downloaded installer)')) {
        setUpdState('downloading');
        const d = await updateDownload();
        setUpdState('idle');
        if (d.ok) await dialogs.askInfo('Downloaded — run the installer to finish updating.\n' + d.path);
        else await dialogs.askInfo('Download failed: ' + (d.error || ''));
      }
    } catch (e: any) {
      setUpdState('idle');
      await dialogs.askInfo('Update check failed: ' + e.message);
    }
  };

  const onInstallSkill = async () => {
    try {
      const res = await installSkill();
      if (res.ok) {
        patchServer({ skillInstalled: true });
        await dialogs.askInfo('flow-sync skill installed — ' + res.path +
          '\nUse /flow-sync in Claude Code sessions for this project.');
      } else await dialogs.askInfo('Install failed: ' + (res.error || 'unknown error'));
    } catch (e: any) {
      await dialogs.askInfo('Install failed: ' + e.message);
    }
  };

  const cleanDoc = () => {
    const d = structuredClone(doc);
    return JSON.stringify(d, null, 2) + '\n';
  };

  return (
    <header className="top">
      <div className="brand">
        <span className="appname">
          <AppLogo />
          {APP_NAME} <span className="ver">v{server?.version || VER}</span>
        </span>
        <span className="brsep">—</span>
        <span className={'svc-icon' + (isServer ? ' click' : '')}
          title={isServer ? 'Open data folder' : undefined}
          onClick={() => { if (isServer) openFolder(); }}>
          {icon && (iconIsImg
            ? <img src={/^(https?:|data:)/.test(icon) ? icon : DATA + icon} alt="" />
            : icon)}
        </span>
        <em>{s.name || 'Project'}</em>
        <span className="gtheme" title="Global scene theme">
          {([['default', 'D'], ['light', 'L'], ['dark', 'N']] as const).map(([t, lb]) => (
            <span key={t}
              className={'tchip' + ((ui.globalTheme || 'default') === t ? ' on' : '')}
              title={'Switch all scenes to ' + t}
              onClick={() => setUI({ globalTheme: t, sceneTheme: {} })}>{lb}</span>
          ))}
        </span>
        <span className="info">
          <span className="i">i</span>
          <div className="tip">
            <b>View</b>
            <ul>
              <li>· Click a card = open the scene full-size</li>
              <li>· Tabs switch flows (All = every flow at once)</li>
              <li>· Wheel = pan · Ctrl+wheel = zoom · Space+drag = pan</li>
              <li>· Thumbnail top-right = theme (D/L/N) · ＋ adds a theme</li>
            </ul>
            <b>Edit</b>
            <ul>
              <li>· Drag a card = reorder (across branches too)</li>
              <li>· Shift+drag to select → right-click = make a bracket</li>
              <li>· Drag bracket handles = resize its range</li>
              <li>· Click a label or bracket name = rename in place</li>
              <li>· Drag a label = re-anchor the branch to another scene</li>
              <li>· ＋ = insert scene · hover ⑂ = new branch · Add note = memo</li>
            </ul>
            <b>Save</b>
            <ul>
              <li>· In the app, every edit autosaves to flow.json</li>
              <li>· On a static server, edits stay in localStorage — use Export</li>
            </ul>
          </div>
        </span>
      </div>
      <div className="tools">
        {server?.canPick && (
          <button title="Open another project folder" onClick={async () => {
            const r = await pickFolder();
            if (r.ok) location.reload();
          }}>📂 Project</button>
        )}
        {server?.canUpdate && (
          <button title="Check for a new release" disabled={updState !== 'idle'} onClick={onUpdate}>
            {updState === 'checking' ? 'Checking…' : updState === 'downloading' ? 'Downloading…' : '⟳ Updates'}
          </button>
        )}
        {s.designUrl && (
          <button title="Open the Claude Design system"
            onClick={() => window.open(s.designUrl, '_blank')}>↗ Design</button>
        )}
        {isServer && s.designUrl && server && !server.skillInstalled && (
          <button title="Install the flow-sync skill into this project's .claude/skills"
            onClick={onInstallSkill}>⤓ Skill</button>
        )}
        <button onClick={() => dialogs.openExport(cleanDoc())}>Export</button>
        <button title="App theme · project name/icon" onClick={openSettings}>⚙ Settings</button>
        {server?.canTerm && (
          <button className={'iconbtn' + (ui.termOpen ? ' on' : '')}
            title="Claude Code terminal — runs in the data folder (uses your local login)"
            onClick={() => setUI({ termOpen: !ui.termOpen })}>
            <PanelIcon open={!!ui.termOpen} />
          </button>
        )}
        {!isServer && (
          <button onClick={async () => {
            if (await dialogs.askConfirm('Discard local edits and reload from flow.json?')) resetToFile();
          }}>Reset</button>
        )}
      </div>
      <nav id="tabs">
        <button className={'tab' + (activeTab === 'all' ? ' on' : '')}
          onClick={() => setActiveTab('all')}>All</button>
        {doc.tabs.map(t => (
          <button key={t.id} className={'tab' + (activeTab === t.id ? ' on' : '')}
            onClick={() => setActiveTab(t.id)}>
            {t.title}
            <span className="tx" title="Delete tab" onClick={async e => {
              e.stopPropagation();
              if (await acts.deleteTab(t.id, t.title)) {
                if (activeTab === t.id) setActiveTab('all');
              }
            }}>✕</span>
          </button>
        ))}
        <button className="tab add" title="New flow tab" onClick={async () => {
          const id = await acts.addTab();
          if (id) setActiveTab(id);
        }}>＋ Tab</button>
        <span className="tabsp" />
        <span className="tabdiv" />
        <button className={'tab' + (activeTab === 'scenes' ? ' on' : '')}
          title="All scenes by category (separate from flows)"
          onClick={() => setActiveTab('scenes')}>🗂️ Scene Gallery</button>
      </nav>
    </header>
  );
}
