import { CumulativeTrainingChart } from '@/components/athlete/CumulativeTrainingChart';

const mockData = {
  dataset: 'BOTH',
  dayKeys: [
    '2026-01-01',
    '2026-01-02',
    '2026-01-03',
    '2026-01-04',
    '2026-01-05',
    '2026-01-06',
    '2026-01-07',
  ],
  disciplines: ['RUN', 'BIKE'],
  actual: {
    series: {
      RUN: [0, 30, 60, 90, 120, 150, 180],
      BIKE: [0, 0, 40, 80, 80, 120, 120],
    },
    breakdown: {
      RUN: {
        '2026-01-02': [{ durationMinutes: 30, distanceKm: 5, caloriesKcal: 320, rpe: 6, title: 'Easy run' }],
        '2026-01-03': [{ durationMinutes: 30, distanceKm: 6, caloriesKcal: 350, rpe: 7, title: 'Steady run' }],
        '2026-01-04': [{ durationMinutes: 30, distanceKm: 5.5, caloriesKcal: 330, rpe: 6, title: 'Recovery run' }],
        '2026-01-05': [{ durationMinutes: 30, distanceKm: 6.2, caloriesKcal: 360, rpe: 7, title: 'Tempo' }],
        '2026-01-06': [{ durationMinutes: 30, distanceKm: 5.8, caloriesKcal: 340, rpe: 6, title: 'Easy run' }],
        '2026-01-07': [{ durationMinutes: 30, distanceKm: 6.0, caloriesKcal: 355, rpe: 7, title: 'Steady run' }],
      },
      BIKE: {
        '2026-01-03': [{ durationMinutes: 40, distanceKm: 18, caloriesKcal: 520, rpe: 5, title: 'Endurance ride' }],
        '2026-01-04': [{ durationMinutes: 40, distanceKm: 20, caloriesKcal: 560, rpe: 6, title: 'Endurance ride' }],
        '2026-01-06': [{ durationMinutes: 40, distanceKm: 22, caloriesKcal: 590, rpe: 6, title: 'Tempo ride' }],
      },
    },
  },
  planned: {
    series: {
      RUN: [30, 60, 90, 120, 150, 180, 210],
      BIKE: [0, 20, 40, 60, 80, 100, 120],
    },
    breakdown: {
      RUN: {
        '2026-01-01': [{ durationMinutes: 30, distanceKm: 5, caloriesKcal: null, rpe: null, title: 'Planned run' }],
        '2026-01-02': [{ durationMinutes: 30, distanceKm: 5, caloriesKcal: null, rpe: null, title: 'Planned run' }],
        '2026-01-03': [{ durationMinutes: 30, distanceKm: 6, caloriesKcal: null, rpe: null, title: 'Planned run' }],
        '2026-01-04': [{ durationMinutes: 30, distanceKm: 5.5, caloriesKcal: null, rpe: null, title: 'Planned run' }],
        '2026-01-05': [{ durationMinutes: 30, distanceKm: 6.2, caloriesKcal: null, rpe: null, title: 'Planned run' }],
        '2026-01-06': [{ durationMinutes: 30, distanceKm: 5.8, caloriesKcal: null, rpe: null, title: 'Planned run' }],
        '2026-01-07': [{ durationMinutes: 30, distanceKm: 6.0, caloriesKcal: null, rpe: null, title: 'Planned run' }],
      },
      BIKE: {
        '2026-01-02': [{ durationMinutes: 20, distanceKm: 10, caloriesKcal: null, rpe: null, title: 'Planned bike' }],
        '2026-01-03': [{ durationMinutes: 20, distanceKm: 10, caloriesKcal: null, rpe: null, title: 'Planned bike' }],
        '2026-01-04': [{ durationMinutes: 20, distanceKm: 10, caloriesKcal: null, rpe: null, title: 'Planned bike' }],
        '2026-01-05': [{ durationMinutes: 20, distanceKm: 10, caloriesKcal: null, rpe: null, title: 'Planned bike' }],
        '2026-01-06': [{ durationMinutes: 20, distanceKm: 10, caloriesKcal: null, rpe: null, title: 'Planned bike' }],
        '2026-01-07': [{ durationMinutes: 20, distanceKm: 10, caloriesKcal: null, rpe: null, title: 'Planned bike' }],
      },
    },
  },
} as const;

export default function DevCumulativeTrainingChartPage() {
  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-lg font-semibold">Dev: Cumulative Training Chart</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Uses mocked data (no API calls). Default mode is <span className="font-medium">Both</span>.
      </p>

      <div className="mt-6">
        <CumulativeTrainingChart
          from="2026-01-01"
          to="2026-01-07"
          discipline={null}
          athleteTimeZone="America/Los_Angeles"
          initialData={mockData as any}
          disableFetch
          defaultMode="BOTH"
        />
      </div>
    </main>
  );
}
