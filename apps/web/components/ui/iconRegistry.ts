// Icon Registry - Single source of truth for all icons in CoachKit
// Uses Google Material Symbols (Outlined style)
// 
// CRITICAL: Do not import icons directly in pages/components.
// Always use <Icon name="..." /> with a typed IconName from this registry.

export const ICON_NAMES = [
  // Discipline icons
  'disciplineRun',
  'disciplineBike',
  'disciplineSwim',
  'disciplineBrick',
  'disciplineStrength',
  'disciplineRest',
  'disciplineOther',
  
  // Coaching / feedback metadata
  'athleteComment',
  'anyComment',
  'attachment',
  'link',
  'painFlag',
  
  // Workflow state
  'planned',
  'completed',
  'skipped',
  'missed',
  'reviewed',
  'needsReview',
  
  // Navigation / actions
  'menu',
  'prev',
  'next',
  'today',
  'refresh',
  'copyWeek',
  'add',
  'scheduleAdd',
  'calendarAddOn',
  'edit',
  'delete',
  'close',
  'filter',
  'settings',
  'info',
  'warning',

  // Common UI
  'favorite',

  // Weather
  'weatherSunny',
  'weatherPartlyCloudy',
  'weatherCloudy',
  'weatherRain',
  'weatherStorm',
  'weatherFog',
  'weatherSnow',
  'weatherWind',
] as const;

export type IconName = (typeof ICON_NAMES)[number];

// Map IconName to Google Material Symbol name
export const ICONS: Record<IconName, string> = {
  // Discipline icons
  disciplineRun: 'directions_run',
  disciplineBike: 'directions_bike',
  disciplineSwim: 'pool',
  disciplineBrick: 'layers',
  disciplineStrength: 'fitness_center',
  disciplineRest: 'bedtime',
  disciplineOther: 'star',
  
  // Coaching / feedback metadata
  athleteComment: 'chat_bubble',
  anyComment: 'forum',
  attachment: 'attach_file',
  link: 'link',
  painFlag: 'healing',
  
  // Workflow state
  planned: 'event',
  completed: 'check_circle',
  skipped: 'remove_circle_outline',
  missed: 'event_busy',
  reviewed: 'done',
  needsReview: 'pending_actions',
  
  // Navigation / actions
  menu: 'menu',
  prev: 'chevron_left',
  next: 'chevron_right',
  today: 'today',
  refresh: 'refresh',
  copyWeek: 'content_copy',
  add: 'add',
  scheduleAdd: 'schedule_add',
  calendarAddOn: 'calendar_add_on',
  edit: 'edit',
  delete: 'delete',
  close: 'close',
  filter: 'filter_list',
  settings: 'settings',
  info: 'info',
  warning: 'warning_amber',

  // Common UI
  favorite: 'star',

  // Weather
  weatherSunny: 'sunny',
  weatherPartlyCloudy: 'partly_cloudy_day',
  weatherCloudy: 'cloud',
  weatherRain: 'rainy',
  weatherStorm: 'thunderstorm',
  weatherFog: 'foggy',
  weatherSnow: 'weather_snowy',
  weatherWind: 'air',
};

export function getIcon(name: IconName): string {
  return ICONS[name];
}
