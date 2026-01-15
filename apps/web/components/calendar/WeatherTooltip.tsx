'use client';

import { ReactElement, cloneElement, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { WeatherSummary } from '@/lib/weather-model';
import { cn } from '@/lib/cn';
import { Icon } from '@/components/ui/Icon';
import { WEATHER_ICON_NAME } from '@/components/calendar/weatherIconName';

type WeatherTooltipProps = {
  weather?: WeatherSummary;
  children: ReactElement;
  sideOffsetPx?: number;
};

function isWeatherComplete(weather: WeatherSummary | undefined): weather is WeatherSummary {
  if (!weather) return false;
  if (!weather.icon) return false;
  if (!Number.isFinite(weather.maxTempC)) return false;
  if (!weather.sunriseLocal || !weather.sunsetLocal) return false;
  return true;
}

export function WeatherTooltip({ weather, children, sideOffsetPx = 10 }: WeatherTooltipProps) {
  const tooltipId = useId();
  const triggerRef = useRef<HTMLElement | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const canRender = useMemo(() => enabled && isWeatherComplete(weather), [enabled, weather]);

  useEffect(() => {
    // Disable tooltips on mobile / coarse pointers. Also effectively disables for touch-only devices.
    const media = window.matchMedia('(hover: hover) and (pointer: fine)');
    const update = () => setEnabled(media.matches);
    update();

    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', update);
      return () => media.removeEventListener('change', update);
    }

    // Safari fallback
    // eslint-disable-next-line deprecation/deprecation
    media.addListener(update);
    // eslint-disable-next-line deprecation/deprecation
    return () => media.removeListener(update);
  }, []);

  const computePosition = () => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();

    // Centered above trigger.
    const x = rect.left + rect.width / 2;
    const y = rect.top - sideOffsetPx;
    setPos({ x, y });
  };

  const show = () => {
    if (!canRender) return;
    computePosition();
    setOpen(true);
  };

  const hide = () => {
    setOpen(false);
  };

  if (!canRender) {
    return children;
  }

  const child = children as ReactElement<any>;
  const originalRef = (child as any).ref;

  const merged = {
    ...child.props,
    ref: (node: any) => {
      triggerRef.current = node as HTMLElement;
      if (typeof originalRef === 'function') originalRef(node);
      else if (originalRef && typeof originalRef === 'object') originalRef.current = node;
    },
    onMouseEnter: (e: any) => {
      child.props.onMouseEnter?.(e);
      show();
    },
    onMouseLeave: (e: any) => {
      child.props.onMouseLeave?.(e);
      hide();
    },
    onFocusCapture: (e: any) => {
      child.props.onFocusCapture?.(e);
      show();
    },
    onBlurCapture: (e: any) => {
      child.props.onBlurCapture?.(e);
      hide();
    },
    'aria-describedby': open ? tooltipId : child.props['aria-describedby'],
  };

  const tooltip =
    open && pos
      ? createPortal(
          <div
            id={tooltipId}
            role="tooltip"
            // pointer-events none ensures we never block clicks into workout pills.
            className={cn(
              'pointer-events-none fixed z-[60] -translate-x-1/2 -translate-y-full',
              'px-3 py-2 rounded-md border border-[var(--border-subtle)]',
              'bg-[var(--bg-card)] text-[var(--text)] shadow-lg'
            )}
            style={{ left: pos.x, top: pos.y }}
          >
            <div className="flex items-center gap-2">
              <Icon name={WEATHER_ICON_NAME[weather!.icon]} size="sm" className="text-[16px]" aria-hidden />
              <div className="flex flex-col">
                <div className="text-xs font-medium">Max: {Math.round(weather!.maxTempC)}°C</div>
                <div className="text-[11px] text-[var(--muted)]">
                  Sunrise {weather!.sunriseLocal} · Sunset {weather!.sunsetLocal}
                </div>
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <>
      {tooltip}
      {cloneElement(child, merged)}
    </>
  );
}
