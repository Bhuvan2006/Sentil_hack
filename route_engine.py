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

# Radius (metres) around the city centre to download — 4 km gives a
# navigable urban area without the long download times of a full city polygon.
DOWNLOAD_RADIUS_M = 4000


def _cache_path(lat: float, lon: float) -> str:
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
    (lat, lon) with the given radius.  Uses graph_from_point which is
    orders of magnitude faster than graph_from_place for large cities.
    """
    cache_file = _cache_path(lat, lon)

    if os.path.exists(cache_file):
        logger.info(f"Loading cached graph for '{city}' from {cache_file}")
        with open(cache_file, "rb") as f:
            return pickle.load(f)

    logger.info(
        f"Downloading {radius_m/1000:.1f} km road network around "
        f"'{city}' ({lat:.4f}, {lon:.4f}) from OSM …"
    )
    G = ox.graph_from_point(
        (lat, lon),
        dist=radius_m,
        network_type="drive",
        simplify=True,
    )

    with open(cache_file, "wb") as f:
        pickle.dump(G, f)

    logger.info(f"Graph saved: {G.number_of_nodes()} nodes, {G.number_of_edges()} edges")
    return G


# ---------------------------------------------------------------------------
# Nearest-node lookup
# ---------------------------------------------------------------------------

def nearest_node(G: nx.MultiDiGraph, lat: float, lon: float) -> int:
    return ox.nearest_nodes(G, X=lon, Y=lat)


# ---------------------------------------------------------------------------
# Flood-aware Dijkstra routing
# ---------------------------------------------------------------------------

def _build_weighted_graph(G: nx.MultiDiGraph, block_critical: bool = True) -> nx.DiGraph:
    """
    Build a simple DiGraph from the MultiDiGraph, using flood_weight as edge weight.
    Optionally removes CRITICAL edges.
    """
    DG = nx.DiGraph()
    DG.add_nodes_from(G.nodes(data=True))

    for u, v, data in G.edges(data=True):
        if block_critical and data.get("risk_class", 0) == 4:
            continue   # block critical flood roads
        w = data.get("flood_weight", data.get("length", 50))
        # Keep only minimum weight among parallel edges
        if DG.has_edge(u, v):
            if DG[u][v]["weight"] > w:
                DG[u][v].update({"weight": w, **data})
        else:
            DG.add_edge(u, v, weight=w, **data)

    return DG


def find_safe_route(
    G: nx.MultiDiGraph,
    origin_lat: float, origin_lon: float,
    dest_lat: float, dest_lon: float,
) -> dict:
    """
    Compute a flood-aware route and the baseline shortest route.
    Returns GeoJSON-style response with node coordinates and risk info.
    """
    try:
        orig_node = nearest_node(G, origin_lat, origin_lon)
        dest_node = nearest_node(G, dest_lat, dest_lon)
    except Exception as e:
        return {"success": False, "error": f"Node lookup failed: {e}"}

    # Build flood-aware weighted graph
    DG_safe = _build_weighted_graph(G, block_critical=True)
    # Build normal (distance only) graph
    DG_normal = _build_weighted_graph(G, block_critical=False)
    for u, v, data in G.edges(data=True):
        if DG_normal.has_edge(u, v):
            DG_normal[u][v]["weight"] = data.get("length", 50)

    results = {}

    # ------- Safe (flood-aware) path -------
    try:
        safe_nodes = nx.dijkstra_path(DG_safe, orig_node, dest_node, weight="weight")
        results["safe_path"] = _path_to_geojson(G, safe_nodes, path_type="safe")
    except nx.NetworkXNoPath:
        results["safe_path"] = {"error": "No flood-safe path found. All routes may be flooded."}
    except Exception as e:
        results["safe_path"] = {"error": str(e)}

    # ------- Normal shortest path -------
    try:
        normal_nodes = nx.dijkstra_path(DG_normal, orig_node, dest_node, weight="weight")
        results["normal_path"] = _path_to_geojson(G, normal_nodes, path_type="normal")
    except nx.NetworkXNoPath:
        results["normal_path"] = {"error": "No path found."}
    except Exception as e:
        results["normal_path"] = {"error": str(e)}

    return {"success": True, **results}


def _path_to_geojson(G: nx.MultiDiGraph, node_list: list, path_type: str) -> dict:
    """Convert a node list to a GeoJSON LineString + metadata."""
    coords = []
    segments = []
    total_length = 0.0
    max_risk = 0
    risk_counts = {0: 0, 1: 0, 2: 0, 3: 0, 4: 0}

    for i in range(len(node_list) - 1):
        u, v = node_list[i], node_list[i + 1]
        # Get best edge
        edge_data = _best_edge(G, u, v)
        length = float(edge_data.get("length", 0))
        total_length += length
        rc = int(edge_data.get("risk_class", 0))
        max_risk = max(max_risk, rc)
        risk_counts[rc] += 1

        u_data = G.nodes[u]
        coords.append([u_data["x"], u_data["y"]])

        segments.append({
            "from": [u_data["y"], u_data["x"]],
            "to":   [G.nodes[v]["y"], G.nodes[v]["x"]],
            "risk_class": rc,
            "risk_label": edge_data.get("risk_label", "SAFE"),
            "risk_color": edge_data.get("risk_color", "#00E5FF"),
            "road_name":  edge_data.get("name", "Unnamed road"),
            "length_m":   round(length, 1),
        })

    # Add last node
    if node_list:
        last = G.nodes[node_list[-1]]
        coords.append([last["x"], last["y"]])

    # Flip to [lat, lon] for Leaflet
    latlng_coords = [[c[1], c[0]] for c in coords]

    from flood_model import FloodRiskModel as _FRM
    risk_labels = _FRM.RISK_LABELS
    risk_colors = _FRM.RISK_COLORS

    return {
        "type": path_type,
        "coordinates": latlng_coords,
        "segments": segments,
        "summary": {
            "total_length_km": round(total_length / 1000, 2),
            "node_count": len(node_list),
            "max_risk_class": max_risk,
            "max_risk_label": risk_labels.get(max_risk, "SAFE"),
            "risk_distribution": risk_counts,
            "estimated_time_min": round(total_length / 1000 / 30 * 60, 1)  # 30 km/h avg
        }
    }


def _best_edge(G: nx.MultiDiGraph, u: int, v: int) -> dict:
    """Return data of the best (lowest weight) parallel edge between u and v."""
    edges = G.get_edge_data(u, v)
    if not edges:
        return {}
    best = min(edges.values(), key=lambda d: d.get("flood_weight", d.get("length", 9999)))
    return best


# ---------------------------------------------------------------------------
# Graph → GeoJSON for map overlay
# ---------------------------------------------------------------------------

def graph_to_geojson(G: nx.MultiDiGraph, max_edges: int = 5000) -> dict:
    """
    Convert scored road graph to GeoJSON for frontend overlay.
    Limits output to max_edges for performance.
    """
    features = []
    edge_iter = list(G.edges(data=True))[:max_edges]

    for u, v, data in edge_iter:
        u_node = G.nodes[u]
        v_node = G.nodes[v]
        rc = data.get("risk_class", 0)

        feature = {
            "type": "Feature",
            "geometry": {
                "type": "LineString",
                "coordinates": [
                    [u_node["x"], u_node["y"]],
                    [v_node["x"], v_node["y"]]
                ]
            },
            "properties": {
                "risk_class": rc,
                "risk_label": data.get("risk_label", "SAFE"),
                "risk_color": data.get("risk_color", "#00E5FF"),
                "road_name":  data.get("name", ""),
                "highway":    data.get("highway", ""),
                "length_m":   round(float(data.get("length", 0)), 1)
            }
        }
        features.append(feature)

    return {"type": "FeatureCollection", "features": features}


def find_nearby_shelters(lat: float, lon: float, radius_m: int = 1000) -> list:
    """
    Find nearby potential shelters (schools, community centers, hospitals, etc.)
    using OSMnx features_from_point.
    """
    tags = {
        "amenity": ["school", "community_centre", "hospital", "place_of_worship", "social_facility"],
        "building": ["school", "hospital", "community_centre"]
    }
    try:
        # Search for features within the radius
        gdf = ox.features_from_point((lat, lon), tags=tags, dist=radius_m)
        if gdf.empty:
            return []
        
        shelters = []
        for _, row in gdf.iterrows():
            # Get name, fallback to type if missing
            name = row.get("name")
            stype = row.get("amenity") or row.get("building") or "Shelter"
            if not name:
                name = f"Unnamed {stype.replace('_', ' ').title()}"

            # Get centroid for lat/lon coordinates
            center = row.geometry.centroid
            
            # Simple distance for sorting (Pythagorean is fine for small radius)
            dist = math.sqrt((center.y - lat)**2 + (center.x - lon)**2)
            
            shelters.append({
                "name": name,
                "lat": center.y,
                "lon": center.x,
                "type": stype,
                "distance_approx": dist
            })
        
        # Sort by distance
        shelters.sort(key=lambda x: x["distance_approx"])
        
        # Remove duplicates by approximate location to avoid multi-polygon issues
        unique_shelters = []
        seen_locs = set()
        for s in shelters:
            loc_key = (round(s["lat"], 5), round(s["lon"], 5))
            if loc_key not in seen_locs:
                unique_shelters.append(s)
                seen_locs.add(loc_key)
                
        return unique_shelters[:10]  # Return top 10
    except Exception as e:
        logger.error(f"Error finding shelters: {e}")
        return []
