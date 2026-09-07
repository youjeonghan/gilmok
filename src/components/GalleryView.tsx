/* ⊞ 씬 갤러리 — 카테고리 그룹별 그리드 (캔버스 밖 일반 스크롤 뷰) */
import React from 'react';
import { useStore } from '../store';
import { SceneCardBody } from './nodes';
import { CARD_W } from '../layout';

export function GalleryView() {
  const { doc } = useStore();
  if (!doc) return null;
  const groups: Record<string, string[]> = {};
  Object.keys(doc.scenes).forEach(id => {
    const g = doc.scenes[id].group || '기타';
    (groups[g] = groups[g] || []).push(id);
  });
  return (
    <div id="gallerywrap">
      {Object.keys(groups).map(g => (
        <div key={g}>
          <div className="seccap">🗂️ {g} ({groups[g].length})</div>
          <div className="gallery">
            {groups[g].map((id, i) => (
              <div key={id} className="scene nogutter" style={{ width: CARD_W }}>
                <SceneCardBody sid={id} flowId={null} idx={0} tabId={null}
                  nav={{ seq: groups[g], index: i, label: '🗂️ ' + g }} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
