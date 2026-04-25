"""
Flask API Server – Flood-Aware Navigation System
=================================================
Endpoints:
  GET  /                    → serve frontend
  GET  /api/status          → system health
  GET  /api/weather         → live weather + flood risk for lat/lon
  POST /api/load-city       → download & score city road graph
  GET  /api/road-network    → GeoJSON of scored road network
  POST /api/route           → compute flood-aware + normal route
  GET  /api/cities          → list of preset cities
"""

import logging
import threading
import time
from flask import Flask, jsonify, request, send_from_directory, abort
from flask_cors import CORS

from data_fetcher import fetch_weather_data
from flood_model import FloodRiskModel
from route_engine import (
    load_city_graph, graph_to_geojson, find_safe_route, find_nearby_shelters
)

# ── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger(__name__)

# ── App setup ────────────────────────────────────────────────────────────────
app = Flask(__name__, static_folder="static", template_folder="templates")
CORS(app)

# ── Global state ─────────────────────────────────────────────────────────────
_state = {
    "graph":          None,   # nx.MultiDiGraph
    "city":           None,
    "model":          None,   # FloodRiskModel instance (kept for future use)
    "rainfall_score": 0.0,
    "weather":        {},
    "loading":        False,
    "load_error":     None,
    "load_pct":       0,
}
_lock = threading.Lock()

# Pre-set cities with known-good coordinates
PRESET_CITIES = [
    {"name": "Surat, India",     "lat": 21.1702, "lon": 72.8311, "zoom": 13},
    {"name": "Mumbai, India",    "lat": 19.0760, "lon": 72.8777, "zoom": 12},
    {"name": "Chennai, India",   "lat": 13.0827, "lon": 80.2707, "zoom": 12},
    {"name": "Kolkata, India",   "lat": 22.5726, "lon": 88.3639, "zoom": 13},
    {"name": "Hyderabad, India", "lat": 17.3850, "lon": 78.4867, "zoom": 12},
    {"name": "Bengaluru, India", "lat": 12.9716, "lon": 77.5946, "zoom": 12},
    {"name": "Delhi, India",     "lat": 28.6139, "lon": 77.2090, "zoom": 12},
    {"name": "Ahmedabad, India", "lat": 23.0225, "lon": 72.5714, "zoom": 13},
    {"name": "Pune, India",      "lat": 18.5204, "lon": 73.8567, "zoom": 13},
]


# ── Model bootstrap ──────────────────────────────────────────────────────────
def _init_model():
    with _lock:
        if _state["model"] is None:
            logger.info("Initializing flood risk model …")
            _state["model"] = FloodRiskModel()
            logger.info(f"Model ready (accuracy={_state['model'].accuracy:.3f})")


threading.Thread(target=_init_model, daemon=True).start()


# ── Background city loader ────────────────────────────────────────────────────
def _load_city_task(city_name: str, lat: float, lon: float):
    with _lock:
        _state["loading"] = True
        _state["load_error"] = None
        _state["load_pct"] = 5

    try:
        # 1. Fetch weather
        logger.info(f"Fetching weather for {city_name} ({lat},{lon}) …")
        weather = fetch_weather_data(lat, lon)
        rainfall_score = weather.get("current", {}).get("flood_risk_score", 0.0)
        with _lock:
            _state["weather"] = weather
            _state["rainfall_score"] = rainfall_score
            _state["load_pct"] = 20

        # 2. Ensure model ready
        _init_model()
        with _lock:
            _state["load_pct"] = 35

        # 3. Load graph (pass lat/lon for fast point-radius download)
        logger.info(f"Loading road graph for '{city_name}' ({lat},{lon}) …")
        G = load_city_graph(city_name, lat=lat, lon=lon)
        with _lock:
            _state["load_pct"] = 85

        # 4. Store graph — GeoJSON & scoring done on-demand per request using
        #    fast_score_edge(), so no slow ML loop needed here.
        with _lock:
            _state["graph"]   = G
            _state["city"]    = city_name
            _state["loading"] = False
            _state["load_pct"] = 100
        logger.info(f"City loaded: {G.number_of_nodes()} nodes, {G.number_of_edges()} edges")

    except Exception as e:
        logger.error(f"City load error: {e}", exc_info=True)
        with _lock:
            _state["loading"] = False
            _state["load_error"] = str(e)
            _state["load_pct"] = 0


