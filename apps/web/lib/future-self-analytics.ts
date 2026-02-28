export type FutureSelfEventName =
  | 'future_self_run_projection'
  | 'future_self_adjust_scenario'
  | 'future_self_toggle_visibility'
  | 'future_self_share_card'
  | 'future_self_view'
  | 'future_self_change_horizon'
  | 'future_self_open_assumptions';

export async function emitFutureSelfEventClient(eventName: FutureSelfEventName, payload: Record<string, unknown> = {}) {
  try {
    await fetch('/api/analytics/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ eventName, payload }),
      credentials: 'same-origin',
      keepalive: true,
    });
  } catch {
    // Do not block UX for telemetry.
  }
}

export function emitFutureSelfEventServer(params: {
  eventName: FutureSelfEventName;
  actorId: string;
  actorRole: string;
  payload?: Record<string, unknown>;
}) {
  console.info('[future-self analytics]', {
    eventName: params.eventName,
    actorId: params.actorId,
    actorRole: params.actorRole,
    payload: params.payload ?? {},
    at: new Date().toISOString(),
  });
}
