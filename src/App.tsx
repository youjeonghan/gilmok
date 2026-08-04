import React, { useCallback, useRef } from 'react';
import { useStore } from './store';
import { Header } from './components/Header';
import { FlowCanvas } from './components/FlowCanvas';
import { GalleryView } from './components/GalleryView';
import { TerminalPanel } from './components/TerminalPanel';
import { pickFolder } from './api';

export function App() {
  const { phase, errMsg, doc, activeTab, server, ui, setUI } = useStore();
  const dragW = useRef<number | null>(null);

  const startDivDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    document.body.classList.add('noselect');
    const move = (ev: MouseEvent) => {
      const w = Math.max(300, Math.min(window.innerWidth - 480, window.innerWidth - ev.clientX));
      dragW.current = w;
      const el = document.getElementById('termpanel');
      if (el) el.style.width = w + 'px';
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      document.body.classList.remove('noselect');
      if (dragW.current != null) setUI({ termW: dragW.current });
      dragW.current = null;
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }, [setUI]);

  if (phase === 'loading') {
    return <div className="screenmsg">Loading…</div>;
  }
  if (phase === 'needProject') {
    return (
      <div className="screenmsg">
        <div className="t">No project open</div>
        Choose a data folder that contains flow.json.<br /><br />
        <button onClick={async () => {
          const r = await pickFolder();
          if (r.ok) location.reload();
        }}>📂 Open project folder</button>
      </div>
    );
  }
  if (phase === 'loaderr' || !doc) {
    return <div className="screenmsg" style={{ whiteSpace: 'pre-line', textAlign: 'left', maxWidth: 640, margin: '0 auto' }}>{errMsg}</div>;
  }

  const view = activeTab === 'scenes' ? 'scenes'
    : activeTab === 'all' || doc.tabs.some(t => t.id === activeTab) ? activeTab : 'all';
  const termOpen = !!ui.termOpen && !!server?.canTerm;

  return (
    <>
      <Header />
      <div id="workarea">
        {view === 'scenes'
          ? <GalleryView />
          : <div id="stage"><FlowCanvas view={view} /></div>}
        {termOpen && (
          <>
            <div id="paneldiv" onMouseDown={startDivDrag} title="Drag to resize" />
            <div id="termpanel" style={{ width: ui.termW || 440 }}>
              <TerminalPanel onClose={() => setUI({ termOpen: false })} />
            </div>
          </>
        )}
      </div>
    </>
  );
}
