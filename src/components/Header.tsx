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

const VER = '7.1';
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
    const r = await dialogs.ask('설정', [
      {
        key: 'appTheme', label: '앱 테마', type: 'select', value: appTheme,
        options: [{ label: '라이트', value: 'light' }, { label: '다크', value: 'dark' }]
      },
      { key: 'name', label: '프로젝트(서비스) 이름', value: s.name || '' },
      {
        key: 'icon',
        label: '프로젝트 아이콘 — 이모지 또는 이미지 경로/URL' + (hasUploaded ? ' (현재: 업로드된 이미지)' : ''),
        value: hasUploaded ? '' : (s.icon || ''), placeholder: '🧩 또는 icon.svg'
      },
      { key: 'iconFile', label: '또는 이미지 파일 직접 등록 (선택하면 위 입력보다 우선)', type: 'file', accept: 'image/*' },
      {
        key: 'designUrl', label: '클로드 디자인 프로젝트 URL (씬 편집 바로가기용)',
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
    commit(d => { d.service = { name: r.name || '서비스', icon: nextIcon, designUrl: r.designUrl || '' }; });
  };

  const onUpdate = async () => {
    setUpdState('checking');
    try {
      const r = await updateCheck();
      setUpdState('idle');
      if (!r.ok) { await dialogs.askInfo('업데이트 확인 실패: ' + (r.error || '')); return; }
      if (!r.hasUpdate) { await dialogs.askInfo('최신 버전입니다 (v' + r.current + ')'); return; }
      if (await dialogs.askConfirm('새 버전 v' + r.latest + ' 이 있어요. 지금 다운로드할까요?\n(받은 설치 파일로 수동 업데이트)')) {
        setUpdState('downloading');
        const d = await updateDownload();
        setUpdState('idle');
        if (d.ok) await dialogs.askInfo('다운로드 완료 — 열린 설치 파일을 실행하면 업데이트가 끝나요.\n' + d.path);
        else await dialogs.askInfo('다운로드 실패: ' + (d.error || ''));
      }
    } catch (e: any) {
      setUpdState('idle');
      await dialogs.askInfo('업데이트 확인 실패: ' + e.message);
    }
  };

  const onInstallSkill = async () => {
    try {
      const res = await installSkill();
      if (res.ok) {
        patchServer({ skillInstalled: true });
        await dialogs.askInfo('flow-sync 스킬 설치 완료 — ' + res.path +
          '\n해당 프로젝트의 Claude Code 세션에서 /flow-sync 로 사용할 수 있어요.');
      } else await dialogs.askInfo('설치 실패: ' + (res.error || '알 수 없는 오류'));
    } catch (e: any) {
      await dialogs.askInfo('설치 실패: ' + e.message);
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
          title={isServer ? '데이터 폴더 열기' : undefined}
          onClick={() => { if (isServer) openFolder(); }}>
          {icon && (iconIsImg
            ? <img src={/^(https?:|data:)/.test(icon) ? icon : DATA + icon} alt="" />
            : icon)}
        </span>
        <em>{s.name || '프로젝트'}</em>
        <span className="gtheme" title="전체 씬 테마 전환">
          {([['default', 'D'], ['light', 'L'], ['dark', 'N']] as const).map(([t, lb]) => (
            <span key={t}
              className={'tchip' + ((ui.globalTheme || 'default') === t ? ' on' : '')}
              title={'전체 씬을 ' + t + ' 테마로 전환'}
              onClick={() => setUI({ globalTheme: t, sceneTheme: {} })}>{lb}</span>
          ))}
        </span>
        <span className="info">
          <span className="i">i</span>
          <div className="tip">
            <b>보기</b>
            <ul>
              <li>· 카드 클릭 = 씬을 실물 크기로 열기</li>
              <li>· 탭 = 플로우 전환 (전체 = 모든 플로우 한눈에)</li>
              <li>· 휠 = 이동 · Ctrl+휠 = 확대/축소 · 미니맵으로 점프</li>
              <li>· 썸네일 우상단 = 테마 전환(D/L/N) · ＋로 테마 등록</li>
            </ul>
            <b>편집</b>
            <ul>
              <li>· 카드 드래그 = 순서 이동 (다른 분기 라인으로도 가능)</li>
              <li>· Shift+드래그로 선택 → 우클릭 = 범주로 묶기</li>
              <li>· 범주 끝 핸들 드래그 = 범위 조절</li>
              <li>· 라벨·범주 이름 클릭 = 그 자리에서 수정</li>
              <li>· 라벨 드래그 = 분기를 다른 씬으로 이동</li>
              <li>· ＋ = 씬 삽입 · 카드 호버 ⑂ = 분기 추가 · Add note = 메모</li>
            </ul>
            <b>저장</b>
            <ul>
              <li>· 앱/실행파일로 열면 flow.json에 자동 저장</li>
              <li>· 정적 서버로 열면 localStorage에 저장 — '내보내기'로 확정</li>
            </ul>
          </div>
        </span>
      </div>
      <div className="tools">
        {server?.canPick && (
          <button title="다른 프로젝트 폴더 열기" onClick={async () => {
            const r = await pickFolder();
            if (r.ok) location.reload();
          }}>📂 프로젝트</button>
        )}
        {server?.canUpdate && (
          <button title="새 버전 확인 후 수동 업데이트" disabled={updState !== 'idle'} onClick={onUpdate}>
            {updState === 'checking' ? '확인 중…' : updState === 'downloading' ? '다운로드 중…' : '⟳ 업데이트 확인'}
          </button>
        )}
        {s.designUrl && (
          <button title="claude.ai/design 디자인 시스템 열기"
            onClick={() => window.open(s.designUrl, '_blank')}>↗ 디자인 시스템</button>
        )}
        {isServer && s.designUrl && server && !server.skillInstalled && (
          <button title="flow-sync 스킬을 이 프로젝트의 .claude/skills에 설치"
            onClick={onInstallSkill}>⤓ 스킬 설치</button>
        )}
        <button onClick={() => dialogs.openExport(cleanDoc())}>내보내기</button>
        <button title="서비스 이름·아이콘" onClick={openSettings}>⚙ 설정</button>
        {server?.canTerm && (
          <button className={'iconbtn' + (ui.termOpen ? ' on' : '')}
            title="Claude Code 터미널 열기/닫기 — 데이터 폴더에서 실행 (구독 로그인 그대로 사용)"
            onClick={() => setUI({ termOpen: !ui.termOpen })}>
            <PanelIcon open={!!ui.termOpen} />
          </button>
        )}
        {!isServer && (
          <button onClick={async () => {
            if (await dialogs.askConfirm('편집 내용을 버리고 flow.json 파일 상태로 되돌릴까요?')) resetToFile();
          }}>편집 초기화</button>
        )}
      </div>
      <nav id="tabs">
        <button className={'tab' + (activeTab === 'all' ? ' on' : '')}
          onClick={() => setActiveTab('all')}>전체</button>
        {doc.tabs.map(t => (
          <button key={t.id} className={'tab' + (activeTab === t.id ? ' on' : '')}
            onClick={() => setActiveTab(t.id)}>
            {t.title}
            <span className="tx" title="탭 삭제" onClick={async e => {
              e.stopPropagation();
              if (await acts.deleteTab(t.id, t.title)) {
                if (activeTab === t.id) setActiveTab('all');
              }
            }}>✕</span>
          </button>
        ))}
        <button className={'tab' + (activeTab === 'scenes' ? ' on' : '')}
          onClick={() => setActiveTab('scenes')}>⊞ 씬 갤러리</button>
        <button className="tab add" title="새 플로우 탭 추가" onClick={async () => {
          const id = await acts.addTab();
          if (id) setActiveTab(id);
        }}>＋ 탭</button>
      </nav>
    </header>
  );
}
