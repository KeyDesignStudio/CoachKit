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
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, width: 0 });

  // Update dropdown position when opened
  useEffect(() => {
    if (isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setDropdownPosition({
        top: rect.bottom + window.scrollY + 8, // 8px margin (mt-2)
        left: rect.right + window.scrollX - 320, // 320px = w-80, align right
        width: rect.width,
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
            className="fixed z-[101] w-80 max-h-96 overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
            style={{
              top: `${dropdownPosition.top}px`,
              left: `${dropdownPosition.left}px`,
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
            <div className="p-2 border-b border-[var(--border-subtle)]">
              <label className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-[var(--bg-structure)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected;
                  }}
                  onChange={toggleAll}
                  className="w-4 h-4 rounded border-[var(--border-subtle)] bg-[var(--bg-card)]"
                />
                <span className="font-medium text-sm">
                  {allSelected ? 'Deselect all' : 'Select all'}
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
                    className="flex items-center gap-2 px-3 py-2 hover:bg-[var(--bg-structure)] cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.has(athlete.userId)}
                      onChange={() => toggleAthlete(athlete.userId)}
                      className="w-4 h-4 rounded border-[var(--border-subtle)] bg-[var(--bg-card)]"
                    />
                    <span className="text-sm">{athlete.user.name || athlete.userId}</span>
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
