# Apex Retail Store Intelligence Platform

This platform ingests raw, anonymized retail CCTV streams and exposes comprehensive analytics and conversion APIs to bridge physical retail data blind spots. 

---

## 🚀 Setup & Execution Guide (5 Commands)

Set up your physical environment in exactly **five commands**:

```bash
# 1. Clone the project and navigate into the repository
git clone https://github.com/apex-retail/store-intelligence.git && cd store-intelligence

# 2. Build and boot the intelligence REST API engine in the background
docker compose up --build -d

# 3. Verify server state is healthy and listening on Port 3000
curl http://localhost:3000/health

# 4. Install pipeline dependencies on your edge GPU box
pip install -r requirements.txt

# 5. Process raw camera recordings and stream telemetry events to the API
./pipeline/run.sh http://localhost:3000/events/ingest ./clips STORE_BLR_002
```

---

## 📂 Core Repository Architecture

The platform architecture complies strictly with industry best practices, decoupling visual frame extraction from database calculations:

* `/app` - Core REST API gateway powered by **FastAPI**
  * `main.py` - Primary router entrypoint setting connection policies, middlewares, and routers.
  * `models.py` - Pydantic definitions executing deterministic shape matching against incoming batches.
  * `ingestion.py` - Handles idempotent validations, duplicate exclusions, and datastore locks.
  * `metrics.py` - Calculates sales metrics and visitor ratios, filtering staff and tracking conversions.
  * `funnel.py` - Tracks step-containment progressions through the store departments.
  * `anomalies.py` - Schedules real-time analysis to report warning spikes.
* `/pipeline` - On-edge Computer Vision inference pipeline
  * `detect.py` - Object detection targeting individuals using **YOLOv8** bounding box classes.
  * `tracker.py` - Coordinates tracking vectors via sub-pixel **ByteTrack** algorithms for Re-ID.
  * `emit.py` - Groups and posts events to raw API endpoints.
  * `run.sh` - Standard CLI coordinator.
* `/tests` - Pytest conformance suite evaluating conversion margins and boundary scopes.

---

## 🧪 Running Conformance Assertions

Validate compliance with all 10 evaluation assertions using pytest directly in your developer terminal:

```bash
# Run the complete test suite with verbose assertions
pytest -v
```

This guarantees:
1. `POST /events/ingest` verifies strict idempotency, skipping duplicates.
2. Store personnel (`is_staff: true`) are systematically excluded from customer metrics.
3. Funnels and conversions evaluate precisely to the preceding 5-minute sliding purchase window.
4. Anomaly alerts are issued with correct priority ratings (CRITICAL / WARN / INFO).
~
