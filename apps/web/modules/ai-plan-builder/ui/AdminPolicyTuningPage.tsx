'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { ApiClientError, useApi } from '@/components/api-client';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';

type PolicyProfileView = {
  profileId: 'coachkit-conservative-v1' | 'coachkit-safe-v1' | 'coachkit-performance-v1';
  profileVersion: 'v1';
  label: string;
  description: string;
  effective: {
    maxIntensityDaysHardCap: number;
    maxDoublesHardCap: number;
    defaultRecoveryEveryNWeeks: number;
    defaultRecoveryWeekMultiplier: number;
    weekMinuteBands: {
      baseMinRatio: number;
      baseMaxRatio: number;
      constrainedMinRatio: number;
      constrainedMaxRatio: number;
      beginnerEarlyMinRatio: number;
      beginnerEarlyMaxRatio: number;
      severeMinRatio: number;
      severeMaxRatio: number;
    };
  };
  override: Record<string, unknown> | null;
};

type EditablePolicy = {
  maxIntensityDaysHardCap: string;
  maxDoublesHardCap: string;
  defaultRecoveryEveryNWeeks: string;
  defaultRecoveryWeekMultiplier: string;
  baseMinRatio: string;
  baseMaxRatio: string;
  constrainedMinRatio: string;
  constrainedMaxRatio: string;
  beginnerEarlyMinRatio: string;
  beginnerEarlyMaxRatio: string;
  severeMinRatio: string;
  severeMaxRatio: string;
  description: string;
};

function toEditable(profile: PolicyProfileView): EditablePolicy {
  return {
    maxIntensityDaysHardCap: String(profile.effective.maxIntensityDaysHardCap),
    maxDoublesHardCap: String(profile.effective.maxDoublesHardCap),
    defaultRecoveryEveryNWeeks: String(profile.effective.defaultRecoveryEveryNWeeks),
    defaultRecoveryWeekMultiplier: String(profile.effective.defaultRecoveryWeekMultiplier),
    baseMinRatio: String(profile.effective.weekMinuteBands.baseMinRatio),
    baseMaxRatio: String(profile.effective.weekMinuteBands.baseMaxRatio),
    constrainedMinRatio: String(profile.effective.weekMinuteBands.constrainedMinRatio),
    constrainedMaxRatio: String(profile.effective.weekMinuteBands.constrainedMaxRatio),
    beginnerEarlyMinRatio: String(profile.effective.weekMinuteBands.beginnerEarlyMinRatio),
    beginnerEarlyMaxRatio: String(profile.effective.weekMinuteBands.beginnerEarlyMaxRatio),
    severeMinRatio: String(profile.effective.weekMinuteBands.severeMinRatio),
    severeMaxRatio: String(profile.effective.weekMinuteBands.severeMaxRatio),
    description: String(profile.description ?? ''),
  };
}

function toNumber(value: string): number {
  return Number(value.trim());
}

