import { prisma } from '@/lib/prisma';

type TrustedKnowledgeSourceSeed = {
  slug: string;
  title: string;
  url: string;
  category: string;
  authority: string;
  trustTier: number;
  planningEnabled: boolean;
  qaEnabled: boolean;
  citationRequired: boolean;
  summaryText: string;
  tags: string[];
};

const TRUSTED_KNOWLEDGE_SOURCE_SEEDS: TrustedKnowledgeSourceSeed[] = [
  {
    slug: 'au-triathlon-coaching',
    title: 'AusTriathlon Coaching',
    url: 'https://www.triathlon.org.au/coaching/',
    category: 'coach-education',
    authority: 'AusTriathlon',
    trustTier: 1,
    planningEnabled: true,
    qaEnabled: true,
    citationRequired: true,
    summaryText: 'Australian triathlon coaching pathway and coach-development guidance for planning and session design.',
    tags: ['triathlon', 'coach education', 'planning', 'pathway', 'session design'],
  },
  {
    slug: 'world-triathlon-coach-education',
    title: 'World Triathlon Coach Education',
    url: 'https://triathlon.org/development/coach/coaches-education-objectives-strategy-and-pathway',
    category: 'coach-education',
    authority: 'World Triathlon',
    trustTier: 1,
    planningEnabled: true,
    qaEnabled: true,
    citationRequired: true,
    summaryText: 'World Triathlon coach-education objectives and pathway material relevant to long-term athlete development and coaching practice.',
    tags: ['triathlon', 'coach education', 'development', 'pathway', 'long term development'],
  },
  {
    slug: 'ais-nutrition',
    title: 'AIS Nutrition',
    url: 'https://www.ais.gov.au/nutrition',
    category: 'nutrition',
    authority: 'Australian Institute of Sport',
    trustTier: 1,
    planningEnabled: false,
    qaEnabled: true,
    citationRequired: true,
    summaryText: 'AIS evidence-based sports nutrition guidance for fueling, hydration, and recovery support.',
    tags: ['nutrition', 'fueling', 'hydration', 'recovery', 'endurance nutrition'],
  },
  {
    slug: 'ais-supplement-framework',
    title: 'AIS Sports Supplement Framework',
    url: 'https://www.ais.gov.au/nutrition/supplements',
    category: 'supplements',
    authority: 'Australian Institute of Sport',
    trustTier: 1,
    planningEnabled: false,
    qaEnabled: true,
    citationRequired: true,
    summaryText: 'AIS supplement framework for evidence, risk, and practical use of sports supplements.',
    tags: ['supplements', 'nutrition', 'evidence', 'risk', 'ergogenic aids'],
  },
  {
    slug: 'ais-performance-support',
    title: 'AIS Performance Support',
    url: 'https://www.ausport.gov.au/ais/performance-support',
    category: 'performance-support',
    authority: 'Australian Institute of Sport',
    trustTier: 1,
    planningEnabled: true,
    qaEnabled: true,
    citationRequired: true,
    summaryText: 'AIS performance-support disciplines covering multidisciplinary support for coaching and performance environments.',
    tags: ['performance support', 'coaching', 'support services', 'sport science', 'performance'],
  },
  {
    slug: 'asc-strength-conditioning',
    title: 'Australian Sports Commission Clearinghouse: Strength and Conditioning for Sport',
    url: 'https://www.ausport.gov.au/clearinghouse/evidence/strength-and-conditioning',
    category: 'strength-conditioning',
    authority: 'Australian Sports Commission Clearinghouse',
    trustTier: 1,
    planningEnabled: true,
    qaEnabled: true,
    citationRequired: true,
    summaryText: 'Clearinghouse evidence hub for sport strength-and-conditioning practice and supporting research.',
    tags: ['strength', 'conditioning', 'gym', 'evidence', 'resistance training'],
  },
  {
    slug: 'asc-recovery',
    title: 'Australian Sports Commission Clearinghouse: Sports Performance Recovery',
    url: 'https://www.ausport.gov.au/clearinghouse/evidence/sports-performance-recovery',
    category: 'recovery',
    authority: 'Australian Sports Commission Clearinghouse',
    trustTier: 1,
    planningEnabled: true,
    qaEnabled: true,
    citationRequired: true,
    summaryText: 'Clearinghouse recovery evidence for scheduling load, restoration, and athlete readiness.',
    tags: ['recovery', 'load management', 'fatigue', 'sleep', 'readiness'],
  },
  {
    slug: 'ais-female-performance-health',
    title: 'AIS Female Performance & Health Initiative',
    url: 'https://www.ais.gov.au/fphi',
    category: 'female-performance-health',
    authority: 'Australian Institute of Sport',
    trustTier: 1,
    planningEnabled: true,
    qaEnabled: true,
    citationRequired: true,
    summaryText: 'AIS guidance on female athlete health and performance considerations for planning and support.',
    tags: ['female athlete', 'women', 'health', 'performance', 'planning considerations'],
  },
  {
    slug: 'sports-dietitians-australia',
    title: 'Sports Dietitians Australia',
    url: 'https://sportsdietitians.com.au/',
    category: 'nutrition',
    authority: 'Sports Dietitians Australia',
    trustTier: 1,
    planningEnabled: false,
    qaEnabled: true,
    citationRequired: true,
    summaryText: 'Accredited sports-dietetics guidance for fueling, competition preparation, and athlete nutrition support.',
    tags: ['nutrition', 'dietitian', 'fueling', 'competition nutrition', 'hydration'],
  },
  {
    slug: 'sport-integrity-check-substances',
    title: 'Sport Integrity Australia: Check Substances / Global DRO Guidance',
    url: 'https://www.sportintegrity.gov.au/what-we-do/anti-doping/substance-education/check-substances',
    category: 'integrity-compliance',
    authority: 'Sport Integrity Australia',
    trustTier: 1,
    planningEnabled: false,
    qaEnabled: true,
    citationRequired: true,
    summaryText: 'Anti-doping and substance-check guidance for athletes and coaches before using supplements or medications.',
    tags: ['anti-doping', 'substances', 'global dro', 'supplements', 'compliance'],
  },
];

