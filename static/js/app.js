/**
 * FloodNav – Frontend JavaScript
 * ================================
 * • Polls /api/status every 2s to sync server state
 * • Populates city dropdown from /api/cities
 * • Triggers city load via /api/load-city and polls progress
 * • Renders scored road network GeoJSON on Leaflet map
 * • Click-to-set origin/destination + calls /api/route
 * • Draws safe + normal paths with distinct styles
 * • Live weather panel rendering
 */

'use strict';

// ── Config ──────────────────────────────────────────────────────────────────
const API = '';       // same origin

// ── State ────────────────────────────────────────────────────────────────────
let map, roadLayer, safePathLayer, normalPathLayer;
let originMarker = null, destMarker = null;
let originLatLng = null, destLatLng = null;
let clickMode = 'origin';   // 'origin' | 'dest'
let currentCity = null;
let statusPollTimer = null;
let loadPollTimer = null;
let cities = [];
let darkTileLayer = null;
let lightTileLayer = null;
let userLatLng = null; // Store user's current location

// ── Leaflet map icons ─────────────────────────────────────────────────────
const ORIGIN_ICON = L.divIcon({
  className: '',
  html: `<div style="
    width:32px;height:32px;background:linear-gradient(135deg,#00bfff,#0044ff);
    border-radius:50% 50% 50% 0;transform:rotate(-45deg);
    border:2px solid white;box-shadow:0 0 12px #00bfff88;
  "></div>`,
  iconSize: [32, 32], iconAnchor: [16, 32]
});
const DEST_ICON = L.divIcon({
  className: '',
  html: `<div style="
    width:32px;height:32px;background:linear-gradient(135deg,#ff1744,#ff6d00);
    border-radius:50% 50% 50% 0;transform:rotate(-45deg);
    border:2px solid white;box-shadow:0 0 12px #ff174488;
  "></div>`,
  iconSize: [32, 32], iconAnchor: [16, 32]
});

// ────────────────────────────────────────────────────────────────────────────
// INIT
// ────────────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  loadCities();
  startStatusPoll();
  requestUserLocation(); // Get current location on startup
});

