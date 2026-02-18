import { CalendarItemStatus, UserRole } from '@prisma/client';

import { prisma } from '@/lib/prisma';

type AskIntent = 'CONTACT' | 'LAST_SESSION' | 'UPCOMING' | 'PAIN' | 'MISSED' | 'GENERAL';

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
  kind: 'ATHLETE' | 'SESSION' | 'ACTIVITY';
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

  return 'GENERAL';
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
  return date.toISOString().slice(0, 10);
}

function firstNonBlank(...values: Array<string | null | undefined>): string {
  for (const value of values) {
    const trimmed = String(value ?? '').trim();
    if (trimmed) return trimmed;
  }
  return '-';
}

function buildDeterministicAnswer(intent: AskIntent, query: string, docs: KnowledgeDoc[]): string {
  if (!docs.length) {
    return 'I could not find a confident match in your CoachKit records. Try adding an athlete name, date, or workout keyword.';
  }

  if (intent === 'CONTACT') {
    const contactDoc = docs.find((d) => d.kind === 'ATHLETE') ?? docs[0];
    return `The best contact match is ${contactDoc.title}.`; 
  }

  if (intent === 'LAST_SESSION') {
    const latest = [...docs]
      .filter((d) => d.kind === 'SESSION' || d.kind === 'ACTIVITY')
      .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))[0] ?? docs[0];
    return `Latest session match: ${latest.title} (${fmtDate(latest.date)}).`;
  }

  if (intent === 'UPCOMING') {
    const today = new Date().toISOString().slice(0, 10);
    const upcoming = [...docs]
      .filter((d) => d.kind === 'SESSION' && d.date && d.date >= today)
      .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))[0] ?? docs[0];
    return `Next upcoming session match: ${upcoming.title} (${fmtDate(upcoming.date)}).`;
  }

  if (intent === 'PAIN') {
    const pain = docs.find((d) => d.body.toLowerCase().includes('pain flag: yes')) ?? docs[0];
    return `Pain-related match: ${pain.title}${pain.date ? ` (${fmtDate(pain.date)})` : ''}.`;
  }

  if (intent === 'MISSED') {
    const missed = docs.find((d) => d.status === CalendarItemStatus.SKIPPED) ?? docs[0];
    return `Missed-session match: ${missed.title}${missed.date ? ` (${fmtDate(missed.date)})` : ''}.`;
  }

  const top = docs[0];
  return `Top match: ${top.title}${top.date ? ` (${fmtDate(top.date)})` : ''}.`;
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

  const [profiles, calendarItems, completed] = await Promise.all([
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
      title: `${athleteName} · Completed activity`,
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

  const intent = detectIntent(query);
  const ranked = docs
    .map((doc) => ({ doc, score: scoreDoc(doc, query, intent) }))
    .filter((entry) => entry.score > 0.08)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  const citations: AskCitation[] = ranked.map(({ doc, score }) => ({
    id: doc.id,
    title: doc.title,
    url: doc.url,
    score: Number(score.toFixed(3)),
  }));

  const answer = buildDeterministicAnswer(
    intent,
    query,
    ranked.map((entry) => entry.doc)
  );

  return { answer, citations };
}
