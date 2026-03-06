const BULLET_REGEX = /[\u2022\u2023\u25e6\u2043\u2219\uf0b7]/g;
const FRACTION_HALF_REGEX = /\u00bd/g;
const FRACTION_QUARTER_REGEX = /\u00bc/g;
const FRACTION_THREE_QUARTERS_REGEX = /\u00be/g;

const NOISE_SECTION_REGEX =
  /\b(training zones?|how it works|are these plans for you|please read this before you start|tips to maximize your training|meet the expert|cut out the guide|fold the guide|photos|illustrations|key\b|zone 1\b|zone 2\b|zone 3\b|zone 4\b|zone 5\b|tri\d+\.plan)\b/i;
const MONTH_PAGE_REGEX = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{4}\b/i;
const DAY_OR_WEEK_REGEX = /^(day\s+\d+|w(?:eek)?\s*0?\d{1,2}\b|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:rs|rsday|r|rs)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)$/i;
const DISCIPLINE_HEADER_REGEX = /^(swim|bike|cycling?|run|run\/walk|strength|rest|off)(?:\b|\/)/i;
const BLOCK_HEADING_REGEX = /^(warm[\s-]?up|cool[\s-]?down|main(?: set| session)?|session|technique|drill|strength|optional workout)\b/i;
const SESSION_METRIC_REGEX =
  /\b(\d+(?:\.\d+)?)\s*(km|kms|kilometres?|kilometers?|mile|miles|mi|m|hours?|hrs?|hr|h|minutes?|mins?|min|secs?|seconds?)\b/i;
const INTERVAL_REGEX = /\b\d+\s*[xX]\s*[\d.]+\s*(km|m|mi|miles?|hours?|hrs?|hr|h|minutes?|mins?|min|secs?|seconds?)\b/i;

type SegmentedBlock = {
  kind: 'schedule' | 'noise';
  lines: string[];
  reason: string;
};

export type SegmentedPlanDocument = {
  filteredText: string;
  filteredLines: string[];
  warnings: string[];
};

function normalizeLine(line: string) {
  return String(line ?? '')
    .replace(BULLET_REGEX, '-')
    .replace(FRACTION_HALF_REGEX, '0.5')
    .replace(FRACTION_QUARTER_REGEX, '0.25')
    .replace(FRACTION_THREE_QUARTERS_REGEX, '0.75')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function isMetadataLine(line: string) {
  const normalized = normalizeLine(line);
  if (!normalized) return true;
  if (/^\d{1,3}$/.test(normalized)) return true;
  if (MONTH_PAGE_REGEX.test(normalized)) return true;
  if (/^[A-Z0-9/& .-]{2,30}$/.test(normalized) && !DISCIPLINE_HEADER_REGEX.test(normalized) && !DAY_OR_WEEK_REGEX.test(normalized)) {
    return true;
  }
  return false;
}

function blockStats(lines: string[]) {
  const joined = lines.join(' ');
  const scheduleAnchors =
    lines.filter((line) => DAY_OR_WEEK_REGEX.test(line) || DISCIPLINE_HEADER_REGEX.test(line) || BLOCK_HEADING_REGEX.test(line)).length;
  const metricLines = lines.filter((line) => SESSION_METRIC_REGEX.test(line) || INTERVAL_REGEX.test(line)).length;
  const longNarrativeLines = lines.filter((line) => line.split(/\s+/).length >= 12).length;
  const noiseHits = lines.filter((line) => NOISE_SECTION_REGEX.test(line) || isMetadataLine(line)).length;
  return { joined, scheduleAnchors, metricLines, longNarrativeLines, noiseHits };
}

function classifyBlock(lines: string[]): SegmentedBlock {
  const stats = blockStats(lines);
  const likelySchedule =
    stats.scheduleAnchors >= 2 ||
    (stats.scheduleAnchors >= 1 && stats.metricLines >= 1) ||
    stats.metricLines >= 2 ||
    lines.some((line) => INTERVAL_REGEX.test(line));

  const likelyNoise =
    NOISE_SECTION_REGEX.test(stats.joined) ||
    stats.noiseHits >= Math.max(2, Math.ceil(lines.length * 0.6)) ||
    (stats.longNarrativeLines >= 2 && stats.scheduleAnchors === 0 && stats.metricLines === 0);

  if (likelySchedule && !likelyNoise) {
    return { kind: 'schedule', lines, reason: 'schedule block' };
  }

  if (!likelySchedule && likelyNoise) {
    return { kind: 'noise', lines, reason: 'editorial or legend block' };
  }

  if (likelySchedule) {
    return { kind: 'schedule', lines, reason: 'mixed block kept for session extraction' };
  }

  return { kind: 'noise', lines, reason: 'non-schedule block' };
}

function splitBlocks(rawText: string) {
  const rawLines = String(rawText ?? '').split(/\r?\n/).map(normalizeLine);
  const blocks: string[][] = [];
  let current: string[] = [];

  for (const line of rawLines) {
    if (!line) {
      if (current.length) {
        blocks.push(current);
        current = [];
      }
      continue;
    }
    current.push(line);
  }

  if (current.length) blocks.push(current);
  return blocks;
}

export function segmentPlanDocument(rawText: string): SegmentedPlanDocument {
  const warnings: string[] = [];
  const blocks = splitBlocks(rawText);
  const kept: string[] = [];

  for (const block of blocks) {
    const classified = classifyBlock(block);
    if (classified.kind === 'noise') {
      warnings.push(`Segmentation removed ${classified.reason}: "${block[0]?.slice(0, 80) ?? ''}"`);
      continue;
    }

    kept.push(...classified.lines);
    kept.push('');
  }

  const filteredLines = kept.map(normalizeLine).filter(Boolean);
  return {
    filteredText: filteredLines.join('\n'),
    filteredLines,
    warnings,
  };
}
