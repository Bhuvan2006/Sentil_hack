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
    "graph_geojson":  None,
    "model":          None,   # FloodRiskModel instance
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
            _state["load_pct"] = 65

        # 4. Score graph
        logger.info("Scoring road segments …")
        _state["model"].score_graph(G, rainfall_score)
        with _lock:
            _state["load_pct"] = 85

        # 5. Build GeoJSON
        geojson = graph_to_geojson(G, max_edges=6000)
        with _lock:
            _state["graph"] = G
            _state["city"] = city_name
            _state["graph_geojson"] = geojson
            _state["loading"] = False
            _state["load_pct"] = 100
        logger.info("City loaded and scored successfully.")

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
        geojson = _state["graph_geojson"]
        loading = _state["loading"]
        err = _state["load_error"]

    if loading:
        return jsonify({"loading": True}), 202
    if err:
        return jsonify({"error": err}), 500
    if geojson is None:
        return jsonify({"error": "No city loaded yet"}), 404
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

    if G is None:
        return jsonify({"error": "No city graph loaded. Call /api/load-city first."}), 409

    result = find_safe_route(G, orig_lat, orig_lon, dest_lat, dest_lon)
    return jsonify(result)


@app.route("/api/shelters")
def api_shelters():
    lat = request.args.get("lat", type=float)
    lon = request.args.get("lon", type=float)
    if lat is None or lon is None:
        return jsonify({"error": "lat and lon required"}), 400
    
    shelters = find_nearby_shelters(lat, lon)
    return jsonify({"shelters": shelters})


# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False, threaded=True)
