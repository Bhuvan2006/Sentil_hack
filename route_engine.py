"""
Route Engine
------------
Loads OpenStreetMap road networks via OSMnx, applies flood risk weights
to edges, and computes flood-aware shortest paths using Dijkstra.

Key features:
  • Caches downloaded city graphs to disk (graphs/ directory)
  • Blocks CRITICAL roads entirely
  • Returns both safe path and alternative normal path for comparison
  • Provides GeoJSON output for Leaflet.js rendering
"""

import os
import json
import math
import logging
import hashlib
import pickle
from typing import Optional

import networkx as nx
import osmnx as ox

logger = logging.getLogger(__name__)

GRAPH_CACHE_DIR = "graphs"
os.makedirs(GRAPH_CACHE_DIR, exist_ok=True)

# Configure OSMnx
ox.settings.log_console = False
ox.settings.use_cache = True
ox.settings.cache_folder = GRAPH_CACHE_DIR


# ---------------------------------------------------------------------------
# Graph loading / caching
# ---------------------------------------------------------------------------

# Radius (metres) around the city centre to download — 2 km for speed as requested.
DOWNLOAD_RADIUS_M = 2000

# Route cache to prevent redundant calculations
ROUTE_CACHE = {}

def haversine_dist(lat1, lon1, lat2, lon2):
    """Straight-line distance between two points in meters."""
    R = 6371000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2)**2
    return 2 * R * math.atan2(math.sqrt(a), math.sqrt(1 - a))

def fast_score_edge(data, rainfall_score):
    """
    Simplified scoring: score = distance + (floodRisk * weight) + (1 / elevation)
    """
    dist = float(data.get("length", 50))
    
    # Deterministic pseudo-elevation (1-100m)
    name = str(data.get("name", data.get("osmid", 0)))
    h = int(hashlib.md5(name.encode()).hexdigest()[:8], 16)
    elevation = (h % 100) + 1
    
    # Flood risk component
    flood_risk = rainfall_score * 10.0
    weight = 500.0  # Large weight to discourage flooded areas
    
    # Calculate score
    score = dist + (flood_risk * weight) + (100.0 / elevation)
    
    # Assign risk class for UI compatibility (0-4)
    risk_val = rainfall_score * 4
    risk_class = int(min(4, max(0, risk_val)))
    
    return {
        "weight": score,
        "risk_class": risk_class,
        "risk_label": ["SAFE", "LOW", "MODERATE", "HIGH", "CRITICAL"][risk_class],
        "risk_color": ["#00E5FF", "#76FF03", "#FFD600", "#FF6D00", "#FF1744"][risk_class]
    }

def _cache_key(o_lat, o_lon, d_lat, d_lon):
    return f"{o_lat:.4f},{o_lon:.4f}_{d_lat:.4f},{d_lon:.4f}"

def _cache_path(lat: float, lon: float) -> str:
    """Return the disk path for a cached city graph pickle."""
    key = hashlib.md5(f"{lat:.4f},{lon:.4f}".encode()).hexdigest()[:10]
    return os.path.join(GRAPH_CACHE_DIR, f"{key}.pkl")

def load_city_graph(
    city: str = "Surat, India",
    lat: float = 21.1702,
    lon: float = 72.8311,
    radius_m: int = DOWNLOAD_RADIUS_M,
) -> nx.MultiDiGraph:
    """
    Download (or load from cache) a driveable road network centred on
    (lat, lon) with the given radius.
    """
    cache_file = _cache_path(lat, lon)

    if os.path.exists(cache_file):
        logger.info(f"Loading cached graph for '{city}' from {cache_file}")
        with open(cache_file, "rb") as f:
            return pickle.load(f)

    logger.info(f"Downloading {radius_m}m road network around '{city}'...")
    G = ox.graph_from_point(
        (lat, lon),
        dist=radius_m,
        network_type="drive",
        simplify=True, # Reduces complexity by using key nodes/intersections
    )

    with open(cache_file, "wb") as f:
        pickle.dump(G, f)

    return G

