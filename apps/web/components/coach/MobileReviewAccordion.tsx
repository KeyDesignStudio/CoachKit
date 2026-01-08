'use client';

import { useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { ReviewChip } from './ReviewChip';

type CommentRecord = {
  id: string;
  body: string;
  createdAt: string;
  author: {
    id: string;
    name: string | null;
    role: 'COACH' | 'ATHLETE';
  };
};

type ReviewItem = {
  id: string;
  title: string;
  date: string;
  discipline: string;
  plannedStartTimeLocal: string | null;
  plannedDurationMinutes: number | null;
  plannedDistanceKm: number | null;
  notes: string | null;
  status: string;
  latestCompletedActivity: {
    id: string;
    durationMinutes: number | null;
    distanceKm: number | null;
    rpe: number | null;
    painFlag: boolean;
    startTime: string;
  } | null;
  athlete: {
    id: string;
    name: string | null;
  } | null;
  comments: CommentRecord[];
  hasAthleteComment: boolean;
  commentCount: number;
  coachAdvicePresent: boolean;
};

type MobileReviewAccordionProps = {
  athleteData: Array<{
    id: string;
    name: string;
    itemsByDate: Map<string, ReviewItem[]>;
  }>;
  weekDays: string[];
  onItemClick: (item: ReviewItem) => void;
  onQuickReview: (id: string) => void;
};

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function MobileReviewAccordion({
  athleteData,
  weekDays,
  onItemClick,
  onQuickReview,
}: MobileReviewAccordionProps) {
  const [expandedAthletes, setExpandedAthletes] = useState<Set<string>>(new Set());

  const toggleAthlete = (athleteId: string) => {
    setExpandedAthletes((prev) => {
      const next = new Set(prev);
      if (next.has(athleteId)) {
        next.delete(athleteId);
      } else {
        next.add(athleteId);
      }
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-2 rounded-3xl border border-white/20 bg-white/20 p-2 backdrop-blur-3xl">
      {athleteData.map((athlete) => {
        const isExpanded = expandedAthletes.has(athlete.id);
        const totalItems = Array.from(athlete.itemsByDate.values()).reduce(
          (sum, items) => sum + items.length,
          0
        );

        return (
          <div key={athlete.id} className="rounded-2xl border border-white/20 bg-white/30 overflow-hidden">
            <button
              type="button"
              onClick={() => toggleAthlete(athlete.id)}
              className="flex w-full items-center justify-between p-4 text-left hover:bg-white/40 transition-colors"
            >
              <div>
                <p className="font-medium text-[var(--text)]">{athlete.name}</p>
                <p className="text-xs text-[var(--muted)]">{totalItems} session(s) to review</p>
              </div>
              <Icon name={isExpanded ? "next" : "next"} size="sm" className={isExpanded ? "rotate-90" : ""} />
            </button>

            {isExpanded && (
              <div className="border-t border-white/20 bg-white/20 p-2">
                <div className="flex gap-1 overflow-x-auto pb-2">
                  {weekDays.map((date, index) => {
                    const dayItems = athlete.itemsByDate.get(date) || [];
                    return (
                      <div key={date} className="flex-shrink-0" style={{ width: '140px' }}>
                        <div className="mb-2 text-center text-xs font-semibold uppercase text-[var(--muted)]">
                          {DAY_NAMES[index]}
                        </div>
                        <div className="min-h-[60px] rounded-xl border border-white/30 bg-white/40 p-2">
                          {dayItems.map((item) => (
                            <ReviewChip
                              key={item.id}
                              time={item.plannedStartTimeLocal}
                              title={item.title}
                              discipline={item.discipline}
                              hasAthleteComment={item.hasAthleteComment}
                              coachAdvicePresent={item.coachAdvicePresent}
                              painFlag={item.latestCompletedActivity?.painFlag ?? false}
                              onClick={() => onItemClick(item)}
                              onQuickReview={
                                !item.hasAthleteComment ? () => onQuickReview(item.id) : undefined
                              }
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