export function AdminPolicyTuningPage() {
  const { request } = useApi();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<PolicyProfileView[]>([]);
  const [edits, setEdits] = useState<Record<string, EditablePolicy>>({});

  const load = useCallback(async () => {
    setBusy('load');
    setError(null);
    try {
      const data = await request<{ profiles: PolicyProfileView[] }>('/api/admin/ai-plan-builder/policy-tuning', {
        cache: 'no-store',
      });
      const rows = Array.isArray(data.profiles) ? data.profiles : [];
      setProfiles(rows);
      const nextEdits: Record<string, EditablePolicy> = {};
      for (const row of rows) nextEdits[row.profileId] = toEditable(row);
      setEdits(nextEdits);
    } catch (e) {
      const message = e instanceof ApiClientError ? e.message : e instanceof Error ? e.message : 'Failed to load policy tuning.';
      setError(message);
    } finally {
      setBusy(null);
    }
  }, [request]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(
    async (profileId: PolicyProfileView['profileId']) => {
      const current = edits[profileId];
      if (!current) return;

      setBusy(`save:${profileId}`);
      setError(null);
      setInfo(null);
      try {
        await request('/api/admin/ai-plan-builder/policy-tuning', {
          method: 'PUT',
          data: {
            profileId,
            override: {
              description: current.description,
              maxIntensityDaysHardCap: toNumber(current.maxIntensityDaysHardCap),
              maxDoublesHardCap: toNumber(current.maxDoublesHardCap),
              defaultRecoveryEveryNWeeks: toNumber(current.defaultRecoveryEveryNWeeks),
              defaultRecoveryWeekMultiplier: toNumber(current.defaultRecoveryWeekMultiplier),
              weekMinuteBands: {
                baseMinRatio: toNumber(current.baseMinRatio),
                baseMaxRatio: toNumber(current.baseMaxRatio),
                constrainedMinRatio: toNumber(current.constrainedMinRatio),
                constrainedMaxRatio: toNumber(current.constrainedMaxRatio),
                beginnerEarlyMinRatio: toNumber(current.beginnerEarlyMinRatio),
                beginnerEarlyMaxRatio: toNumber(current.beginnerEarlyMaxRatio),
                severeMinRatio: toNumber(current.severeMinRatio),
                severeMaxRatio: toNumber(current.severeMaxRatio),
              },
            },
          },
        });
        await load();
        setInfo(`Saved tuning for ${profileId}.`);
      } catch (e) {
        const message = e instanceof ApiClientError ? e.message : e instanceof Error ? e.message : 'Failed to save policy tuning.';
        setError(message);
      } finally {
        setBusy(null);
      }
    },
    [edits, load, request]
  );

  const content = useMemo(() => {
    if (!profiles.length) return <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-3 text-sm">No policy profiles found.</div>;
    return profiles.map((profile) => {
      const edit = edits[profile.profileId];
      if (!edit) return null;
      return (
        <div key={profile.profileId} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
          <div className="mb-2">
            <div className="text-sm font-semibold">{profile.label}</div>
            <div className="text-xs text-[var(--fg-muted)]">
              {profile.profileId} ({profile.profileVersion})
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium">Description</label>
              <Textarea
                value={edit.description}
                onChange={(e) => setEdits((prev) => ({ ...prev, [profile.profileId]: { ...edit, description: e.target.value } }))}
                rows={2}
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium">Intensity cap</label>
                <Input
                  value={edit.maxIntensityDaysHardCap}
                  onChange={(e) => setEdits((prev) => ({ ...prev, [profile.profileId]: { ...edit, maxIntensityDaysHardCap: e.target.value } }))}
                  inputMode="numeric"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Doubles cap</label>
                <Input
                  value={edit.maxDoublesHardCap}
                  onChange={(e) => setEdits((prev) => ({ ...prev, [profile.profileId]: { ...edit, maxDoublesHardCap: e.target.value } }))}
                  inputMode="numeric"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Recovery every N</label>
                <Input
                  value={edit.defaultRecoveryEveryNWeeks}
                  onChange={(e) => setEdits((prev) => ({ ...prev, [profile.profileId]: { ...edit, defaultRecoveryEveryNWeeks: e.target.value } }))}
                  inputMode="numeric"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Recovery multiplier</label>
                <Input
                  value={edit.defaultRecoveryWeekMultiplier}
                  onChange={(e) => setEdits((prev) => ({ ...prev, [profile.profileId]: { ...edit, defaultRecoveryWeekMultiplier: e.target.value } }))}
                  inputMode="decimal"
                />
              </div>
            </div>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ['baseMinRatio', 'Base min'],
              ['baseMaxRatio', 'Base max'],
              ['constrainedMinRatio', 'Constrained min'],
              ['constrainedMaxRatio', 'Constrained max'],
              ['beginnerEarlyMinRatio', 'Beginner early min'],
              ['beginnerEarlyMaxRatio', 'Beginner early max'],
              ['severeMinRatio', 'Severe min'],
              ['severeMaxRatio', 'Severe max'],
            ].map(([key, label]) => (
              <div key={key}>
                <label className="mb-1 block text-xs font-medium">{label}</label>
                <Input
                  value={(edit as any)[key]}
                  onChange={(e) => setEdits((prev) => ({ ...prev, [profile.profileId]: { ...edit, [key]: e.target.value } as EditablePolicy }))}
                  inputMode="decimal"
                />
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between">
            <div className="text-xs text-[var(--fg-muted)]">
              Quality gate score will reflect these values on next generation/publish.
            </div>
            <Button onClick={() => void save(profile.profileId)} disabled={busy != null}>
              Save tuning
            </Button>
          </div>
        </div>
      );
    });
  }, [busy, edits, profiles, save]);

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">AI Plan Builder Policy Tuning</h1>
        <p className="mt-1 text-sm text-[var(--fg-muted)]">Tune hard caps and load bands for UAT without code changes.</p>
      </div>
      {error ? <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
      {info ? <div className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{info}</div> : null}
      {content}
    </div>
  );
}

