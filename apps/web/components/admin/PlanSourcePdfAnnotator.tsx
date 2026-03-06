'use client';

import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Icon } from '@/components/ui/Icon';
import { cn } from '@/lib/cn';

declare global {
  interface Window {
    pdfjsLib?: any;
    __coachKitPdfJsPromise?: Promise<any>;
  }
}

const PDFJS_URL = 'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.min.js';
const PDFJS_WORKER_URL = 'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
const ANNOTATION_TYPES = ['WEEK_HEADER', 'DAY_LABEL', 'SESSION_CELL', 'BLOCK_TITLE', 'IGNORE_REGION', 'LEGEND', 'NOTE'] as const;

type AnnotationType = (typeof ANNOTATION_TYPES)[number];

type AnnotationBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type PdfAnnotation = {
  id: string;
  pageNumber: number;
  annotationType: AnnotationType;
  label: string | null;
  bboxJson: AnnotationBox;
  note: string | null;
  createdByEmail: string;
  createdAt: string;
  updatedAt: string;
};

type PlanSourcePdfAnnotatorProps = {
  pdfUrl: string;
  annotations: PdfAnnotation[];
  onCreateAnnotation: (payload: {
    pageNumber: number;
    annotationType: AnnotationType;
    label: string;
    note: string;
    bbox: AnnotationBox;
  }) => Promise<void>;
  onDeleteAnnotation: (annotationId: string) => Promise<void>;
};

type Point = { x: number; y: number };