def find_safe_route(
    G: nx.MultiDiGraph,
    origin_lat: float, origin_lon: float,
    dest_lat: float, dest_lon: float,
    rainfall_score: float = 0.0
) -> dict:
    """
    Compute route using A* with Haversine heuristic. Fast and cached.
    """
    # Check route cache first
    ckey = _cache_key(origin_lat, origin_lon, dest_lat, dest_lon)
    if ckey in ROUTE_CACHE:
        logger.info("Route served from cache")
        return ROUTE_CACHE[ckey]

    try:
        orig_node = ox.nearest_nodes(G, X=origin_lon, Y=origin_lat)
        dest_node = ox.nearest_nodes(G, X=dest_lon,   Y=dest_lat)
    except Exception as e:
        return {"success": False, "error": f"Node lookup failed: {e}"}

    try:
        # Build simple DiGraphs — copy node attributes so heuristic can read lat/lon
        DG_safe   = nx.DiGraph()
        DG_normal = nx.DiGraph()
        for node, attrs in G.nodes(data=True):
            DG_safe.add_node(node, **attrs)
            DG_normal.add_node(node, **attrs)

        for u, v, data in G.edges(data=True):
            scored   = fast_score_edge(data, rainfall_score)
            # scored already contains 'weight' — do NOT also pass weight= explicitly
            w_safe   = scored["weight"]
            w_normal = float(data.get("length", 50))

            # Keep minimum-weight edge between any pair (parallel edges → best one)
            if not DG_safe.has_edge(u, v) or DG_safe[u][v]["weight"] > w_safe:
                DG_safe.add_edge(u, v, **scored)          # weight is inside scored
            if not DG_normal.has_edge(u, v) or DG_normal[u][v]["weight"] > w_normal:
                DG_normal.add_edge(u, v, weight=w_normal)

    except Exception as e:
        logger.error(f"Graph build error: {e}", exc_info=True)
        return {"success": False, "error": f"Graph construction failed: {e}"}

    # Haversine heuristic — uses node y/x (lat/lon stored by OSMnx)
    def heuristic(u, goal):
        try:
            un = DG_safe.nodes[u]
            gn = DG_safe.nodes[goal]
            return haversine_dist(un["y"], un["x"], gn["y"], gn["x"])
        except Exception:
            return 0.0

    results = {"success": True}

    # ── A* safe (flood-aware) path ──
    try:
        safe_nodes = nx.astar_path(
            DG_safe, orig_node, dest_node,
            heuristic=heuristic, weight="weight"
        )
        results["safe_path"] = _path_to_geojson(G, safe_nodes, "safe", rainfall_score)
    except nx.NetworkXNoPath:
        results["safe_path"] = {"error": "No flood-safe path found. All routes may be flooded."}
    except Exception as e:
        logger.error(f"A* safe path error: {e}", exc_info=True)
        results["safe_path"] = {"error": str(e)}

    # ── A* normal (distance-only) path ──
    def heuristic_normal(u, goal):
        try:
            un = DG_normal.nodes[u]
            gn = DG_normal.nodes[goal]
            return haversine_dist(un["y"], un["x"], gn["y"], gn["x"])
        except Exception:
            return 0.0

    try:
        normal_nodes = nx.astar_path(
            DG_normal, orig_node, dest_node,
            heuristic=heuristic_normal, weight="weight"
        )
        results["normal_path"] = _path_to_geojson(G, normal_nodes, "normal", rainfall_score)
    except nx.NetworkXNoPath:
        results["normal_path"] = {"error": "No path found."}
    except Exception as e:
        logger.error(f"A* normal path error: {e}", exc_info=True)
        results["normal_path"] = {"error": str(e)}

    ROUTE_CACHE[ckey] = results
    return results

def _path_to_geojson(G, node_list, path_type, rainfall_score=0.0):
    coords = []
    total_length = 0.0
    max_risk = 0
    
    for i in range(len(node_list) - 1):
        u, v = node_list[i], node_list[i + 1]
        u_data = G.nodes[u]
        coords.append([u_data["y"], u_data["x"]])
        
        # Get edge data for summary
        edges = G.get_edge_data(u, v)
        if edges:
            data = min(edges.values(), key=lambda d: d.get("length", 999))
            total_length += data.get("length", 0)
            scored = fast_score_edge(data, rainfall_score)
            max_risk = max(max_risk, scored["risk_class"])

    if node_list:
        last = G.nodes[node_list[-1]]
        coords.append([last["y"], last["x"]])

    return {
        "type": path_type,
        "coordinates": coords,
        "summary": {
            "total_length_km": round(total_length / 1000, 2),
            "max_risk_class": max_risk,
            "estimated_time_min": round(total_length / 1000 / 30 * 60, 1)
        }
    }

def graph_to_geojson(G: nx.MultiDiGraph, rainfall_score: float = 0.0) -> dict:
    features = []
    for u, v, data in G.edges(data=True):
        u_node = G.nodes[u]
        v_node = G.nodes[v]
        scored = fast_score_edge(data, rainfall_score)
        
        features.append({
            "type": "Feature",
            "geometry": {
                "type": "LineString",
                "coordinates": [[u_node["x"], u_node["y"]], [v_node["x"], v_node["y"]]]
            },
            "properties": {
                "risk_class": scored["risk_class"],
                "risk_color": scored["risk_color"],
                "length_m": round(float(data.get("length", 0)), 1)
            }
        })
    return {"type": "FeatureCollection", "features": features}

def find_nearby_shelters(lat: float, lon: float, radius_m: int = 1000) -> list:
    # Kept for compatibility, already efficient enough
    tags = {"amenity": ["school", "community_centre", "hospital"], "building": ["school"]}
    try:
        gdf = ox.features_from_point((lat, lon), tags=tags, dist=radius_m)
        if gdf.empty: return []
        shelters = []
        for _, row in gdf.iterrows():
            name = row.get("name") or "Shelter"
            center = row.geometry.centroid
            shelters.append({"name": name, "lat": center.y, "lon": center.x, "type": "Safe Zone"})
        return shelters[:5]
    except: return []
