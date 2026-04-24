"""
Data Fetcher Module
Fetches live rain/weather data from Open-Meteo API (free, no API key needed)
and provides utilities for rainfall intensity classification.
"""

import requests
import logging
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

# Open-Meteo free weather API endpoint
OPENMETEO_URL = "https://api.open-meteo.com/v1/forecast"

# WMO precipitation code descriptions
PRECIPITATION_CODES = {
    0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
    45: "Foggy", 48: "Icy fog", 51: "Light drizzle", 53: "Moderate drizzle",
    55: "Dense drizzle", 61: "Slight rain", 63: "Moderate rain",
    65: "Heavy rain", 71: "Slight snow", 73: "Moderate snow", 75: "Heavy snow",
    80: "Slight showers", 81: "Moderate showers", 82: "Violent showers",
    95: "Thunderstorm", 96: "Thunderstorm with hail", 99: "Heavy thunderstorm with hail"
}


def fetch_weather_data(lat: float, lon: float) -> dict:
    """
    Fetch current and hourly weather + precipitation data for a location.
    Returns structured weather data including rainfall risk levels.
    """
    params = {
        "latitude": lat,
        "longitude": lon,
        "current": [
            "temperature_2m",
            "precipitation",
            "weathercode",
            "windspeed_10m",
            "relative_humidity_2m"
        ],
        "hourly": [
            "precipitation",
            "precipitation_probability",
            "weathercode"
        ],
        "forecast_days": 1,
        "timezone": "auto"
    }

    try:
        response = requests.get(OPENMETEO_URL, params=params, timeout=10)
        response.raise_for_status()
        raw = response.json()

        current = raw.get("current", {})
        hourly = raw.get("hourly", {})

        # Current precipitation in mm
        current_precip = float(current.get("precipitation", 0.0))
        weather_code = int(current.get("weathercode", 0))

        # Past 6-hour accumulated precipitation estimate
        hourly_precip = hourly.get("precipitation", [])
        precip_6h = sum(hourly_precip[:6]) if len(hourly_precip) >= 6 else sum(hourly_precip)

        # Calculate flood risk score 0-1 based on precipitation
        flood_risk = _calculate_rain_risk(current_precip, precip_6h, weather_code)

        return {
            "success": True,
            "location": {"lat": lat, "lon": lon},
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "current": {
                "temperature": current.get("temperature_2m", 0),
                "precipitation_mm": current_precip,
                "precipitation_6h_mm": round(precip_6h, 2),
                "humidity": current.get("relative_humidity_2m", 0),
                "wind_speed": current.get("windspeed_10m", 0),
                "weather_code": weather_code,
                "weather_description": PRECIPITATION_CODES.get(weather_code, "Unknown"),
                "flood_risk_score": flood_risk,
                "risk_level": _risk_label(flood_risk)
            },
            "hourly_precip_forecast": hourly_precip[:12]   # next 12 hours
        }

    except requests.RequestException as e:
        logger.error(f"Weather API error: {e}")
        return {
            "success": False,
            "error": str(e),
            "current": {
                "precipitation_mm": 0, "flood_risk_score": 0.0,
                "risk_level": "Unknown", "weather_description": "Data unavailable"
            }
        }


def _calculate_rain_risk(current_mm: float, precip_6h: float, wmo_code: int) -> float:
    """
    Compute a 0-1 flood risk score from rain intensity metrics.
    Uses IMD (Indian Meteorological Dept) thresholds adapted for urban flooding.
    """
    score = 0.0

    # Current precipitation intensity contribution (0-0.5)
    if current_mm >= 64.5:       # Extremely heavy rain (IMD: >64.5 mm/hr)
        score += 0.50
    elif current_mm >= 35.5:     # Very heavy rain
        score += 0.40
    elif current_mm >= 15.6:     # Heavy rain
        score += 0.30
    elif current_mm >= 7.6:      # Moderate to heavy
        score += 0.20
    elif current_mm >= 2.5:      # Moderate
        score += 0.10
    elif current_mm > 0:         # Light rain
        score += 0.05

    # 6-hour accumulated precipitation contribution (0-0.35)
    if precip_6h >= 100:
        score += 0.35
    elif precip_6h >= 60:
        score += 0.28
    elif precip_6h >= 30:
        score += 0.20
    elif precip_6h >= 15:
        score += 0.12
    elif precip_6h >= 6:
        score += 0.06

    # WMO code adjustment (0-0.15)
    if wmo_code in (82, 95, 96, 99):   # Violent showers / thunderstorms
        score += 0.15
    elif wmo_code in (65, 81):          # Heavy rain / moderate showers
        score += 0.08
    elif wmo_code in (63, 80):          # Moderate rain / showers
        score += 0.04

    return round(min(score, 1.0), 3)


def _risk_label(score: float) -> str:
    if score >= 0.75: return "CRITICAL"
    if score >= 0.50: return "HIGH"
    if score >= 0.25: return "MODERATE"
    if score >= 0.10: return "LOW"
    return "SAFE"


def get_risk_color(score: float) -> str:
    """Return hex color for risk visualization."""
    if score >= 0.75: return "#FF1744"
    if score >= 0.50: return "#FF6D00"
    if score >= 0.25: return "#FFD600"
    if score >= 0.10: return "#76FF03"
    return "#00E5FF"
