import { Card } from '@/components/ui/Card';
import { cn } from '@/lib/cn';

function Line({ className }: { className?: string }) {
  return <div className={cn('h-4 rounded bg-[var(--bg-card)] animate-pulse', className)} aria-hidden="true" />;
}

function Pill({ className }: { className?: string }) {
  return <div className={cn('h-6 rounded-full bg-[var(--bg-card)] animate-pulse', className)} aria-hidden="true" />;
}

export function SkeletonAthleteWorkoutDetail({ className }: { className?: string }) {
  return (
    <div className={cn('grid grid-cols-1 lg:grid-cols-12 gap-4', className)} aria-hidden="true">
      <div className="lg:col-span-5 space-y-4">
        <Card className="rounded-3xl">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="h-6 w-6 rounded-full bg-[var(--bg-card)] animate-pulse" />
              <Line className="h-6 w-[60%]" />
              <Pill className="w-20" />
            </div>
            <Line className="w-[45%]" />
            <div className="flex gap-2">
              <Pill className="w-28" />
              <Pill className="w-24" />
              <Pill className="w-20" />
            </div>
          </div>
        </Card>

        <Card className="rounded-3xl">
          <div className="space-y-3">
            <Line className="w-[35%]" />
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Line className="w-[70%]" />
                <Line className="w-[55%]" />
              </div>
              <div className="space-y-2">
                <Line className="w-[65%]" />
                <Line className="w-[50%]" />
              </div>
            </div>
          </div>
        </Card>
      </div>

      <div className="lg:col-span-7 space-y-4">
        <Card className="rounded-3xl">
          <div className="space-y-3">
            <Line className="w-[40%]" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Line className="w-[75%]" />
                <Line className="w-[60%]" />
                <Line className="w-[68%]" />
              </div>
              <div className="space-y-2">
                <Line className="w-[72%]" />
                <Line className="w-[58%]" />
                <Line className="w-[64%]" />
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <Pill className="w-28" />
              <Pill className="w-28" />
              <Pill className="w-24" />
            </div>
          </div>
        </Card>

        <Card className="rounded-3xl">
          <div className="space-y-3">
            <Line className="w-[30%]" />
            <Line className="h-20 w-full" />
            <Line className="h-10 w-full" />
          </div>
        </Card>
      </div>
    </div>
  );
}
