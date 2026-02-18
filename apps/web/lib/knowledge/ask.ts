import { AiPlanDraftVisibilityStatus, CalendarItemStatus, UserRole } from '@prisma/client';

import { formatDateShortAu } from '@/lib/client-date';
import { prisma } from '@/lib/prisma';

type AskIntent = 'CONTACT' | 'LAST_SESSION' | 'UPCOMING' | 'PAIN' | 'MISSED' | 'PLAN' | 'GENERAL';

type AskCitation = {
  id: string;
  title: string;
  url: string;
  score: number;
};

type AskResult = {
  answer: string;
  citations: AskCitation[];
};

type AskContext = {
  userId: string;
  role: UserRole;
  query: string;
};

type KnowledgeDoc = {
  id: string;
  kind:
    | 'ATHLETE'
    | 'SESSION'
    | 'ACTIVITY'
    | 'ATHLETE_BRIEF'
    | 'AI_PLAN'
    | 'AI_PLAN_WEEK'
    | 'AI_PLAN_SESSION'
    | 'AI_PROPOSAL'
    | 'AI_AUDIT';
  title: string;
  body: string;
  url: string;
  athleteName?: string;
  date?: string;
  status?: CalendarItemStatus;
};

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'have', 'how', 'i', 'in', 'is', 'it', 'its',
  'me', 'of', 'on', 'or', 'our', 'that', 'the', 'their', 'them', 'they', 'this', 'to', 'was', 'we', 'what', 'when', 'where',
  'which', 'who', 'with', 'you', 'your', 'please', 'show', 'tell', 'about', 'does', 'do', 'did', 'can', 'could', 'should',
]);

const SYNONYMS: Record<string, string[]> = {
  athlete: ['client'],
  client: ['athlete'],
  contact: ['phone', 'email', 'mobile'],
  session: ['workout', 'training', 'activity'],
  workout: ['session', 'training', 'activity'],
  activity: ['session', 'workout', 'training'],
  upcoming: ['next', 'soon'],
  next: ['upcoming', 'soon'],
  pain: ['injury', 'sore', 'soreness'],
  skipped: ['missed'],
  missed: ['skipped'],
  ai: ['plan', 'brief'],
  plan: ['ai', 'draft', 'builder'],
  brief: ['athlete', 'profile', 'plan'],
};

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim();
}

function tokenize(value: string): string[] {
  const normalized = normalize(value);
  if (!normalized) return [];

  const out = new Set<string>();
  for (const token of normalized.split(' ')) {
    if (!token || STOPWORDS.has(token)) continue;
    out.add(token);
    for (const synonym of SYNONYMS[token] ?? []) {
      out.add(synonym);
    }
  }

  return Array.from(out);
}

function detectIntent(query: string): AskIntent {
  const q = normalize(query);

  if (/(contact|phone|mobile|email)/.test(q)) return 'CONTACT';
  if (/(last|latest|most recent)/.test(q) && /(session|workout|activity|training|completed|done)/.test(q)) return 'LAST_SESSION';
  if (/(upcoming|next|soon)/.test(q) && /(session|workout|activity|training|planned|coming)/.test(q)) return 'UPCOMING';
  if (/(pain|injury|sore|soreness)/.test(q)) return 'PAIN';
  if (/(missed|skipped)/.test(q)) return 'MISSED';
  if (/(ai plan|plan builder|draft plan|athlete brief|brief)/.test(q)) return 'PLAN';

  return 'GENERAL';
}

function parseWeekFromQuery(query: string): number | null {
  const q = query.toLowerCase();
  const match = q.match(/\bweek\s+(\d{1,2})\b/);
  if (!match) return null;
  const week = Number(match[1]);
  if (!Number.isFinite(week) || week <= 0) return null;
  return week;
}

function isSimpleFactualQuery(query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  if (q.length <= 90 && /^(what|when|who|which|how many|how much|is|did|does|was|were)\b/.test(q)) return true;
  return /(last|latest|next|upcoming|missed|skipped|week\s+\d+)/.test(q) && q.length <= 120;
}

