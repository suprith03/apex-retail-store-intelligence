from fastapi import FastAPI, HTTPException, status
from fastapi.responses import JSONResponse
from typing import List, Dict, Any
from app.models import RetailEvent, IngestResponse
from app.ingestion import ingest_events_batch, seed_pos_transaction, events_db
from app.metrics import compute_store_metrics
from app.funnel import compute_store_funnel
from app.anomalies import detect_store_anomalies
from app.health import get_system_health

app = FastAPI(
    title="Apex Retail - Store Intelligence API",
    description="A highly optimized REST API ingesting edge-CCTV detections to track customers and surface real-time KPIs.",
    version="1.0.0"
)

# Mock layout cache to support heatmap normalization query configurations
STORE_LAYOUTS = {
    "STORE_BLR_002": ["SKINCARE", "COSMETICS", "BILLING", "APPAREL", "HAIRCARE"],
    "STORE_DEL_001": ["SKINCARE", "COSMETICS", "BILLING", "FOOTWEAR", "MENS_WEAR"],
    "STORE_BOM_005": ["SKINCARE", "COSMETICS", "BILLING", "FRAGRANCE", "BAGS"],
    "STORE_HYD_003": ["SKINCARE", "COSMETICS", "BILLING", "WELLNESS", "GADGETS"],
    "STORE_MAA_004": ["SKINCARE", "COSMETICS", "BILLING", "JEWELRY", "SAREES"]
}

# --- Graceful Connection Degradation Simulation State Variable (Part C!) ---
database_online = True

@app.middleware("http")
async def db_connection_guard(request, call_next):
    """Intercepts and degrades API calls to 503 if database simulation is demoted."""
    if not database_online and request.url.path.startswith(("/events", "/stores")):
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={
                "error": "Service Unavailable",
                "code": "DATABASE_UNREACHABLE",
                "message": "The primary store-intelligence analytics database is currently unreachable.",
                "suggested_action": "Wait 15 seconds for automated system failover to complete."
            }
        )
    return await call_next(request)

@app.get("/health")
def get_health():
    """Service health status endpoint with lagging-pulse warns."""
    health_payload = get_system_health()
    if not database_online:
        health_payload["status"] = "DEGRADED"
        health_payload["database_connected"] = False
    else:
        health_payload["database_connected"] = True
    return health_payload

@app.post("/events/ingest", response_model=IngestResponse)
def post_events(batch: List[Dict[str, Any]]):
    """
    Ingests and deduplicates batches of up to 500 retail events.
    Returns 207 on partial errors, 413 on payload limits.
    """
    if len(batch) == 0:
        raise HTTPException(status_code=400, detail="Batch payload cannot be empty.")
    if len(batch) > 500:
        raise HTTPException(status_code=413, detail="Batch size exceeds maximum allow limit of 500 events.")
        
    res = ingest_events_batch(batch)
    
    if res["status"] == "failed":
        raise HTTPException(status_code=400, detail=res)
    elif res["status"] == "partial_success":
        return JSONResponse(status_code=207, content=res)
        
    return res

@app.get("/stores/{store_id}/metrics")
def get_metrics(store_id: str):
    """Surfaces on-demand traffic and sales metrics for a store."""
    if store_id not in STORE_LAYOUTS:
        raise HTTPException(
            status_code=404, 
            detail=f"Store ID '{store_id}' was unrecognized."
        )
    return compute_store_metrics(store_id)

@app.get("/stores/{store_id}/funnel")
def get_funnel(store_id: str):
    """Aggregates visitors through the Conversion Funnel stage steps."""
    if store_id not in STORE_LAYOUTS:
        raise HTTPException(status_code=404, detail="Store ID unrecognized.")
    return compute_store_funnel(store_id)

@app.get("/stores/{store_id}/heatmap")
def get_heatmap(store_id: str):
    """
    Computes normalized (0-100) spatial density indices for store layouts.
    Flags data_confidence = false if daily volume is under 20 sessions today.
    """
    if store_id not in STORE_LAYOUTS:
        raise HTTPException(status_code=404, detail="Store ID unrecognized.")
        
    zones = STORE_LAYOUTS[store_id]
    
    # Calculate counts
    zone_visits = {z: 0 for z in zones}
    zone_dwells = {z: [] for z in zones}
    
    today_events = [e for e in events_db if e.store_id == store_id and not e.is_staff]
    
    # Track distinct visitor count to set confidence
    visitor_ids = set()
    
    for e in today_events:
        visitor_ids.add(e.visitor_id)
        if e.zone_id in zone_visits:
            if e.event_type == "ZONE_ENTER":
                zone_visits[e.zone_id] += 1
            elif e.event_type == "ZONE_EXIT" and e.dwell_ms > 0:
                zone_dwells[e.zone_id].append(e.dwell_ms)
                
    max_count = max(zone_visits.values()) if zone_visits.values() else 1
    max_count = 1 if max_count == 0 else max_count
    
    heatmap_steps = []
    for z in zones:
        v_count = zone_visits[z]
        dwells_list = zone_dwells[z]
        avg_dwell_sec = int((sum(dwells_list) / len(dwells_list)) / 1000) if dwells_list else 0
        density_score = int((v_count / max_count) * 100)
        
        heatmap_steps.append({
            "zone_id": z,
            "visit_count": v_count,
            "avg_dwell_seconds": avg_dwell_sec,
            "density_score": density_score
        })
        
    return {
        "store_id": store_id,
        "total_sessions_today": len(visitor_ids),
        "data_confidence": len(visitor_ids) >= 20,
        "heatmap": heatmap_steps
    }

@app.get("/stores/{store_id}/anomalies")
def get_anomalies(store_id: str):
    """Surfaces active operational concerns and remedial steps."""
    if store_id not in STORE_LAYOUTS:
        raise HTTPException(status_code=404, detail="Store ID unrecognized.")
    return {
        "store_id": store_id,
        "anomalies": detect_store_anomalies(store_id)
    }

# Seed realistic data immediately of 1 transaction for testing purposes
seed_pos_transaction("STORE_BLR_002", "TXN_999", "2026-05-30T12:00:00Z", 1500.0)
