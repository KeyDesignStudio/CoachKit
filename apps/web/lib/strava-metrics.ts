function pickFiniteNumber(value: unknown): number | null {
  if (typeof value !== 'number') return null;
  if (!Number.isFinite(value)) return null;
  return value;
}

/**
 * Extracts calories (kcal) from the various Strava metric shapes we persist.
 *
 * Supported shapes:
 * - metricsJson.strava.caloriesKcal
 * - metricsJson.strava.calories
 * - metricsJson.strava.activity.calories
 */
export function getStravaCaloriesKcal(strava: unknown): number | null {
  if (!strava || typeof strava !== 'object') return null;

  const root = strava as Record<string, unknown>;

  const direct = pickFiniteNumber(root.caloriesKcal) ?? pickFiniteNumber(root.calories);
  if (direct !== null) return direct;

  const activity = root.activity;
  if (activity && typeof activity === 'object') {
    const activityObj = activity as Record<string, unknown>;
    return pickFiniteNumber(activityObj.caloriesKcal) ?? pickFiniteNumber(activityObj.calories);
  }

  return null;
}

export function getStravaKilojoules(strava: unknown): number | null {
  if (!strava || typeof strava !== 'object') return null;

  const root = strava as Record<string, unknown>;
  const direct = pickFiniteNumber(root.kilojoules) ?? pickFiniteNumber(root.energy);
  if (direct !== null) return direct;

  const activity = root.activity;
  if (activity && typeof activity === 'object') {
    const activityObj = activity as Record<string, unknown>;
    return pickFiniteNumber(activityObj.kilojoules) ?? pickFiniteNumber(activityObj.energy);
  }

  return null;
}
