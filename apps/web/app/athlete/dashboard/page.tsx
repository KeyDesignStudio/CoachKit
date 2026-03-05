import ConsoleDashboardPage, {
  type ActiveChallengePreview,
  type AthleteDashboardResponse,
  type AthleteIntakeLifecycleResponse,
} from './console-page';
import { BuildInfoFooter } from '@/components/BuildInfoFooter';
import { getAppShellBootstrap } from '@/lib/app-shell';
import { getZonedDateKeyForNow } from '@/components/calendar/getCalendarDisplayTime';
import { addDaysToDayKey } from '@/lib/day-key';
import { createServerRouteRequest, readServerRouteData } from '@/lib/server-route-bootstrap';
import { GET as getAthleteDashboardConsoleRoute } from '@/app/api/athlete/dashboard/console/route';
import { GET as getAthleteChallengesRoute } from '@/app/api/athlete/challenges/route';
import { GET as getAthleteIntakeLifecycleRoute } from '@/app/api/athlete/ai-plan/intake/latest/route';

type AthleteChallengesResponse = {
  challenges: ActiveChallengePreview[];
};

export default async function AthleteDashboardPage() {
  const appShell = await getAppShellBootstrap();
  const authUser = appShell.authUser;

  let initialData: AthleteDashboardResponse | null = null;
  let initialChallenges: ActiveChallengePreview[] = [];
  let initialTrainingRequestLifecycle: AthleteIntakeLifecycleResponse | null = null;
  let initialQueryKey: string | null = null;

  if (authUser?.role === 'ATHLETE') {
    try {
      const todayKey = getZonedDateKeyForNow(authUser.timezone);
      const fromKey = addDaysToDayKey(todayKey, -29);

      const [dashboardResponse, challengesResponse, trainingLifecycleResponse] = await Promise.all([
        getAthleteDashboardConsoleRoute(
          createServerRouteRequest(`/api/athlete/dashboard/console?from=${fromKey}&to=${todayKey}`)
        ),
        getAthleteChallengesRoute(createServerRouteRequest('/api/athlete/challenges?status=ACTIVE')),
        getAthleteIntakeLifecycleRoute(),
      ]);

      initialData = await readServerRouteData<AthleteDashboardResponse>(dashboardResponse);
      initialChallenges = (await readServerRouteData<AthleteChallengesResponse>(challengesResponse)).challenges ?? [];
      initialTrainingRequestLifecycle =
        await readServerRouteData<AthleteIntakeLifecycleResponse>(trainingLifecycleResponse);
      initialQueryKey = [fromKey, todayKey, ''].join('|');
    } catch {
      initialData = null;
      initialChallenges = [];
      initialTrainingRequestLifecycle = null;
      initialQueryKey = null;
    }
  }

  return (
    <>
      <ConsoleDashboardPage
        initialData={initialData}
        initialChallenges={initialChallenges}
        initialTrainingRequestLifecycle={initialTrainingRequestLifecycle}
        initialQueryKey={initialQueryKey}
      />
      <BuildInfoFooter />
    </>
  );
}
