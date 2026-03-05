import { NextRequest } from 'next/server';

type ApiEnvelope<T> = {
  data: T | null;
  error: {
    code: string;
    message: string;
  } | null;
};

export function createServerRouteRequest(path: string) {
  return new NextRequest(new URL(path, 'https://coachkit.local'));
}

export async function readServerRouteData<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as ApiEnvelope<T>;
  if (!response.ok || payload.error || payload.data == null) {
    throw new Error(payload.error?.message || `Route bootstrap failed with status ${response.status}`);
  }

  return payload.data;
}