function requestUserLocation() {
  if (!navigator.geolocation) {
    console.log('Geolocation not supported');
    return;
  }

  showTooltip('Finding your location...');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      userLatLng = { lat: latitude, lng: longitude };
      originLatLng = userLatLng; // Automatically set user as origin
      
      // Center map and load city for this location
      map.setView([latitude, longitude], 14);
      loadCity(latitude, longitude);
      
      // Update origin label
      document.getElementById('origin-label').textContent = `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
      if (originMarker) map.removeLayer(originMarker);
      originMarker = L.marker([latitude, longitude], { icon: ORIGIN_ICON })
        .addTo(map)
        .bindPopup(`<b>Your Location</b>`);
      
      clickMode = 'dest';
      showTooltip('Location found. Click map to set destination or find shelter.');
    },
    (err) => {
      console.warn(`Geolocation error: ${err.message}`);
      showTooltip('Could not get location. Please select a city manually.');
    },
    { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
  );
}

function initMap() {
  map = L.map('map', {
    center: [21.1702, 72.8311],
    zoom: 13,
    zoomControl: true,
    attributionControl: true,
    zoomControl: false,
  });

  // Tile layers
  darkTileLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap © CartoDB',
    subdomains: 'abcd', maxZoom: 19,
  });
  lightTileLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap © CartoDB',
    subdomains: 'abcd', maxZoom: 19,
  });

  darkTileLayer.addTo(map);

  // Click handler
  map.on('click', onMapClick);
  showTooltip('Click anywhere to set your Origin point');
}

function switchMapTile() {
  const theme = document.documentElement.getAttribute('data-theme');
  if (theme === 'light') {
    if (map.hasLayer(darkTileLayer))  map.removeLayer(darkTileLayer);
    if (!map.hasLayer(lightTileLayer)) lightTileLayer.addTo(map);
  } else {
    if (map.hasLayer(lightTileLayer)) map.removeLayer(lightTileLayer);
    if (!map.hasLayer(darkTileLayer)) darkTileLayer.addTo(map);
  }
}

function onMapClick(e) {
  const { lat, lng } = e.latlng;

  if (clickMode === 'origin') {
    originLatLng = { lat, lng };
    if (originMarker) map.removeLayer(originMarker);
    originMarker = L.marker([lat, lng], { icon: ORIGIN_ICON })
      .addTo(map)
      .bindPopup(`<b>Origin</b><br>${lat.toFixed(5)}, ${lng.toFixed(5)}`);
    document.getElementById('origin-label').textContent = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    clickMode = 'dest';
    showTooltip('Now click to set your Destination');
  } else {
    destLatLng = { lat, lng };
    if (destMarker) map.removeLayer(destMarker);
    destMarker = L.marker([lat, lng], { icon: DEST_ICON })
      .addTo(map)
      .bindPopup(`<b>Destination</b><br>${lat.toFixed(5)}, ${lng.toFixed(5)}`);
    document.getElementById('dest-label').textContent = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    clickMode = 'origin';
    showTooltip('Click "Find Safe Route" or set a new Origin');
    document.getElementById('find-route-btn').disabled = false;
  }
}

// ── City loading ─────────────────────────────────────────────────────────────
async function loadCities() {
  try {
    const res = await fetch(`${API}/api/cities`);
    const data = await res.json();
    cities = data.cities || [];
    const sel = document.getElementById('city-select');
    cities.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.name; opt.textContent = c.name;
      sel.appendChild(opt);
    });
    // Auto-select first
    sel.value = cities[0]?.name || '';
  } catch (e) {
    console.error('Failed to load cities:', e);
  }
}

async function loadCity(lat, lon) {
  const sel = document.getElementById('city-select');
  let cityName = sel.value;
  
  // If lat/lon provided (from geolocation), use those instead of selection
  const useManualCoord = (lat !== undefined && lon !== undefined);
  
  if (!cityName && !useManualCoord) { showAlert('Please select a city first.'); return; }

  const cityObj = cities.find(c => c.name === cityName) || { lat, lon, zoom: 14 };
  if (!cityObj && !useManualCoord) return;
  
  const finalLat = useManualCoord ? lat : cityObj.lat;
  const finalLon = useManualCoord ? lon : cityObj.lon;
  const finalCity = useManualCoord ? null : cityName; // Backend handles null by using lat/lon label

  // Show loading UI
  document.getElementById('load-progress').classList.remove('hidden');
  document.getElementById('map-overlay').classList.remove('hidden');
  updateProgress(5, 'Connecting to weather API…');

  try {
    const res = await fetch(`${API}/api/load-city`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ city: finalCity, lat: finalLat, lon: finalLon })
    });
    if (!res.ok) throw new Error(await res.text());

    // Pan map
    map.setView([finalLat, finalLon], cityObj.zoom || 14);
    currentCity = cityObj;

    // Poll until done
    startLoadPoll();
  } catch (e) {
    showAlert(`Failed to start city load: ${e.message}`);
    hideLoadingUI();
  }
}

function startLoadPoll() {
  clearInterval(loadPollTimer);
  loadPollTimer = setInterval(async () => {
    try {
      const res = await fetch(`${API}/api/status`);
      const s = await res.json();
      updateProgress(s.load_pct, getLoadMessage(s.load_pct));

      if (!s.loading && s.graph_loaded) {
        clearInterval(loadPollTimer);
        onCityLoaded(s);
      } else if (!s.loading && s.load_error) {
        clearInterval(loadPollTimer);
        showAlert(`Load failed: ${s.load_error}`);
        hideLoadingUI();
      }
    } catch (e) {}
  }, 1200);
}

function getLoadMessage(pct) {
  if (pct < 20) return 'Fetching live rainfall data…';
  if (pct < 35) return 'Training flood risk model…';
  if (pct < 65) return 'Downloading road network from OSM…';
  if (pct < 85) return 'Scoring road segments for flood risk…';
  if (pct < 100) return 'Building map visualization…';
  return 'City loaded!';
}

async function findNearestShelter() {
  const loc = originLatLng || userLatLng;
  if (!loc) {
    showAlert('Need your origin location first.');
    return;
  }

  showTooltip('Searching for nearby shelters...');
  try {
    const res = await fetch(`${API}/api/shelters?lat=${loc.lat}&lon=${loc.lng}`);
    const data = await res.json();
    const shelters = data.shelters || [];

    if (shelters.length === 0) {
      showAlert('No safe shelters found within 1km. Please select a destination manually.');
      return;
    }

    // Pick the closest one
    const s = shelters[0];
    destLatLng = { lat: s.lat, lng: s.lon };
    
    if (destMarker) map.removeLayer(destMarker);
    destMarker = L.marker([s.lat, s.lon], { icon: DEST_ICON })
      .addTo(map)
      .bindPopup(`<b>Safe Shelter</b><br>${s.name}<br>${s.type.replace('_', ' ')}`);
    
    document.getElementById('dest-label').textContent = s.name;
    map.setView([s.lat, s.lon], 15);
    
    showTooltip(`Found shelter: ${s.name}. Click "Find Safe Route" to navigate.`);
    document.getElementById('find-route-btn').disabled = false;
  } catch (e) {
    showAlert(`Error searching shelters: ${e.message}`);
  }
}

async function onCityLoaded(status) {
  updateProgress(100, 'City loaded!');
  document.getElementById('chip-city').textContent = status.city?.split(',')[0] || 'City';
  updateRiskChip(status.rainfall_score, status.risk_level);

  // Fetch and render road network
  await renderRoadNetwork();

  // Update weather sidebar
  if (currentCity) {
    fetchAndRenderWeather(currentCity.lat, currentCity.lon);
  }

  setTimeout(hideLoadingUI, 800);
}

// ── Road network GeoJSON overlay ─────────────────────────────────────────────
async function renderRoadNetwork() {
  try {
    const res = await fetch(`${API}/api/road-network`);
    if (!res.ok) return;
    const geojson = await res.json();
    if (geojson.error) return;

    if (roadLayer) map.removeLayer(roadLayer);

    roadLayer = L.geoJSON(geojson, {
      style: feature => ({
        color: feature.properties.risk_color || '#00E5FF',
        weight: feature.properties.risk_class >= 3 ? 3.5 : 2,
        opacity: feature.properties.risk_class === 0 ? 0.45 :
                 feature.properties.risk_class === 4 ? 0.85 : 0.7,
        dashArray: feature.properties.risk_class === 4 ? '6, 4' : null,
      }),
      onEachFeature: (feature, layer) => {
        const p = feature.properties;
        layer.bindPopup(`
          <div style="min-width:140px">
            <b style="color:${p.risk_color}">${p.risk_label}</b><br>
            ${p.road_name || 'Unnamed road'}<br>
            <span style="color:#8aadcc">${p.highway || ''} · ${p.length_m}m</span>
          </div>
        `);
        layer.on('mouseover', function(e) {
          this.setStyle({ weight: 4, opacity: 1 });
        });
        layer.on('mouseout', function(e) {
          roadLayer.resetStyle(this);
        });
      }
    }).addTo(map);

  } catch (e) {
    console.error('Road network render error:', e);
  }
}

// ── Route finding ─────────────────────────────────────────────────────────────
async function findRoute() {
  if (!originLatLng || !destLatLng) {
    showAlert('Please set both origin and destination on the map.');
    return;
  }

  document.getElementById('find-route-btn').disabled = true;
  document.getElementById('find-route-btn').textContent = 'Computing…';

  // Clear old paths
  if (safePathLayer)   { map.removeLayer(safePathLayer);   safePathLayer = null; }
  if (normalPathLayer) { map.removeLayer(normalPathLayer); normalPathLayer = null; }

  try {
    const res = await fetch(`${API}/api/route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        origin_lat: originLatLng.lat, origin_lon: originLatLng.lng,
        dest_lat:   destLatLng.lat,   dest_lon:   destLatLng.lng,
      })
    });
    const data = await res.json();

    if (!data.success) {
      showAlert(data.error || 'Routing failed.');
      return;
    }

    // Draw normal path (grey dashed)
    if (data.normal_path?.coordinates) {
      normalPathLayer = L.polyline(data.normal_path.coordinates, {
        color: '#888888', weight: 4, opacity: 0.6, dashArray: '8, 6'
      }).addTo(map).bindPopup('<b>🛣 Normal Shortest Path</b>');
    }

    // Draw safe path (green animated)
    if (data.safe_path?.coordinates) {
      safePathLayer = L.polyline(data.safe_path.coordinates, {
        color: '#00ff88', weight: 5, opacity: 0.9
      }).addTo(map).bindPopup('<b>✅ Flood-Safe Route</b>');

      // Fit bounds to safe path
      map.fitBounds(safePathLayer.getBounds().pad(0.15));
    }

    renderRouteResult(data);

    // Check for risk alert
    const maxRisk = data.safe_path?.summary?.max_risk_class ?? 0;
    if (maxRisk >= 3) {
      showAlert(`⚠️ Safe route passes through ${maxRisk === 4 ? 'critically' : 'highly'} risky zones — proceed with extreme caution!`);
    }

  } catch (e) {
    showAlert(`Route request failed: ${e.message}`);
  } finally {
    document.getElementById('find-route-btn').disabled = false;
    document.getElementById('find-route-btn').textContent = 'Find Safe Route';
  }
}

