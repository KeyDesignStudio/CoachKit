'use client';

import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/Button';
import styles from './page.module.css';

type Piece = {
  delay: string;
  color: string;
  dx: number;
  dy: number;
  dxEnd: number;
  dyEnd: number;
  rot: string;
  size: number;
};

const COLORS = ['#facc15', '#fb7185', '#38bdf8', '#34d399', '#a78bfa', '#f97316'];
const PRESETS_STORAGE_KEY = 'coachkit-confetti-proof-presets-v1';

type ConfettiPreset = {
  id: string;
  name: string;
  pieces: number;
  spread: number;
  lift: number;
  durationMs: number;
};

function buildPieces(count: number, spread: number, lift: number): Piece[] {
  const rand = (seed: number) => {
    const x = Math.sin(seed * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  };
  return Array.from({ length: count }, (_, index) => {
    const angle = rand(index + 1) * Math.PI * 2;
    const distance = spread * (0.35 + rand(index + 21) * 0.85);
    const dx = Math.round(Math.cos(angle) * distance);
    const dy = Math.round(Math.sin(angle) * distance - lift);
    const gravityDrop = 18 + Math.round(rand(index + 31) * 18);
    return {
      delay: `${Math.round(rand(index + 11) * 42)}ms`,
      color: COLORS[index % COLORS.length],
      dx,
      dy,
      dxEnd: Math.round(dx * 1.08),
      dyEnd: dy + gravityDrop,
      rot: `${Math.round(rand(index + 41) * 420 - 210)}deg`,
      size: 6 + Math.round(rand(index + 51) * 4),
    };
  });
}

export default function DevProofConfettiPage() {
  const [pieces, setPieces] = useState(28);
  const [spread, setSpread] = useState(90);
  const [lift, setLift] = useState(42);
  const [centerBurst, setCenterBurst] = useState(0);
  const [buttonBurst, setButtonBurst] = useState(0);
  const [durationMs, setDurationMs] = useState(1050);
  const [presets, setPresets] = useState<ConfettiPreset[]>([]);
  const [presetName, setPresetName] = useState('');
  const [presetsLoaded, setPresetsLoaded] = useState(false);

  const confetti = useMemo(() => buildPieces(pieces, spread, lift), [pieces, spread, lift]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(PRESETS_STORAGE_KEY);
      if (!raw) {
        setPresetsLoaded(true);
        return;
      }
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const safePresets = parsed
          .filter((p) => p && typeof p === 'object')
          .map((p) => ({
            id: String((p as any).id ?? ''),
            name: String((p as any).name ?? 'Preset'),
            pieces: Number((p as any).pieces ?? 28),
            spread: Number((p as any).spread ?? 90),
            lift: Number((p as any).lift ?? 42),
            durationMs: Number((p as any).durationMs ?? 1050),
          }))
          .filter((p) => p.id && p.name);
        setPresets(safePresets);
      }
    } catch {
      setPresets([]);
    } finally {
      setPresetsLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!presetsLoaded) return;
    window.localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(presets));
  }, [presets, presetsLoaded]);

  const applyPreset = (preset: ConfettiPreset) => {
    setPieces(preset.pieces);
    setSpread(preset.spread);
    setLift(preset.lift);
    setDurationMs(preset.durationMs);
  };

  const savePreset = () => {
    const trimmedName = presetName.trim();
    if (!trimmedName) return;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setPresets((prev) => [
      { id, name: trimmedName, pieces, spread, lift, durationMs },
      ...prev.slice(0, 19),
    ]);
    setPresetName('');
  };

  const deletePreset = (id: string) => {
    setPresets((prev) => prev.filter((p) => p.id !== id));
  };

  return (
    <section className="mx-auto max-w-4xl p-6">
      <h1 className="text-xl font-semibold text-[var(--text)]">Dev Proof: Confetti Burst Playground</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        Isolated sandbox for experimenting with confetti burst behavior used in greeting and workout complete flows.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
        <label className="text-xs text-[var(--muted)]">
          Pieces ({pieces})
          <input
            type="range"
            className="mt-1 w-full"
            min={8}
            max={64}
            step={2}
            value={pieces}
            onChange={(e) => setPieces(Number(e.target.value))}
          />
        </label>
        <label className="text-xs text-[var(--muted)]">
          Spread ({spread})
          <input
            type="range"
            className="mt-1 w-full"
            min={30}
            max={160}
            step={2}
            value={spread}
            onChange={(e) => setSpread(Number(e.target.value))}
          />
        </label>
        <label className="text-xs text-[var(--muted)]">
          Lift ({lift})
          <input
            type="range"
            className="mt-1 w-full"
            min={12}
            max={90}
            step={1}
            value={lift}
            onChange={(e) => setLift(Number(e.target.value))}
          />
        </label>
        <label className="text-xs text-[var(--muted)]">
          Duration ({durationMs}ms)
          <input
            type="range"
            className="mt-1 w-full"
            min={500}
            max={1800}
            step={50}
            value={durationMs}
            onChange={(e) => setDurationMs(Number(e.target.value))}
          />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="button" onClick={() => setCenterBurst((v) => v + 1)}>
          Play Center Burst
        </Button>
        <Button type="button" variant="secondary" onClick={() => setButtonBurst((v) => v + 1)}>
          Play Button-Origin Burst
        </Button>
      </div>

      <div className="mt-4 rounded-xl border border-[var(--border-subtle)] p-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            placeholder="Preset name (e.g. Burst v3)"
            className="h-10 min-w-[220px] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 text-sm text-[var(--text)]"
          />
          <Button type="button" size="sm" onClick={savePreset} disabled={!presetName.trim()}>
            Save Preset
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {presets.length === 0 ? (
            <p className="text-xs text-[var(--muted)]">No saved presets yet.</p>
          ) : (
            presets.map((preset) => (
              <div key={preset.id} className="inline-flex items-center gap-1 rounded-full border border-[var(--border-subtle)] px-2 py-1">
                <button
                  type="button"
                  className="text-xs font-medium text-[var(--text)] hover:underline"
                  onClick={() => applyPreset(preset)}
                >
                  {preset.name}
                </button>
                <button
                  type="button"
                  aria-label={`Delete preset ${preset.name}`}
                  className="text-xs text-[var(--muted)] hover:text-rose-600"
                  onClick={() => deletePreset(preset.id)}
                >
                  ✕
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      <div className={`mt-5 p-4 ${styles.stage}`} data-testid="confetti-proof-stage">
        <p className="text-sm font-medium text-[var(--text)]">Preview Area</p>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Center burst mimics greeting. Button-origin burst mimics workout Complete.
        </p>

        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-sm font-semibold text-[var(--text)]">
          Great effort today!
        </div>

        {centerBurst > 0 ? (
          <div className={styles.burstLayer} key={`center-${centerBurst}`} data-testid="confetti-proof-center">
            {confetti.map((piece, index) => (
              <span
                key={`center-piece-${centerBurst}-${index}`}
                className={styles.piece}
                style={{
                  animationDelay: piece.delay,
                  animationDuration: `${durationMs}ms`,
                  backgroundColor: piece.color,
                  width: `${piece.size}px`,
                  height: `${Math.round(piece.size * 1.8)}px`,
                  ['--dx' as any]: `${piece.dx}px`,
                  ['--dy' as any]: `${piece.dy}px`,
                  ['--dx-end' as any]: `${piece.dxEnd}px`,
                  ['--dy-end' as any]: `${piece.dyEnd}px`,
                  ['--rot' as any]: piece.rot,
                }}
              />
            ))}
          </div>
        ) : null}

        <div className="absolute bottom-4 right-4">
          <Button type="button" size="sm" onClick={() => setButtonBurst((v) => v + 1)}>
            Complete
          </Button>
          {buttonBurst > 0 ? (
            <div className={styles.burstLayer} key={`button-${buttonBurst}`} data-testid="confetti-proof-button">
              {confetti.map((piece, index) => (
                <span
                  key={`button-piece-${buttonBurst}-${index}`}
                  className={styles.piece}
                  style={{
                    left: '86%',
                    top: '87%',
                    animationDelay: piece.delay,
                    animationDuration: `${durationMs}ms`,
                    backgroundColor: piece.color,
                    width: `${piece.size}px`,
                    height: `${Math.round(piece.size * 1.8)}px`,
                    ['--dx' as any]: `${piece.dx}px`,
                    ['--dy' as any]: `${piece.dy}px`,
                    ['--dx-end' as any]: `${piece.dxEnd}px`,
                    ['--dy-end' as any]: `${piece.dyEnd}px`,
                    ['--rot' as any]: piece.rot,
                  }}
                />
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
