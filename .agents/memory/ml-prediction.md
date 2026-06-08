---
name: ML prediction system
description: Design constraints and lessons for the Poisson + Random Forest ensemble prediction model.
---

## Key files
- `artifacts/api-server/src/lib/mlModel.ts` — feature extraction, Poisson, RF, blend, predict, train, serialize
- `artifacts/api-server/src/routes/model.ts` — `GET /api/model/status`, `POST /api/model/train`, `POST /api/model/predict`
- `artifacts/processing-engine/src/pages/database.tsx` — `PredictionPanel` component + `ModelTrainingCard`

## DB schema
- `model_store` table added to `initSchema` in `db.ts` (key/value store for serialized model JSON).

## Field aliasing (both match sources)
`extractFeatures()` reads from both `stored_matches` (cols: `home_stats_json`, `odds_1x2_json`) and `processing_matches` (cols: `home_team_stats_json`, `po_1x2_json`) via fallback aliasing — both work with the same predict endpoint.

## Model design
- 31 features: xG proxies, form, possession, shots, goals, h2h, odds-implied probs, market breadth
- RF (ml-random-forest npm package) trained 80/20 split on stored matches; blended 60% RF / 40% Poisson at prediction time
- Feature quality: `"full"` (≥20 non-zero), `"partial"` (≥10), `"minimal"` otherwise
- Value-bet threshold: model_prob > implied_prob + 0.04 (4% edge)

## Why Poisson blend
Pure RF overfits on small datasets (32 samples typical). Poisson anchors on lambda (xG-proxy), RF adjusts for form/momentum. The blend is controlled by a constant — easy to tune.

## Accuracy on 32 samples
1X2: ~57%, BTTS: ~43% — expect improvement as more matches are processed.
