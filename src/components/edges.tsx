/* 커스텀 엣지 — ㄴ자 트렁크(라운드 코너·갈래 사이 여백)와 수평 화살표 */
import React from 'react';
import type { EdgeProps } from '@xyflow/react';
import { ARROW_H, CORNER_R } from '../layout';

const STROKE = '#C9432C';
const PILL_GAP = 6; // 화살촉 끝 → 라벨 알약 사이 여백

/** 루트 카드 → 첫 분기 라벨: 수평 직선 + 화살촉 (카드에서 여백을 두고 시작).
 *  첫 Branch가 자유 배치로 이동해 높이가 어긋나면 라운드 코너 2번의 ㄹ자 경로로 잇는다. */
export function HArrowEdge({ sourceX, sourceY, targetX, targetY }: EdgeProps) {
  const startX = sourceX + 16;
  const tX = targetX - PILL_GAP;
  const endX = Math.max(startX + 6, tX - ARROW_H);
  const head = (y: number) =>
    <path d={`M ${endX} ${y - 5.5} L ${tX} ${y} L ${endX} ${y + 5.5} Z`} fill={STROKE} />;
  if (Math.abs(targetY - sourceY) < 6) {
    return (
      <>
        <path d={`M ${startX} ${targetY} L ${endX} ${targetY}`}
          fill="none" stroke={STROKE} strokeWidth={3} strokeLinecap="round" />
        {head(targetY)}
      </>
    );
  }
  const midX = Math.min(startX + 28, (startX + endX) / 2);
  const r = Math.min(CORNER_R, Math.abs(targetY - sourceY) / 2, Math.max(2, endX - midX));
  const s = targetY > sourceY ? 1 : -1;
  const d = `M ${startX} ${sourceY} L ${midX - r} ${sourceY}`
    + ` Q ${midX} ${sourceY} ${midX} ${sourceY + s * r}`
    + ` L ${midX} ${targetY - s * r}`
    + ` Q ${midX} ${targetY} ${midX + r} ${targetY}`
    + ` L ${endX} ${targetY}`;
  return (
    <>
      <path d={d} fill="none" stroke={STROKE} strokeWidth={3} strokeLinecap="round" />
      {head(targetY)}
    </>
  );
}

/** 부모(씬/라벨) → 자식 분기 라벨: 세로 트렁크 + 라운드 코너 + 수평 갈래 + 화살촉.
 *  시작점은 소스 핸들 기준 상대값(startDY) — 드래그 중에도 뿌리가 노드를 따라온다 */
export function TrunkEdge({ sourceX, sourceY, targetX, targetY, data }: EdgeProps) {
  const x = sourceX;
  const y = targetY;
  const startY = sourceY + ((data as any)?.startDY ?? 8);
  const r = Math.min(CORNER_R, Math.max(0, y - startY));
  const tX = targetX - PILL_GAP;
  const endX = tX - ARROW_H;
  const d = `M ${x} ${startY} L ${x} ${y - r} Q ${x} ${y} ${x + r} ${y} L ${endX} ${y}`;
  return (
    <>
      <path d={d} fill="none" stroke={STROKE} strokeWidth={3} strokeLinecap="round" />
      <path d={`M ${endX} ${y - 5.5} L ${tX} ${y} L ${endX} ${y + 5.5} Z`} fill={STROKE} />
    </>
  );
}

/** 부모 카드 오른쪽 → 자식 분기 라벨: 카드 오른쪽에서 수평으로 나와 위/아래로 꺾이는 트렁크.
 *  첫 갈래만 카드에서 나오는 수평 구간을 그리고, 이후 갈래는 이전 갈래 아래에서 세로선을 재개(여백).
 *  라벨이 핸들보다 위에 있으면 위로 꺾인다. */
export function RTrunkEdge({ sourceX, sourceY, targetX, targetY, data }: EdgeProps) {
  const d = (data as any) || {};
  const x = sourceX + (d.bendDX ?? 35);
  const y = targetY;
  const tX = targetX - PILL_GAP;
  const endX = tX - ARROW_H;
  const s = y >= sourceY ? 1 : -1;
  let path;
  if (d.startDY == null) {
    const r = Math.min(CORNER_R, Math.max(2, Math.abs(y - sourceY) / 2));
    path = `M ${sourceX + 12} ${sourceY} L ${x - r} ${sourceY}`
      + ` Q ${x} ${sourceY} ${x} ${sourceY + s * r}`
      + ` L ${x} ${y - s * r} Q ${x} ${y} ${x + r} ${y} L ${endX} ${y}`;
  } else {
    const sy = sourceY + d.startDY;
    const r = Math.min(CORNER_R, Math.max(0, y - sy));
    path = `M ${x} ${sy} L ${x} ${y - r} Q ${x} ${y} ${x + r} ${y} L ${endX} ${y}`;
  }
  return (
    <>
      <path d={path} fill="none" stroke={STROKE} strokeWidth={3} strokeLinecap="round" />
      <path d={`M ${endX} ${y - 5.5} L ${tX} ${y} L ${endX} ${y + 5.5} Z`} fill={STROKE} />
    </>
  );
}
