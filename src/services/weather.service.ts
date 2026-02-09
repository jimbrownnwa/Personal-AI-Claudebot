/**
 * OpenWeather API integration
 * Provides weather forecasts and current conditions
 */

import axios from 'axios';
import { logger } from '../utils/logger.js';

const OPENWEATHER_BASE_URL = 'https://api.openweathermap.org/data/2.5';

interface WeatherData {
  current: {
    temp: number;
    feelsLike: number;
    humidity: number;
    description: string;
    icon: string;
  };
  forecast?: {
    high: number;
    low: number;
    description: string;
  };
}

/**
 * Get current weather and forecast for a zip code
 */
export async function getWeatherByZip(zipCode: string, countryCode: string = 'US'): Promise<WeatherData> {
  const OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY;

  if (!OPENWEATHER_API_KEY) {
    throw new Error('OpenWeather API key not configured');
  }

  try {
    // Get current weather
    const currentResponse = await axios.get(`${OPENWEATHER_BASE_URL}/weather`, {
      params: {
        zip: `${zipCode},${countryCode}`,
        appid: OPENWEATHER_API_KEY,
        units: 'imperial', // Fahrenheit
      },
    });

    const current = currentResponse.data;

    // Get forecast
    const forecastResponse = await axios.get(`${OPENWEATHER_BASE_URL}/forecast`, {
      params: {
        zip: `${zipCode},${countryCode}`,
        appid: OPENWEATHER_API_KEY,
        units: 'imperial',
      },
    });

    const forecast = forecastResponse.data;

    // Get today's high and low from forecast
    const today = new Date().toISOString().split('T')[0];
    const todayForecasts = forecast.list.filter((item: any) =>
      item.dt_txt.startsWith(today)
    );

    const temps = todayForecasts.map((item: any) => item.main.temp);
    const high = Math.max(...temps);
    const low = Math.min(...temps);

    return {
      current: {
        temp: Math.round(current.main.temp),
        feelsLike: Math.round(current.main.feels_like),
        humidity: current.main.humidity,
        description: current.weather[0].description,
        icon: current.weather[0].icon,
      },
      forecast: {
        high: Math.round(high),
        low: Math.round(low),
        description: todayForecasts[0]?.weather[0]?.description || current.weather[0].description,
      },
    };
  } catch (error) {
    logger.error('Failed to fetch weather', error as Error);
    throw new Error('Unable to fetch weather data');
  }
}

/**
 * Format weather data for display
 */
export function formatWeather(weather: WeatherData, location: string): string {
  const emoji = getWeatherEmoji(weather.current.icon);

  return `${emoji} **Weather for ${location}**

Current: ${weather.current.temp}°F (feels like ${weather.current.feelsLike}°F)
Condition: ${capitalizeFirst(weather.current.description)}
Humidity: ${weather.current.humidity}%

Today's Forecast:
High: ${weather.forecast?.high}°F | Low: ${weather.forecast?.low}°F
${capitalizeFirst(weather.forecast?.description || '')}`;
}

/**
 * Get appropriate emoji for weather icon code
 */
function getWeatherEmoji(iconCode: string): string {
  const emojiMap: Record<string, string> = {
    '01d': '☀️', // clear sky day
    '01n': '🌙', // clear sky night
    '02d': '⛅', // few clouds day
    '02n': '☁️', // few clouds night
    '03d': '☁️', // scattered clouds
    '03n': '☁️',
    '04d': '☁️', // broken clouds
    '04n': '☁️',
    '09d': '🌧️', // shower rain
    '09n': '🌧️',
    '10d': '🌦️', // rain day
    '10n': '🌧️', // rain night
    '11d': '⛈️', // thunderstorm
    '11n': '⛈️',
    '13d': '❄️', // snow
    '13n': '❄️',
    '50d': '🌫️', // mist
    '50n': '🌫️',
  };

  return emojiMap[iconCode] || '🌤️';
}

/**
 * Capitalize first letter of string
 */
function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
