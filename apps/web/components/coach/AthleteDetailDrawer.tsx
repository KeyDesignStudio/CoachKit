'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Icon } from '@/components/ui/Icon';
import { CALENDAR_ACTION_ICON_CLASS } from '@/components/calendar/iconTokens';
import { cn } from '@/lib/cn';
import { useApi } from '@/components/api-client';
import { getDisciplineTheme } from '@/components/ui/disciplineTheme';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { TimezoneSelect } from '@/components/TimezoneSelect';
import { uiH2, uiMuted } from '@/components/ui/typography';
import type { AthleteBriefJson } from '@/modules/ai/athlete-brief/types';

const DISCIPLINES = ['RUN', 'BIKE', 'SWIM', 'BRICK', 'STRENGTH', 'REST', 'OTHER'] as const;
const AVAILABLE_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

function humanizeEnumLabel(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function humanizeDiscipline(value: unknown): string | null {
  const v = value == null ? '' : String(value).trim().toUpperCase();
  if (!v) return null;
  const map: Record<string, string> = {
    RUN: 'Run',
    BIKE: 'Bike',
    SWIM: 'Swim',
    BRICK: 'Brick',
    STRENGTH: 'Strength',
    REST: 'Rest',
    OTHER: 'Other',
  };
  return map[v] ?? humanizeEnumLabel(v);
}

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
  coachNotes?: string | null;
  user: {
    id: string;
    name: string | null;
    email: string;
    timezone: string;
  };
};

type AthleteBrief = AthleteBriefJson;

type PainHistoryItem = {
  calendarItemId: string;
  date: string;
  startTime: string;
  discipline: string;
  title: string;
  painFlag: boolean;
  athletePainComment?: string | null;
  commentDate?: string | null;
};

type JournalEntry = {
  id: string;
  entryDate: string;
  body: string;
  createdAt: string;
  updatedAt: string;
};

type AthleteDetailDrawerProps = {
  isOpen: boolean;
  athleteId: string | null;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
};