function scoreDoc(doc: KnowledgeDoc, query: string, intent: AskIntent): number {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return 0;

  const text = normalize(`${doc.title} ${doc.body}`);
  const docTokens = new Set(tokenize(text));

  let matches = 0;
  for (const token of queryTokens) {
    if (docTokens.has(token) || text.includes(token)) matches += 1;
  }

  let score = matches / queryTokens.length;

  if (intent === 'CONTACT' && doc.kind === 'ATHLETE') score += 0.22;
  if (intent === 'LAST_SESSION' && (doc.kind === 'SESSION' || doc.kind === 'ACTIVITY')) score += 0.2;
  if (intent === 'UPCOMING' && doc.kind === 'SESSION') score += 0.2;
  if (intent === 'PAIN' && doc.body.toLowerCase().includes('pain flag: yes')) score += 0.2;
  if (intent === 'MISSED' && doc.status === CalendarItemStatus.SKIPPED) score += 0.2;
  if (intent === 'PLAN' && (doc.kind === 'AI_PLAN' || doc.kind === 'ATHLETE_BRIEF' || doc.kind === 'AI_PROPOSAL' || doc.kind === 'AI_AUDIT')) {
    score += 0.24;
  }
  if (intent === 'PLAN' && (doc.kind === 'AI_PLAN_WEEK' || doc.kind === 'AI_PLAN_SESSION')) score += 0.28;
  const week = parseWeekFromQuery(query);
  if (week != null && (doc.kind === 'AI_PLAN_WEEK' || doc.kind === 'AI_PLAN_SESSION')) {
    if (doc.title.toLowerCase().includes(`week ${week}`)) score += 0.32;
  }

  if (doc.athleteName) {
    const athlete = normalize(doc.athleteName);
    if (queryTokens.some((token) => athlete.includes(token))) score += 0.18;
  }

  return Math.min(1.5, Number(score.toFixed(3)));
}

function fmtDate(iso?: string): string {
  if (!iso) return 'unknown date';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  return formatDateShortAu(date) || iso.slice(0, 10);
}

function firstNonBlank(...values: Array<string | null | undefined>): string {
  for (const value of values) {
    const trimmed = String(value ?? '').trim();
    if (trimmed) return trimmed;
  }
  return '-';
}

function readBodyField(body: string, label: string): string | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = body.match(new RegExp(`${escaped}:\\s*([^|]+)`));
  const value = match?.[1]?.trim();
  return value ? value : null;
}

type BuiltAnswer = {
  answer: string;
  primaryDocId?: string;
};

