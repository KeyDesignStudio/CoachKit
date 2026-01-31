'use client';

import { useState, useEffect } from 'react';
import { Icon } from '@/components/ui/Icon';
import { Button } from '@/components/ui/Button';

export function CoachCalendarHelp() {
  const [showFirstTimeTip, setShowFirstTimeTip] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    // Check if user has seen the tip
    const hasSeenTip = localStorage.getItem('coach-calendar-right-click-tip-seen');
    if (!hasSeenTip) {
      setShowFirstTimeTip(true);
    }
  }, []);

  const dismissTip = () => {
    setShowFirstTimeTip(false);
    localStorage.setItem('coach-calendar-right-click-tip-seen', 'true');
  };

  const toggleHelp = () => setHelpOpen((prev) => !prev);

  return (
    <>
      {/* Help Trigger (Question Mark) */}
      <button 
        onClick={toggleHelp}
        className="text-[var(--muted)] hover:text-[var(--text)] transition-colors p-1"
        aria-label="Calendar Help"
        title="Calendar Help"
      >
        <Icon name="info" size="sm" />
      </button>

      {/* Helper Popover */}
      {helpOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/10" onClick={() => setHelpOpen(false)} />
          <div className="absolute right-0 top-10 z-50 w-72 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 shadow-xl animate-in fade-in zoom-in-95 duration-200 origin-top-right">
            <h3 className="font-semibold text-sm mb-3 text-[var(--text)] flex items-center gap-2">
              <Icon name="idea" size="sm" className="text-[var(--primary)]" />
              Calendar Tips
            </h3>
            <ul className="space-y-3 text-xs text-[var(--muted)]">
               <li className="flex gap-2">
                 <span className="font-medium text-[var(--text)] whitespace-nowrap">Right-click Session:</span>
                 <span>Copy, Edit, Delete</span>
               </li>
               <li className="flex gap-2">
                 <span className="font-medium text-[var(--text)] whitespace-nowrap">Right-click Day:</span>
                 <span>Paste, Add from Library</span>
               </li>
               <li className="flex gap-2">
                 <span className="font-medium text-[var(--text)] whitespace-nowrap">Bricks:</span>
                 <span>Multi-step sessions show distinct sections (e.g. Run + Bike).</span>
               </li>
            </ul>
            <div className="mt-3 pt-3 border-t border-[var(--border-subtle)] text-right">
               <button onClick={() => setHelpOpen(false)} className="text-xs font-medium text-[var(--primary)] hover:underline">
                 Close
               </button>
            </div>
          </div>
        </>
      )}

      {/* First Time Tooltip - Shows until dismissed */}
      {showFirstTimeTip && !helpOpen && (
        <div className="absolute top-12 right-0 z-40 max-w-[200px] p-3 bg-[var(--bg-inverse)] text-[var(--text-inverse)] rounded-lg shadow-lg text-xs leading-relaxed animate-in slide-in-from-top-2 fade-in duration-300">
          <div className="flex gap-2 items-start">
             <div className="flex-1">
               <span className="font-bold block mb-1">Coach Tip</span>
               Right-click a session to copy it. Right-click another day to paste.
             </div>
             <button onClick={dismissTip} className="opacity-70 hover:opacity-100 p-0.5">
               <Icon name="close" size="xs" />
             </button>
          </div>
          {/* Arrow */}
          <div className="absolute -top-1 right-3.5 w-2 h-2 bg-[var(--bg-inverse)] rotate-45" />
        </div>
      )}
    </>
  );
}
