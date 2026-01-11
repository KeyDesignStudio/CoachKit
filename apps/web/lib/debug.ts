export function isStravaTimeDebugEnabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.NEXT_PUBLIC_DEBUG_STRAVA_TIME === "true"
  );
}
