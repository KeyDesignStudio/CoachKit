'use client';

type ConfirmModalProps = {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmModal({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm" onClick={onCancel} />

      {/* Modal */}
      <div className="fixed left-1/2 top-1/2 z-[60] w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-3xl border border-white/30 bg-white/95 p-6 shadow-2xl backdrop-blur-2xl">
        <h3 className="mb-2 text-lg font-semibold">{title}</h3>
        <p className="mb-6 text-sm text-slate-700">{message}</p>
        <div className="flex gap-3">
          <button
            onClick={onConfirm}
            className="rounded-full bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
          >
            {confirmLabel}
          </button>
          <button
            onClick={onCancel}
            className="rounded-full border border-white/30 bg-white/60 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-white/80"
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </>
  );
}