function normalize(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim();
}

function tokenize(text: string) {
  return normalize(text)
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function overlapScore(query: string, haystack: string) {
  const queryTokens = tokenize(query);
  if (!queryTokens.length) return 0;
  const haystackText = normalize(haystack);
  let matches = 0;
  for (const token of queryTokens) {
    if (haystackText.includes(token)) matches += 1;
  }
  return matches / queryTokens.length;
}

export async function ensureTrustedKnowledgeSourcesSeeded() {
  await Promise.all(
    TRUSTED_KNOWLEDGE_SOURCE_SEEDS.map((source) =>
      prisma.trustedKnowledgeSource.upsert({
        where: { slug: source.slug },
        update: {
          title: source.title,
          url: source.url,
          category: source.category,
          authority: source.authority,
          trustTier: source.trustTier,
          planningEnabled: source.planningEnabled,
          qaEnabled: source.qaEnabled,
          citationRequired: source.citationRequired,
          summaryText: source.summaryText,
          tags: source.tags,
          isActive: true,
        },
        create: source,
      })
    )
  );
}

export async function listTrustedKnowledgeSources() {
  await ensureTrustedKnowledgeSourcesSeeded();
  return prisma.trustedKnowledgeSource.findMany({
    orderBy: [{ trustTier: 'asc' }, { authority: 'asc' }, { title: 'asc' }],
  });
}

export async function updateTrustedKnowledgeSource(params: {
  id: string;
  planningEnabled?: boolean;
  qaEnabled?: boolean;
  citationRequired?: boolean;
  isActive?: boolean;
}) {
  await ensureTrustedKnowledgeSourcesSeeded();
  return prisma.trustedKnowledgeSource.update({
    where: { id: params.id },
    data: {
      ...(typeof params.planningEnabled === 'boolean' ? { planningEnabled: params.planningEnabled } : {}),
      ...(typeof params.qaEnabled === 'boolean' ? { qaEnabled: params.qaEnabled } : {}),
      ...(typeof params.citationRequired === 'boolean' ? { citationRequired: params.citationRequired } : {}),
      ...(typeof params.isActive === 'boolean' ? { isActive: params.isActive } : {}),
    },
  });
}

export async function matchTrustedKnowledgeSources(params: {
  query: string;
  limit?: number;
  includePlanning?: boolean;
}) {
  await ensureTrustedKnowledgeSourcesSeeded();
  const rows = await prisma.trustedKnowledgeSource.findMany({
    where: {
      isActive: true,
      OR: [
        { qaEnabled: true },
        ...(params.includePlanning ? [{ planningEnabled: true }] : []),
      ],
    },
    orderBy: [{ trustTier: 'asc' }, { authority: 'asc' }, { title: 'asc' }],
  });

  return rows
    .map((row) => {
      const score = overlapScore(params.query, [row.title, row.category, row.authority, row.summaryText ?? '', ...(row.tags ?? [])].join(' '));
      return { row, score };
    })
    .filter((entry) => entry.score >= 0.12)
    .sort((a, b) => b.score - a.score || a.row.trustTier - b.row.trustTier)
    .slice(0, Math.max(1, Math.min(6, params.limit ?? 3)));
}
