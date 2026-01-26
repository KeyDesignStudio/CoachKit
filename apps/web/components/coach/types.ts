type Discipline = 'RUN' | 'BIKE' | 'SWIM' | 'BRICK' | 'STRENGTH' | 'OTHER';
type IntensityCategory = 'Z1' | 'Z2' | 'Z3' | 'Z4' | 'Z5' | 'RPE' | 'OTHER';

export type LibraryListItem = {
  id: string;
  title: string;
  discipline: Discipline;
  tags: string[];
  category: string | null;
  description: string;
  durationSec: number;
  intensityTarget: string;
  intensityCategory: IntensityCategory | null;
  distanceMeters: number | null;
  elevationGainMeters: number | null;
  equipment: string[];
  usageCount: number;
  createdAt: string;
  updatedAt: string;
  favorite: boolean;
};

export type CalendarItem = {
  id: string;
  date: string;
  plannedStartTimeLocal: string | null;
  displayTimeLocal?: string | null;
  discipline: string;
  status: string;
  title: string;
  athleteId?: string;
  athleteName?: string | null;
  athleteTimezone?: string;
  workoutDetail?: string | null;
  template?: { id: string; title: string } | null;
  plannedDurationMinutes?: number | null;
  plannedDistanceKm?: number | null;
  distanceMeters?: number | null;
  intensityTarget?: string | null;
  tags?: string[];
  equipment?: string[];
  workoutStructure?: unknown | null;
  notes?: string | null;
  latestCompletedActivity?: {
    painFlag: boolean;
    source?: 'MANUAL' | 'STRAVA';
    effectiveStartTimeUtc?: string;
    startTime?: string;
    confirmedAt?: string | null;
    durationMinutes?: number | null;
    distanceKm?: number | null;
    caloriesKcal?: number | null;
  } | null;
};