function renderRouteResult(data) {
  const el = document.getElementById('route-result');
  const sp = data.safe_path?.summary;
  const np = data.normal_path?.summary;
  const spErr = data.safe_path?.error;

  if (!sp && !spErr) { el.classList.add('hidden'); return; }

  const riskColors = { 0:'#00E5FF', 1:'#76FF03', 2:'#FFD600', 3:'#FF6D00', 4:'#FF1744' };
  const riskNames  = { 0:'Safe', 1:'Low', 2:'Moderate', 3:'High', 4:'Critical' };

  let safeHTML = spErr
    ? `<div style="color:#ff1744;font-size:12px">${spErr}</div>`
    : `
      <div class="route-stat">📏 <strong>${sp.total_length_km} km</strong></div>
      <div class="route-stat">⏱ ~<strong>${sp.estimated_time_min} min</strong></div>
      <div class="route-stat">⚠️ Max: <strong style="color:${riskColors[sp.max_risk_class]}">${riskNames[sp.max_risk_class]}</strong></div>
    `;

  let normalHTML = np?.error
    ? `<div style="color:#888;font-size:12px">${np.error}</div>`
    : np ? `
      <div class="route-stat">📏 <strong>${np.total_length_km} km</strong></div>
      <div class="route-stat">⏱ ~<strong>${np.estimated_time_min} min</strong></div>
      <div class="route-stat">⚠️ Max: <strong style="color:${riskColors[np.max_risk_class]}">${riskNames[np.max_risk_class]}</strong></div>
    ` : '<div class="route-stat" style="color:#888">N/A</div>';

  el.innerHTML = `
    <div class="route-result-wrap">
      <div class="route-comparison">
        <div class="route-box safe-box">
          <div class="route-box-title">✅ Safe Route</div>
          ${safeHTML}
        </div>
        <div class="route-box normal-box">
          <div class="route-box-title">🛣 Normal</div>
          ${normalHTML}
        </div>
      </div>
    </div>
  `;
  el.classList.remove('hidden');
}

