import React from 'react';
import { useStore } from './store';
import { Header } from './components/Header';
import { FlowCanvas } from './components/FlowCanvas';
import { GalleryView } from './components/GalleryView';
import { pickFolder } from './api';

export function App() {
  const { phase, errMsg, doc, activeTab } = useStore();

  if (phase === 'loading') {
    return <div className="screenmsg">불러오는 중…</div>;
  }
  if (phase === 'needProject') {
    return (
      <div className="screenmsg">
        <div className="t">열 프로젝트가 없어요</div>
        flow.json이 있는 데이터 폴더를 선택해주세요.<br /><br />
        <button onClick={async () => {
          const r = await pickFolder();
          if (r.ok) location.reload();
        }}>📂 프로젝트 폴더 열기</button>
      </div>
    );
  }
  if (phase === 'loaderr' || !doc) {
    return <div className="screenmsg" style={{ whiteSpace: 'pre-line', textAlign: 'left', maxWidth: 640, margin: '0 auto' }}>{errMsg}</div>;
  }

  const view = activeTab === 'scenes' ? 'scenes'
    : activeTab === 'all' || doc.tabs.some(t => t.id === activeTab) ? activeTab : 'all';

  return (
    <>
      <Header />
      {view === 'scenes'
        ? <GalleryView />
        : <div id="stage"><FlowCanvas view={view} /></div>}
    </>
  );
}
