/* 커스텀 엣지 — ㄴ자 트렁크(라운드 코너·갈래 사이 여백)와 수평 화살표 */
import React from 'react';
import type { EdgeProps } from '@xyflow/react';
import { ARROW_H, CORNER_R } from '../layout';

const STROKE = '#C9432C';

/** 루트 카드 → 첫 분기 라벨: 수평 직선 + 화살촉 */
export function HArrowEdge({ sourceX, targetX, targetY }: EdgeProps) {
  const y = targetY;
  const endX = targetX - ARROW_H;
  return (
    <>
      <path d={`M ${sourceX} ${y} L ${endX} ${y}`}
        fill="none" stroke={STROKE} strokeWidth={3} strokeLinecap="round" />
      <path d={`M ${endX} ${y - 5.5} L ${targetX} ${y} L ${endX} ${y + 5.5} Z`} fill={STROKE} />
    </>
  );
}

/** 부모(씬/라벨) → 자식 분기 라벨: 세로 트렁크 + 라운드 코너 + 수평 갈래 + 화살촉.
 *  data.startY = 이 세그먼트의 시작 y (첫 갈래는 앵커 하단+8, 이후는 이전 갈래 y+8 — v6와 동일) */
export function TrunkEdge({ sourceX, targetX, targetY, data }: EdgeProps) {
  const x = sourceX;
  const y = targetY;
  const startY = (data as any)?.startY ?? y - 40;
  const r = Math.min(CORNER_R, Math.max(0, y - startY));
  const endX = targetX - ARROW_H;
  const d = `M ${x} ${startY} L ${x} ${y - r} Q ${x} ${y} ${x + r} ${y} L ${endX} ${y}`;
  return (
    <>
      <path d={d} fill="none" stroke={STROKE} strokeWidth={3} strokeLinecap="round" />
      <path d={`M ${endX} ${y - 5.5} L ${targetX} ${y} L ${endX} ${y + 5.5} Z`} fill={STROKE} />
    </>
  );
}
