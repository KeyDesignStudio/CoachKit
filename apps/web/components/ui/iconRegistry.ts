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
  'coachAdvice',
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
  'prev',
  'next',
  'today',
  'refresh',
  'copyWeek',
  'add',
  'edit',
  'delete',
  'close',
  'filter',
  'settings',
  'info',
  'warning',
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
  coachAdvice: 'lightbulb',
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
  prev: 'chevron_left',
  next: 'chevron_right',
  today: 'today',
  refresh: 'refresh',
  copyWeek: 'content_copy',
  add: 'add',
  edit: 'edit',
  delete: 'delete',
  close: 'close',
  filter: 'filter_list',
  settings: 'settings',
  info: 'info',
  warning: 'warning_amber',
};

export function getIcon(name: IconName): string {
  return ICONS[name];
}
