export type WeatherIcon =
  | 'sunny'
  | 'partly_cloudy'
  | 'cloudy'
  | 'rain'
  | 'storm'
  | 'fog'
  | 'snow'
  | 'wind';

// Minimal payload for calendars and tooltips.
export type WeatherSummary = {
  icon: WeatherIcon;
  maxTempC: number;
  sunriseLocal: string; // HH:MM
  sunsetLocal: string; // HH:MM
};
