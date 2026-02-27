import { cn } from '@/lib/cn';

type LinkifiedTextProps = {
  text: string;
  className?: string;
  linkClassName?: string;
};

const URL_PATTERN = /https?:\/\/[^\s]+/g;
const TRAILING_PUNCTUATION = /[),.;!?]$/;

function splitUrlAndTrailingPunctuation(rawUrl: string): { url: string; trailing: string } {
  let url = rawUrl;
  let trailing = '';

  while (url.length > 0 && TRAILING_PUNCTUATION.test(url)) {
    trailing = `${url.slice(-1)}${trailing}`;
    url = url.slice(0, -1);
  }

  return { url, trailing };
}

export function LinkifiedText({ text, className, linkClassName }: LinkifiedTextProps) {
  const content = text ?? '';
  const parts: Array<{ type: 'text' | 'link'; value: string; href?: string }> = [];
  let cursor = 0;

  for (const match of content.matchAll(URL_PATTERN)) {
    const start = match.index ?? -1;
    if (start < 0) continue;
    if (start > cursor) {
      parts.push({ type: 'text', value: content.slice(cursor, start) });
    }

    const raw = match[0] ?? '';
    const { url, trailing } = splitUrlAndTrailingPunctuation(raw);
    if (url) {
      parts.push({ type: 'link', value: url, href: url });
    }
    if (trailing) {
      parts.push({ type: 'text', value: trailing });
    }
    cursor = start + raw.length;
  }

  if (cursor < content.length) {
    parts.push({ type: 'text', value: content.slice(cursor) });
  }

  return (
    <div className={className}>
      {parts.length === 0
        ? content
        : parts.map((part, idx) =>
            part.type === 'link' ? (
              <a
                key={`link-${idx}-${part.value}`}
                href={part.href}
                target="_blank"
                rel="noreferrer noopener"
                className={cn('underline decoration-[var(--muted)] underline-offset-2 break-all hover:text-[var(--primary)]', linkClassName)}
              >
                {part.value}
              </a>
            ) : (
              <span key={`text-${idx}`}>{part.value}</span>
            )
          )}
    </div>
  );
}