export function AthleteDetailDrawer({ isOpen, athleteId, onClose, onSaved, onDeleted }: AthleteDetailDrawerProps) {
  const { request } = useApi();
  const [athlete, setAthlete] = useState<AthleteProfile | null>(null);
  const [painHistory, setPainHistory] = useState<PainHistoryItem[]>([]);
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);
  const [journalOpen, setJournalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [brief, setBrief] = useState<AthleteBrief | null>(null);

  const briefSections = (() => {
    if (!brief) return [] as Array<{ title: string; items: string[] }>;
    const sections: Array<{ title: string; items: string[] }> = [];
    const pushLabeled = (items: string[], label: string, value: string | number | null | undefined) => {
      if (value == null || value === '') return;
      items.push(`${label}: ${value}`);
    };

    if (brief.version === 'v1.1') {
      const snapshotItems: string[] = [];
      pushLabeled(snapshotItems, 'Goal', brief.snapshot?.primaryGoal ?? undefined);
      pushLabeled(snapshotItems, 'Experience', brief.snapshot?.experienceLabel ?? undefined);
      if (brief.snapshot?.disciplines?.length) {
        snapshotItems.push(`Disciplines: ${brief.snapshot.disciplines.map(humanizeDiscipline).join(', ')}`);
      }
      if (brief.snapshot?.tags?.length) snapshotItems.push(`Tags: ${brief.snapshot.tags.join(', ')}`);
      if (snapshotItems.length) sections.push({ title: 'Snapshot', items: snapshotItems });

      const trainingItems: string[] = [];
      pushLabeled(trainingItems, 'Weekly minutes', brief.trainingProfile?.weeklyMinutesTarget ?? undefined);
      if (brief.trainingProfile?.availabilityDays?.length) {
        trainingItems.push(`Availability: ${brief.trainingProfile.availabilityDays.join(', ')}`);
      }
      pushLabeled(trainingItems, 'Schedule', brief.trainingProfile?.scheduleNotes ?? undefined);
      pushLabeled(trainingItems, 'Timezone', brief.trainingProfile?.timezone ?? undefined);
      if (trainingItems.length) sections.push({ title: 'Training profile', items: trainingItems });

      const constraintItems: string[] = [];
      pushLabeled(constraintItems, 'Injury status', brief.constraintsAndSafety?.injuryStatus ?? undefined);
      if (brief.constraintsAndSafety?.painHistory?.length) {
        constraintItems.push(`Pain history: ${brief.constraintsAndSafety.painHistory.join('; ')}`);
      }
      pushLabeled(constraintItems, 'Sleep quality', brief.constraintsAndSafety?.sleepQuality ?? undefined);
      pushLabeled(constraintItems, 'Notes', brief.constraintsAndSafety?.notes ?? undefined);
      if (constraintItems.length) sections.push({ title: 'Constraints & safety', items: constraintItems });

      const coachingItems: string[] = [];
      pushLabeled(coachingItems, 'Tone', brief.coachingPreferences?.tone ?? undefined);
      pushLabeled(coachingItems, 'Feedback style', brief.coachingPreferences?.feedbackStyle ?? undefined);
      pushLabeled(coachingItems, 'Check-in cadence', brief.coachingPreferences?.checkinCadence ?? undefined);
      pushLabeled(coachingItems, 'Structure preference', brief.coachingPreferences?.structurePreference ?? undefined);
      pushLabeled(coachingItems, 'Motivation style', brief.coachingPreferences?.motivationStyle ?? undefined);
      if (coachingItems.length) sections.push({ title: 'Coaching preferences', items: coachingItems });

      const observationItems: string[] = [];
      pushLabeled(observationItems, 'Coach notes', brief.coachObservations?.notes ?? undefined);
      if (observationItems.length) sections.push({ title: 'Coach observations', items: observationItems });

      const guidanceItems: string[] = [];
      pushLabeled(guidanceItems, 'Plan guidance', brief.planGuidance ?? undefined);
      if (brief.riskFlags?.length) guidanceItems.push(`Risk flags: ${brief.riskFlags.join(', ')}`);
      if (guidanceItems.length) sections.push({ title: 'Plan guidance', items: guidanceItems });

      return sections;
    }

    const snapshotItems: string[] = [];
    if (brief.snapshot?.headline) snapshotItems.push(brief.snapshot.headline);
    if (brief.snapshot?.tags?.length) snapshotItems.push(`Tags: ${brief.snapshot.tags.join(', ')}`);
    if (snapshotItems.length) sections.push({ title: 'Snapshot', items: snapshotItems });

    const goalItems: string[] = [];
    pushLabeled(goalItems, 'Type', humanizeEnumLabel(brief.goals?.type) ?? brief.goals?.type ?? undefined);
    pushLabeled(goalItems, 'Details', brief.goals?.details ?? undefined);
    pushLabeled(goalItems, 'Timeline', humanizeEnumLabel(brief.goals?.timeline) ?? brief.goals?.timeline ?? undefined);
    pushLabeled(goalItems, 'Focus', humanizeEnumLabel(brief.goals?.focus) ?? brief.goals?.focus ?? undefined);
    if (goalItems.length) sections.push({ title: 'Goals', items: goalItems });

    const trainingItems: string[] = [];
    pushLabeled(
      trainingItems,
      'Experience',
      humanizeEnumLabel(brief.disciplineProfile?.experienceLevel) ?? brief.disciplineProfile?.experienceLevel
    );
    const disciplineList = Array.isArray(brief.disciplineProfile?.disciplines)
      ? brief.disciplineProfile?.disciplines.map(humanizeDiscipline).filter(Boolean)
      : [];
    if (disciplineList.length) trainingItems.push(`Disciplines: ${disciplineList.join(', ')}`);
    pushLabeled(trainingItems, 'Weekly minutes', brief.disciplineProfile?.weeklyMinutes ?? undefined);
    pushLabeled(
      trainingItems,
      'Recent consistency',
      humanizeEnumLabel(brief.disciplineProfile?.recentConsistency) ?? brief.disciplineProfile?.recentConsistency
    );
    if (brief.disciplineProfile?.swimConfidence) trainingItems.push(`Swim confidence: ${brief.disciplineProfile.swimConfidence}/5`);
    if (brief.disciplineProfile?.bikeConfidence) trainingItems.push(`Bike confidence: ${brief.disciplineProfile.bikeConfidence}/5`);
    if (brief.disciplineProfile?.runConfidence) trainingItems.push(`Run confidence: ${brief.disciplineProfile.runConfidence}/5`);
    if (trainingItems.length) sections.push({ title: 'Training profile', items: trainingItems });

    const constraintItems: string[] = [];
    if (brief.constraints?.availabilityDays?.length) {
      constraintItems.push(`Available days: ${brief.constraints.availabilityDays.join(', ')}`);
    }
    pushLabeled(
      constraintItems,
      'Schedule variability',
      humanizeEnumLabel(brief.constraints?.scheduleVariability) ?? brief.constraints?.scheduleVariability
    );
    pushLabeled(
      constraintItems,
      'Sleep quality',
      humanizeEnumLabel(brief.constraints?.sleepQuality) ?? brief.constraints?.sleepQuality
    );
    pushLabeled(
      constraintItems,
      'Injury status',
      humanizeEnumLabel(brief.constraints?.injuryStatus) ?? brief.constraints?.injuryStatus
    );
    pushLabeled(constraintItems, 'Notes', brief.constraints?.notes ?? undefined);
    if (constraintItems.length) sections.push({ title: 'Constraints & safety', items: constraintItems });

    const coachingItems: string[] = [];
    pushLabeled(
      coachingItems,
      'Feedback style',
      humanizeEnumLabel(brief.coaching?.feedbackStyle) ?? brief.coaching?.feedbackStyle
    );
    pushLabeled(
      coachingItems,
      'Tone preference',
      humanizeEnumLabel(brief.coaching?.tonePreference) ?? brief.coaching?.tonePreference
    );
    pushLabeled(
      coachingItems,
      'Check-in cadence',
      humanizeEnumLabel(brief.coaching?.checkinPreference) ?? brief.coaching?.checkinPreference
    );
    if (brief.coaching?.structurePreference) coachingItems.push(`Structure preference: ${brief.coaching.structurePreference}/5`);
    pushLabeled(
      coachingItems,
      'Motivation style',
      humanizeEnumLabel(brief.coaching?.motivationStyle) ?? brief.coaching?.motivationStyle
    );
    pushLabeled(coachingItems, 'Notes', brief.coaching?.notes ?? undefined);
    if (coachingItems.length) sections.push({ title: 'Coaching preferences', items: coachingItems });

    const guidanceItems: string[] = [];
    pushLabeled(guidanceItems, 'Tone', humanizeEnumLabel(brief.planGuidance?.tone) ?? brief.planGuidance?.tone);
    if (brief.planGuidance?.focusNotes?.length) guidanceItems.push(`Focus notes: ${brief.planGuidance.focusNotes.join(' ')}`);
    if (brief.planGuidance?.coachingCues?.length) guidanceItems.push(`Coaching cues: ${brief.planGuidance.coachingCues.join(' ')}`);
    if (brief.planGuidance?.safetyNotes?.length) guidanceItems.push(`Safety notes: ${brief.planGuidance.safetyNotes.join(' ')}`);
    if (guidanceItems.length) sections.push({ title: 'Plan guidance', items: guidanceItems });

    if (brief.risks?.length) sections.push({ title: 'Risks', items: brief.risks });

    return sections;
  })();

  // Form state
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [gender, setGender] = useState('');
  const [trainingSuburb, setTrainingSuburb] = useState('');
  const [mobilePhone, setMobilePhone] = useState('');
  const [email, setEmail] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [trainingPlanFrequency, setTrainingPlanFrequency] = useState<'WEEKLY' | 'FORTNIGHTLY' | 'MONTHLY' | 'AD_HOC'>('AD_HOC');
  const [trainingPlanDayOfWeek, setTrainingPlanDayOfWeek] = useState<number | null>(null);
  const [trainingPlanWeekOfMonth, setTrainingPlanWeekOfMonth] = useState<1 | 2 | 3 | 4 | null>(null);
  const [selectedDisciplines, setSelectedDisciplines] = useState<string[]>([]);
  const [primaryGoal, setPrimaryGoal] = useState('');
  const [secondaryGoals, setSecondaryGoals] = useState('');
  const [focus, setFocus] = useState('');
  const [eventName, setEventName] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [timelineWeeks, setTimelineWeeks] = useState('');
  const [experienceLevel, setExperienceLevel] = useState('');
  const [weeklyMinutesTarget, setWeeklyMinutesTarget] = useState('');
  const [consistencyLevel, setConsistencyLevel] = useState('');
  const [swimConfidence, setSwimConfidence] = useState('');
  const [bikeConfidence, setBikeConfidence] = useState('');
  const [runConfidence, setRunConfidence] = useState('');
  const [availableDays, setAvailableDays] = useState<string[]>([]);
  const [scheduleVariability, setScheduleVariability] = useState('');
  const [sleepQuality, setSleepQuality] = useState('');
  const [equipmentAccess, setEquipmentAccess] = useState('');
  const [travelConstraints, setTravelConstraints] = useState('');
  const [injuryStatus, setInjuryStatus] = useState('');
  const [constraintsNotes, setConstraintsNotes] = useState('');
  const [feedbackStyle, setFeedbackStyle] = useState('');
  const [tonePreference, setTonePreference] = useState('');
  const [checkInCadence, setCheckInCadence] = useState('');
  const [structurePreference, setStructurePreference] = useState('');
  const [motivationStyle, setMotivationStyle] = useState('');
  const [coachNotes, setCoachNotes] = useState('');
  const [timezone, setTimezone] = useState('Australia/Brisbane');

  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleError, setScheduleError] = useState('');
  const scheduleHydratedRef = useRef(false);
  const autosaveTimerRef = useRef<number | null>(null);

  // Journal form
  const [newJournalDate, setNewJournalDate] = useState('');
  const [newJournalBody, setNewJournalBody] = useState('');
  const [addingJournal, setAddingJournal] = useState(false);
  const [journalDateError, setJournalDateError] = useState('');

  // Confirmation modals
  const [deleteAthleteConfirm, setDeleteAthleteConfirm] = useState(false);
  const [deleteJournalId, setDeleteJournalId] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !athleteId) {
      setAthlete(null);
      setPainHistory([]);
      setJournalEntries([]);
      setError('');
      setJournalOpen(false);
      setScheduleError('');
      setScheduleSaving(false);
      scheduleHydratedRef.current = false;
      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
      return;
    }

    const loadData = async () => {
      setLoading(true);
      setError('');
      try {
        const [athleteData, painData, journalData, briefData] = await Promise.all([
          request<{ athlete: AthleteProfile }>(`/api/coach/athletes/${athleteId}`),
          request<{ history: PainHistoryItem[] }>(`/api/coach/athletes/${athleteId}/pain-history`),
          request<{ entries: JournalEntry[] }>(`/api/coach/athletes/${athleteId}/journal`),
          request<{ brief: AthleteBrief | null }>(`/api/coach/athletes/${athleteId}/athlete-brief/latest`),
        ]);

        setAthlete(athleteData.athlete);
        setPainHistory(painData.history);
        setJournalEntries(journalData.entries);
        setBrief(briefData.brief ?? null);

        // Populate form
        setFirstName(athleteData.athlete.firstName || '');
        setLastName(athleteData.athlete.lastName || '');
        setGender(athleteData.athlete.gender || '');
        setTrainingSuburb(athleteData.athlete.trainingSuburb || '');
        setMobilePhone(athleteData.athlete.mobilePhone || '');
        setEmail(athleteData.athlete.user.email);
        setTimezone(athleteData.athlete.timezone || athleteData.athlete.user.timezone || 'Australia/Brisbane');
        setDateOfBirth(athleteData.athlete.dateOfBirth ? athleteData.athlete.dateOfBirth.split('T')[0] : '');
        setTrainingPlanFrequency(athleteData.athlete.trainingPlanSchedule?.frequency ?? 'AD_HOC');
        setTrainingPlanDayOfWeek(
          athleteData.athlete.trainingPlanSchedule?.dayOfWeek === undefined
            ? null
            : (athleteData.athlete.trainingPlanSchedule?.dayOfWeek ?? null)
        );
        setTrainingPlanWeekOfMonth(
          athleteData.athlete.trainingPlanSchedule?.weekOfMonth === undefined
            ? null
            : (athleteData.athlete.trainingPlanSchedule?.weekOfMonth ?? null)
        );
        setSelectedDisciplines(athleteData.athlete.disciplines);
        setPrimaryGoal(athleteData.athlete.primaryGoal || '');
        setSecondaryGoals((athleteData.athlete.secondaryGoals ?? []).join(', '));
        setFocus(athleteData.athlete.focus || '');
        setEventName(athleteData.athlete.eventName || '');
        setEventDate(athleteData.athlete.eventDate ? athleteData.athlete.eventDate.split('T')[0] : '');
        setTimelineWeeks(
          athleteData.athlete.timelineWeeks != null ? String(athleteData.athlete.timelineWeeks) : ''
        );
        setExperienceLevel(athleteData.athlete.experienceLevel || '');
        setWeeklyMinutesTarget(
          athleteData.athlete.weeklyMinutesTarget != null ? String(athleteData.athlete.weeklyMinutesTarget) : ''
        );
        setConsistencyLevel(athleteData.athlete.consistencyLevel || '');
        setSwimConfidence(athleteData.athlete.swimConfidence != null ? String(athleteData.athlete.swimConfidence) : '');
        setBikeConfidence(athleteData.athlete.bikeConfidence != null ? String(athleteData.athlete.bikeConfidence) : '');
        setRunConfidence(athleteData.athlete.runConfidence != null ? String(athleteData.athlete.runConfidence) : '');
        setAvailableDays(athleteData.athlete.availableDays ?? []);
        setScheduleVariability(athleteData.athlete.scheduleVariability || '');
        setSleepQuality(athleteData.athlete.sleepQuality || '');
        setEquipmentAccess(athleteData.athlete.equipmentAccess || '');
        setTravelConstraints(athleteData.athlete.travelConstraints || '');
        setInjuryStatus(athleteData.athlete.injuryStatus || '');
        setConstraintsNotes(athleteData.athlete.constraintsNotes || '');
        setFeedbackStyle(athleteData.athlete.feedbackStyle || '');
        setTonePreference(athleteData.athlete.tonePreference || '');
        setCheckInCadence(athleteData.athlete.checkInCadence || '');
        setStructurePreference(
          athleteData.athlete.structurePreference != null ? String(athleteData.athlete.structurePreference) : ''
        );
        setMotivationStyle(athleteData.athlete.motivationStyle || '');
        setCoachNotes(athleteData.athlete.coachNotes || '');

        // Set default journal date to today
        const today = new Date().toISOString().split('T')[0];
        setNewJournalDate(today);
        setJournalDateError('');

        scheduleHydratedRef.current = true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load athlete');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [isOpen, athleteId, request]);

  // Autosave training plan schedule changes
  useEffect(() => {
    if (!isOpen || !athleteId) return;
    if (!scheduleHydratedRef.current) return;

    setScheduleError('');

    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }

    autosaveTimerRef.current = window.setTimeout(async () => {
      try {
        // Avoid sending invalid combos while the user is mid-selection.
        if (trainingPlanFrequency !== 'AD_HOC' && trainingPlanDayOfWeek === null) return;
        if (trainingPlanFrequency === 'MONTHLY' && trainingPlanWeekOfMonth === null) return;

        setScheduleSaving(true);

        // Normalize dependent fields
        const normalized =
          trainingPlanFrequency === 'AD_HOC'
            ? { trainingPlanDayOfWeek: null, trainingPlanWeekOfMonth: null }
            : trainingPlanFrequency === 'MONTHLY'
              ? { trainingPlanDayOfWeek: trainingPlanDayOfWeek, trainingPlanWeekOfMonth: trainingPlanWeekOfMonth }
              : { trainingPlanDayOfWeek: trainingPlanDayOfWeek, trainingPlanWeekOfMonth: null };

        await request(`/api/coach/athletes/${athleteId}`, {
          method: 'PATCH',
          data: {
            trainingPlanSchedule: {
              frequency: trainingPlanFrequency,
              dayOfWeek: normalized.trainingPlanDayOfWeek,
              weekOfMonth: normalized.trainingPlanWeekOfMonth,
            },
          },
        });
      } catch (err) {
        setScheduleError(err instanceof Error ? err.message : 'Could not save training plan schedule.');
      } finally {
        setScheduleSaving(false);
      }
    }, 500);

    return () => {
      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
  }, [isOpen, athleteId, request, trainingPlanFrequency, trainingPlanDayOfWeek, trainingPlanWeekOfMonth]);

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!athleteId) return;

    setSaving(true);
    setError('');
    try {
      if (selectedDisciplines.length === 0) {
        throw new Error('At least one discipline is required');
      }

      await request(`/api/coach/athletes/${athleteId}`, {
        method: 'PATCH',
        data: {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          gender: gender.trim() || null,
          trainingSuburb: trainingSuburb.trim() || null,
          mobilePhone: mobilePhone.trim() || null,
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
          coachNotes: coachNotes.trim() || null,
        },
      });

      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!athleteId) return;

    try {
      await request(`/api/coach/athletes/${athleteId}`, { method: 'DELETE' });
      setDeleteAthleteConfirm(false);
      onDeleted();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
      setDeleteAthleteConfirm(false);
    }
  };

  const handleAddJournalEntry = async () => {
    if (!athleteId || !newJournalBody.trim()) return;

    // Validate date is not in the future
    const today = new Date().toISOString().split('T')[0];
    if (newJournalDate > today) {
      setJournalDateError('Entry date cannot be in the future');
      return;
    }
    setJournalDateError('');

    setAddingJournal(true);
    try {
      const result = await request<{ entry: JournalEntry }>(`/api/coach/athletes/${athleteId}/journal`, {
        method: 'POST',
        body: JSON.stringify({
          entryDate: newJournalDate,
          body: newJournalBody.trim(),
        }),
      });

      setJournalEntries([result.entry, ...journalEntries]);
      setNewJournalBody('');
      const today = new Date().toISOString().split('T')[0];
      setNewJournalDate(today);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add journal entry');
    } finally {
      setAddingJournal(false);
    }
  };

  const handleDeleteJournalConfirm = async () => {
    if (!athleteId || !deleteJournalId) return;

    try {
      await request(`/api/coach/athletes/${athleteId}/journal/${deleteJournalId}`, { method: 'DELETE' });
      setJournalEntries(journalEntries.filter((e) => e.id !== deleteJournalId));
      setDeleteJournalId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete entry');
      setDeleteJournalId(null);
    }
  };

  const toggleDiscipline = (discipline: string) => {
    setSelectedDisciplines((prev) =>
      prev.includes(discipline) ? prev.filter((d) => d !== discipline) : [...prev, discipline]
    );
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  if (!isOpen) return null;

  const displayName = [firstName, lastName].filter(Boolean).join(' ');

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm" onClick={onClose} />

      {/* Drawer */}
      <div
        className={cn(
          'fixed right-0 top-0 z-50 h-full overflow-y-auto border-l border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-2xl transition-transform',
          'w-full',
          'lg:w-[50vw] lg:max-w-[840px]',
          isOpen ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-6 py-4">
          <h2 className={`${uiH2} md:text-xl font-semibold`}>{displayName || 'Athlete Profile'}</h2>
          <Button type="button" variant="ghost" onClick={onClose}>
            ✕
          </Button>
        </div>

        {/* Content */}
        <form onSubmit={handleSave} className="p-6">
          {loading ? (
            <p className={`${uiMuted} text-center`}>Loading...</p>
          ) : error ? (
            <p className="text-center text-sm text-red-600">{error}</p>
          ) : (
            <div className="grid gap-6 lg:grid-cols-2">
              {/* Left Column: Profile */}
              <div className="space-y-6">
                {/* Profile Section */}
                <section className="space-y-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
                <h3 className="text-lg font-semibold">Profile</h3>
                <div className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-sm font-medium">First name</label>
                      <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium">Last name</label>
                      <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium">Email</label>
                    <Input value={email} disabled className="bg-[var(--bg-structure)]" />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-sm font-medium">Gender</label>
                      <Input value={gender} onChange={(e) => setGender(e.target.value)} />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium">Mobile phone</label>
                      <Input value={mobilePhone} onChange={(e) => setMobilePhone(e.target.value)} />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium">Training suburb</label>
                    <Input value={trainingSuburb} onChange={(e) => setTrainingSuburb(e.target.value)} />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium">Athlete timezone</label>
                    <p className="mb-2 text-xs text-[var(--muted)]">Affects Strava times and day boundaries (missed).</p>
                    <TimezoneSelect value={timezone} onChange={setTimezone} disabled={saving} />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium">Date of Birth</label>
                    <Input type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium">Training Plan Schedule</label>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-xs font-medium text-[var(--muted)]">Frequency</label>
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
                      </div>

                      {trainingPlanFrequency === 'MONTHLY' ? (
                        <div>
                          <label className="mb-1 block text-xs font-medium text-[var(--muted)]">Week of month</label>
                          <Select
                            value={trainingPlanWeekOfMonth ?? ''}
                            onChange={(e) =>
                              setTrainingPlanWeekOfMonth((Number(e.target.value) as 1 | 2 | 3 | 4) || null)
                            }
                            disabled={saving}
                          >
                            <option value="1">1st</option>
                            <option value="2">2nd</option>
                            <option value="3">3rd</option>
                            <option value="4">4th</option>
                          </Select>
                        </div>
                      ) : null}

                      {trainingPlanFrequency !== 'AD_HOC' ? (
                        <div>
                          <label className="mb-1 block text-xs font-medium text-[var(--muted)]">Day</label>
                          <Select
                            value={trainingPlanDayOfWeek ?? ''}
                            onChange={(e) => setTrainingPlanDayOfWeek(Number(e.target.value))}
                            disabled={saving}
                          >
                            <option value="0">Sunday</option>
                            <option value="1">Monday</option>
                            <option value="2">Tuesday</option>
                            <option value="3">Wednesday</option>
                            <option value="4">Thursday</option>
                            <option value="5">Friday</option>
                            <option value="6">Saturday</option>
                          </Select>
                        </div>
                      ) : null}
                    </div>

                    {scheduleSaving ? (
                      <p className="mt-2 text-xs text-[var(--muted)]">Saving Training Plan…</p>
                    ) : scheduleError ? (
                      <p className="mt-2 text-xs text-red-600">{scheduleError}</p>
                    ) : null}
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium">Disciplines *</label>
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
                  <div className="space-y-3">
                    <div>
                      <label className="mb-1 block text-sm font-medium">Primary goal</label>
                      <Textarea
                        value={primaryGoal}
                        onChange={(e) => setPrimaryGoal(e.target.value)}
                        placeholder="Primary goal..."
                        rows={2}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium">Secondary goals</label>
                      <Input
                        value={secondaryGoals}
                        onChange={(e) => setSecondaryGoals(e.target.value)}
                        placeholder="Comma-separated goals"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium">Focus</label>
                      <Input value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="Current focus" />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-sm font-medium">Event name</label>
                        <Input value={eventName} onChange={(e) => setEventName(e.target.value)} />
                      </div>
                      <div>
                        <label className="mb-1 block text-sm font-medium">Event date</label>
                        <Input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
                      </div>
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium">Timeline (weeks)</label>
                      <Input
                        type="number"
                        min={1}
                        max={104}
                        value={timelineWeeks}
                        onChange={(e) => setTimelineWeeks(e.target.value)}
                        placeholder="e.g. 12"
                      />
                    </div>
                  </div>
                </div>
              </section>

              <section className="space-y-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
                <h3 className="text-lg font-semibold">Training Profile</h3>
                <div className="space-y-3">
                  <div>
                    <label className="mb-1 block text-sm font-medium">Experience level</label>
                    <Input value={experienceLevel} onChange={(e) => setExperienceLevel(e.target.value)} />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-sm font-medium">Weekly minutes target</label>
                      <Input
                        type="number"
                        min={0}
                        max={1500}
                        value={weeklyMinutesTarget}
                        onChange={(e) => setWeeklyMinutesTarget(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium">Consistency level</label>
                      <Input value={consistencyLevel} onChange={(e) => setConsistencyLevel(e.target.value)} />
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div>
                      <label className="mb-1 block text-sm font-medium">Swim confidence</label>
                      <Input
                        type="number"
                        min={1}
                        max={5}
                        value={swimConfidence}
                        onChange={(e) => setSwimConfidence(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium">Bike confidence</label>
                      <Input
                        type="number"
                        min={1}
                        max={5}
                        value={bikeConfidence}
                        onChange={(e) => setBikeConfidence(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium">Run confidence</label>
                      <Input
                        type="number"
                        min={1}
                        max={5}
                        value={runConfidence}
                        onChange={(e) => setRunConfidence(e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              </section>

              <section className="space-y-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
                <h3 className="text-lg font-semibold">Constraints & Safety</h3>
                <div className="space-y-3">
                  <div>
                    <label className="mb-1 block text-sm font-medium">Available days</label>
                    <div className="flex flex-wrap gap-2">
                      {AVAILABLE_DAYS.map((day) => {
                        const isSelected = availableDays.includes(day);
                        return (
                          <button
                            key={day}
                            type="button"
                            onClick={() =>
                              setAvailableDays((prev) =>
                                prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
                              )
                            }
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
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-sm font-medium">Schedule variability</label>
                      <Input value={scheduleVariability} onChange={(e) => setScheduleVariability(e.target.value)} />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium">Sleep quality</label>
                      <Input value={sleepQuality} onChange={(e) => setSleepQuality(e.target.value)} />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium">Equipment access</label>
                    <Input value={equipmentAccess} onChange={(e) => setEquipmentAccess(e.target.value)} />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium">Travel constraints</label>
                    <Textarea
                      value={travelConstraints}
                      onChange={(e) => setTravelConstraints(e.target.value)}
                      rows={2}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium">Injury status</label>
                    <Input value={injuryStatus} onChange={(e) => setInjuryStatus(e.target.value)} />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium">Constraints notes</label>
                    <Textarea value={constraintsNotes} onChange={(e) => setConstraintsNotes(e.target.value)} rows={2} />
                  </div>
                </div>
              </section>

              <section className="space-y-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
                <h3 className="text-lg font-semibold">Coaching Preferences</h3>
                <div className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-sm font-medium">Feedback style</label>
                      <Input value={feedbackStyle} onChange={(e) => setFeedbackStyle(e.target.value)} />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium">Tone preference</label>
                      <Input value={tonePreference} onChange={(e) => setTonePreference(e.target.value)} />
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-sm font-medium">Check-in cadence</label>
                      <Input value={checkInCadence} onChange={(e) => setCheckInCadence(e.target.value)} />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium">Structure preference (1-5)</label>
                      <Input
                        type="number"
                        min={1}
                        max={5}
                        value={structurePreference}
                        onChange={(e) => setStructurePreference(e.target.value)}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium">Motivation style</label>
                    <Input value={motivationStyle} onChange={(e) => setMotivationStyle(e.target.value)} />
                  </div>
                </div>
              </section>

              <section className="space-y-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
                <h3 className="text-lg font-semibold">Athlete Brief</h3>
                {!brief ? (
                  <p className="text-sm text-[var(--muted)]">No Athlete Brief available yet.</p>
                ) : (
                  <div className="space-y-3">
                    {briefSections.map((section) =>
                      section.items.length ? (
                        <div key={section.title} className="space-y-1">
                          <div className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                            {section.title}
                          </div>
                          <ul className="list-disc space-y-1 pl-4 text-sm text-[var(--text)]">
                            {section.items.map((item, idx) => (
                              <li key={`${section.title}-${idx}`}>{item}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null
                    )}
                  </div>
                )}
              </section>
              </div>

              {/* Right Column: Coach Notes, Pain History, Journal */}
              <div className="space-y-6">
                {/* Coach Notes Section */}
                <section className="space-y-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
                <h3 className="text-lg font-semibold">Coach Notes</h3>
                <Textarea
                  value={coachNotes}
                  onChange={(e) => setCoachNotes(e.target.value)}
                  placeholder="Private notes about this athlete..."
                  rows={4}
                />
              </section>

              {/* Pain History Section */}
              <section className="space-y-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
                <h3 className="text-lg font-semibold">Pain History</h3>
                {painHistory.length === 0 ? (
                  <p className="text-sm text-[var(--muted)]">No pain flags recorded.</p>
                ) : (
                  <div className="space-y-2">
                    {painHistory.map((item) => {
                      const theme = getDisciplineTheme(item.discipline);
                      return (
                        <div
                          key={item.calendarItemId}
                          className="flex items-start gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 text-sm"
                        >
                          <div className="flex items-center gap-2">
                            <Icon name="painFlag" size="xs" className={`text-rose-500 ${CALENDAR_ACTION_ICON_CLASS}`} />
                          </div>
                          <div className="flex-1">
                            <div className="font-medium">{item.title}</div>
                            <div className="text-xs text-[var(--muted)]">{formatDate(item.date)}</div>
                            {item.athletePainComment && (
                              <div className="mt-1 italic text-[var(--text)]">&quot;{item.athletePainComment}&quot;</div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* Coach Journal Section */}
              <section className="space-y-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
                <button
                  type="button"
                  className="flex w-full items-center justify-between text-left"
                  onClick={() => setJournalOpen(!journalOpen)}
                >
                  <h3 className="text-lg font-semibold">Coach Journal</h3>
                  <Icon
                    name="next"
                    size="sm"
                    className={cn('transition-transform', journalOpen ? 'rotate-90' : '')}
                  />
                </button>

                {journalOpen && (
                  <div className="space-y-4">
                    {/* Add Entry Form */}
                    <div className="space-y-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
                      <div>
                        <label className="mb-1 block text-xs font-medium">Entry Date</label>
                        <Input
                          type="date"
                          value={newJournalDate}
                          onChange={(e) => {
                            setNewJournalDate(e.target.value);
                            setJournalDateError('');
                          }}
                          className="text-sm"
                        />
                        {journalDateError && (
                          <p className="mt-1 text-xs text-red-600">{journalDateError}</p>
                        )}
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium">Entry</label>
                        <Textarea
                          value={newJournalBody}
                          onChange={(e) => setNewJournalBody(e.target.value)}
                          placeholder="Journal notes..."
                          rows={3}
                          className="text-sm"
                        />
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        onClick={handleAddJournalEntry}
                        disabled={!newJournalBody.trim() || addingJournal || !!journalDateError}
                      >
                        {addingJournal ? 'Adding...' : 'Add Entry'}
                      </Button>
                    </div>

                    {/* Entries List */}
                    {journalEntries.length === 0 ? (
                      <p className="text-sm text-[var(--muted)]">No journal entries yet.</p>
                    ) : (
                      <div className="space-y-2">
                        {journalEntries.map((entry) => (
                          <div
                            key={entry.id}
                            className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 text-sm"
                          >
                            <div className="mb-1 flex items-center justify-between">
                              <span className="text-xs font-medium text-[var(--muted)]">
                                {formatDate(entry.entryDate)}
                              </span>
                              <button
                                type="button"
                                onClick={() => setDeleteJournalId(entry.id)}
                                className="text-xs text-red-600 hover:text-red-800"
                              >
                                Delete
                              </button>
                            </div>
                            <p className="whitespace-pre-wrap text-[var(--text)]">{entry.body}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </section>
              </div>
            </div>
          )}

          {/* Footer Actions */}
          <div className="flex flex-wrap gap-3 border-t border-[var(--border-subtle)] pt-6 mt-6">
            <Button type="submit" disabled={saving || loading}>
              {saving ? 'Saving...' : 'Save Changes'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setDeleteAthleteConfirm(true)}
              disabled={loading}
            >
              Delete Athlete
            </Button>
            <Button type="button" variant="secondary" onClick={onClose}>
              Close
            </Button>
          </div>
        </form>
      </div>

      {/* Confirmation Modals */}
      <ConfirmModal
        isOpen={deleteAthleteConfirm}
        title="Delete Athlete"
        message={`Delete ${displayName || 'this athlete'}? This action cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteAthleteConfirm(false)}
      />

      <ConfirmModal
        isOpen={deleteJournalId !== null}
        title="Delete Journal Entry"
        message="Delete this journal entry? This action cannot be undone."
        confirmLabel="Delete"
        onConfirm={handleDeleteJournalConfirm}
        onCancel={() => setDeleteJournalId(null)}
      />
    </>
  );
}
