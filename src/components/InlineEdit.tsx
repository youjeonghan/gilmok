/* 인라인 라벨 편집 — 클릭하면 그 자리에서 입력으로 전환 (너비 유지) */
import React, { useEffect, useRef, useState } from 'react';

export function InlineEdit({ value, className, title, onSave, disabled }: {
  value: string;
  className?: string;
  title?: string;
  onSave: (v: string) => void;
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [width, setWidth] = useState(0);
  const spanRef = useRef<HTMLSpanElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  if (editing) {
    const finish = (commit: boolean) => {
      setEditing(false);
      if (commit && draft.trim()) onSave(draft); // 공백 포함 허용, 완전 빈 값만 되돌림
    };
    return (
      <input
        ref={inputRef}
        className="inline-edit nodrag"
        style={{ width: Math.max(width + 6, 60) }}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') finish(true);
          if (e.key === 'Escape') finish(false);
        }}
        onBlur={() => finish(true)}
        onMouseDown={e => e.stopPropagation()}
      />
    );
  }
  return (
    <span
      ref={spanRef}
      className={className}
      title={title}
      onClick={e => {
        if (disabled) return;
        e.stopPropagation();
        setDraft(value);
        setWidth(spanRef.current?.offsetWidth || 0);
        setEditing(true);
      }}
    >{value}</span>
  );
}