function clearRoute() {
  if (safePathLayer)   { map.removeLayer(safePathLayer);   safePathLayer = null; }
  if (normalPathLayer) { map.removeLayer(normalPathLayer); normalPathLayer = null; }
  if (originMarker)    { map.removeLayer(originMarker);    originMarker = null; }
  if (destMarker)      { map.removeLayer(destMarker);      destMarker = null; }
  originLatLng = destLatLng = null;
  clickMode = 'origin';
  document.getElementById('origin-label').textContent = 'Not set';
  document.getElementById('dest-label').textContent   = 'Not set';
  document.getElementById('find-route-btn').disabled = true;
  document.getElementById('route-result').classList.add('hidden');
  showTooltip('Click anywhere to set your Origin point');
}

// ── Weather ───────────────────────────────────────────────────────────────────
async function fetchAndRenderWeather(lat, lon) {
  try {
    const res = await fetch(`${API}/api/weather?lat=${lat}&lon=${lon}`);
    const data = await res.json();
    if (!data.success) return;

    const cur = data.current;
    const riskColor = getRiskColor(cur.flood_risk_score);

    // Sidebar mini weather
    document.getElementById('weather-content').innerHTML = `
      <div class="weather-desc">🌍 ${data.location.lat.toFixed(2)}°N, ${data.location.lon.toFixed(2)}°E</div>
      <div class="weather-desc">${cur.weather_description}</div>
      <div class="weather-grid">
        <div class="weather-item">
          <div class="weather-item-label">Rainfall</div>
          <div class="weather-item-value">${cur.precipitation_mm} mm</div>
        </div>
        <div class="weather-item">
          <div class="weather-item-label">6h Total</div>
          <div class="weather-item-value">${cur.precipitation_6h_mm} mm</div>
        </div>
        <div class="weather-item">
          <div class="weather-item-label">Temp</div>
          <div class="weather-item-value">${cur.temperature}°C</div>
        </div>
        <div class="weather-item">
          <div class="weather-item-label">Humidity</div>
          <div class="weather-item-value">${cur.humidity}%</div>
        </div>
      </div>
      <div class="risk-badge" style="background:${riskColor}22;border:1px solid ${riskColor};color:${riskColor}">
        ⚠ Risk: ${cur.risk_level} (${(cur.flood_risk_score * 100).toFixed(0)}%)
      </div>
    `;

    // Full weather panel
    renderWeatherPanel(data);
  } catch (e) { console.error('Weather render error:', e); }
}