# ── Routes ────────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return send_from_directory("templates", "index.html")


@app.route("/static/<path:path>")
def static_files(path):
    return send_from_directory("static", path)


@app.route("/game/")
@app.route("/game/<path:path>")
def game_files(path="index.html"):
    return send_from_directory("game", path)


@app.route("/api/status")
def api_status():
    with _lock:
        return jsonify({
            "status": "ok",
            "model_ready": _state["model"] is not None,
            "graph_loaded": _state["graph"] is not None,
            "city": _state["city"],
            "loading": _state["loading"],
            "load_pct": _state["load_pct"],
            "load_error": _state["load_error"],
            "rainfall_score": _state["rainfall_score"],
            "risk_level": _state["weather"].get("current", {}).get("risk_level", "N/A"),
        })


@app.route("/api/cities")
def api_cities():
    return jsonify({"cities": PRESET_CITIES})


@app.route("/api/weather")
def api_weather():
    lat = request.args.get("lat", type=float)
    lon = request.args.get("lon", type=float)
    if lat is None or lon is None:
        return jsonify({"error": "lat and lon required"}), 400
    data = fetch_weather_data(lat, lon)
    return jsonify(data)


@app.route("/api/load-city", methods=["POST"])
def api_load_city():
    body = request.get_json(silent=True) or {}
    lat  = body.get("lat")
    lon  = body.get("lon")
    city = body.get("city")

    if not city and lat is not None and lon is not None:
        city = f"Location ({lat:.2f}, {lon:.2f})"
    
    if not city:
        city = "Surat, India"
    if lat is None: lat = 21.1702
    if lon is None: lon = 72.8311

    with _lock:
        if _state["loading"]:
            return jsonify({"message": "Already loading", "loading": True}), 202

    t = threading.Thread(target=_load_city_task, args=(city, lat, lon), daemon=True)
    t.start()
    return jsonify({"message": f"Loading '{city}' …", "loading": True}), 202


@app.route("/api/road-network")
def api_road_network():
    with _lock:
        G = _state["graph"]
        loading = _state["loading"]
        err = _state["load_error"]
        rainfall_score = _state["rainfall_score"]

    if loading:
        return jsonify({"loading": True}), 202
    if err:
        return jsonify({"error": err}), 500
    if G is None:
        return jsonify({"error": "No city loaded yet"}), 404
        
    geojson = graph_to_geojson(G, rainfall_score=rainfall_score)
    return jsonify(geojson)


@app.route("/api/route", methods=["POST"])
def api_route():
    body = request.get_json(silent=True) or {}
    try:
        orig_lat = float(body["origin_lat"])
        orig_lon = float(body["origin_lon"])
        dest_lat = float(body["dest_lat"])
        dest_lon = float(body["dest_lon"])
    except (KeyError, TypeError, ValueError):
        return jsonify({"error": "origin_lat, origin_lon, dest_lat, dest_lon required"}), 400

    with _lock:
        G = _state["graph"]
        rainfall_score = _state["rainfall_score"]

    if G is None:
        return jsonify({"error": "No city graph loaded. Call /api/load-city first."}), 409

    try:
        result = find_safe_route(G, orig_lat, orig_lon, dest_lat, dest_lon, rainfall_score=rainfall_score)
        return jsonify(result)
    except Exception as e:
        logger.error(f"Route endpoint error: {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/disaster-assessment")
