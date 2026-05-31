from datetime import datetime, timedelta
from typing import Dict, Any
from app.ingestion import events_db

STORES = ["STORE_BLR_002", "STORE_DEL_001", "STORE_BOM_005", "STORE_HYD_003", "STORE_MAA_004"]

def get_system_health() -> Dict[str, Any]:
    """
    Computes diagnostic health metrics and stale feed warnings.
    Flags camera feeds with 'STALE_FEED' if camera latency lags > 10 mins.
    """
    now = datetime.utcnow()
    store_health_map = {}
    
    for sid in STORES:
        store_events = [e for e in events_db if e.store_id == sid]
        if not store_events:
            store_health_map[sid] = {
                "status": "OK",
                "last_event_timestamp": None
            }
            continue
            
        latest_evt = store_events[-1]
        lag = now - latest_evt.timestamp
        minutes_lag = int(lag.total_seconds() / 60)
        
        status = "OK"
        warning = None
        
        if minutes_lag > 10:
            status = "STALE_FEED"
            warning = f"Camera feed lag currently at {minutes_lag} minutes, exceeding maximum SLA buffer limit of 10 min."
            
        store_health_map[sid] = {
            "status": status,
            "last_event_timestamp": latest_evt.timestamp.isoformat() + "Z",
            "warning": warning
        }
        
    return {
        "status": "HEALTHY",
        "current_time": now.isoformat() + "Z",
        "stores": store_health_map
    }
