'use client';

import { FormEvent, ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';

type SessionDrawerProps = {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  onSubmit?: (event: FormEvent) => void;
  submitLabel?: string;
  submitDisabled?: boolean;
  onDelete?: () => void;
};

export function SessionDrawer({
  isOpen,
  onClose,
  title,
  children,
  onSubmit,
  submitLabel = 'Save',
  submitDisabled = false,
  onDelete,
}: SessionDrawerProps) {
  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />

      {/* Drawer */}
      <div
        className={cn(
          'fixed right-0 top-0 z-50 h-full w-full max-w-2xl overflow-y-auto border-l border-[var(--border-subtle)] bg-[var(--bg-surface)] transition-transform',
          isOpen ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-4 md:px-6">
          <h2 className="text-xl font-semibold">{title}</h2>
          <Button type="button" variant="ghost" onClick={onClose}>
            ✕
          </Button>
        </div>

        <form onSubmit={onSubmit} className="flex min-h-[calc(100vh-72px)] flex-col gap-6 p-4 md:p-6">
          <div className="flex-1 space-y-6">
            {children}
          </div>

          <div className="sticky bottom-0 -mx-4 border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] md:static md:mx-0 md:bg-transparent md:px-0 md:pt-6 md:pb-0">
            <div className="flex flex-wrap gap-3">
              <Button type="submit" disabled={submitDisabled}>
                {submitLabel}
              </Button>
              {onDelete ? (
                <Button type="button" variant="ghost" onClick={onDelete}>
                  Delete
                </Button>
              ) : null}
              <Button type="button" variant="secondary" onClick={onClose}>
                Cancel
              </Button>
            </div>
          </div>
        </form>
      </div>
    </>
  );
}
