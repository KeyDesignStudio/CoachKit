'use client';

import { useEffect, useMemo, useState } from 'react';

import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { cn } from '@/lib/cn';
import { TIMEZONE_OPTIONS } from '@/lib/timezones';

type TimezoneSelectProps = {
  value: string;
  onChange: (tz: string) => void;
  disabled?: boolean;
  className?: string;
};

export function TimezoneSelect({ value, onChange, disabled, className }: TimezoneSelectProps) {
  const [query, setQuery] = useState('');

  useEffect(() => {
    setQuery('');
  }, [value]);

  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return TIMEZONE_OPTIONS;
    return TIMEZONE_OPTIONS.filter((tz) => tz.value.toLowerCase().includes(q) || tz.label.toLowerCase().includes(q));
  }, [query]);

  const hasCurrent = options.some((o) => o.value === value);
  const selectOptions = hasCurrent ? options : [{ value, label: value }, ...options];

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search timezones (e.g. Brisbane, New York)"
        disabled={disabled}
        aria-label="Search timezones"
      />
      <Select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} aria-label="Select timezone">
        {selectOptions.map((tz) => (
          <option key={tz.value} value={tz.value}>
            {tz.label}
          </option>
        ))}
      </Select>
    </div>
  );
}