def api_disaster_assessment():
    """
    Computes real-time disaster impact estimates:
      - Fatalities / injuries / displaced persons
      - Property damage (residential, commercial, infrastructure)
      - Roads affected
      - Recovery timeline & cost
    """
    with _lock:
        G          = _state["graph"]
        rainfall   = _state["rainfall_score"]
        weather    = _state["weather"]
        city_name  = _state["city"] or "Unknown"
        loading    = _state["loading"]

    if loading:
        return jsonify({"loading": True}), 202
    if G is None:
        return jsonify({"error": "No city loaded yet"}), 404

    # ── City reference data (population density / km², avg asset value ₹/km²) ──
    CITY_DB = {
        "Surat":     {"pop_density": 17_000, "asset_cr_km2": 450},
        "Mumbai":    {"pop_density": 20_500, "asset_cr_km2": 2_000},
        "Chennai":   {"pop_density":  8_000, "asset_cr_km2": 600},
        "Kolkata":   {"pop_density": 24_000, "asset_cr_km2": 400},
        "Hyderabad": {"pop_density": 18_000, "asset_cr_km2": 550},
        "Bengaluru": {"pop_density":  4_400, "asset_cr_km2": 800},
        "Delhi":     {"pop_density": 11_300, "asset_cr_km2": 1_000},
        "Ahmedabad": {"pop_density": 12_000, "asset_cr_km2": 350},
        "Pune":      {"pop_density":  5_000, "asset_cr_km2": 500},
    }
    city_key  = next((k for k in CITY_DB if k in city_name), None)
    cref      = CITY_DB.get(city_key, {"pop_density": 10_000, "asset_cr_km2": 500})

    # ── Graph-derived metrics ──
    total_edges     = max(G.number_of_edges(), 1)
    hi_risk_edges   = sum(1 for _u, _v, d in G.edges(data=True) if d.get("risk_class", 0) >= 3)
    crit_edges      = sum(1 for _u, _v, d in G.edges(data=True) if d.get("risk_class", 0) == 4)
    hi_risk_frac    = hi_risk_edges / total_edges

    # 2 km radius city area ≈ 12.57 km²
    total_area_km2  = 3.14159 * 4          # πr²
    affected_km2    = total_area_km2 * hi_risk_frac * max(rainfall, 0.05)

    # ── Intensity buckets ──
    ri = rainfall   # 0-1
    if   ri >= 0.75: threat, t_color = "CATASTROPHIC", "#FF0000"
    elif ri >= 0.50: threat, t_color = "SEVERE",       "#FF4500"
    elif ri >= 0.25: threat, t_color = "MODERATE",     "#FFD600"
    elif ri >= 0.10: threat, t_color = "LOW",           "#76FF03"
    else:            threat, t_color = "MINIMAL",       "#00E5FF"

    # ── Fatality model ──
    # UN-HABITAT urban flood lethality: 0.01-0.2% depending on intensity
    base_cfr = {
        "CATASTROPHIC": 0.002, "SEVERE": 0.0008,
        "MODERATE": 0.0003, "LOW": 0.0001, "MINIMAL": 0.00001
    }[threat]
    pop_exposed       = cref["pop_density"] * affected_km2
    est_deaths        = max(0, round(pop_exposed * base_cfr))
    est_injured       = max(0, round(est_deaths * 6))       # ~6× injury-to-death ratio
    est_displaced     = max(0, round(pop_exposed * ri * 0.18))
    total_affected    = round(pop_exposed)

    # ── Property damage model (₹ Crore) ──
    # NDMA formula: damage = asset_density × affected_area × flood_depth_factor
    depth_factor = ri ** 1.4            # super-linear with intensity
    res_damage   = round(cref["asset_cr_km2"] * affected_km2 * 0.60 * depth_factor, 2)
    com_damage   = round(cref["asset_cr_km2"] * affected_km2 * 0.25 * depth_factor * 0.8, 2)
    infra_damage = round(cref["asset_cr_km2"] * affected_km2 * 0.15 * depth_factor, 2)
    total_damage = round(res_damage + com_damage + infra_damage, 2)
    recovery_cost = round(total_damage * 0.35, 2)   # 35% of damage = recovery spend

    # ── Infrastructure ──
    roads_affected_km = round(hi_risk_edges * 0.12, 1)   # avg segment ~120 m
    bridges_at_risk   = max(0, round(crit_edges * 0.05))

    # ── Recovery timeline ──
    base_days = {"CATASTROPHIC": 90, "SEVERE": 45, "MODERATE": 20, "LOW": 7, "MINIMAL": 2}[threat]
    recovery_days = base_days + round(hi_risk_frac * 30)

    cur = weather.get("current", {})

    return jsonify({
        "success": True,
        "city":         city_name,
        "threat_level": threat,
        "threat_color": t_color,
        "flood_intensity": round(ri, 3),
        "fatalities": {
            "estimated_deaths":    est_deaths,
            "estimated_injured":   est_injured,
            "estimated_displaced": est_displaced,
            "total_affected":      total_affected,
        },
        "property_damage": {
            "residential_cr": res_damage,
            "commercial_cr":  com_damage,
            "infrastructure_cr": infra_damage,
            "total_cr":       total_damage,
            "recovery_cost_cr": recovery_cost,
        },
        "infrastructure": {
            "roads_affected_km":   roads_affected_km,
            "high_risk_roads":     hi_risk_edges,
            "critical_roads":      crit_edges,
            "total_roads":         total_edges,
            "high_risk_pct":       round(hi_risk_frac * 100, 1),
            "bridges_at_risk":     bridges_at_risk,
        },
        "area": {
            "total_km2":    round(total_area_km2, 2),
            "affected_km2": round(affected_km2, 2),
            "affected_pct": round(hi_risk_frac * ri * 100, 1),
        },
        "weather_snapshot": {
            "precipitation_mm":    cur.get("precipitation_mm", 0),
            "precipitation_6h_mm": cur.get("precipitation_6h_mm", 0),
            "wind_speed":          cur.get("wind_speed", 0),
            "humidity":            cur.get("humidity", 0),
            "risk_level":          cur.get("risk_level", "N/A"),
        },
        "recovery": {
            "estimated_days": recovery_days,
            "recovery_cost_cr": recovery_cost,
        }
    })


