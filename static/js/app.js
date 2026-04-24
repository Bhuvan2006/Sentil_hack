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
});

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

async function loadCity() {
  const sel = document.getElementById('city-select');
  const cityName = sel.value;
  if (!cityName) { showAlert('Please select a city first.'); return; }

  const cityObj = cities.find(c => c.name === cityName);
  if (!cityObj) return;

  // Show loading UI
  document.getElementById('load-progress').classList.remove('hidden');
  document.getElementById('map-overlay').classList.remove('hidden');
  updateProgress(5, 'Connecting to weather API…');

  try {
    const res = await fetch(`${API}/api/load-city`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ city: cityName, lat: cityObj.lat, lon: cityObj.lon })
    });
    if (!res.ok) throw new Error(await res.text());

    // Pan map to city
    map.setView([cityObj.lat, cityObj.lon], cityObj.zoom || 13);
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
  const maxPrecip = Math.max(...hourly, 1);

  const barItems = hourly.map((v, i) => {
    const h = Math.round((new Date().getHours() + i) % 24);
    const pct = Math.max(4, Math.round((v / maxPrecip) * 100));
    return `
      <div class="forecast-col">
        <div class="forecast-fill" style="height:${pct}%;background:linear-gradient(180deg,${riskColor},#0044ff66)"></div>
        <div class="forecast-label">${h}h</div>
      </div>`;
  }).join('');

  document.getElementById('weather-panel-content').innerHTML = `
    <div class="weather-full">
      <div class="weather-full-card">
        <h3 style="color:var(--accent);margin-bottom:10px">Current Conditions</h3>
        <p style="font-size:22px;margin-bottom:8px">${cur.weather_description}</p>
        <p>🌡 <strong>${cur.temperature}°C</strong></p>
        <p>💧 Rainfall: <strong>${cur.precipitation_mm} mm/hr</strong></p>
        <p>📊 6h Total: <strong>${cur.precipitation_6h_mm} mm</strong></p>
        <p>💨 Wind: <strong>${cur.wind_speed} km/h</strong></p>
        <p>🌊 Humidity: <strong>${cur.humidity}%</strong></p>
      </div>
      <div class="weather-full-card">
        <h3 style="color:var(--accent);margin-bottom:10px">Flood Risk Score</h3>
        <div style="font-size:48px;font-weight:700;color:${riskColor};margin:8px 0">
          ${(cur.flood_risk_score * 100).toFixed(0)}%
        </div>
        <div style="background:${riskColor}22;border:1px solid ${riskColor};color:${riskColor};
          padding:6px 12px;border-radius:100px;display:inline-block;font-weight:600">
          ${cur.risk_level}
        </div>
        <p style="margin-top:12px;font-size:12px;color:var(--text-secondary)">
          Score computed from current rainfall intensity, 6-hour accumulation, and WMO weather code using IMD flood thresholds.
        </p>
      </div>
      <div class="weather-full-card" style="grid-column:span 1">
        <h3 style="color:var(--accent);margin-bottom:10px">12-Hour Precipitation Forecast</h3>
        <div class="forecast-bar">${barItems}</div>
        <p style="font-size:11px;color:var(--text-muted);margin-top:8px">Hourly rainfall (mm) for the next 12 hours</p>
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
  ['map', 'weather', 'game'].forEach(p => {
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
