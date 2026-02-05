export type IntakeQuestionType = 'text' | 'textarea' | 'select' | 'multi' | 'scale' | 'number' | 'date';

export type IntakeQuestionVisibility = {
  questionKey: string;
  equals?: string | number | boolean;
  anyOf?: Array<string | number | boolean>;
  includes?: string;
  includesAny?: string[];
};

export type IntakeQuestion = {
  key: string;
  prompt: string;
  helper?: string;
  type: IntakeQuestionType;
  options?: string[];
  min?: number;
  max?: number;
  visibleWhen?: IntakeQuestionVisibility;
};

export type IntakeSection = {
  key: string;
  title: string;
  intro?: string;
  questions: IntakeQuestion[];
};

export const INTAKE_SECTIONS: IntakeSection[] = [
  {
    key: 'profile-basics',
    title: 'Profile Basics',
    intro: 'A few details to personalize your coaching.',
    questions: [
      { key: 'first_name', prompt: 'First name', type: 'text' },
      { key: 'last_name', prompt: 'Last name', type: 'text' },
      { key: 'date_of_birth', prompt: 'Date of birth', type: 'date' },
      {
        key: 'gender',
        prompt: 'Gender',
        type: 'select',
        options: ['Female', 'Male', 'Non-binary', 'Prefer not to say', 'Other'],
      },
      { key: 'mobile_phone', prompt: 'Mobile phone', type: 'text' },
      { key: 'training_suburb', prompt: 'Suburb you usually do your training in?', type: 'text' },
    ],
  },
  {
    key: 'goals',
    title: 'Goals & Timeline',
    intro: 'A quick snapshot of what you want to accomplish next.',
    questions: [
      {
        key: 'goal_type',
        prompt: 'What best describes your main goal?',
        type: 'select',
        options: ['Race or event', 'Improve fitness', 'Return from a break', 'General health', 'Other'],
      },
      {
        key: 'goal_timeline',
        prompt: 'When do you want to feel ready?',
        type: 'select',
        options: ['No date in mind', 'In 6–8 weeks', 'In 2–3 months', 'In 3–6 months', 'In 6–12 months'],
      },
      {
        key: 'goal_focus',
        prompt: 'What matters most right now?',
        type: 'select',
        options: ['Consistency', 'Base fitness', 'Performance', 'Return to training', 'Health & recovery'],
      },
      { key: 'event_name', prompt: 'Event name (if applicable)', type: 'text' },
      { key: 'event_date', prompt: 'Event date (if applicable)', type: 'date' },
      { key: 'secondary_goals', prompt: 'Secondary goals (comma-separated)', type: 'text' },
      { key: 'goal_details', prompt: 'Optional: add any details about your goal', type: 'text' },
    ],
  },
  {
    key: 'training-profile',
    title: 'Training Profile',
    intro: 'A quick snapshot of your current training background.',
    questions: [
      {
        key: 'experience_level',
        prompt: 'Experience level',
        type: 'select',
        options: ['New to structured training', 'Some experience', 'Experienced'],
      },
      {
        key: 'disciplines',
        prompt: 'Which disciplines are you training for right now?',
        type: 'multi',
        options: ['RUN', 'BIKE', 'SWIM', 'STRENGTH', 'OTHER'],
      },
      {
        key: 'weekly_hours_per_day',
        prompt: 'On a typical training day, how many hours can you train?',
        type: 'select',
        options: ['0.5', '1', '1.5', '2', '2.5+'],
      },
      {
        key: 'weekly_days_per_week',
        prompt: 'How many days per week can you usually train?',
        type: 'select',
        options: ['2', '3', '4', '5', '6', '7'],
      },
      {
        key: 'recent_consistency',
        prompt: 'How consistent has training been lately?',
        type: 'select',
        options: ['Just starting', 'Some weeks consistent', 'Mostly consistent'],
      },
      {
        key: 'swim_confidence',
        prompt: 'Swim confidence (1–5, 1 lowest, 5 highest)',
        type: 'scale',
        min: 1,
        max: 5,
        visibleWhen: { questionKey: 'disciplines', includes: 'SWIM' },
      },
      {
        key: 'bike_confidence',
        prompt: 'Bike confidence (1–5, 1 lowest, 5 highest)',
        type: 'scale',
        min: 1,
        max: 5,
        visibleWhen: { questionKey: 'disciplines', includes: 'BIKE' },
      },
      {
        key: 'run_confidence',
        prompt: 'Run confidence (1–5, 1 lowest, 5 highest)',
        type: 'scale',
        min: 1,
        max: 5,
        visibleWhen: { questionKey: 'disciplines', includes: 'RUN' },
      },
    ],
  },
  {
    key: 'constraints',
    title: 'Constraints & Safety',
    intro: 'This helps keep the plan realistic and safe.',
    questions: [
      {
        key: 'availability_days',
        prompt: 'Which days are usually available for training?',
        type: 'multi',
        options: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
      },
      {
        key: 'schedule_variability',
        prompt: 'How predictable is your weekly schedule?',
        type: 'select',
        options: ['Very stable', 'Some variation', 'Often unpredictable'],
      },
      {
        key: 'sleep_quality',
        prompt: 'Sleep quality lately',
        type: 'select',
        options: ['Great', 'Okay', 'Inconsistent', 'Poor'],
      },
      {
        key: 'injury_status',
        prompt: 'Any injuries or medical considerations?',
        type: 'select',
        options: ['No injuries', 'Managing minor pain', 'Recovering from injury', 'Medical considerations'],
      },
      { key: 'equipment_access', prompt: 'Equipment access (trainer, gym, pool, etc.)', type: 'text' },
      { key: 'travel_constraints', prompt: 'Travel or work constraints?', type: 'text' },
      { key: 'constraints_notes', prompt: 'Optional: anything else we should plan around?', type: 'text' },
    ],
  },
  {
    key: 'coaching-preferences',
    title: 'Coaching Preferences',
    intro: 'How you want feedback and support.',
    questions: [
      {
        key: 'feedback_style',
        prompt: 'What feedback style helps you most?',
        type: 'select',
        options: ['Direct and concise', 'Encouraging and supportive', 'Balanced and pragmatic'],
      },
      {
        key: 'tone_preference',
        prompt: 'Preferred coaching tone',
        type: 'select',
        options: ['Direct', 'Warm', 'Balanced'],
      },
      {
        key: 'checkin_preference',
        prompt: 'Check-in cadence',
        type: 'select',
        options: ['Weekly', 'Every two weeks', 'Only when needed', 'As needed'],
      },
      {
        key: 'structure_preference',
        prompt: 'How much structure do you want in training weeks? (1 very flexible, 5 highly structured)',
        type: 'scale',
        min: 1,
        max: 5,
      },
      {
        key: 'motivation_style',
        prompt: 'What keeps you motivated?',
        type: 'select',
        options: ['Progress updates', 'Clear accountability', 'Variety', 'Performance targets', 'Community'],
      },
      { key: 'coaching_notes', prompt: 'Optional: anything you want your coach to know', type: 'text' },
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