@app.route("/api/flood-zones")
def api_flood_zones():
    """Return heatmap points [lat, lon, intensity] for high-risk road segments."""
    with _lock:
        G = _state["graph"]
        loading = _state["loading"]

    if loading:
        return jsonify({"loading": True}), 202
    if G is None:
        return jsonify({"error": "No city loaded yet"}), 404

    points = []
    for u, v, data in G.edges(data=True):
        rc = data.get("risk_class", 0)
        if rc < 2:
            continue  # only moderate, high, critical
        u_node = G.nodes[u]
        v_node = G.nodes[v]
        mid_lat = (u_node["y"] + v_node["y"]) / 2
        mid_lon = (u_node["x"] + v_node["x"]) / 2
        # Map risk_class (2-4) → intensity (0.35–1.0)
        intensity = {2: 0.35, 3: 0.65, 4: 1.0}.get(rc, 0.35)
        points.append([mid_lat, mid_lon, intensity])

    return jsonify({"points": points})


@app.route("/api/shelters")
def api_shelters():
    lat = request.args.get("lat", type=float)
    lon = request.args.get("lon", type=float)
    if lat is None or lon is None:
        return jsonify({"error": "lat and lon required"}), 400
    
    shelters = find_nearby_shelters(lat, lon)
    return jsonify({"shelters": shelters})


@app.route("/api/disaster-news")
def api_disaster_news():
    """
    Proxies filtered disaster news from NewsAPI.
    """
    import requests
    try:
        api_key = "a727f4eeb63f430b8010e0e22b015249"
        # Stricter query for natural disasters, excluding common false positives
        query = (
            '(disaster OR flood OR earthquake OR hurricane OR "natural disaster" OR wildfire OR cyclone OR tsunami) '
            'AND (emergency OR relief OR evacuation OR "death toll" OR destruction OR "state of emergency") '
            'NOT (financial OR economic OR movie OR film OR "box office")'
        )
        url = f"https://newsapi.org/v2/everything?q={requests.utils.quote(query)}&sortBy=publishedAt&pageSize=20&language=en&apiKey={api_key}"
        
        res = requests.get(url, timeout=10)
        res.raise_for_status()
        data = res.json()
        
        # Additional backend filtering for safety
        disaster_keywords = ['flood', 'disaster', 'quake', 'storm', 'cyclone', 'tsunami', 'evacuation', 'emergency', 'wildfire', 'casualty', 'death']
        filtered_articles = []
        for art in data.get("articles", []):
            text = (art.get("title", "") + " " + art.get("description", "")).lower()
            if any(k in text for k in disaster_keywords):
                filtered_articles.append(art)
        
        return jsonify({"articles": filtered_articles[:15]})
    except Exception as e:
        logger.error(f"NewsAPI fetch error: {e}")
        return jsonify({"success": False, "error": str(e)}), 502


