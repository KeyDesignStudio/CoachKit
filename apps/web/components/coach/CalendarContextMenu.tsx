'use client';

import { useEffect, useRef, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/cn';
import { Icon } from '@/components/ui/Icon';
import type { IconName } from '@/components/ui/iconRegistry';

import { getDisciplineTheme } from '@/components/ui/disciplineTheme';

export type Position = { x: number; y: number };
export type ContextMenuAction =
  | 'copy'
  | 'paste'
  | 'delete'
  | 'edit'
  | 'library-insert'
  | 'library-insert-item'
  | 'publish-session'
  | 'unpublish-session';

type GroupSessionItem = {
  id: string;
  title: string;
  discipline: string;
  durationMinutes: number;
};

type CalendarContextMenuProps = {
  isOpen: boolean;
  position: Position;
  type: 'session' | 'day';
  canPaste: boolean;
  canCopy?: boolean;
  copyDisabledLabel?: string;
  pasteDisabledLabel?: string;
  onClose: () => void;
  onAction: (action: ContextMenuAction, payload?: any) => void;
  libraryItems?: GroupSessionItem[];
  showLibraryInsert?: boolean;
  canPublishSession?: boolean;
  canUnpublishSession?: boolean;
};

export function CalendarContextMenu({
  isOpen,
  position,
  type,
  canPaste,
  canCopy = true,
  copyDisabledLabel,
  pasteDisabledLabel,
  onClose,
  onAction,
  libraryItems = [],
  showLibraryInsert = true,
  canPublishSession = false,
  canUnpublishSession = false,
}: CalendarContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [showLibraryList, setShowLibraryList] = useState(false);

  // Reset library list view when menu closes or re-opens
  useEffect(() => {
    if (!isOpen) setShowLibraryList(false);
  }, [isOpen]);

  // Close on click outside or Escape
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      // If clicking inside, do nothing (let button handlers work)
      if (ref.current && ref.current.contains(e.target as Node)) {
        return;
      }
      onClose();
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
      list.push({
        label: 'Publish session',
        icon: 'completed',
        action: 'publish-session',
        disabled: !canPublishSession,
      });
      list.push({
        label: 'Unpublish session',
        icon: 'planned',
        action: 'unpublish-session',
        disabled: !canUnpublishSession,
      });
      list.push({
        label: canCopy ? 'Copy session' : copyDisabledLabel ?? 'Copy session',
        icon: 'copyWeek',
        action: 'copy',
        disabled: !canCopy,
      });
      list.push({ label: 'Delete session', icon: 'delete', action: 'delete', variant: 'danger' });
    } else if (type === 'day') {
      if (canPaste) {
        list.push({ label: 'Paste session', action: 'paste', icon: 'paste' });
      } else {
        list.push({
          label: pasteDisabledLabel ?? 'Paste session',
          action: 'paste',
          disabled: true,
          icon: 'paste',
        });
      }
      
      if (!showLibraryList && showLibraryInsert) {
        list.push({ label: 'Add from Recurring Group Sessions', icon: 'calendarAddOn', action: 'library-insert' });
      }
    }

    return list;
  }, [type, canPaste, showLibraryList, showLibraryInsert, canPublishSession, canUnpublishSession, canCopy, copyDisabledLabel, pasteDisabledLabel]);

  if (!isOpen) return null;

  // Simple positioning logic to keep in viewport
  const menuWidth = 240;
  // If showing library list, expand height, otherwise calc standard
  const standardHeight = (type === 'session' ? 4 : 2) * 40 + 16;
  const menuHeight = showLibraryList ? 320 : standardHeight;
  
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
      style={{ top: y, left: x, width: menuWidth, maxHeight: showLibraryList ? 320 : undefined }}
      role="menu"
    >
      {showLibraryList ? (
        <div className="flex flex-col h-full max-h-[300px]">
          <div className="flex items-center justify-between px-2 py-1.5 border-b border-[var(--border-subtle)] mb-1">
             <button onClick={() => setShowLibraryList(false)} className="text-xs text-[var(--muted)] hover:text-[var(--text)] flex items-center gap-1">
               <Icon name="prev" size="xs" /> Back
             </button>
             <span className="text-xs font-medium text-[var(--muted)]">Recurring Group Sessions</span>
          </div>
          <div className="flex-1 overflow-y-auto min-h-0 flex flex-col gap-1 pr-1 custom-scrollbar">
            {libraryItems.length === 0 ? (
               <div className="p-3 text-center text-xs text-[var(--muted)]">No sessions found</div>
            ) : (
               libraryItems.map(item => {
                 const theme = getDisciplineTheme(item.discipline);
                 return (
                   <button
                     key={item.id}
                     onClick={(e) => {
                       e.stopPropagation();
                       onAction('library-insert-item', item);
                     }}
                     className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-xs text-left hover:bg-[var(--bg-structure)] transition-colors group"
                   >
                     <div className={cn("flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center bg-[var(--bg-structure)] border border-[var(--border-subtle)] group-hover:bg-[var(--bg-surface)]", theme.textClass)}>
                       <Icon name={theme.iconName} size="xs" />
                     </div>
                     <div className="min-w-0 flex-1">
                       <p className="font-medium md:truncate text-[var(--text)]">{item.title}</p>
                       <p className="text-[10px] text-[var(--muted)] md:truncate">{item.durationMinutes} min</p>
                     </div>
                   </button>
                 );
               })
            )}
          </div>
          <div className="pt-1 mt-1 border-t border-[var(--border-subtle)]">
            <a
               href="/coach/group-sessions"
               target="_blank"
               onClick={(e) => {
                 e.stopPropagation();
               }}
               className="block w-full text-center text-xs text-[var(--primary)] py-1 hover:underline"
            >
              Manage Recurring sessions
            </a>
          </div>
        </div>
      ) : (
        items.map((item) => (
        <button
          key={item.label}
          onClick={(e) => {
            e.stopPropagation();
            if (!item.disabled) {
              if (item.action === 'library-insert') {
                 // Expand inline
                 setShowLibraryList(true);
              } else {
                 onAction(item.action);
              }
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
          {item.icon ? <Icon name={item.icon} size="sm" className={item.variant === 'danger' ? 'text-rose-600' : 'text-[var(--muted)]'} /> : <div className="w-5 h-5" />}
          {item.label}
        </button>
      )))}
    </div>,
    document.body
  );
}
