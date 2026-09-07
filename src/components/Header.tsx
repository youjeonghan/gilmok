/* 상단 헤더 — 서비스 브랜드 · 전체 테마 · 도구 버튼 · 탭 */
import React, { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { useActions } from '../actions';
import { useDialogs } from '../dialogs';
import { pickFolder, installSkill, newProject, updateCheck, updateDownload, openFolder, useFolder, discoverProjects } from '../api';
import type { ProjectRef } from '../api';

/** 경로 뒤 두 세그먼트만 표시 (전체는 title로) */
const shortPath = (p: string) =>
  p.replace(/[\\/]+$/, '').split(/[\\/]/).slice(-2).join('/');

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

const VER = '0.7.14'; // 서버 미응답 시 폴백 표기 — 실제 버전은 server.version
const APP_NAME = '길목'; // 저장소 gilmok · 설치 파일 gilmok-setup — 이름 전부 길목/gilmok으로 통일

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
  const [projOpen, setProjOpen] = useState(false);
  const projRef = useRef<HTMLSpanElement>(null);
  // 메뉴를 열 때마다 fresh 조회 — 최근(존재 검증) + 디스크에서 발견된 프로젝트
  const [disc, setDisc] = useState<{ recent: ProjectRef[]; found: ProjectRef[] } | null>(null);
  const [discBusy, setDiscBusy] = useState(false);
  const [dragTab, setDragTab] = useState<string | null>(null);
  const [dropMark, setDropMark] = useState<{ id: string; after: boolean } | null>(null);

  useEffect(() => {
    if (!projOpen) return;
    const onDown = (e: MouseEvent) => {
      if (projRef.current && !projRef.current.contains(e.target as Node)) setProjOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [projOpen]);

  const s = doc?.service || { name: '서비스', icon: '' };

  useEffect(() => {
    // 프로젝트 미선택(또는 이름 미지정) 시 "길목", 열리면 "길목 — 프로젝트명"
    const pn = doc && s.name && s.name !== '서비스' ? s.name : '';
    document.title = APP_NAME + (pn ? ' — ' + pn : '');
  }, [doc, s.name]);

  if (!doc) return null;

  const icon = (s.icon || '').trim();
  const iconIsImg = /\.(png|svg|jpe?g|webp|gif|ico)$/i.test(icon) || icon.includes('/');

  const openSettings = async () => {
    const r = await dialogs.ask('설정', [
      {
        key: 'appTheme', label: '앱 테마', type: 'segment', value: appTheme,
        options: [{ label: '☀️ 라이트', value: 'light' }, { label: '🌙 다크', value: 'dark' }],
        onPick: v => { if (v === 'light' || v === 'dark') setAppTheme(v); } // 클릭 즉시 적용
      },
      { key: 'name', label: '프로젝트 이름', value: s.name || '' },
      {
        key: 'iconFile',
        label: '프로젝트 아이콘 — 이미지 파일 등록' + (s.icon ? ' (미선택 시 현재 아이콘 유지)' : ''),
        type: 'file', accept: 'image/*'
      },
      {
        key: 'designUrl', label: '클로드 디자인 프로젝트 URL (선택 — Scene 편집 바로가기용)',
        value: s.designUrl || '', placeholder: 'https://claude.ai/design/p/…'
      }
    ]);
    if (!r) return;
    if (r.appTheme === 'light' || r.appTheme === 'dark') setAppTheme(r.appTheme);
    let nextIcon: string = s.icon || ''; // 파일 미선택 → 기존 아이콘 유지
    if (r.iconFile) {
      nextIcon = await new Promise<string>(res => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result as string);
        fr.readAsDataURL(r.iconFile);
      });
    }
    commit(d => { d.service = { name: r.name || '프로젝트', icon: nextIcon, designUrl: r.designUrl || '' }; });
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
        if (d.ok) await dialogs.askInfo('다운로드 완료 — 설치 파일을 실행하면 업데이트가 끝나요.\n' + d.path);
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
          '\n이 프로젝트의 Claude Code 세션에서 /flow-sync 로 사용할 수 있어요.');
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
        <span className="gtheme" title="전체 Scene 테마 전환">
          {([['default', 'D'], ['light', 'L'], ['dark', 'N']] as const).map(([t, lb]) => (
            <span key={t}
              className={'tchip' + ((ui.globalTheme || 'default') === t ? ' on' : '')}
              title={'전체 Scene을 ' + t + ' 테마로'}
              onClick={() => setUI({ globalTheme: t, sceneTheme: {} })}>{lb}</span>
          ))}
        </span>
        <span className="info">
          <span className="i">i</span>
          <div className="tip">
            <b>보기</b>
            <ul>
              <li>· 카드 클릭 = Scene을 실물 크기로 열기</li>
              <li>· Tab = 플로우 전환 · 선택된 Tab 클릭 = 이름 수정 · 드래그 = 순서 이동</li>
              <li>· 휠 = 이동 · Ctrl+휠 = 확대/축소 · 스페이스+드래그 = 화면 이동</li>
              <li>· 썸네일 우상단 = 테마(D/L/N) · ＋로 테마 등록</li>
            </ul>
            <b>편집</b>
            <ul>
              <li>· 카드 드래그 = 순서 이동 (다른 Branch로도 가능)</li>
              <li>· Shift+드래그 선택 → 우클릭 = Bracket으로 묶기</li>
              <li>· Bracket 끝 핸들 드래그 = 범위 조절</li>
              <li>· 라벨·Bracket 이름 클릭 = 그 자리에서 수정</li>
              <li>· 라벨 드래그 = Branch를 다른 Scene으로 이동</li>
              <li>· ＋ = Scene 삽입 · 카드 호버 ⑂ = Branch 추가</li>
            </ul>
            <b>저장</b>
            <ul>
              <li>· 앱에서는 모든 편집이 flow.json에 자동 저장</li>
              <li>· 정적 서버에서는 localStorage에 저장 — '내보내기'로 확정</li>
            </ul>
          </div>
        </span>
      </div>
      <div className="tools">
        {isServer && (
          <span className="projwrap" ref={projRef}>
            <button className={projOpen ? 'on' : ''} title="현재 폴더 확인 · 열기 · 전환"
              onClick={() => {
                const next = !projOpen;
                setProjOpen(next);
                if (next) {
                  setDiscBusy(true);
                  discoverProjects().then(d => { setDisc(d && d.ok ? d : null); setDiscBusy(false); });
                }
              }}>📂 프로젝트</button>
            {projOpen && (
              <div className="projmenu">
                <div className="pm-cur" title={(server?.dataDir || '') + ' — 클릭하면 탐색기로 열기'}
                  onClick={() => { openFolder(); setProjOpen(false); }}>
                  <span className="pm-badge">현재</span>
                  <span className="pm-path">{shortPath(server?.dataDir || '')}</span>
                  <span className="pm-act">탐색기 ↗</span>
                </div>
                {(() => {
                  // discover 응답이 오기 전(또는 미지원 서버)엔 health의 recent로 폴백
                  const recent: ProjectRef[] = disc
                    ? disc.recent
                    : (server?.recent || []).filter(p => p !== server?.dataDir).map(p => ({ dir: p, name: '' }));
                  const goTo = async (dir: string) => {
                    const r = await useFolder(dir);
                    if (r.ok) location.reload();
                    else await dialogs.askInfo('전환 실패 — 폴더에 flow.json이 없어요.\n' + dir);
                  };
                  return (
                    <>
                      {recent.length > 0 && <div className="pm-label">최근</div>}
                      {recent.map(r => (
                        <div key={r.dir} className="pm-item" title={r.dir + ' — 이 프로젝트로 전환'}
                          onClick={() => goTo(r.dir)}>{shortPath(r.dir)}</div>
                      ))}
                      {discBusy && <div className="pm-label">디스크 검색 중…</div>}
                      {disc && disc.found.length > 0 && (
                        <>
                          <div className="pm-label">디스크에서 발견</div>
                          {disc.found.map(f => (
                            <div key={f.dir} className="pm-item pm-found" title={f.dir + ' — 이 프로젝트로 전환'}
                              onClick={() => goTo(f.dir)}>
                              {f.name}<span className="pm-sub">{shortPath(f.dir)}</span>
                            </div>
                          ))}
                        </>
                      )}
                    </>
                  );
                })()}
                <div className="pm-sep" />
                <div className="pm-item pm-pick" onClick={async () => {
                  setProjOpen(false);
                  const r = await pickFolder();
                  if (r.ok) location.reload();
                }}>⇄ 다른 폴더 선택…</div>
                <div className="pm-item pm-pick" onClick={async () => {
                  setProjOpen(false);
                  const r = await dialogs.ask('새 프로젝트', [
                    { key: 'name', label: '프로젝트 이름', placeholder: '예: 마이앱' }
                  ]);
                  if (!r || !r.name) return;
                  const res = await newProject(r.name);
                  if (res.ok) location.reload();
                  else if (res.error) await dialogs.askInfo('생성 실패 — ' + res.error);
                }}>＋ 새 프로젝트 만들기…</div>
              </div>
            )}
          </span>
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
        {isServer && server && !server.skillInstalled && (
          <button title="flow-sync 스킬을 이 프로젝트의 .claude/skills에 설치 (디자인 URL 없어도 설치 가능)"
            onClick={onInstallSkill}>⤓ 스킬 설치</button>
        )}
        <button onClick={() => dialogs.openExport(cleanDoc())}>내보내기</button>
        <button title="앱 테마 · 프로젝트 이름/아이콘" onClick={openSettings}>⚙ 설정</button>
        {server?.canTerm && (
          <button className={'iconbtn' + (ui.termOpen ? ' on' : '')}
            title="Claude Code 터미널 — 데이터 폴더에서 실행 (구독 로그인 그대로)"
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
          <button key={t.id}
            className={'tab' + (activeTab === t.id ? ' on' : '')
              + (dragTab === t.id ? ' dragsrc' : '')
              + (dropMark?.id === t.id ? (dropMark.after ? ' drop-r' : ' drop-l') : '')}
            title="선택된 Tab 클릭 = 이름 수정 · 드래그 = 순서 이동"
            draggable
            onDragStart={e => { setDragTab(t.id); e.dataTransfer.effectAllowed = 'move'; }}
            onDragEnd={() => { setDragTab(null); setDropMark(null); }}
            onDragOver={e => {
              if (!dragTab || dragTab === t.id) return;
              e.preventDefault();
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              const after = e.clientX > r.left + r.width / 2;
              setDropMark(m => (m?.id === t.id && m.after === after ? m : { id: t.id, after }));
            }}
            onDragLeave={() => setDropMark(m => (m?.id === t.id ? null : m))}
            onDrop={e => {
              e.preventDefault();
              if (!dragTab || dragTab === t.id) return;
              const fromIdx = doc.tabs.findIndex(x => x.id === dragTab);
              const idx = doc.tabs.findIndex(x => x.id === t.id);
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              let to = idx + (e.clientX > r.left + r.width / 2 ? 1 : 0);
              if (fromIdx >= 0 && fromIdx < to) to--;
              acts.moveTab(dragTab, to);
              setDragTab(null); setDropMark(null);
            }}
            onClick={() => {
              if (activeTab === t.id) acts.renameTab(t.id); // 이미 선택된 탭 = 이름 수정
              else setActiveTab(t.id);
            }}>
            {t.title}
            <span className="tx" title="Tab 삭제" onClick={async e => {
              e.stopPropagation();
              if (await acts.deleteTab(t.id, t.title)) {
                if (activeTab === t.id) setActiveTab('all');
              }
            }}>✕</span>
          </button>
        ))}
        <button className="tab add" title="새 Tab 추가" onClick={async () => {
          const id = await acts.addTab();
          if (id) setActiveTab(id);
        }}>＋ Tab</button>
        <span className="tabsp" />
        <span className="tabdiv" />
        <button className={'tab' + (activeTab === 'scenes' ? ' on' : '')}
          title="모든 Scene을 카테고리별로 모아보기 (플로우와 별개)"
          onClick={() => setActiveTab('scenes')}>🗂️ Scene 갤러리</button>
      </nav>
    </header>
  );
}
