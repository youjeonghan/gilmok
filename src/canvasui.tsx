/* 캔버스 인터랙션의 일시 상태 (드래그 프리뷰 등) — 문서와 분리 */
import { createContext, useContext } from 'react';
import type { LaneRow } from './layout';

export interface CanvasUIState {
  /** 씬 드래그 중 카드 밀림 프리뷰: 해당 레인에서 t 이상 인덱스 카드를 오른쪽으로 */
  shift: { flowId: string; fromEntryIdx: number; entryIdxOf: Record<string, number> } | null;
  /** 범주 편입 하이라이트 */
  hotBracket: { flowId: string; bi: number } | null;
  /** 분기 라벨 드래그 대상 씬 하이라이트 (노드 id) */
  anchorTarget: string | null;
  /** 드래그 중인 씬 노드 id (반투명 처리) */
  dragSrc: string | null;
}

export interface CanvasCtxValue extends CanvasUIState {
  lanes: LaneRow[];
  reportPill: (flowId: string, w: number) => void;
  /** 범주 리사이즈 커밋 전 프리뷰 (좌표는 flow 좌표) */
  bracketPreview: { flowId: string; bi: number; left: number; width: number } | null;
  setBracketPreview: (p: CanvasCtxValue['bracketPreview']) => void;
}

export const CanvasCtx = createContext<CanvasCtxValue>({
  shift: null, hotBracket: null, anchorTarget: null, dragSrc: null,
  lanes: [], reportPill: () => {}, bracketPreview: null, setBracketPreview: () => {}
});
export const useCanvasUI = () => useContext(CanvasCtx);

/* 드래그 직후 클릭 억제 (썸네일 클릭=열기와 드래그 구분) */
let suppressUntil = 0;
export const suppressClicks = (ms = 250) => { suppressUntil = Date.now() + ms; };
export const clickSuppressed = () => Date.now() < suppressUntil;
