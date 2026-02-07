'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@/components/ui/Icon';

type Athlete = {
  userId: string;
  user: {
    id: string;
    name: string | null;
  };
};

type AthleteSelectorProps = {
  athletes: Athlete[];
  selectedIds: Set<string>;
  onChange: (selectedIds: Set<string>) => void;
};

export function AthleteSelector({ athletes, selectedIds, onChange }: AthleteSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownId = 'athlete-selector-dropdown';
  const selectAllRef = useRef<HTMLInputElement>(null);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, width: 320 });

  // Update dropdown position when opened
  useEffect(() => {
    if (isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const desiredWidth = Math.min(360, Math.max(280, window.innerWidth - 16));
      const minLeft = 8;
      const maxLeft = Math.max(8, window.innerWidth - desiredWidth - 8);
      const desiredLeft = rect.right + window.scrollX - desiredWidth;
      setDropdownPosition({
        top: rect.bottom + window.scrollY + 8, // 8px margin (mt-2)
        left: Math.max(minLeft, Math.min(maxLeft, desiredLeft)),
        width: desiredWidth,
      });
    }
  }, [isOpen]);

  const filteredAthletes = useMemo(() => {
    if (!searchQuery) return athletes;
    const query = searchQuery.toLowerCase();
    return athletes.filter((a) => (a.user.name || a.userId).toLowerCase().includes(query));
  }, [athletes, searchQuery]);

  const allSelected = athletes.length > 0 && selectedIds.size === athletes.length;
  const someSelected = selectedIds.size > 0 && selectedIds.size < athletes.length;

  useEffect(() => {
    if (!selectAllRef.current) return;
    // Indeterminate must be set via DOM property.
    selectAllRef.current.indeterminate = someSelected && !allSelected;
  }, [allSelected, someSelected]);

  const toggleAll = () => {
    if (allSelected) {
      onChange(new Set());
    } else {
      onChange(new Set(athletes.map((a) => a.userId)));
    }
  };

  const toggleAthlete = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    onChange(newSet);
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        data-athlete-selector="button"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={dropdownId}
        className="flex items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-structure)] px-3 py-2 text-sm hover:bg-[var(--bg-structure)] transition-colors"
      >
        <span className="font-medium">
          {selectedIds.size === 0
            ? 'Select athletes'
            : selectedIds.size === athletes.length
            ? `All athletes (${athletes.length})`
            : `${selectedIds.size} athlete${selectedIds.size !== 1 ? 's' : ''}`}
        </span>
        <Icon name={isOpen ? 'close' : 'filter'} size="sm" />
      </button>

      {isOpen && typeof window !== 'undefined' && createPortal(
        <>
          <div className="fixed inset-0 z-[100]" onClick={() => setIsOpen(false)} />
          <div 
            id={dropdownId}
            data-athlete-selector="dropdown"
            className="fixed z-[101] max-h-96 overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
            style={{
              top: `${dropdownPosition.top}px`,
              left: `${dropdownPosition.left}px`,
              width: `${dropdownPosition.width}px`,
            }}
          >
            <div className="p-3 border-b border-[var(--border-subtle)]">
              <input
                type="text"
                placeholder="Search athletes..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
              />
            </div>
            <div className="border-b border-[var(--border-subtle)]">
              <label className="flex w-full min-h-[44px] items-center gap-3 px-3 py-2 hover:bg-[var(--bg-structure)] cursor-pointer">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  data-athlete-selector="select-all"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="h-5 w-5 flex-none rounded border-[var(--border-subtle)] bg-[var(--bg-card)]"
                />
                <span className="min-w-0 flex-1 truncate font-medium text-sm">
                  Select all
                </span>
              </label>
            </div>
            <div className="overflow-y-auto max-h-64">
              {filteredAthletes.length === 0 ? (
                <p className="p-4 text-sm text-[var(--muted)] text-center">No athletes found</p>
              ) : (
                filteredAthletes.map((athlete) => (
                  <label
                    key={athlete.userId}
                    className="flex w-full min-h-[44px] items-center gap-3 px-3 py-2 hover:bg-[var(--bg-structure)] cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.has(athlete.userId)}
                      onChange={() => toggleAthlete(athlete.userId)}
                      data-athlete-selector="athlete-checkbox"
                      className="h-5 w-5 flex-none rounded border-[var(--border-subtle)] bg-[var(--bg-card)]"
                    />
                    <span className="min-w-0 flex-1 truncate text-sm">{athlete.user.name || athlete.userId}</span>
                  </label>
                ))
              )}
            </div>
          </div>
        </>,
        document.body
      )}
    </div>
  );
}
