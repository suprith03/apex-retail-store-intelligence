# PROMPT: Create pytest checks capturing active operational anomalies. Test for QUEUE_SPIKE alerts under deeper checkout queues, DEAD_ZONE events with zero-traffic scenarios, and correct severity status reports.
# CHANGES MADE: Encompassed assert queries with explicit severity checks to accommodate custom INFO vs WARN vs CRITICAL specifications.

import pytest
from datetime import datetime, timedelta
from app import main
from app.ingestion import events_db, processed_event_ids
from app.anomalies import detect_store_anomalies

@pytest.fixture(autouse=True)
def init_clean_state():
    events_db.clear()
    processed_event_ids.clear()
    main.database_online = True

def test_queue_spike_anomaly():
    """Confirms checkout depth thresholds trigger appropriate severity alerts."""
    now_time = datetime.utcnow()
    
    # Under low queue depth -> No critical spike alarms
    an1 = detect_store_anomalies("STORE_BLR_002")
    # By default, a dead zone is detected because no events exist, but no queue spike should be present
    assert not any(a["type"] == "QUEUE_SPIKE" for a in an1)
    
    # Inject high queue depth event
    main.post_events([{
        "event_id": "evt_spike_trigger",
        "store_id": "STORE_BLR_002",
        "camera_id": "CAM_BILLING_01",
        "visitor_id": "VIS_shopper_q",
        "event_type": "BILLING_QUEUE_JOIN",
        "timestamp": now_time.isoformat() + "Z",
        "zone_id": "BILLING",
        "dwell_ms": 0,
        "is_staff": False,
        "confidence": 0.98,
        "metadata": {
            "queue_depth": 5, # Threshold level 5
            "session_seq": 2
        }
    }])
    
    an2 = detect_store_anomalies("STORE_BLR_002")
    spikes = [a for a in an2 if a["type"] == "QUEUE_SPIKE"]
    assert len(spikes) >= 1
    assert spikes[0]["severity"] == "CRITICAL"
    assert "remedy" in spikes[0]["suggested_action"].lower() or "deploy" in spikes[0]["suggested_action"].lower() or "auxiliary" in spikes[0]["suggested_action"].lower() or "open" in spikes[0]["suggested_action"].lower() or "counter" in spikes[0]["suggested_action"].lower() or "cashier" in spikes[0]["suggested_action"].lower()
