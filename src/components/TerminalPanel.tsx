/* 내장 터미널 패널 — 데이터 폴더에서 claude CLI를 pty로 실행 (구독 로그인 그대로 사용).
 * 패널을 닫아도 메인 프로세스의 세션은 유지되고, 다시 열면 버퍼가 리플레이된다. */
import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useStore } from '../store';

export function TerminalPanel({ onClose }: { onClose: () => void }) {
  const { server } = useStore();
  const boxRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const [dead, setDead] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const el = boxRef.current!;
    const t = new Terminal({
      fontSize: 12.5,
      fontFamily: '"Cascadia Mono", Consolas, "D2Coding", monospace',
      cursorBlink: true,
      convertEol: false,
      theme: {
        background: '#141618', foreground: '#D8DDDB', cursor: '#E8563C',
        selectionBackground: '#31555033',
        black: '#141618', brightBlack: '#5A6360'
      }
    });
    const fit = new FitAddon();
    t.loadAddon(fit);
    t.open(el);
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/api/term`);
    const sendResize = () => {
      try { fit.fit(); } catch {}
      if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'r', cols: t.cols, rows: t.rows }));
    };
    ws.onopen = sendResize;
    ws.onmessage = ev => {
      let m: any;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (m.t === 'o') t.write(m.d);
      else if (m.t === 'hello') { if (m.replay) t.write(m.replay); sendResize(); }
      else if (m.t === 'exit') setDead(m.code ?? 0);
      else if (m.t === 'restarted') { setDead(null); }
      else if (m.t === 'err') setErr(m.msg);
    };
    t.onData(d => { if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'i', d })); });
    const ro = new ResizeObserver(() => sendResize());
    ro.observe(el);
    wsRef.current = ws;
    termRef.current = t;
    setTimeout(() => t.focus(), 60);
    return () => { ro.disconnect(); ws.close(); t.dispose(); };
  }, []);

  const restart = () => {
    const t = termRef.current;
    t?.reset();
    setErr(null); setDead(null);
    wsRef.current?.send(JSON.stringify({ t: 'restart', cols: t?.cols, rows: t?.rows }));
    setTimeout(() => t?.focus(), 60);
  };

  return (
    <>
      <div className="termhead">
        <span className="dot" />
        Claude Code
        <span className="cwd" title={server?.dataDir || ''}>{server?.dataDir || ''}</span>
        <span className="sp" />
        <button onClick={restart} title="Restart session">⟳ Restart</button>
        <button onClick={onClose} title="Close panel (session keeps running)">✕</button>
      </div>
      <div className="termbox" ref={boxRef} />
      {(dead != null || err) && (
        <div className="termdead">
          <div>
            {err ? err : `Session ended (code ${dead})`}
            {!err && dead !== 0 && (
              <div className="hint">
                The claude CLI must be installed.<br />
                Run <code>npm install -g @anthropic-ai/claude-code</code><br />
                or see claude.com/claude-code.
              </div>
            )}
          </div>
          <button onClick={restart}>⟳ Restart</button>
        </div>
      )}
    </>
  );
}
