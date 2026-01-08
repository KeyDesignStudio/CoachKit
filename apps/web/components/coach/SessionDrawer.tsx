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
      <div className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm" onClick={onClose} />

      {/* Drawer */}
      <div
        className={cn(
          'fixed right-0 top-0 z-50 h-full w-full max-w-2xl overflow-y-auto border-l border-white/20 bg-white/90 backdrop-blur-3xl shadow-2xl transition-transform',
          isOpen ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/20 bg-white/60 px-6 py-4 backdrop-blur-xl">
          <h2 className="text-xl font-semibold">{title}</h2>
          <Button type="button" variant="ghost" onClick={onClose}>
            ✕
          </Button>
        </div>

        <form onSubmit={onSubmit} className="space-y-6 p-6">
          {children}

          <div className="flex flex-wrap gap-3 border-t border-white/20 pt-6">
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
        </form>
      </div>
    </>
  );
}
