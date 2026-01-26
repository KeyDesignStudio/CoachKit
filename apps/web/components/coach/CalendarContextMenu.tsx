'use client';

import { useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/cn';
import { Icon } from '@/components/ui/Icon';
import type { IconName } from '@/components/ui/iconRegistry';

export type Position = { x: number; y: number };
export type ContextMenuAction = 'copy' | 'paste' | 'delete' | 'edit' | 'library-insert';

type CalendarContextMenuProps = {
  isOpen: boolean;
  position: Position;
  type: 'session' | 'day';
  canPaste: boolean;
  onClose: () => void;
  onAction: (action: ContextMenuAction) => void;
};

export function CalendarContextMenu({
  isOpen,
  position,
  type,
  canPaste,
  onClose,
  onAction,
}: CalendarContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  // Close on click outside or Escape
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', onClose, true);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [isOpen, onClose]);

  const items = useMemo(() => {
    const list: Array<{ label: string; icon: IconName; action: ContextMenuAction; disabled?: boolean; variant?: 'default' | 'danger' }> = [];

    if (type === 'session') {
      // Spec: ONLY Copy for now. Edit/Delete reserved for later approval.
      list.push({ label: 'Copy session', icon: 'copyWeek', action: 'copy' });
    } else if (type === 'day') {
      if (canPaste) {
        list.push({ label: 'Paste session', icon: 'scheduleAdd', action: 'paste' });
      } else {
        list.push({ label: 'Paste session', icon: 'scheduleAdd', action: 'paste', disabled: true });
      }
      list.push({ label: 'Add from Session Library', icon: 'calendarAddOn', action: 'library-insert' });
    }

    return list;
  }, [type, canPaste]);

  if (!isOpen) return null;

  // Simple positioning logic to keep in viewport
  const menuWidth = 240;
  const menuHeight = items.length * 40 + 16;
  
  let x = position.x;
  let y = position.y;

  if (typeof window !== 'undefined') {
    if (x + menuWidth > window.innerWidth) x -= menuWidth;
    if (y + menuHeight > window.innerHeight) y -= menuHeight;
  }

  return createPortal(
    <div
      ref={ref}
      className="fixed z-[9999] min-w-[220px] overflow-hidden rounded-xl bg-[var(--bg-surface)] p-1.5 shadow-xl border border-[var(--border-subtle)] animate-in fade-in zoom-in-95 duration-100"
      style={{ top: y, left: x }}
      role="menu"
    >
      {items.map((item) => (
        <button
          key={item.label}
          onClick={(e) => {
            e.stopPropagation();
            if (!item.disabled) {
              onAction(item.action);
            }
          }}
          disabled={item.disabled}
          className={cn(
            'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors text-left',
            'hover:bg-[var(--bg-structure)]',
            item.disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
            item.variant === 'danger' ? 'text-rose-600' : 'text-[var(--text)]'
          )}
        >
          {item.icon ? (
             <Icon name={item.icon} size="sm" className={cn(item.variant === 'danger' ? 'text-rose-600' : 'text-[var(--muted)]', 'shrink-0')} />
          ) : null}
          <span className="truncate">{item.label}</span>
        </button>
      ))}
    </div>,
    document.body
  );
}
