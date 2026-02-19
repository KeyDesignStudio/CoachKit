'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useApi } from '@/components/api-client';
import { useAuthUser } from '@/components/use-auth-user';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { FormFieldSpan, FormGrid, FormPageContainer, FormSection } from '@/components/ui/FormLayout';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { TimezoneSelect } from '@/components/TimezoneSelect';
import { StravaVitalsCard } from '@/components/profile/StravaVitalsCard';
import { getDisciplineTheme } from '@/components/ui/disciplineTheme';
import { uiH1, uiMuted } from '@/components/ui/typography';
import { cn } from '@/lib/cn';
import type { StravaVitalsSnapshot } from '@/lib/strava-vitals';
import { normalizeAustralianMobile } from '@/modules/athlete-intake/validation';

const DISCIPLINES = ['RUN', 'BIKE', 'SWIM', 'BRICK', 'STRENGTH', 'OTHER'] as const;
const AVAILABLE_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

const GENDER_OPTIONS = ['Female', 'Male', 'Non-binary', 'Prefer not to say', 'Other'] as const;
const EXPERIENCE_OPTIONS = ['New to structured training', 'Some experience', 'Experienced'] as const;
const CONSISTENCY_OPTIONS = ['Just starting', 'Some weeks consistent', 'Mostly consistent'] as const;
const SCHEDULE_VARIABILITY_OPTIONS = ['Very stable', 'Some variation', 'Often unpredictable'] as const;
const SLEEP_QUALITY_OPTIONS = ['Great', 'Okay', 'Inconsistent', 'Poor'] as const;
const INJURY_OPTIONS = ['No injuries', 'Managing minor pain', 'Recovering from injury', 'Medical considerations'] as const;
const FEEDBACK_STYLE_OPTIONS = ['Direct and concise', 'Encouraging and supportive', 'Balanced and pragmatic'] as const;
const TONE_OPTIONS = ['Direct', 'Warm', 'Balanced'] as const;
const CHECK_IN_OPTIONS = ['Weekly', 'Every two weeks', 'Only when needed', 'As needed'] as const;
const MOTIVATION_OPTIONS = ['Progress updates', 'Clear accountability', 'Variety', 'Performance targets', 'Community'] as const;

type AthleteProfile = {
  userId: string;
  coachId: string;
  firstName?: string | null;
  lastName?: string | null;
  gender?: string | null;
  timezone?: string | null;
  trainingSuburb?: string | null;
  email?: string | null;
  mobilePhone?: string | null;
  disciplines: string[];
  primaryGoal?: string | null;
  secondaryGoals?: string[] | null;
  focus?: string | null;
  eventName?: string | null;
  eventDate?: string | null;
  timelineWeeks?: number | null;
  experienceLevel?: string | null;
  weeklyMinutesTarget?: number | null;
  consistencyLevel?: string | null;
  swimConfidence?: number | null;
  bikeConfidence?: number | null;
  runConfidence?: number | null;
  availableDays?: string[] | null;
  scheduleVariability?: string | null;
  sleepQuality?: string | null;
  equipmentAccess?: string | null;
  travelConstraints?: string | null;
  injuryStatus?: string | null;
  constraintsNotes?: string | null;
  feedbackStyle?: string | null;
  tonePreference?: string | null;
  checkInCadence?: string | null;
  structurePreference?: number | null;
  motivationStyle?: string | null;
  trainingPlanSchedule?: {
    frequency: 'WEEKLY' | 'FORTNIGHTLY' | 'MONTHLY' | 'AD_HOC';
    dayOfWeek?: number | null;
    weekOfMonth?: 1 | 2 | 3 | 4 | null;
  } | null;
  dateOfBirth?: string | null;
  user: {
    id: string;
    name: string | null;
    email: string;
    timezone: string;
  };
};

const TABS = ['Personal', 'Training Basics', 'Current Training Plan'] as const;
type TabKey = (typeof TABS)[number];

const gridColumns = { base: 1, md: 2, xl: 4 } as const;
const span1 = { base: 1, md: 1, xl: 1 } as const;
const span2 = { base: 1, md: 2, xl: 2 } as const;
const span4 = { base: 1, md: 2, xl: 4 } as const;

