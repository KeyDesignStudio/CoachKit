export type IntakeQuestionType = 'text' | 'textarea' | 'select' | 'multi' | 'scale' | 'number';

export type IntakeQuestion = {
  key: string;
  prompt: string;
  helper?: string;
  type: IntakeQuestionType;
  options?: string[];
  min?: number;
  max?: number;
};

export type IntakeSection = {
  key: string;
  title: string;
  intro?: string;
  questions: IntakeQuestion[];
};

export const INTAKE_SECTIONS: IntakeSection[] = [
  {
    key: 'coaching-style',
    title: 'Coaching Style & Relationship',
    intro: 'Let’s shape how we work together so coaching feels supportive and effective.',
    questions: [
      { key: 'coach_feedback_style', prompt: 'What kind of feedback helps you most?', type: 'textarea' },
      {
        key: 'coach_checkin_preference',
        prompt: 'How do you prefer check-ins?',
        type: 'select',
        options: ['Quick check-in', 'Detailed review', 'Only when needed', 'Mix it up'],
      },
      {
        key: 'coach_tone_preference',
        prompt: 'What tone feels best for coaching feedback?',
        type: 'select',
        options: ['Direct and concise', 'Encouraging and supportive', 'Balanced and pragmatic'],
      },
      {
        key: 'coach_structure_preference',
        prompt: 'How much structure do you want in training weeks?',
        type: 'scale',
        min: 1,
        max: 5,
      },
      { key: 'coach_green_flags', prompt: 'What feels like a green flag in coaching?', type: 'text' },
      { key: 'coach_red_flags', prompt: 'Anything you want to avoid in coaching?', type: 'text' },
    ],
  },
  {
    key: 'identity-mindset',
    title: 'Athlete Identity & Mindset',
    intro: 'A little about how you think and feel as an athlete.',
    questions: [
      { key: 'athlete_identity', prompt: 'How would you describe yourself as an athlete?', type: 'textarea' },
      { key: 'motivation_triggers', prompt: 'What keeps you consistent when motivation dips?', type: 'textarea' },
      { key: 'success_definition', prompt: 'What makes training feel successful for you?', type: 'text' },
      {
        key: 'tough_session_response',
        prompt: 'How do you usually handle tough sessions?',
        type: 'select',
        options: ['Push through', 'Adjust pace/intensity', 'Need extra support', 'Depends on the day'],
      },
      { key: 'confidence_level', prompt: 'Confidence level right now', type: 'scale', min: 1, max: 5 },
      { key: 'mindset_challenges', prompt: 'Any mindset challenges you want help with?', type: 'textarea' },
    ],
  },
  {
    key: 'goal-context',
    title: 'Goal & Event Context',
    intro: 'Let’s clarify what we’re building toward.',
    questions: [
      { key: 'primary_goal', prompt: 'What’s your main goal or event?', type: 'text' },
      { key: 'goal_date', prompt: 'Event date (if known)', type: 'text' },
      { key: 'goal_reason', prompt: 'Why does this goal matter to you?', type: 'textarea' },
      { key: 'secondary_goals', prompt: 'Any secondary goals?', type: 'textarea' },
      {
        key: 'goal_experience_level',
        prompt: 'Your experience with similar events',
        type: 'select',
        options: ['First time', 'Some experience', 'Plenty of experience'],
      },
      {
        key: 'next_12_weeks_priority',
        prompt: 'Top priority for the next 8–12 weeks',
        type: 'select',
        options: ['Consistency', 'Fitness base', 'Speed/strength', 'Health & recovery'],
      },
    ],
  },
  {
    key: 'swim-profile',
    title: 'Swim Profile',
    intro: 'Help me understand your swimming background.',
    questions: [
      {
        key: 'swim_background',
        prompt: 'Swim background',
        type: 'select',
        options: ['New to swimming', 'Some experience', 'Strong swimmer'],
      },
      {
        key: 'swim_open_water_confidence',
        prompt: 'Open water confidence',
        type: 'scale',
        min: 1,
        max: 5,
      },
      {
        key: 'swim_weekly_sessions',
        prompt: 'Typical swim sessions per week',
        type: 'select',
        options: ['0–1', '2', '3+'],
      },
      { key: 'swim_limiters', prompt: 'Main limiter in swimming', type: 'textarea' },
      {
        key: 'swim_preference',
        prompt: 'Preferred swim session focus',
        type: 'select',
        options: ['Technique', 'Endurance', 'Speed', 'Variety'],
      },
      { key: 'swim_injury_notes', prompt: 'Any swim-related injuries or pain?', type: 'textarea' },
    ],
  },
  {
    key: 'bike-profile',
    title: 'Bike Profile',
    intro: 'Let’s capture your cycling strengths and needs.',
    questions: [
      {
        key: 'bike_background',
        prompt: 'Bike background',
        type: 'select',
        options: ['New to cycling', 'Some experience', 'Strong cyclist'],
      },
      {
        key: 'bike_weekly_sessions',
        prompt: 'Typical bike sessions per week',
        type: 'select',
        options: ['0–1', '2', '3+'],
      },
      { key: 'bike_limiters', prompt: 'Main limiter on the bike', type: 'textarea' },
      {
        key: 'bike_preference',
        prompt: 'Preferred bike session focus',
        type: 'select',
        options: ['Endurance', 'Tempo', 'Hills/strength', 'Cadence/skills'],
      },
      {
        key: 'bike_environment',
        prompt: 'Where do you ride most?',
        type: 'select',
        options: ['Outdoor', 'Indoor', 'Mix of both'],
      },
      { key: 'bike_injury_notes', prompt: 'Any bike-related injuries or pain?', type: 'textarea' },
    ],
  },
  {
    key: 'run-profile',
    title: 'Run Profile',
    intro: 'Running often drives fatigue — let’s get this right.',
    questions: [
      {
        key: 'run_background',
        prompt: 'Run background',
        type: 'select',
        options: ['New to running', 'Some experience', 'Strong runner'],
      },
      {
        key: 'run_weekly_sessions',
        prompt: 'Typical run sessions per week',
        type: 'select',
        options: ['1–2', '3–4', '5+'],
      },
      { key: 'run_limiters', prompt: 'Main limiter in running', type: 'textarea' },
      {
        key: 'run_preference',
        prompt: 'Preferred run session focus',
        type: 'select',
        options: ['Easy aerobic', 'Tempo', 'Intervals', 'Long run'],
      },
      {
        key: 'run_surface',
        prompt: 'Where do you run most?',
        type: 'select',
        options: ['Road', 'Trail', 'Treadmill', 'Mix'],
      },
      { key: 'run_injury_notes', prompt: 'Any run-related injuries or pain?', type: 'textarea' },
    ],
  },
  {
    key: 'life-constraints',
    title: 'Life & Constraints',
    intro: 'Let’s shape training around your real life.',
    questions: [
      {
        key: 'availability_days',
        prompt: 'Which days are usually available for training?',
        type: 'multi',
        options: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
      },
      {
        key: 'availability_minutes',
        prompt: 'Typical minutes available per week',
        type: 'number',
        min: 0,
        max: 1500,
      },
      { key: 'schedule_constraints', prompt: 'Work/life constraints I should know', type: 'textarea' },
      {
        key: 'sleep_quality',
        prompt: 'Sleep quality lately',
        type: 'select',
        options: ['Great', 'Okay', 'Inconsistent', 'Poor'],
      },
      {
        key: 'travel_variability',
        prompt: 'How variable is your weekly schedule?',
        type: 'select',
        options: ['Very stable', 'Some variation', 'Often unpredictable'],
      },
      { key: 'equipment_access', prompt: 'Equipment or facilities you have access to', type: 'textarea' },
      { key: 'injury_risk_notes', prompt: 'Any injuries, pain, or medical considerations?', type: 'textarea' },
    ],
  },
];

export function flattenIntakeQuestions(sections: IntakeSection[] = INTAKE_SECTIONS) {
  const map = new Map<string, IntakeQuestion>();
  sections.forEach((section) => {
    section.questions.forEach((q) => map.set(q.key, q));
  });
  return map;
}