# ── Gemini AI Assistant ──────────────────────────────────────────────────────
GEMINI_API_KEY = "AIzaSyCJ_b_lHHQ3n8ODvN42YfoHxr5GOwhzIDU"
GEMINI_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "gemini-2.0-flash:generateContent?key=" + GEMINI_API_KEY
)


def _gemini_ask(system_prompt: str, user_query: str) -> str:
    """Call Google Gemini API and return the text response."""
    payload = {
        "contents": [
            {
                "role": "user",
                "parts": [
                    {"text": f"{system_prompt}\n\nUser question: {user_query}"}
                ]
            }
        ],
        "generationConfig": {
            "temperature": 0.7,
            "maxOutputTokens": 1024,
            "topP": 0.95,
            "topK": 40
        }
    }
    try:
        r = requests.post(GEMINI_URL, json=payload, timeout=20)
        r.raise_for_status()
        data = r.json()
        candidates = data.get("candidates", [])
        if not candidates:
            return "I'm sorry, I couldn't generate a response right now."
        parts = candidates[0].get("content", {}).get("parts", [])
        return " ".join(p.get("text", "") for p in parts).strip()
    except Exception as e:
        logger.error(f"Gemini API error: {e}")
        return "I'm having trouble connecting to my knowledge base. Please try again shortly."


@app.route("/api/ask-ai", methods=["POST"])
def api_ask_ai():
    """
    AI-powered assistant endpoint.
    Accepts: { "query": str, "context": {...} }
    Returns: { "success": bool, "answer": str }
    """
    body = request.get_json(silent=True) or {}
    user_query = body.get("query", "").strip()
    if not user_query:
        return jsonify({"success": False, "error": "Query is required"}), 400

    with _lock:
        city = _state["city"] or "Unknown"
        rainfall = _state["rainfall_score"]
        weather = _state["weather"]
        risk_level = weather.get("current", {}).get("risk_level", "N/A")
        precip = weather.get("current", {}).get("precipitation_mm", 0)
        wind = weather.get("current", {}).get("wind_speed", 0)
        humidity = weather.get("current", {}).get("humidity", 0)
        temp = weather.get("current", {}).get("temperature", 0)
        graph_loaded = _state["graph"] is not None
        loading = _state["loading"]

    system_prompt = f"""You are FloodNav AI, an intelligent emergency assistant for a flood-aware navigation web application.
Your job is to help users stay safe during floods by answering questions using the LIVE data below.

CURRENT SITE CONTEXT:
- Loaded city: {city}
- Flood risk level: {risk_level}
- Rainfall score (0-1): {rainfall:.3f}
- Current precipitation: {precip} mm/hr
- Wind speed: {wind} km/h
- Humidity: {humidity}%
- Temperature: {temp}°C
- Map loaded: {"Yes" if graph_loaded else "No"}
- System loading: {"Yes" if loading else "No"}

INSTRUCTIONS:
- Be concise, helpful, and safety-focused.
- If the user asks about flood risk, routes, shelters, or weather, use the live context above.
- If the user asks general knowledge questions (e.g., "What causes floods?", "How to prepare an emergency kit?", "What is the NDMA?"), answer expertly.
- If the user asks something unrelated, politely steer back to flood safety and navigation.
- Keep responses under 150 words when possible.
- Use a calm, authoritative tone suitable for emergency situations.
"""

    answer = _gemini_ask(system_prompt, user_query)
    return jsonify({"success": True, "answer": answer})


# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False, threaded=True)