function buildDeterministicAnswer(intent: AskIntent, query: string, docs: KnowledgeDoc[]): BuiltAnswer {
  if (!docs.length) {
    return {
      answer: 'I could not find a confident match in your CoachKit records. Try adding an athlete name, date, or workout keyword.',
    };
  }

  if (intent === 'CONTACT') {
    const contactDoc = docs.find((d) => d.kind === 'ATHLETE') ?? docs[0];
    return {
      answer: `Best contact match: ${contactDoc.title}.`,
      primaryDocId: contactDoc.id,
    };
  }

  if (intent === 'LAST_SESSION') {
    const latest = [...docs]
      .filter((d) => d.kind === 'ACTIVITY' || d.kind === 'SESSION')
      .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))[0] ?? docs[0];
    const duration = readBodyField(latest.body, 'Duration min');
    const distance = readBodyField(latest.body, 'Distance km');
    const details: string[] = [];
    if (duration && Number(duration) > 0) details.push(`${Number(duration)} min`);
    if (distance && Number(distance) > 0) details.push(`${Number(distance)} km`);
    return {
      answer: `${latest.athleteName ?? 'Athlete'} last completed session was on ${fmtDate(latest.date)}${details.length ? ` (${details.join(', ')})` : ''}.`,
      primaryDocId: latest.id,
    };
  }

  if (intent === 'UPCOMING') {
    const today = new Date().toISOString().slice(0, 10);
    const upcoming = [...docs]
      .filter((d) => d.kind === 'SESSION' && d.date && d.date >= today)
      .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))[0] ?? docs[0];
    return {
      answer: `Next upcoming session: ${upcoming.title} on ${fmtDate(upcoming.date)}.`,
      primaryDocId: upcoming.id,
    };
  }

  if (intent === 'PAIN') {
    const pain = docs.find((d) => d.body.toLowerCase().includes('pain flag: yes')) ?? docs[0];
    return {
      answer: `Latest pain-flagged session: ${pain.title}${pain.date ? ` on ${fmtDate(pain.date)}` : ''}.`,
      primaryDocId: pain.id,
    };
  }

  if (intent === 'MISSED') {
    const missed = docs.find((d) => d.status === CalendarItemStatus.SKIPPED) ?? docs[0];
    return {
      answer: `Latest missed session: ${missed.title}${missed.date ? ` on ${fmtDate(missed.date)}` : ''}.`,
      primaryDocId: missed.id,
    };
  }

  if (intent === 'PLAN') {
    const requestedWeek = parseWeekFromQuery(query);
    if (requestedWeek != null) {
      const weekDoc = docs.find((d) => d.kind === 'AI_PLAN_WEEK' && d.title.toLowerCase().includes(`week ${requestedWeek}`));
      if (weekDoc) {
        return {
          answer: `${weekDoc.athleteName ?? 'Athlete'} week ${requestedWeek} plan: ${weekDoc.body.replace(/\s*\|\s*/g, ', ')}.`,
          primaryDocId: weekDoc.id,
        };
      }
    }

    if (/(session|workout)/.test(query.toLowerCase())) {
      const sessionDoc = docs.find((d) => d.kind === 'AI_PLAN_SESSION') ?? docs.find((d) => d.kind === 'AI_PLAN_WEEK');
      if (sessionDoc) {
        return {
          answer: `Best plan session match: ${sessionDoc.title}. ${sessionDoc.body.replace(/\s*\|\s*/g, ', ')}.`,
          primaryDocId: sessionDoc.id,
        };
      }
    }

    const planDoc = docs.find((d) => d.kind === 'AI_PLAN') ?? docs.find((d) => d.kind === 'ATHLETE_BRIEF') ?? docs[0];
    if (planDoc.kind === 'AI_PLAN') {
      return {
        answer: `Latest AI plan context: ${planDoc.title}${planDoc.date ? ` (${fmtDate(planDoc.date)})` : ''}.`,
        primaryDocId: planDoc.id,
      };
    }
    return {
      answer: `Latest athlete brief context: ${planDoc.title}.`,
      primaryDocId: planDoc.id,
    };
  }

  const top = docs[0];
  return {
    answer: `Top match: ${top.title}${top.date ? ` (${fmtDate(top.date)})` : ''}.`,
    primaryDocId: top.id,
  };
}

async function getScopedAthleteIds(userId: string, role: UserRole): Promise<string[]> {
  if (role === UserRole.ATHLETE) return [userId];

  if (role === UserRole.COACH) {
    const athletes = await prisma.athleteProfile.findMany({
      where: { coachId: userId },
      select: { userId: true },
    });
    return athletes.map((a) => a.userId);
  }

  const athletes = await prisma.athleteProfile.findMany({
    select: { userId: true },
    take: 500,
  });
  return athletes.map((a) => a.userId);
}

