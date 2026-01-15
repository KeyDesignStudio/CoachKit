import { WeatherIcon } from '@/lib/weather-model';
import { Icon } from '@/components/ui/Icon';

export const WEATHER_ICON_NAME: Record<WeatherIcon, Parameters<typeof Icon>[0]['name']> = {
  sunny: 'weatherSunny',
  partly_cloudy: 'weatherPartlyCloudy',
  cloudy: 'weatherCloudy',
  rain: 'weatherRain',
  storm: 'weatherStorm',
  fog: 'weatherFog',
  snow: 'weatherSnow',
  wind: 'weatherWind',
};