export default function AthleteProfilePage() {
  const router = useRouter();
  const { request } = useApi();
  const { user, loading: userLoading } = useAuthUser();

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [vitals, setVitals] = useState<StravaVitalsSnapshot | null>(null);
  const [vitalsLoading, setVitalsLoading] = useState(false);
  const [vitalsError, setVitalsError] = useState('');
  const [activeTab, setActiveTab] = useState<TabKey>('Personal');

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [gender, setGender] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [email, setEmail] = useState('');
  const [mobilePhone, setMobilePhone] = useState('');
  const [timezone, setTimezone] = useState('Australia/Brisbane');
  const [trainingSuburb, setTrainingSuburb] = useState('');

  const [experienceLevel, setExperienceLevel] = useState('');
  const [primaryGoal, setPrimaryGoal] = useState('');
  const [secondaryGoals, setSecondaryGoals] = useState('');
  const [weeklyMinutesTarget, setWeeklyMinutesTarget] = useState('');
  const [consistencyLevel, setConsistencyLevel] = useState('');
  const [swimConfidence, setSwimConfidence] = useState('');
  const [bikeConfidence, setBikeConfidence] = useState('');
  const [runConfidence, setRunConfidence] = useState('');
  const [trainingPlanFrequency, setTrainingPlanFrequency] = useState<'WEEKLY' | 'FORTNIGHTLY' | 'MONTHLY' | 'AD_HOC'>('AD_HOC');
  const [trainingPlanDayOfWeek, setTrainingPlanDayOfWeek] = useState<number | null>(null);
  const [trainingPlanWeekOfMonth, setTrainingPlanWeekOfMonth] = useState<1 | 2 | 3 | 4 | null>(null);
  const [feedbackStyle, setFeedbackStyle] = useState('');
  const [tonePreference, setTonePreference] = useState('');
  const [checkInCadence, setCheckInCadence] = useState('');
  const [structurePreference, setStructurePreference] = useState('');
  const [motivationStyle, setMotivationStyle] = useState('');

  const [focus, setFocus] = useState('');
  const [eventName, setEventName] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [timelineWeeks, setTimelineWeeks] = useState('');
  const [selectedDisciplines, setSelectedDisciplines] = useState<string[]>([]);
  const [availableDays, setAvailableDays] = useState<string[]>([]);
  const [scheduleVariability, setScheduleVariability] = useState('');
  const [sleepQuality, setSleepQuality] = useState('');
  const [equipmentAccess, setEquipmentAccess] = useState('');
  const [travelConstraints, setTravelConstraints] = useState('');
  const [injuryStatus, setInjuryStatus] = useState('');
  const [constraintsNotes, setConstraintsNotes] = useState('');

  useEffect(() => {
    if (userLoading) return;
    if (!user || user.role !== 'ATHLETE') return;

    const loadData = async () => {
      setLoading(true);
      setError('');
      setVitalsLoading(true);
      setVitalsError('');
      try {
        const [data, vitalsData] = await Promise.all([
          request<{ athlete: AthleteProfile }>('/api/athlete/profile', { cache: 'no-store' }),
          request<{ vitals: StravaVitalsSnapshot }>('/api/athlete/strava-vitals?windowDays=90', { cache: 'no-store' }),
        ]);
        const athlete = data.athlete;
        setVitals(vitalsData.vitals);

        setFirstName(athlete.firstName || '');
        setLastName(athlete.lastName || '');
        setGender(athlete.gender || '');
        setDateOfBirth(athlete.dateOfBirth ? athlete.dateOfBirth.split('T')[0] : '');
        setEmail(athlete.user.email || athlete.email || '');
        setMobilePhone(athlete.mobilePhone || '');
        setTimezone(athlete.timezone || athlete.user.timezone || 'Australia/Brisbane');
        setTrainingSuburb(athlete.trainingSuburb || '');

        setExperienceLevel(athlete.experienceLevel || '');
        setPrimaryGoal(athlete.primaryGoal || '');
        setSecondaryGoals((athlete.secondaryGoals ?? []).join(', '));
        setWeeklyMinutesTarget(athlete.weeklyMinutesTarget != null ? String(athlete.weeklyMinutesTarget) : '');
        setConsistencyLevel(athlete.consistencyLevel || '');
        setSwimConfidence(athlete.swimConfidence != null ? String(athlete.swimConfidence) : '');
        setBikeConfidence(athlete.bikeConfidence != null ? String(athlete.bikeConfidence) : '');
        setRunConfidence(athlete.runConfidence != null ? String(athlete.runConfidence) : '');
        setTrainingPlanFrequency(athlete.trainingPlanSchedule?.frequency ?? 'AD_HOC');
        setTrainingPlanDayOfWeek(
          athlete.trainingPlanSchedule?.dayOfWeek === undefined
            ? null
            : (athlete.trainingPlanSchedule?.dayOfWeek ?? null)
        );
        setTrainingPlanWeekOfMonth(
          athlete.trainingPlanSchedule?.weekOfMonth === undefined
            ? null
            : (athlete.trainingPlanSchedule?.weekOfMonth ?? null)
        );
        setFeedbackStyle(athlete.feedbackStyle || '');
        setTonePreference(athlete.tonePreference || '');
        setCheckInCadence(athlete.checkInCadence || '');
        setStructurePreference(athlete.structurePreference != null ? String(athlete.structurePreference) : '');
        setMotivationStyle(athlete.motivationStyle || '');

        setFocus(athlete.focus || '');
        setEventName(athlete.eventName || '');
        setEventDate(athlete.eventDate ? athlete.eventDate.split('T')[0] : '');
        setTimelineWeeks(athlete.timelineWeeks != null ? String(athlete.timelineWeeks) : '');
        setSelectedDisciplines(athlete.disciplines ?? []);
        setAvailableDays(athlete.availableDays ?? []);
        setScheduleVariability(athlete.scheduleVariability || '');
        setSleepQuality(athlete.sleepQuality || '');
        setEquipmentAccess(athlete.equipmentAccess || '');
        setTravelConstraints(athlete.travelConstraints || '');
        setInjuryStatus(athlete.injuryStatus || '');
        setConstraintsNotes(athlete.constraintsNotes || '');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load profile.');
        setVitals(null);
        setVitalsError(err instanceof Error ? err.message : 'Failed to load Strava vitals.');
      } finally {
        setLoading(false);
        setVitalsLoading(false);
      }
    };

    loadData();
  }, [request, user, userLoading]);

  const toggleDiscipline = (discipline: string) => {
    setSelectedDisciplines((prev) =>
      prev.includes(discipline) ? prev.filter((d) => d !== discipline) : [...prev, discipline]
    );
  };

  const toggleAvailableDay = (day: string) => {
    setAvailableDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]));
  };

  const formattedTabs = useMemo(
    () =>
      TABS.map((tab) => ({
        key: tab,
        label: tab,
      })),
    []
  );

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setSuccess('');

    try {
      if (!timezone.trim()) {
        throw new Error('Timezone is required.');
      }

      if (selectedDisciplines.length === 0) {
        throw new Error('At least one discipline is required.');
      }

      if (trainingPlanFrequency !== 'AD_HOC' && trainingPlanDayOfWeek === null) {
        throw new Error('Training plan schedule day is required.');
      }

      if (trainingPlanFrequency === 'MONTHLY' && trainingPlanWeekOfMonth === null) {
        throw new Error('Training plan schedule week is required.');
      }

      const trimmedMobile = mobilePhone.trim();
      if (trimmedMobile) {
        const normalized = normalizeAustralianMobile(trimmedMobile);
        if (!normalized) {
          throw new Error('Enter an Australian mobile number, e.g. 04xx xxx xxx or +614xx xxx xxx.');
        }
      }

      await request('/api/athlete/profile', {
        method: 'PATCH',
        data: {
          firstName: firstName.trim() || undefined,
          lastName: lastName.trim() || undefined,
          gender: gender.trim() || null,
          mobilePhone: mobilePhone.trim() || null,
          trainingSuburb: trainingSuburb.trim() || null,
          timezone,
          disciplines: selectedDisciplines,
          primaryGoal: primaryGoal.trim() || null,
          secondaryGoals: secondaryGoals
            .split(',')
            .map((g) => g.trim())
            .filter(Boolean),
          focus: focus.trim() || null,
          eventName: eventName.trim() || null,
          eventDate: eventDate || null,
          timelineWeeks: timelineWeeks ? Number(timelineWeeks) : null,
          experienceLevel: experienceLevel.trim() || null,
          weeklyMinutesTarget: weeklyMinutesTarget ? Number(weeklyMinutesTarget) : null,
          consistencyLevel: consistencyLevel.trim() || null,
          swimConfidence: swimConfidence ? Number(swimConfidence) : null,
          bikeConfidence: bikeConfidence ? Number(bikeConfidence) : null,
          runConfidence: runConfidence ? Number(runConfidence) : null,
          availableDays,
          scheduleVariability: scheduleVariability.trim() || null,
          sleepQuality: sleepQuality.trim() || null,
          equipmentAccess: equipmentAccess.trim() || null,
          travelConstraints: travelConstraints.trim() || null,
          injuryStatus: injuryStatus.trim() || null,
          constraintsNotes: constraintsNotes.trim() || null,
          feedbackStyle: feedbackStyle.trim() || null,
          tonePreference: tonePreference.trim() || null,
          checkInCadence: checkInCadence.trim() || null,
          structurePreference: structurePreference ? Number(structurePreference) : null,
          motivationStyle: motivationStyle.trim() || null,
          trainingPlanSchedule: {
            frequency: trainingPlanFrequency,
            dayOfWeek: trainingPlanFrequency === 'AD_HOC' ? null : trainingPlanDayOfWeek,
            weekOfMonth: trainingPlanFrequency === 'MONTHLY' ? trainingPlanWeekOfMonth : null,
          },
          dateOfBirth: dateOfBirth || null,
        },
      });

      setSuccess('Saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save changes.');
    } finally {
      setSaving(false);
    }
  };

  if (userLoading) {
    return (
      <div className="px-6 pt-6">
        <p className="text-[var(--muted)]">Loading...</p>
      </div>
    );
  }

  if (!user || user.role !== 'ATHLETE') {
    return (
      <div className="px-6 pt-6">
        <p className="text-[var(--muted)]">Athlete access required.</p>
      </div>
    );
  }

  return (
    <FormPageContainer maxWidth="3xl">
      <div className="sticky top-0 z-20 -mx-4 mb-6 border-b border-[var(--border-subtle)] bg-[var(--bg-page)] px-4 pb-4 pt-4 md:-mx-6 md:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className={uiH1}>Athlete Profile</h1>
            <p className={uiMuted}>Update your training profile and preferences.</p>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="secondary" onClick={() => router.push('/athlete/dashboard')}>
              Back to dashboard
            </Button>
            <Button type="button" onClick={handleSave} disabled={saving || loading}>
              {saving ? 'Saving...' : 'Save changes'}
            </Button>
          </div>
        </div>
      </div>

      {error ? <p className="mb-4 text-sm text-red-600">{error}</p> : null}
      {success ? <p className="mb-4 text-sm text-emerald-700">{success}</p> : null}
      <StravaVitalsCard vitals={vitals} loading={vitalsLoading} error={vitalsError} />

      {loading ? <p className={uiMuted}>Loading profile...</p> : null}

      <div className="mb-6" role="tablist" aria-label="Athlete profile tabs">
        <div className="inline-flex rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-1">
          {formattedTabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.key}
              aria-controls={`tab-panel-${tab.key.replace(/\s+/g, '-')}`}
              className={cn(
                'rounded-full px-4 py-2 text-sm font-medium transition-colors',
                activeTab === tab.key
                  ? 'bg-[var(--bg-card)] text-[var(--text)] shadow-sm'
                  : 'text-[var(--muted)] hover:text-[var(--text)]'
              )}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'Personal' ? (
        <FormGrid role="tabpanel" id="tab-panel-Personal" columns={gridColumns}>
          <FormSection title="Identity" />
          <FormFieldSpan span={span1}>
            <label className="flex flex-col gap-2 text-sm font-medium">
              First Name
              <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </label>
          </FormFieldSpan>
          <FormFieldSpan span={span1}>
            <label className="flex flex-col gap-2 text-sm font-medium">
              Last Name
              <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </label>
          </FormFieldSpan>
          <FormFieldSpan span={span1}>
            <label className="flex flex-col gap-2 text-sm font-medium">
              Gender
              <Select value={gender} onChange={(e) => setGender(e.target.value)}>
                <option value="">Select...</option>
                {GENDER_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </Select>
            </label>
          </FormFieldSpan>
          <FormFieldSpan span={span1}>
            <label className="flex flex-col gap-2 text-sm font-medium">
              Date of Birth
              <Input type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} />
            </label>
          </FormFieldSpan>

          <FormSection title="Contact" className="mt-2" />
          <FormFieldSpan span={span2}>
            <label className="flex flex-col gap-2 text-sm font-medium">
              Email
              <Input value={email} disabled className="bg-[var(--bg-structure)]" />
            </label>
          </FormFieldSpan>
          <FormFieldSpan span={span2}>
            <label className="flex flex-col gap-2 text-sm font-medium">
              Mobile phone
              <Input value={mobilePhone} onChange={(e) => setMobilePhone(e.target.value)} />
            </label>
          </FormFieldSpan>

          <FormSection title="Location & Timezone" className="mt-2" />
          <FormFieldSpan span={span2}>
            <div className="flex flex-col gap-2 text-sm font-medium">
              Athlete timezone
              <TimezoneSelect value={timezone} onChange={setTimezone} disabled={saving} />
            </div>
          </FormFieldSpan>
          <FormFieldSpan span={span2}>
            <label className="flex flex-col gap-2 text-sm font-medium">
              Training suburb
              <Input value={trainingSuburb} onChange={(e) => setTrainingSuburb(e.target.value)} />
            </label>
          </FormFieldSpan>
        </FormGrid>
      ) : null}

      {activeTab === 'Training Basics' ? (
        <FormGrid role="tabpanel" id="tab-panel-Training-Basics" columns={gridColumns}>
          <FormSection title="Training Basics" />

          <FormFieldSpan span={span1}>
            <label className="flex flex-col gap-2 text-sm font-medium">
              Experience level
              <Select value={experienceLevel} onChange={(e) => setExperienceLevel(e.target.value)}>
                <option value="">Select...</option>
                {EXPERIENCE_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </Select>
            </label>
          </FormFieldSpan>
          <FormFieldSpan span={span1}>
            <label className="flex flex-col gap-2 text-sm font-medium">
              Weekly minutes target
              <Input
                type="number"
                min={0}
                max={1500}
                value={weeklyMinutesTarget}
                onChange={(e) => setWeeklyMinutesTarget(e.target.value)}
              />
            </label>
          </FormFieldSpan>
          <FormFieldSpan span={span1}>
            <label className="flex flex-col gap-2 text-sm font-medium">
              Consistency level
              <Select value={consistencyLevel} onChange={(e) => setConsistencyLevel(e.target.value)}>
                <option value="">Select...</option>
                {CONSISTENCY_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </Select>
            </label>
          </FormFieldSpan>

          <FormFieldSpan span={span1}>
            <label className="flex flex-col gap-2 text-sm font-medium">
              Swim confidence
              <Select value={swimConfidence} onChange={(e) => setSwimConfidence(e.target.value)}>
                <option value="">Select...</option>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            </label>
          </FormFieldSpan>
          <FormFieldSpan span={span1}>
            <label className="flex flex-col gap-2 text-sm font-medium">
              Bike confidence
              <Select value={bikeConfidence} onChange={(e) => setBikeConfidence(e.target.value)}>
                <option value="">Select...</option>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            </label>
          </FormFieldSpan>

          <FormFieldSpan span={span1}>
            <label className="flex flex-col gap-2 text-sm font-medium">
              Run confidence
              <Select value={runConfidence} onChange={(e) => setRunConfidence(e.target.value)}>
                <option value="">Select...</option>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            </label>
          </FormFieldSpan>

          <FormFieldSpan span={span1}>
            <label className="flex flex-col gap-2 text-sm font-medium">
              Training plan schedule frequency
              <Select
                value={trainingPlanFrequency}
                onChange={(e) => {
                  const next = e.target.value as 'WEEKLY' | 'FORTNIGHTLY' | 'MONTHLY' | 'AD_HOC';
                  setTrainingPlanFrequency(next);
                  if (next === 'AD_HOC') {
                    setTrainingPlanDayOfWeek(null);
                    setTrainingPlanWeekOfMonth(null);
                  } else if (next === 'MONTHLY') {
                    setTrainingPlanWeekOfMonth((trainingPlanWeekOfMonth ?? 1) as 1 | 2 | 3 | 4);
                    setTrainingPlanDayOfWeek(trainingPlanDayOfWeek ?? 1);
                  } else {
                    setTrainingPlanWeekOfMonth(null);
                    setTrainingPlanDayOfWeek(trainingPlanDayOfWeek ?? 2);
                  }
                }}
                disabled={saving}
              >
                <option value="WEEKLY">Weekly</option>
                <option value="FORTNIGHTLY">Fortnightly</option>
                <option value="MONTHLY">Monthly</option>
                <option value="AD_HOC">Ad hoc</option>
              </Select>
            </label>
            {trainingPlanFrequency === 'MONTHLY' ? (
              <label className="mt-2 flex flex-col gap-2 text-xs font-medium text-[var(--muted)]">
                Week of month
                <Select
                  value={trainingPlanWeekOfMonth ?? ''}
                  onChange={(e) => setTrainingPlanWeekOfMonth((Number(e.target.value) as 1 | 2 | 3 | 4) || null)}
                  disabled={saving}
                >
                  <option value="1">1st</option>
                  <option value="2">2nd</option>
                  <option value="3">3rd</option>
                  <option value="4">4th</option>
                </Select>
              </label>
            ) : null}
          </FormFieldSpan>
          <FormFieldSpan span={span1}>
            <label className="flex flex-col gap-2 text-sm font-medium">
              Training plan schedule day
              <Select
                value={trainingPlanDayOfWeek ?? ''}
                onChange={(e) => setTrainingPlanDayOfWeek(Number(e.target.value))}
                disabled={saving || trainingPlanFrequency === 'AD_HOC'}
              >
                <option value="">Select...</option>
                <option value="0">Sunday</option>
                <option value="1">Monday</option>
                <option value="2">Tuesday</option>
                <option value="3">Wednesday</option>
                <option value="4">Thursday</option>
                <option value="5">Friday</option>
                <option value="6">Saturday</option>
              </Select>
            </label>
          </FormFieldSpan>

          <FormSection title="Coaching Preferences" className="mt-2" />
          <FormFieldSpan span={span1}>
            <label className="flex flex-col gap-2 text-sm font-medium">
              Check-in cadence
              <Select value={checkInCadence} onChange={(e) => setCheckInCadence(e.target.value)}>
                <option value="">Select...</option>
                {CHECK_IN_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </Select>
            </label>
          </FormFieldSpan>

          <FormFieldSpan span={span1}>
            <label className="flex flex-col gap-2 text-sm font-medium">
              Feedback style
              <Select value={feedbackStyle} onChange={(e) => setFeedbackStyle(e.target.value)}>
                <option value="">Select...</option>
                {FEEDBACK_STYLE_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </Select>
            </label>
          </FormFieldSpan>
          <FormFieldSpan span={span1}>
            <label className="flex flex-col gap-2 text-sm font-medium">
              Tone preference
              <Select value={tonePreference} onChange={(e) => setTonePreference(e.target.value)}>
                <option value="">Select...</option>
                {TONE_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </Select>
            </label>
          </FormFieldSpan>
          <FormFieldSpan span={span1}>
            <label className="flex flex-col gap-2 text-sm font-medium">
              Structure preference
              <Select value={structurePreference} onChange={(e) => setStructurePreference(e.target.value)}>
                <option value="">Select...</option>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            </label>
          </FormFieldSpan>
          <FormFieldSpan span={span1}>
            <label className="flex flex-col gap-2 text-sm font-medium">
              Motivation style
              <Select value={motivationStyle} onChange={(e) => setMotivationStyle(e.target.value)}>
                <option value="">Select...</option>
                {MOTIVATION_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </Select>
            </label>
          </FormFieldSpan>

          <FormFieldSpan span={span2}>
            <label className="flex flex-col gap-2 text-sm font-medium">
              Primary goal
              <Textarea value={primaryGoal} onChange={(e) => setPrimaryGoal(e.target.value)} rows={2} />
            </label>
          </FormFieldSpan>
          <FormFieldSpan span={span2}>
            <label className="flex flex-col gap-2 text-sm font-medium">
              Secondary goals
              <Input value={secondaryGoals} onChange={(e) => setSecondaryGoals(e.target.value)} />
            </label>
          </FormFieldSpan>
        </FormGrid>
      ) : null}

      {activeTab === 'Current Training Plan' ? (
        <FormGrid role="tabpanel" id="tab-panel-Current-Training-Plan" columns={gridColumns}>
          <FormSection title="Plan Focus & Event" />
          <FormFieldSpan span={span2}>
            <label className="flex flex-col gap-2 text-sm font-medium">
              Focus
              <Input value={focus} onChange={(e) => setFocus(e.target.value)} />
            </label>
          </FormFieldSpan>
          <FormFieldSpan span={span2}>
            <label className="flex flex-col gap-2 text-sm font-medium">
              Next event name
              <Input value={eventName} onChange={(e) => setEventName(e.target.value)} />
            </label>
          </FormFieldSpan>
          <FormFieldSpan span={span2}>
            <label className="flex flex-col gap-2 text-sm font-medium">
              Next event date
              <Input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
            </label>
          </FormFieldSpan>
          <FormFieldSpan span={span2}>
            <label className="flex flex-col gap-2 text-sm font-medium">
              Timeline (weeks)
              <Input
                type="number"
                min={1}
                max={104}
                value={timelineWeeks}
                onChange={(e) => setTimelineWeeks(e.target.value)}
              />
            </label>
          </FormFieldSpan>

          <FormSection title="Disciplines & Availability" className="mt-2" />
          <FormFieldSpan span={span4}>
            <div className="space-y-2 text-sm font-medium">
              Disciplines
              <div className="flex flex-wrap gap-2">
                {DISCIPLINES.map((discipline) => {
                  const theme = getDisciplineTheme(discipline);
                  const isSelected = selectedDisciplines.includes(discipline);
                  return (
                    <button
                      key={discipline}
                      type="button"
                      onClick={() => toggleDiscipline(discipline)}
                      className={cn(
                        'flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition-all',
                        isSelected
                          ? 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300'
                          : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--muted)] hover:bg-[var(--bg-card)]'
                      )}
                    >
                      <Icon name={theme.iconName} size="sm" className={isSelected ? theme.textClass : ''} />
                      {discipline}
                    </button>
                  );
                })}
              </div>
            </div>
          </FormFieldSpan>
          <FormFieldSpan span={span4}>
            <div className="space-y-2 text-sm font-medium">
              Available days
              <div className="flex flex-wrap gap-2">
                {AVAILABLE_DAYS.map((day) => {
                  const isSelected = availableDays.includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      onClick={() => toggleAvailableDay(day)}
                      className={cn(
                        'rounded-xl border px-3 py-2 text-sm font-medium transition-all',
                        isSelected
                          ? 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300'
                          : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--muted)] hover:bg-[var(--bg-card)]'
                      )}
                    >
                      {day}
                    </button>
                  );
                })}
              </div>
            </div>
          </FormFieldSpan>

          <FormSection title="Constraints & Risk Notes" className="mt-2" />
          <FormFieldSpan span={span2}>
            <label className="flex flex-col gap-2 text-sm font-medium">
              Schedule variability
              <Select value={scheduleVariability} onChange={(e) => setScheduleVariability(e.target.value)}>
                <option value="">Select...</option>
                {SCHEDULE_VARIABILITY_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </Select>
            </label>
          </FormFieldSpan>
          <FormFieldSpan span={span2}>
            <label className="flex flex-col gap-2 text-sm font-medium">
              Sleep quality
              <Select value={sleepQuality} onChange={(e) => setSleepQuality(e.target.value)}>
                <option value="">Select...</option>
                {SLEEP_QUALITY_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </Select>
            </label>
          </FormFieldSpan>
          <FormFieldSpan span={span2}>
            <label className="flex flex-col gap-2 text-sm font-medium">
              Injury status
              <Select value={injuryStatus} onChange={(e) => setInjuryStatus(e.target.value)}>
                <option value="">Select...</option>
                {INJURY_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </Select>
            </label>
          </FormFieldSpan>
          <FormFieldSpan span={span2}>
            <label className="flex flex-col gap-2 text-sm font-medium">
              Equipment access
              <Input value={equipmentAccess} onChange={(e) => setEquipmentAccess(e.target.value)} />
            </label>
          </FormFieldSpan>
          <FormFieldSpan span={span2}>
            <label className="flex flex-col gap-2 text-sm font-medium">
              Travel constraints
              <Input value={travelConstraints} onChange={(e) => setTravelConstraints(e.target.value)} />
            </label>
          </FormFieldSpan>
          <FormFieldSpan span={span4}>
            <label className="flex flex-col gap-2 text-sm font-medium">
              Constraints notes
              <Textarea value={constraintsNotes} onChange={(e) => setConstraintsNotes(e.target.value)} rows={3} />
            </label>
          </FormFieldSpan>
        </FormGrid>
      ) : null}
    </FormPageContainer>
  );
}
