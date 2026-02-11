export function getPageTitleFromPath(pathname: string): string {
  if (pathname.startsWith('/admin')) return 'Admin';

  if (pathname.startsWith('/coach/athletes/')) {
    if (pathname.includes('/profile')) return 'Athlete profile';
    if (pathname.includes('/ai-plan-builder')) return 'AI Plan Builder';
    return 'Athletes';
  }

  if (pathname.startsWith('/coach/dashboard')) return 'Dashboard';
  if (pathname.startsWith('/coach/calendar')) return 'Calendar';
  if (pathname.startsWith('/coach/notifications')) return 'Notifications';
  if (pathname.startsWith('/coach/athletes')) return 'Athletes';
  if (pathname.startsWith('/coach/group-sessions')) return 'Group sessions';
  if (pathname.startsWith('/coach/settings')) return 'Settings';

  if (pathname.startsWith('/athlete/dashboard')) return 'Dashboard';
  if (pathname.startsWith('/athlete/calendar')) return 'Calendar';
  if (pathname.startsWith('/athlete/profile')) return 'Athlete profile';
  if (pathname.startsWith('/athlete/notifications')) return 'Notifications';
  if (pathname.startsWith('/athlete/settings')) return 'Settings';
  if (pathname.startsWith('/athlete/intake')) return 'Intake';
  if (pathname.startsWith('/athlete/today')) return 'Today';
  if (pathname.startsWith('/athlete/workouts')) return 'Workouts';

  return 'CoachKit';
}