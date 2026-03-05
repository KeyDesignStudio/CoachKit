import ConsoleDashboardPage, {
  type CoachActiveChallengePreview,
  type CoachDashboardResponse,
} from './console-page';
import { BuildInfoFooter } from '@/components/BuildInfoFooter';
import { getAppShellBootstrap } from '@/lib/app-shell';
import { getZonedDateKeyForNow } from '@/components/calendar/getCalendarDisplayTime';
import { addDaysToDayKey } from '@/lib/day-key';
import { createServerRouteRequest, readServerRouteData } from '@/lib/server-route-bootstrap';
import { GET as getCoachDashboardConsoleRoute } from '@/app/api/coach/dashboard/console/route';
import { GET as getCoachChallengesRoute } from '@/app/api/coach/challenges/route';

type CoachChallengesResponse = {
  challenges: CoachActiveChallengePreview[];
};

export default async function CoachDashboardPage() {
  const appShell = await getAppShellBootstrap();
  const authUser = appShell.authUser;

  let initialData: CoachDashboardResponse | null = null;
  let initialChallenges: CoachActiveChallengePreview[] = [];
  let initialSelectedAthleteIds: string[] = [];
  let initialQueryKey: string | null = null;

  if (authUser?.role === 'COACH') {
    try {
      const todayKey = getZonedDateKeyForNow(authUser.timezone);
      const fromKey = addDaysToDayKey(todayKey, -29);

      const [dashboardResponse, challengesResponse] = await Promise.all([
        getCoachDashboardConsoleRoute(
          createServerRouteRequest(
            `/api/coach/dashboard/console?from=${fromKey}&to=${todayKey}&inboxLimit=25&inboxOffset=0&includeLoadModel=1`
          )
        ),
        getCoachChallengesRoute(createServerRouteRequest('/api/coach/challenges?status=ACTIVE')),
      ]);

      initialData = await readServerRouteData<CoachDashboardResponse>(dashboardResponse);
      initialChallenges = (await readServerRouteData<CoachChallengesResponse>(challengesResponse)).challenges ?? [];
      initialSelectedAthleteIds = initialData.athletes.map((athlete) => athlete.id);
      initialQueryKey = [fromKey, todayKey, '', 'ALL'].join('|');
    } catch {
      initialData = null;
      initialChallenges = [];
      initialSelectedAthleteIds = [];
      initialQueryKey = null;
    }
  }

  return (
    <>
      <ConsoleDashboardPage
        initialData={initialData}
        initialChallenges={initialChallenges}
        initialSelectedAthleteIds={initialSelectedAthleteIds}
        initialQueryKey={initialQueryKey}
      />
      <BuildInfoFooter />
    </>
  );
}
