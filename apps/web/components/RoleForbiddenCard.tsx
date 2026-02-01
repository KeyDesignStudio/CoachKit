import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

export function RoleForbiddenCard(props: {
  title?: string;
  message?: string;
  details?: string;
  primaryHref?: string;
  primaryLabel?: string;
}) {
  const {
    title = 'Access denied',
    message = 'You do not have permission to view this page.',
    details,
    primaryHref = '/',
    primaryLabel = 'Return Home',
  } = props;

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Card className="max-w-md rounded-3xl p-8 text-center">
        <h1 className="mb-4 text-2xl font-semibold">{title}</h1>
        <p className="mb-6 text-[var(--muted)]">{message}</p>
        {details ? <p className="mb-6 text-sm text-[var(--muted)]">{details}</p> : null}
        <div className="flex flex-col gap-3">
          <a href={primaryHref} className="w-full">
            <Button className="w-full">{primaryLabel}</Button>
          </a>
          <a href="/sign-out" className="text-sm text-[var(--muted)] hover:underline">
            Sign Out
          </a>
        </div>
      </Card>
    </div>
  );
}