function formatEnum(value: string) {
  return value
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function toDraftBox(start: Point, end: Point): AnnotationBox {
  const left = Math.min(start.x, end.x);
  const top = Math.min(start.y, end.y);
  return {
    x: left,
    y: top,
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

async function loadPdfJs() {
  if (typeof window === 'undefined') return null;
  if (window.pdfjsLib) return window.pdfjsLib;
  if (window.__coachKitPdfJsPromise) return window.__coachKitPdfJsPromise;

  window.__coachKitPdfJsPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-coachkit-pdfjs="true"]');
    if (existing) {
      existing.addEventListener('load', () => resolve(window.pdfjsLib), { once: true });
      existing.addEventListener('error', () => reject(new Error('Failed to load PDF.js runtime.')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = PDFJS_URL;
    script.async = true;
    script.dataset.coachkitPdfjs = 'true';
    script.onload = () => {
      if (!window.pdfjsLib) {
        reject(new Error('PDF.js runtime loaded without exposing pdfjsLib.'));
        return;
      }
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
      resolve(window.pdfjsLib);
    };
    script.onerror = () => reject(new Error('Failed to load PDF.js runtime.'));
    document.head.appendChild(script);
  });

  return window.__coachKitPdfJsPromise;
}

export function PlanSourcePdfAnnotator({ pdfUrl, annotations, onCreateAnnotation, onDeleteAnnotation }: PlanSourcePdfAnnotatorProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [zoom, setZoom] = useState(1.15);
  const [renderSize, setRenderSize] = useState({ width: 0, height: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [drawStart, setDrawStart] = useState<Point | null>(null);
  const [draftBox, setDraftBox] = useState<AnnotationBox | null>(null);
  const [annotationType, setAnnotationType] = useState<AnnotationType>('SESSION_CELL');
  const [label, setLabel] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'create' | 'delete' | null>(null);

  const pageAnnotations = useMemo(
    () => annotations.filter((annotation) => annotation.pageNumber === pageNumber),
    [annotations, pageNumber]
  );

  const renderPage = useCallback(async () => {
    if (!pdfDoc || !canvasRef.current) return;
    setLoading(true);
    setError('');
    try {
      const page = await pdfDoc.getPage(pageNumber);
      const viewport = page.getViewport({ scale: zoom });
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas context unavailable.');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      await page.render({ canvasContext: context, viewport }).promise;
      setRenderSize({ width: viewport.width, height: viewport.height });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to render the PDF page.');
    } finally {
      setLoading(false);
    }
  }, [pageNumber, pdfDoc, zoom]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setPdfDoc(null);
    setPageCount(0);
    setPageNumber(1);

    void (async () => {
      try {
        const pdfjsLib = await loadPdfJs();
        if (!pdfjsLib) throw new Error('PDF.js could not be initialised.');
        const task = pdfjsLib.getDocument({ url: pdfUrl, withCredentials: false });
        const loaded = await task.promise;
        if (cancelled) return;
        setPdfDoc(loaded);
        setPageCount(loaded.numPages || 0);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load stored PDF.');
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pdfUrl]);

  useEffect(() => {
    if (!pdfDoc) return;
    void renderPage();
  }, [pdfDoc, renderPage]);

  const toNormalizedPoint = useCallback((clientX: number, clientY: number): Point | null => {
    const overlay = overlayRef.current;
    if (!overlay || !renderSize.width || !renderSize.height) return null;
    const rect = overlay.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: clamp((clientX - rect.left) / rect.width, 0, 1),
      y: clamp((clientY - rect.top) / rect.height, 0, 1),
    };
  }, [renderSize.height, renderSize.width]);

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const point = toNormalizedPoint(event.clientX, event.clientY);
    if (!point) return;
    setDrawStart(point);
    setDraftBox({ x: point.x, y: point.y, width: 0, height: 0 });
  }, [toNormalizedPoint]);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drawStart) return;
    const point = toNormalizedPoint(event.clientX, event.clientY);
    if (!point) return;
    setDraftBox(toDraftBox(drawStart, point));
  }, [drawStart, toNormalizedPoint]);

  const handlePointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drawStart) return;
    const point = toNormalizedPoint(event.clientX, event.clientY);
    setDrawStart(null);
    if (!point) return;
    const nextBox = toDraftBox(drawStart, point);
    if (nextBox.width < 0.01 || nextBox.height < 0.01) {
      setDraftBox(null);
      return;
    }
    setDraftBox(nextBox);
  }, [drawStart, toNormalizedPoint]);

  const saveDraftBox = useCallback(async () => {
    if (!draftBox) return;
    setBusy('create');
    setError('');
    try {
      await onCreateAnnotation({
        pageNumber,
        annotationType,
        label,
        note,
        bbox: draftBox,
      });
      setDraftBox(null);
      setLabel('');
      setNote('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save annotation.');
    } finally {
      setBusy(null);
    }
  }, [annotationType, draftBox, label, note, onCreateAnnotation, pageNumber]);

  const removeAnnotation = useCallback(async (annotationId: string) => {
    setBusy('delete');
    setError('');
    try {
      await onDeleteAnnotation(annotationId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete annotation.');
    } finally {
      setBusy(null);
    }
  }, [onDeleteAnnotation]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">PDF Layout Review</h3>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Draw boxes over the rendered page to mark week headers, session cells, day labels, or ignore regions.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <button
            type="button"
            onClick={() => setPageNumber((current) => Math.max(1, current - 1))}
            disabled={pageNumber <= 1}
            className="inline-flex min-h-[40px] items-center gap-1 rounded-full border border-[var(--border-subtle)] px-3 py-2 text-[var(--text)] disabled:opacity-50"
          >
            <Icon name="prev" size="sm" aria-hidden />
            <span>Prev</span>
          </button>
          <div className="rounded-full border border-[var(--border-subtle)] px-3 py-2 text-xs text-[var(--muted)]">
            Page {pageNumber} / {pageCount || '—'}
          </div>
          <button
            type="button"
            onClick={() => setPageNumber((current) => Math.min(pageCount || current, current + 1))}
            disabled={!pageCount || pageNumber >= pageCount}
            className="inline-flex min-h-[40px] items-center gap-1 rounded-full border border-[var(--border-subtle)] px-3 py-2 text-[var(--text)] disabled:opacity-50"
          >
            <span>Next</span>
            <Icon name="next" size="sm" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => setZoom((current) => clamp(current - 0.15, 0.7, 2))}
            className="inline-flex min-h-[40px] items-center rounded-full border border-[var(--border-subtle)] px-3 py-2 text-[var(--text)]"
          >
            - Zoom
          </button>
          <button
            type="button"
            onClick={() => setZoom((current) => clamp(current + 0.15, 0.7, 2))}
            className="inline-flex min-h-[40px] items-center rounded-full border border-[var(--border-subtle)] px-3 py-2 text-[var(--text)]"
          >
            + Zoom
          </button>
        </div>
      </div>

      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="overflow-auto rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3">
          <div
            ref={overlayRef}
            className="relative mx-auto select-none"
            style={{ width: renderSize.width || undefined, height: renderSize.height || undefined }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          >
            <canvas ref={canvasRef} className="block max-w-full rounded-xl" />
            {pageAnnotations.map((annotation) => (
              <div
                key={annotation.id}
                className={cn(
                  'pointer-events-none absolute border-2',
                  annotation.annotationType === 'IGNORE_REGION'
                    ? 'border-rose-500 bg-rose-500/10'
                    : annotation.annotationType === 'WEEK_HEADER'
                      ? 'border-sky-500 bg-sky-500/10'
                      : annotation.annotationType === 'DAY_LABEL'
                        ? 'border-emerald-500 bg-emerald-500/10'
                        : 'border-amber-500 bg-amber-500/10'
                )}
                style={{
                  left: `${annotation.bboxJson.x * 100}%`,
                  top: `${annotation.bboxJson.y * 100}%`,
                  width: `${annotation.bboxJson.width * 100}%`,
                  height: `${annotation.bboxJson.height * 100}%`,
                }}
              >
                <span className="absolute left-1 top-1 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                  {formatEnum(annotation.annotationType)}
                </span>
              </div>
            ))}
            {draftBox ? (
              <div
                className="pointer-events-none absolute border-2 border-fuchsia-500 bg-fuchsia-500/10"
                style={{
                  left: `${draftBox.x * 100}%`,
                  top: `${draftBox.y * 100}%`,
                  width: `${draftBox.width * 100}%`,
                  height: `${draftBox.height * 100}%`,
                }}
              />
            ) : null}
            {loading ? (
              <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-[var(--bg-card)]/80 text-sm text-[var(--muted)]">
                Loading PDF page…
              </div>
            ) : null}
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
            <div className="text-sm font-semibold">New annotation</div>
            <div className="mt-3 space-y-3">
              <label className="space-y-1">
                <span className="text-xs font-medium text-[var(--muted)]">Annotation type</span>
                <select
                  value={annotationType}
                  onChange={(event) => setAnnotationType(event.target.value as AnnotationType)}
                  className="min-h-[44px] w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text)]"
                >
                  {ANNOTATION_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {formatEnum(type)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium text-[var(--muted)]">Label</span>
                <input
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                  className="min-h-[44px] w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text)]"
                  placeholder="Week 1 header, Monday labels, etc."
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium text-[var(--muted)]">Note</span>
                <textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  rows={4}
                  className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text)]"
                  placeholder="What should the parser do with this region?"
                />
              </label>
              <div className="rounded-xl bg-[var(--bg-structure)]/55 px-3 py-3 text-xs text-[var(--muted)]">
                {draftBox
                  ? `Draft box: x ${draftBox.x.toFixed(3)}, y ${draftBox.y.toFixed(3)}, w ${draftBox.width.toFixed(3)}, h ${draftBox.height.toFixed(3)}`
                  : 'Draw a box on the page first.'}
              </div>
              <button
                type="button"
                onClick={() => void saveDraftBox()}
                disabled={!draftBox || busy != null}
                className="inline-flex min-h-[44px] w-full items-center justify-center rounded-full bg-[var(--text)] px-4 py-2 text-sm font-medium text-[var(--bg-page)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                Save annotation
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
            <div className="text-sm font-semibold">Annotations on this page</div>
            <div className="mt-3 space-y-2">
              {pageAnnotations.length ? (
                pageAnnotations.map((annotation) => (
                  <div key={annotation.id} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium text-[var(--text)]">{annotation.label || formatEnum(annotation.annotationType)}</div>
                        <div className="mt-1 text-xs text-[var(--muted)]">{formatEnum(annotation.annotationType)} · by {annotation.createdByEmail}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void removeAnnotation(annotation.id)}
                        disabled={busy != null}
                        className="inline-flex min-h-[36px] items-center rounded-full border border-rose-300 px-3 py-1 text-xs font-medium text-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Delete
                      </button>
                    </div>
                    {annotation.note ? <div className="mt-2 text-xs text-[var(--text)]">{annotation.note}</div> : null}
                  </div>
                ))
              ) : (
                <div className="rounded-xl border border-dashed border-[var(--border-subtle)] px-3 py-6 text-sm text-[var(--muted)]">
                  No annotations recorded on this page yet.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
