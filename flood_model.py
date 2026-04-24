"""
Flood Risk Model
----------------
Trains a simple Random Forest classifier on synthetic urban flooding features
and assigns flood risk scores to road segments on a city road network.

Features used per road segment:
  - elevation_diff   : height difference along segment (lower → higher risk)
  - road_type_enc    : road hierarchy (motorway > primary > secondary > …)
  - distance_to_drain: proximity to drainage/water body
  - rainfall_score   : live rain risk score from data_fetcher
  - slope            : terrain slope (lower slope → water pools)
  - historical_flood : synthetic historical flooding frequency (0-1)
"""

import numpy as np
import logging
import hashlib
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score

logger = logging.getLogger(__name__)

# Road type hierarchy — lower number = higher capacity = less flood prone
ROAD_TYPE_RANK = {
    "motorway": 1, "motorway_link": 1,
    "trunk": 2, "trunk_link": 2,
    "primary": 3, "primary_link": 3,
    "secondary": 4, "secondary_link": 4,
    "tertiary": 5, "tertiary_link": 5,
    "residential": 6, "living_street": 7,
    "service": 8, "unclassified": 9,
    "footway": 10, "path": 10, "cycleway": 10,
}


def _synthetic_train_data(n: int = 3000, seed: int = 42) -> tuple:
    """
    Generate synthetic labeled training data for the flood risk classifier.
    Features: [elevation_diff, road_type_enc, distance_to_drain,
               rainfall_score, slope, historical_flood, road_length]
    Label: [0=safe, 1=low, 2=moderate, 3=high, 4=critical]
    """
    rng = np.random.default_rng(seed)

    elevation_diff  = rng.uniform(-5, 20, n)          # meters
    road_type_enc   = rng.integers(1, 11, n)           # 1-10
    dist_to_drain   = rng.uniform(0, 500, n)           # meters
    rainfall_score  = rng.uniform(0, 1, n)             # 0-1
    slope           = rng.uniform(0, 15, n)            # degrees
    historical_flood= rng.uniform(0, 1, n)             # 0-1 freq
    road_length     = rng.uniform(20, 2000, n)         # meters

    X = np.column_stack([
        elevation_diff, road_type_enc, dist_to_drain,
        rainfall_score, slope, historical_flood, road_length
    ])

    # Composite risk formula
    risk_raw = (
        (10 - rainfall_score * 10) * 0.0 +   # rainfall dominates
        rainfall_score * 4.0
        + np.clip((10 - elevation_diff) / 10, 0, 1) * 1.5
        + np.clip((500 - dist_to_drain) / 500, 0, 1) * 0.8
        + np.clip((6 - slope) / 6, 0, 1) * 0.5
        + historical_flood * 1.2
        + (road_type_enc / 10) * 0.5
    )
    # Normalize to 0-4 labels
    risk_norm = np.clip(risk_raw / risk_raw.max() * 4, 0, 4)
    y = np.floor(risk_norm).astype(int)
    y = np.clip(y, 0, 4)

    # ── Guarantee all 5 classes are present so the classifier always
    #    outputs a probability vector of length 5 ────────────────────
    for cls in range(5):
        if cls not in y:
            # append a synthetic worst-case sample for this class
            X = np.vstack([X, np.array([[-2, 10, 0, min(cls/4, 1.0), 0, 1.0, 50]])])
            y = np.append(y, cls)

    return X, y


class FloodRiskModel:
    """
    Trained flood risk classifier + risk score calculator for road segments.
    """

    RISK_LABELS = {0: "SAFE", 1: "LOW", 2: "MODERATE", 3: "HIGH", 4: "CRITICAL"}
    RISK_COLORS = {
        0: "#00E5FF", 1: "#76FF03", 2: "#FFD600",
        3: "#FF6D00", 4: "#FF1744"
    }
    RISK_WEIGHTS = {0: 1.0, 1: 2.5, 2: 6.0, 3: 15.0, 4: 999.0}

    def __init__(self):
        self.model: Pipeline | None = None
        self.accuracy: float = 0.0
        self._train()

    def _train(self):
        X, y = _synthetic_train_data()
        X_tr, X_te, y_tr, y_te = train_test_split(X, y, test_size=0.2, random_state=42)

        pipeline = Pipeline([
            ("scaler", StandardScaler()),
            ("clf", GradientBoostingClassifier(
                n_estimators=120, max_depth=4,
                learning_rate=0.08, subsample=0.85,
                random_state=42
            ))
        ])
        pipeline.fit(X_tr, y_tr)
        y_pred = pipeline.predict(X_te)
        self.accuracy = accuracy_score(y_te, y_pred)
        self.model = pipeline
        logger.info(f"Flood model trained. Accuracy: {self.accuracy:.3f}")

    def _road_features(self, edge_data: dict, rainfall_score: float) -> np.ndarray:
        """Extract feature vector from OSMnx edge attributes."""
        road_type = edge_data.get("highway", "unclassified")
        if isinstance(road_type, list):
            road_type = road_type[0]
        road_type_enc = ROAD_TYPE_RANK.get(road_type, 9)

        length = float(edge_data.get("length", 100))

        # Pseudo-elevation diff: use edge name hash for reproducibility
        name = str(edge_data.get("name", edge_data.get("osmid", 0)))
        h = int(hashlib.md5(name.encode()).hexdigest()[:8], 16) % 1000
        elevation_diff = (h % 15) - 2        # range -2 to 12

        # pseudo distance to drain
        dist_to_drain = (h * 7 % 500)

        # slope estimate
        slope = max(0, 8 - elevation_diff * 0.5 + rainfall_score * 3)

        # historical flood frequency — inverse of road hierarchy
        historical_flood = min(1.0, road_type_enc / 10.0 * 0.8 + rainfall_score * 0.2)

        return np.array([[
            elevation_diff, road_type_enc, dist_to_drain,
            rainfall_score, slope, historical_flood, length
        ]])

    def predict_risk(self, edge_data: dict, rainfall_score: float = 0.0) -> dict:
        """Return risk class, label, color, and routing weight for one edge."""
        feats = self._road_features(edge_data, rainfall_score)
        risk_class = int(self.model.predict(feats)[0])
        proba = self.model.predict_proba(feats)[0]
        # Use the actual classes the model learned (avoids index-out-of-bounds
        # when class 4 was absent from the training split before the fix).
        classes = self.model.named_steps["clf"].classes_
        risk_score = float(sum(proba[j] * classes[j] for j in range(len(classes))) / 4)

        return {
            "risk_class": risk_class,
            "risk_score": round(risk_score, 3),
            "risk_label": self.RISK_LABELS[risk_class],
            "risk_color": self.RISK_COLORS[risk_class],
            "routing_weight": self.RISK_WEIGHTS[risk_class],
        }

    def score_graph(self, G, rainfall_score: float = 0.0) -> None:
        """
        In-place annotation of every edge in the OSMnx graph G
        with flood risk attributes.
        """
        for u, v, k, data in G.edges(keys=True, data=True):
            risk = self.predict_risk(data, rainfall_score)
            data.update(risk)
            # Effective routing weight = base_length * risk_weight
            base = float(data.get("length", 50))
            data["flood_weight"] = base * risk["routing_weight"]
