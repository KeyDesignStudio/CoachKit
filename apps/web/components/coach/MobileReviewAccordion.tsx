'use client';

import { useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { ReviewChip } from './ReviewChip';
import { formatDisplay } from '@/lib/client-date';
import { cn } from '@/lib/cn';

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
  workoutDetail: string | null;
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
};

type MobileReviewAccordionProps = {
  athleteData: Array<{
    id: string;
    name: string;
    itemsByDate: Map<string, ReviewItem[]>;
  }>;
  weekDays: string[];
  todayKey: string | null;
  onItemClick: (item: ReviewItem) => void;
  onQuickReview: (id: string) => void;
};

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function getFormattedHeaderDate(dateKey: string): string {
  const formatted = formatDisplay(dateKey);
  return formatted.split(',')[1]?.trim() || formatted;
}

const todayTintClass =
  'relative before:absolute before:inset-0 before:bg-blue-500/5 before:pointer-events-none';

export function MobileReviewAccordion({
  athleteData,
  weekDays,
  todayKey,
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
    <div className="flex flex-col gap-2 rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2">
      {athleteData.map((athlete) => {
        const isExpanded = expandedAthletes.has(athlete.id);
        const totalItems = Array.from(athlete.itemsByDate.values()).reduce(
          (sum, items) => sum + items.length,
          0
        );

        return (
          <div key={athlete.id} className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-structure)] overflow-hidden">
            <button
              type="button"
              onClick={() => toggleAthlete(athlete.id)}
              className="flex w-full items-center justify-between p-4 text-left hover:bg-[var(--bg-surface)] transition-colors"
            >
              <div>
                <p className="font-medium text-[var(--text)]">{athlete.name}</p>
                <p className="text-xs text-[var(--muted)]">{totalItems} workout(s) to review</p>
              </div>
              <Icon name={isExpanded ? "next" : "next"} size="sm" className={isExpanded ? "rotate-90" : ""} />
            </button>

            {isExpanded && (
              <div className="border-t border-[var(--border-subtle)] bg-[var(--bg-structure)] p-2">
                <div className="flex gap-1 overflow-x-auto pb-2">
                  {weekDays.map((date, index) => {
                    const dayItems = athlete.itemsByDate.get(date) || [];
                    const isToday = !!todayKey && todayKey === date;
                    return (
                      <div key={date} className="flex-shrink-0" style={{ width: '140px' }}>
                        <div className={cn('mb-2 bg-[var(--bg-surface)] px-3 py-2 rounded border border-[var(--border-subtle)]', isToday ? todayTintClass : '')}>
                          <div className="relative z-10 flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-xs uppercase tracking-wide text-[var(--muted)]">{DAY_NAMES[index]}</p>
                              <p className="text-sm font-medium truncate">{getFormattedHeaderDate(date)}</p>
                            </div>
                            {isToday ? (
                              <span className="bg-blue-500/10 text-blue-700 text-[10px] px-2 py-0.5 rounded border border-[var(--today-border)]">
                                Today
                              </span>
                            ) : null}
                          </div>
                        </div>

                        <div
                          className={cn(
                            'min-h-[60px] rounded border border-[var(--border-subtle)] bg-[var(--bg-card)] p-2 overflow-hidden',
                            isToday ? todayTintClass : ''
                          )}
                        >
                          {dayItems.map((item) => (
                            <ReviewChip
                              key={item.id}
                              time={item.plannedStartTimeLocal}
                              title={item.title}
                              discipline={item.discipline}
                              hasAthleteComment={item.hasAthleteComment}
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
