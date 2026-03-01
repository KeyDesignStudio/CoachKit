import { ChallengeBadgeType } from '@prisma/client';

import type { ChallengeRewardConfig } from '@/lib/challenges/config';

const BADGE_TEMPLATE_PATH = '/badges/templates/badge-template-v1.svg';

const BADGE_TIER_LABEL: Record<ChallengeBadgeType, string> = {
  PARTICIPATION: 'PARTICIPATION',
  GOLD: 'GOLD',
  SILVER: 'SILVER',
  BRONZE: 'BRONZE',
};

function escapeXml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function badgeTierColor(type: ChallengeBadgeType) {
  if (type === 'GOLD') return '#facc15';
  if (type === 'SILVER') return '#cbd5e1';
  if (type === 'BRONZE') return '#fdba74';
  return '#34d399';
}

function wrapTitle(value: string, maxLineLength: number) {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return ['Challenge'];

  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxLineLength) {
      current = next;
      continue;
    }

    if (current) lines.push(current);
    current = word;
  }

  if (current) lines.push(current);
  return lines.slice(0, 2);
}

function initialsFromSquadName(squadName: string) {
  const chars = squadName
    .split(/\s+/)
    .map((part) => part.trim().charAt(0))
    .filter(Boolean)
    .slice(0, 3)
    .join('')
    .toUpperCase();

  return chars || 'SQD';
}

export function defaultBadgeMonthYear(date: Date) {
  return new Intl.DateTimeFormat('en-AU', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
}

export function buildChallengeBadgeImageUrl(challengeId: string, type: ChallengeBadgeType) {
  return `/api/challenges/${encodeURIComponent(challengeId)}/badge-image/${type}`;
}

export function renderBadgeSvg(input: {
  type: ChallengeBadgeType;
  challengeTitle: string;
  squadName: string;
  logoUrl: string | null;
  rewardConfig: ChallengeRewardConfig;
  startAt: Date;
}) {
  const tierLabel = BADGE_TIER_LABEL[input.type];
  const monthYear = input.rewardConfig.badgeMonthYear?.trim() || defaultBadgeMonthYear(input.startAt);
  const logoUrl = input.rewardConfig.badgeLogoUrl?.trim() || input.logoUrl?.trim() || '';
  const titleLines = wrapTitle(input.challengeTitle, 28);
  const templateHref = BADGE_TEMPLATE_PATH;

  const firstLine = escapeXml(titleLines[0] ?? 'Challenge');
  const secondLine = titleLines[1] ? escapeXml(titleLines[1]) : '';

  const fallbackInitials = escapeXml(initialsFromSquadName(input.squadName));

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024" role="img" aria-label="${escapeXml(input.challengeTitle)} ${escapeXml(tierLabel)} badge">
  <image href="${templateHref}" x="0" y="0" width="1024" height="1024" preserveAspectRatio="xMidYMid meet"/>

  <text x="510" y="212" text-anchor="middle" font-family="'Avenir Next', 'Helvetica Neue', Helvetica, Arial, sans-serif" font-size="44" font-weight="700" fill="${badgeTierColor(input.type)}" letter-spacing="1">${escapeXml(tierLabel)}</text>

  ${
    logoUrl
      ? `<image href="${escapeXml(logoUrl)}" x="318" y="414" width="90" height="90" preserveAspectRatio="xMidYMid meet"/>`
      : `<circle cx="363" cy="459" r="43" fill="#101a33"/><text x="363" y="473" text-anchor="middle" font-family="'Avenir Next', 'Helvetica Neue', Helvetica, Arial, sans-serif" font-size="30" font-weight="700" fill="#f8fafc">${fallbackInitials}</text>`
  }

  <text x="392" y="580" text-anchor="middle" font-family="'Avenir Next', 'Helvetica Neue', Helvetica, Arial, sans-serif" font-size="20" font-weight="600" fill="#101a33" letter-spacing="0.4">${escapeXml(monthYear.toUpperCase())}</text>

  <text x="508" y="707" text-anchor="middle" font-family="'Avenir Next', 'Helvetica Neue', Helvetica, Arial, sans-serif" font-size="30" font-weight="700" fill="#f8fafc" letter-spacing="0.6">${firstLine}</text>
  ${
    secondLine
      ? `<text x="508" y="736" text-anchor="middle" font-family="'Avenir Next', 'Helvetica Neue', Helvetica, Arial, sans-serif" font-size="26" font-weight="700" fill="#f8fafc" letter-spacing="0.4">${secondLine}</text>`
      : ''
  }
</svg>`;
}