function renderWeatherPanel(data) {
  const cur = data.current;
  const hourly = data.hourly_precip_forecast || [];
  const riskColor = getRiskColor(cur.flood_risk_score);
  const riskPct = Math.round(cur.flood_risk_score * 100);

  // 1. Decision Message Logic
  let decisionMsg = "Conditions are stable. Safe to travel.";
  let decisionIcon = "✅";
  if (riskPct >= 75) {
    decisionMsg = "High flood risk detected. Move to safe shelter immediately.";
    decisionIcon = "🚨";
  } else if (riskPct >= 40 || cur.precipitation_mm > 5) {
    decisionMsg = "Moderate rainfall. Avoid low-lying areas and known flood zones.";
    decisionIcon = "⚠️";
  } else if (cur.precipitation_mm > 1) {
    decisionMsg = "Light rain expected. Travel with caution.";
    decisionIcon = "🌦";
  }

  // 2. Trend Logic (Recent vs Forecast)
  const avgForecast = hourly.length ? hourly.slice(0, 3).reduce((a, b) => a + b, 0) / 3 : 0;
  let trendClass = "trend-stable";
  let trendText = "Stable conditions";
  let trendIcon = "→";
  if (avgForecast > cur.precipitation_mm + 1) {
    trendClass = "trend-up"; trendText = "Increasing rainfall"; trendIcon = "↑";
  } else if (avgForecast < cur.precipitation_mm - 1) {
    trendClass = "trend-down"; trendText = "Decreasing rainfall"; trendIcon = "↓";
  }

  // 3. Predictive Insights
  let predictiveInsight = "Low flood risk now, but monitoring conditions.";
  if (avgForecast > 5) {
    predictiveInsight = `Heavy rain (${avgForecast.toFixed(1)}mm/hr) expected in next 3 hours.`;
  } else if (riskPct > 50) {
    predictiveInsight = "Flood risk is high; conditions may worsen if rain continues.";
  }

  // 4. Smart Alerts
  const alerts = [];
  if (cur.precipitation_mm > 7) alerts.push("Heavy rainfall expected → evacuation routes may change");
  if (riskPct > 60) alerts.push("Low-lying areas may experience flooding soon");
  if (avgForecast > 4 && riskPct > 30) alerts.push("Avoid travel in the next 2–3 hours");

  // 5. Gauge SVG calculations
  const gaugeCircumference = 251.2; // 2 * PI * 40 (approx for radius 40)
  const gaugeOffset = gaugeCircumference - (cur.flood_risk_score * gaugeCircumference);

  // 6. Forecast Chart HTML
  const maxPrecip = Math.max(...hourly, 2);
  const barItems = hourly.map((v, i) => {
    const h = (new Date().getHours() + i) % 24;
    const hStr = h < 10 ? `0${h}:00` : `${h}:00`;
    const heightPct = Math.max(2, (v / maxPrecip) * 100);
    // Color intensity based on mm
    const barColor = v > 10 ? '#FF1744' : (v > 5 ? '#FFD600' : '#1a73e8');
    
    return `
      <div class="forecast-bar-item">
        <div class="bar-value-tooltip">${v.toFixed(1)}mm</div>
        <div class="bar-fill ${v > 0 ? 'water-anim' : ''}" style="height:${heightPct}%; background:${barColor}"></div>
        <div class="bar-label">${hStr}</div>
      </div>
    `;
  }).join('');

  const container = document.getElementById('weather-panel-content');
  container.innerHTML = `
    <div class="weather-full">
      <!-- Left: Unified Insight Card -->
      <div class="unified-flood-card">
        <div class="decision-summary">
          <div class="decision-icon">${decisionIcon}</div>
          <div class="decision-text">
            <h3>Current Advisory</h3>
            <p>${decisionMsg}</p>
          </div>
        </div>

        <div class="dashboard-section gauge-container">
          <svg class="gauge-svg" viewBox="0 0 100 60">
            <path class="gauge-bg" d="M10 50 A 40 40 0 0 1 90 50" />
            <path class="gauge-fill" d="M10 50 A 40 40 0 0 1 90 50" 
                  style="stroke-dashoffset: ${gaugeOffset}; stroke: ${riskColor}" />
          </svg>
          <div class="gauge-data">
            <span class="gauge-value">${riskPct}%</span>
            <span class="gauge-label" style="background:${riskColor}22; color:${riskColor}">
              ${cur.risk_level}
            </span>
          </div>
          <div class="trend-indicator ${trendClass}">
            ${trendIcon} ${trendText}
          </div>
        </div>

        <div class="dashboard-section insights-grid">
          <div class="insight-card">
            <div class="insight-header">
              <span class="insight-icon">🌡</span>
              <span class="insight-title">Temp & Humidity</span>
            </div>
            <div class="insight-value">${cur.temperature}°C · ${cur.humidity}%</div>
          </div>
          <div class="insight-card">
            <div class="insight-header">
              <span class="insight-icon">💨</span>
              <span class="insight-title">Wind Speed</span>
            </div>
            <div class="insight-value">${cur.wind_speed} km/h</div>
          </div>
          <div class="insight-card" style="grid-column: 1 / -1">
            <div class="insight-header">
              <span class="insight-icon">🔍</span>
              <span class="insight-title">Predictive Insight</span>
            </div>
            <div class="insight-value">${predictiveInsight}</div>
          </div>
        </div>
        
        ${alerts.length ? `
          <div class="dashboard-section">
            <div class="insight-title" style="margin-bottom:10px">Active Smart Alerts</div>
            ${alerts.map(a => `<div class="smart-alert">⚠️ ${a}</div>`).join('')}
          </div>
        ` : ''}

        <div class="dashboard-section" style="background:var(--surface-sunken)">
          <div class="insight-title">Localized Intelligence</div>
          <p style="font-size:13px; color:var(--text-secondary); margin:8px 0 0">
            Urban drainage systems in this area may overflow if rainfall exceeds 10mm/hr. 
            Nearby low-elevation segments are prioritized in routing.
          </p>
        </div>
      </div>

      <!-- Right: Forecast Detail -->
      <div class="unified-flood-card forecast-dashboard">
        <div class="dashboard-section">
          <div class="chart-header">
            <div class="chart-title">12-Hour Rainfall Forecast</div>
            <div class="chart-legend">
              <div class="legend-item"><span class="legend-color" style="background:#1a73e8"></span> Light</div>
              <div class="legend-item"><span class="legend-color" style="background:#FFD600"></span> Moderate</div>
              <div class="legend-item"><span class="legend-color" style="background:#FF1744"></span> Heavy</div>
            </div>
          </div>
          <div class="forecast-bars-container">
            ${barItems}
          </div>
        </div>
        
        <div class="dashboard-section">
          <div class="insight-title">Precipitation Analysis</div>
          <div class="weather-grid" style="margin-top:15px">
            <div class="weather-item">
              <div class="weather-item-label">Current Rate</div>
              <div class="weather-item-value">${cur.precipitation_mm} mm/hr</div>
            </div>
            <div class="weather-item">
              <div class="weather-item-label">6h Accumulation</div>
              <div class="weather-item-value">${cur.precipitation_6h_mm} mm</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ── Status polling ───────────────────────────────────────────────────────────
function startStatusPoll() {
  clearInterval(statusPollTimer);
  statusPollTimer = setInterval(pollStatus, 3000);
  pollStatus();
}

async function pollStatus() {
  try {
    const res = await fetch(`${API}/api/status`);
    const s = await res.json();
    renderStatus(s);
  } catch (e) {
    setStatusUI('error', 'Backend offline');
  }
}

function renderStatus(s) {
  if (!s.model_ready) {
    setStatusUI('loading', 'Loading model…');
  } else if (s.loading) {
    setStatusUI('loading', `Loading city… ${s.load_pct}%`);
  } else if (s.load_error) {
    setStatusUI('error', 'Load error');
  } else if (s.graph_loaded) {
    setStatusUI('ready', `${s.city?.split(',')[0] || 'Ready'} · ${s.risk_level}`);
  } else {
    setStatusUI('ready', 'Model ready');
  }
}

function setStatusUI(state, msg) {
  const dot  = document.getElementById('status-dot');
  const text = document.getElementById('status-text');
  dot.className = `status-dot ${state}`;
  text.textContent = msg;
}

// ── UI helpers ────────────────────────────────────────────────────────────────
function showPanel(name) {
  ['map', 'weather', 'simulation'].forEach(p => {
    const btn   = document.getElementById(`nav-${p}`);
    const panel = document.getElementById(`${p}-panel`);
    const isActive = p === name;
    btn?.classList.toggle('active', isActive);
    if (panel) panel.classList.toggle('hidden', !isActive);
  });
  // Hide sidebar & chips when switching away from map
  const sidebar = document.getElementById('sidebar');
  const chips   = document.querySelector('.map-chips');
  const tooltip = document.getElementById('map-tooltip');
  if (sidebar) sidebar.classList.toggle('hidden', name !== 'map');
  if (chips)   chips.classList.toggle('hidden', name !== 'map');
  if (tooltip) tooltip.classList.add('hidden');

  if (name === 'map') { setTimeout(() => map?.invalidateSize(), 50); }
}

function updateProgress(pct, msg) {
  document.getElementById('progress-fill').style.width = `${pct}%`;
  document.getElementById('progress-label').textContent = msg;
  document.getElementById('overlay-bar').style.width = `${pct}%`;
  document.getElementById('overlay-msg').textContent = msg;
}

function hideLoadingUI() {
  document.getElementById('load-progress').classList.add('hidden');
  document.getElementById('map-overlay').classList.add('hidden');
}

function updateRiskChip(score, level) {
  const chip = document.getElementById('chip-risk');
  chip.classList.remove('hidden');
  chip.style.borderColor = getRiskColor(score);
  chip.style.color = getRiskColor(score);
  chip.textContent = `Flood Risk: ${level}`;
}

function showTooltip(msg) {
  const el = document.getElementById('map-tooltip');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.add('hidden'), 5000);
}

function showAlert(msg) {
  document.getElementById('alert-text').textContent = msg;
  document.getElementById('alert-banner').classList.remove('hidden');
  clearTimeout(window._alertTimer);
  window._alertTimer = setTimeout(closeAlert, 8000);
}

function closeAlert() {
  document.getElementById('alert-banner').classList.add('hidden');
}

function getRiskColor(score) {
  if (score >= 0.75) return '#FF1744';
  if (score >= 0.50) return '#FF6D00';
  if (score >= 0.25) return '#FFD600';
  if (score >= 0.10) return '#76FF03';
  return '#00E5FF';
}

// ── Flood Evacuation Simulation ──────────────────────────────────────────────
let isFloodDetected = false;

// Simulated shelter data (can also be loaded from JSON)
const EMERGENCY_SHELTERS = [
  { name: "Primary Safety Center", lat: 12.8812, lon: 77.5432, elevation: 25, status: "open" },
  { name: "Community Hall Shelter", lat: 12.8820, lon: 77.5440, elevation: 20, status: "open" },
  { name: "Government School Shelter", lat: 12.8798, lon: 77.5425, elevation: 18, status: "open" },
  { name: "Relief Camp Center", lat: 12.8830, lon: 77.5418, elevation: 22, status: "open" },
  { name: "City High School", lat: 21.175, lon: 72.84, elevation: 15, status: "open" },
  { name: "Community Hall B", lat: 21.168, lon: 72.825, elevation: 12, status: "open" },
  { name: "St. Mary Hospital", lat: 21.18, lon: 72.835, elevation: 20, status: "open" },
  { name: "North Park Gym", lat: 21.19, lon: 72.85, elevation: 18, status: "closed" },
  { name: "South Side Plaza", lat: 21.16, lon: 72.82, elevation: 14, status: "open" }
];

/**
 * Distance between two points in km
 */
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Triggers the automatic evacuation protocol
 */
window.simulateFlood = function(detected) {
  isFloodDetected = detected;
  if (isFloodDetected) {
    showAlert("🚨 FLOOD EVENT DETECTED! Activating evacuation protocol...");
    initiateEvacuation();
  }
};

async function initiateEvacuation() {
  const loc = userLatLng || originLatLng;
  if (!loc) {
    showAlert("Waiting for your location to determine evacuation route...");
    // If we don't have location, try to get it again
    requestUserLocation();
    return;
  }

  showTooltip("Routing to nearest safe shelter within 1 km");
  
  // 1. Filter: Within 1km AND status is Open
  const candidates = EMERGENCY_SHELTERS.filter(s => {
    const dist = haversine(loc.lat, loc.lng, s.lat, s.lon);
    return dist <= 1.0 && s.status === "open";
  });

  // If no candidates within 1km, fall back to any open shelter sorted by proximity/safety
  const availableShelters = candidates.length > 0 
    ? candidates 
    : EMERGENCY_SHELTERS.filter(s => s.status === "open");

  if (availableShelters.length === 0) {
    showAlert("CRITICAL: No open evacuation shelters found in system!");
    return;
  }

  // 2. Select Best: prioritize shortest distance, but also higher elevation
  // We use a weighted score: Distance(km)*10 - Elevation(m)*0.5 (lower score is better)
  availableShelters.sort((a, b) => {
    const distA = haversine(loc.lat, loc.lng, a.lat, a.lon);
    const distB = haversine(loc.lat, loc.lng, b.lat, b.lon);
    
    const scoreA = (distA * 10) - (a.elevation * 0.5);
    const scoreB = (distB * 10) - (b.elevation * 0.5);
    
    return scoreA - scoreB;
  });

  const best = availableShelters[0];
  destLatLng = { lat: best.lat, lng: best.lon };

  // Update map UI
  if (destMarker) map.removeLayer(destMarker);
  destMarker = L.marker([best.lat, best.lon], { icon: DEST_ICON })
    .addTo(map)
    .bindPopup(`
      <div style="min-width:140px">
        <b style="color:var(--success)">SAFE SHELTER</b><br>
        <b>${best.name}</b><br>
        Elevation: ${best.elevation}m<br>
        Distance: ${haversine(loc.lat, loc.lng, best.lat, best.lon).toFixed(2)} km
      </div>
    `);

  document.getElementById('dest-label').textContent = best.name;
  
  // 3. Automatically trigger routing
  setTimeout(() => {
    findRoute();
    map.setView([best.lat, best.lon], 15);
  }, 500);
}