export async function askScopedKnowledge(context: AskContext): Promise<AskResult> {
  const query = context.query.trim();
  if (!query) {
    return {
      answer: 'Ask a question to search your CoachKit data.',
      citations: [],
    };
  }

  const athleteIds = await getScopedAthleteIds(context.userId, context.role);
  if (!athleteIds.length) {
    return {
      answer: 'No athlete records are available in your scope yet.',
      citations: [],
    };
  }

  const [profiles, calendarItems, completed, athleteBriefs, aiDrafts, planChangeProposals, planChangeAudits] = await Promise.all([
    prisma.athleteProfile.findMany({
      where: { userId: { in: athleteIds } },
      select: {
        userId: true,
        firstName: true,
        lastName: true,
        email: true,
        mobilePhone: true,
        primaryGoal: true,
        eventName: true,
        timezone: true,
        user: { select: { name: true } },
      },
      take: 300,
    }),
    prisma.calendarItem.findMany({
      where: { athleteId: { in: athleteIds }, deletedAt: null },
      select: {
        id: true,
        athleteId: true,
        title: true,
        discipline: true,
        status: true,
        date: true,
        plannedStartTimeLocal: true,
        plannedDurationMinutes: true,
        plannedDistanceKm: true,
        notes: true,
        workoutDetail: true,
        athlete: { select: { user: { select: { name: true } } } },
      },
      orderBy: [{ date: 'desc' }],
      take: 500,
    }),
    prisma.completedActivity.findMany({
      where: { athleteId: { in: athleteIds } },
      select: {
        id: true,
        athleteId: true,
        calendarItemId: true,
        startTime: true,
        durationMinutes: true,
        distanceKm: true,
        rpe: true,
        painFlag: true,
        notes: true,
        athlete: { select: { user: { select: { name: true } } } },
      },
      orderBy: [{ startTime: 'desc' }],
      take: 500,
    }),
    prisma.athleteBrief.findMany({
      where: { athleteId: { in: athleteIds } },
      select: {
        id: true,
        athleteId: true,
        generatedAt: true,
        summaryText: true,
        riskFlags: true,
      },
      orderBy: [{ generatedAt: 'desc' }],
      take: 300,
    }),
    prisma.aiPlanDraft.findMany({
      where: {
        athleteId: { in: athleteIds },
        ...(context.role === UserRole.ATHLETE ? { visibilityStatus: AiPlanDraftVisibilityStatus.PUBLISHED } : {}),
      },
      select: {
        id: true,
        athleteId: true,
        createdAt: true,
        publishedAt: true,
        visibilityStatus: true,
        status: true,
        lastPublishedSummaryText: true,
        weeks: { select: { sessionsCount: true, totalMinutes: true } },
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 300,
    }),
    prisma.planChangeProposal.findMany({
      where: context.role === UserRole.COACH ? { athleteId: { in: athleteIds } } : { athleteId: '__none__' },
      select: {
        id: true,
        athleteId: true,
        status: true,
        rationaleText: true,
        coachDecisionAt: true,
        appliedAt: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 300,
    }),
    prisma.planChangeAudit.findMany({
      where: context.role === UserRole.COACH ? { athleteId: { in: athleteIds } } : { athleteId: '__none__' },
      select: {
        id: true,
        athleteId: true,
        eventType: true,
        changeSummaryText: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 300,
    }),
  ]);

  const profileByAthleteId = new Map(
    profiles.map((profile) => {
      const fullName = firstNonBlank(
        [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim(),
        profile.user?.name,
        profile.userId
      );

      const body = [
        `Contact name: ${fullName}`,
        `Email: ${firstNonBlank(profile.email)}`,
        `Phone: ${firstNonBlank(profile.mobilePhone)}`,
        `Primary goal: ${firstNonBlank(profile.primaryGoal)}`,
        `Event: ${firstNonBlank(profile.eventName)}`,
        `Timezone: ${firstNonBlank(profile.timezone)}`,
      ].join(' | ');

      return [
        profile.userId,
        {
          id: `athlete:${profile.userId}`,
          kind: 'ATHLETE' as const,
          title: fullName,
          body,
          url:
            context.role === UserRole.ATHLETE
              ? '/athlete/profile'
              : `/coach/athletes/${encodeURIComponent(profile.userId)}/profile`,
          athleteName: fullName,
        },
      ];
    })
  );

  const docs: KnowledgeDoc[] = [];
  docs.push(...profileByAthleteId.values());

  for (const session of calendarItems) {
    const athleteName = firstNonBlank(session.athlete?.user?.name, profileByAthleteId.get(session.athleteId)?.title, session.athleteId);
    const day = session.date.toISOString().slice(0, 10);
    docs.push({
      id: `session:${session.id}`,
      kind: 'SESSION',
      title: `${athleteName} · ${session.title}`,
      body: [
        `Discipline: ${firstNonBlank(session.discipline)}`,
        `Status: ${session.status}`,
        `Date: ${day}`,
        `Start: ${firstNonBlank(session.plannedStartTimeLocal)}`,
        `Duration min: ${session.plannedDurationMinutes ?? 0}`,
        `Distance km: ${session.plannedDistanceKm ?? 0}`,
        `Details: ${firstNonBlank(session.workoutDetail)}`,
        `Notes: ${firstNonBlank(session.notes)}`,
      ].join(' | '),
      url:
        context.role === UserRole.ATHLETE
          ? `/athlete/calendar?date=${encodeURIComponent(day)}`
          : `/coach/calendar?athleteId=${encodeURIComponent(session.athleteId)}&date=${encodeURIComponent(day)}`,
      athleteName,
      date: day,
      status: session.status,
    });
  }

  for (const activity of completed) {
    const athleteName = firstNonBlank(activity.athlete?.user?.name, profileByAthleteId.get(activity.athleteId)?.title, activity.athleteId);
    const day = activity.startTime.toISOString().slice(0, 10);
    docs.push({
      id: `activity:${activity.id}`,
      kind: 'ACTIVITY',
      title: `${athleteName} · Completed activity (${day})`,
      body: [
        `Date: ${day}`,
        `Duration min: ${activity.durationMinutes}`,
        `Distance km: ${activity.distanceKm ?? 0}`,
        `RPE: ${activity.rpe ?? '-'}`,
        `Pain flag: ${activity.painFlag ? 'yes' : 'no'}`,
        `Notes: ${firstNonBlank(activity.notes)}`,
      ].join(' | '),
      url:
        context.role === UserRole.ATHLETE
          ? `/athlete/calendar?date=${encodeURIComponent(day)}`
          : `/coach/calendar?athleteId=${encodeURIComponent(activity.athleteId)}&date=${encodeURIComponent(day)}`,
      athleteName,
      date: day,
    });
  }

  const latestBriefByAthlete = new Map<string, (typeof athleteBriefs)[number]>();
  for (const brief of athleteBriefs) {
    if (latestBriefByAthlete.has(brief.athleteId)) continue;
    latestBriefByAthlete.set(brief.athleteId, brief);
  }

  for (const [athleteId, brief] of latestBriefByAthlete.entries()) {
    const athleteName = firstNonBlank(profileByAthleteId.get(athleteId)?.title, athleteId);
    const day = brief.generatedAt.toISOString().slice(0, 10);
    docs.push({
      id: `brief:${brief.id}`,
      kind: 'ATHLETE_BRIEF',
      title: `${athleteName} · Athlete Brief`,
      body: [
        `Generated: ${day}`,
        `Summary: ${firstNonBlank(brief.summaryText)}`,
        `Risk flags: ${(brief.riskFlags ?? []).join(', ') || '-'}`,
      ].join(' | '),
      url:
        context.role === UserRole.ATHLETE
          ? '/athlete/ai-plan'
          : `/coach/athletes/${encodeURIComponent(athleteId)}/ai-plan-builder`,
      athleteName,
      date: day,
    });
  }

  const latestDraftByAthlete = new Map<string, (typeof aiDrafts)[number]>();
  for (const draft of aiDrafts) {
    if (latestDraftByAthlete.has(draft.athleteId)) continue;
    latestDraftByAthlete.set(draft.athleteId, draft);
  }

  for (const [athleteId, draft] of latestDraftByAthlete.entries()) {
    const athleteName = firstNonBlank(profileByAthleteId.get(athleteId)?.title, athleteId);
    const day = (draft.publishedAt ?? draft.createdAt).toISOString().slice(0, 10);
    const totalSessions = (draft.weeks ?? []).reduce((sum, week) => sum + Number(week.sessionsCount ?? 0), 0);
    const totalMinutes = (draft.weeks ?? []).reduce((sum, week) => sum + Number(week.totalMinutes ?? 0), 0);
    const published = draft.visibilityStatus === AiPlanDraftVisibilityStatus.PUBLISHED;

    docs.push({
      id: `aiplan:${draft.id}`,
      kind: 'AI_PLAN',
      title: `${athleteName} · ${published ? 'Published AI plan' : 'Draft AI plan'}`,
      body: [
        `Date: ${day}`,
        `Draft status: ${draft.status}`,
        `Visibility: ${draft.visibilityStatus}`,
        `Sessions: ${totalSessions}`,
        `Total minutes: ${totalMinutes}`,
        `Summary: ${firstNonBlank(draft.lastPublishedSummaryText)}`,
      ].join(' | '),
      url:
        context.role === UserRole.ATHLETE
          ? `/athlete/ai-plan/${encodeURIComponent(draft.id)}`
          : `/coach/athletes/${encodeURIComponent(athleteId)}/ai-plan-builder`,
      athleteName,
      date: day,
    });
  }

  const latestDraftIds = Array.from(new Set(Array.from(latestDraftByAthlete.values()).map((d) => d.id)));
  if (latestDraftIds.length) {
    const draftSessions = await prisma.aiPlanDraftSession.findMany({
      where: { draftId: { in: latestDraftIds } },
      select: {
        id: true,
        draftId: true,
        weekIndex: true,
        dayOfWeek: true,
        discipline: true,
        type: true,
        durationMinutes: true,
        ordinal: true,
        locked: true,
      },
      orderBy: [{ weekIndex: 'asc' }, { ordinal: 'asc' }],
      take: 1200,
    });

    const draftById = new Map(Array.from(latestDraftByAthlete.values()).map((d) => [d.id, d] as const));
    const sessionsByAthleteWeek = new Map<string, typeof draftSessions>();

    for (const session of draftSessions) {
      const draft = draftById.get(session.draftId);
      if (!draft) continue;
      const key = `${draft.athleteId}:${session.weekIndex}`;
      const bucket = sessionsByAthleteWeek.get(key) ?? [];
      bucket.push(session);
      sessionsByAthleteWeek.set(key, bucket);
    }

    for (const [key, sessions] of sessionsByAthleteWeek.entries()) {
      const [athleteId, weekIndexRaw] = key.split(':');
      const weekIndex = Number(weekIndexRaw);
      const athleteName = firstNonBlank(profileByAthleteId.get(athleteId)?.title, athleteId);
      const weekNumber = Number.isFinite(weekIndex) ? weekIndex + 1 : 1;
      const totalMinutes = sessions.reduce((sum, s) => sum + Number(s.durationMinutes ?? 0), 0);
      const disciplines = Array.from(
        new Set(
          sessions
            .map((s) => String(s.discipline ?? '').trim().toLowerCase())
            .filter(Boolean)
            .map((d) => d.toUpperCase())
        )
      );

      docs.push({
        id: `aiplanweek:${athleteId}:${weekIndex}`,
        kind: 'AI_PLAN_WEEK',
        title: `${athleteName} · Week ${weekNumber} plan`,
        body: [`Sessions: ${sessions.length}`, `Total minutes: ${totalMinutes}`, `Disciplines: ${disciplines.join(', ') || '-'}`].join(' | '),
        url:
          context.role === UserRole.ATHLETE
            ? '/athlete/ai-plan'
            : `/coach/athletes/${encodeURIComponent(athleteId)}/ai-plan-builder`,
        athleteName,
      });
    }

    for (const session of draftSessions.slice(0, 400)) {
      const draft = draftById.get(session.draftId);
      if (!draft) continue;
      const athleteId = draft.athleteId;
      const athleteName = firstNonBlank(profileByAthleteId.get(athleteId)?.title, athleteId);
      const weekNumber = Number(session.weekIndex) + 1;
      docs.push({
        id: `aiplansession:${session.id}`,
        kind: 'AI_PLAN_SESSION',
        title: `${athleteName} · Week ${weekNumber} ${String(session.discipline)} ${String(session.type)}`,
        body: [
          `Week: ${weekNumber}`,
          `Day index: ${session.dayOfWeek}`,
          `Duration min: ${session.durationMinutes}`,
          `Discipline: ${session.discipline}`,
          `Type: ${session.type}`,
          `Locked: ${session.locked ? 'yes' : 'no'}`,
        ].join(' | '),
        url:
          context.role === UserRole.ATHLETE
            ? '/athlete/ai-plan'
            : `/coach/athletes/${encodeURIComponent(athleteId)}/ai-plan-builder`,
        athleteName,
      });
    }
  }

  const latestProposalByAthlete = new Map<string, (typeof planChangeProposals)[number]>();
  for (const proposal of planChangeProposals) {
    if (latestProposalByAthlete.has(proposal.athleteId)) continue;
    latestProposalByAthlete.set(proposal.athleteId, proposal);
  }

  for (const [athleteId, proposal] of latestProposalByAthlete.entries()) {
    const athleteName = firstNonBlank(profileByAthleteId.get(athleteId)?.title, athleteId);
    const proposalDate = (proposal.appliedAt ?? proposal.coachDecisionAt ?? proposal.createdAt).toISOString().slice(0, 10);
    docs.push({
      id: `aiproposal:${proposal.id}`,
      kind: 'AI_PROPOSAL',
      title: `${athleteName} · Plan proposal (${proposal.status})`,
      body: [
        `Date: ${proposalDate}`,
        `Status: ${proposal.status}`,
        `Rationale: ${firstNonBlank(proposal.rationaleText)}`,
      ].join(' | '),
      url: `/coach/athletes/${encodeURIComponent(athleteId)}/ai-plan-builder`,
      athleteName,
      date: proposalDate,
    });
  }

  const latestAuditByAthlete = new Map<string, (typeof planChangeAudits)[number]>();
  for (const audit of planChangeAudits) {
    if (latestAuditByAthlete.has(audit.athleteId)) continue;
    latestAuditByAthlete.set(audit.athleteId, audit);
  }

  for (const [athleteId, audit] of latestAuditByAthlete.entries()) {
    const athleteName = firstNonBlank(profileByAthleteId.get(athleteId)?.title, athleteId);
    const auditDate = audit.createdAt.toISOString().slice(0, 10);
    docs.push({
      id: `aiaudit:${audit.id}`,
      kind: 'AI_AUDIT',
      title: `${athleteName} · Plan audit (${audit.eventType})`,
      body: [
        `Date: ${auditDate}`,
        `Event: ${audit.eventType}`,
        `Summary: ${firstNonBlank(audit.changeSummaryText)}`,
      ].join(' | '),
      url: `/coach/athletes/${encodeURIComponent(athleteId)}/ai-plan-builder`,
      athleteName,
      date: auditDate,
    });
  }

  const intent = detectIntent(query);
  const ranked = docs
    .map((doc) => ({ doc, score: scoreDoc(doc, query, intent) }))
    .filter((entry) => entry.score > 0.08)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  const built = buildDeterministicAnswer(
    intent,
    query,
    ranked.map((entry) => entry.doc)
  );

  const uniqueCitations = new Map<string, AskCitation>();
  for (const { doc, score } of ranked) {
    const key = `${doc.url}|${doc.title}`;
    if (uniqueCitations.has(key)) continue;
    uniqueCitations.set(key, {
      id: doc.id,
      title: doc.title,
      url: doc.url,
      score: Number(score.toFixed(3)),
    });
  }

  let citations = Array.from(uniqueCitations.values());
  if (built.primaryDocId) {
    const preferred = citations.find((citation) => citation.id === built.primaryDocId);
    if (preferred) {
      citations = [preferred, ...citations.filter((citation) => citation.id !== built.primaryDocId)];
    }
  }

  const factual = isSimpleFactualQuery(query);
  citations = citations.slice(0, factual ? 1 : intent === 'GENERAL' ? 3 : 1);

  const answer = built.answer;

  return { answer, citations };
}
