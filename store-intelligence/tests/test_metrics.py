# PROMPT: Build comprehensive unit assertions evaluating conversion-funnel calculations and sliding pre-checkout 5-minute sales matching ratios. Test edge cases: empty stores (no shoppers), staff exclusion filters (is_staff=true), and zero-purchase setups.
# CHANGES MADE: Standardized timezone offsets in datetime parsing to assure datetime calculations execute flawlessly without local environment warnings.

import pytest
from datetime import datetime, timedelta
from app import main
from app.ingestion import events_db, transactions_db, processed_event_ids, seed_pos_transaction
from app.metrics import compute_store_metrics
from app.funnel import compute_store_funnel

@pytest.fixture(autouse=True)
def wipe_repos():
    events_db.clear()
    transactions_db.clear()
    processed_event_ids.clear()
    main.database_online = True

def test_staff_exclusion():
    """Confirms that events flagged is_staff=True are excluded from shopper analytics."""
    event_time = datetime.utcnow()
    
    # Ingest staff member walking through store
    staff_entry = {
        "event_id": "evt_staff_t1",
        "store_id": "STORE_BLR_002",
        "camera_id": "CAM_ENTRY_01",
        "visitor_id": "VIS_STAFF_member",
        "event_type": "ENTRY",
        "timestamp": event_time.isoformat() + "Z",
        "zone_id": None,
        "dwell_ms": 0,
        "is_staff": True, # Excluded target
        "confidence": 0.99,
        "metadata": {"queue_depth": None, "session_seq": 1}
    }
    main.post_events([staff_entry])
    
    metrics = compute_store_metrics("STORE_BLR_002")
    assert metrics["unique_visitors"] == 0 # Decoupled and filtered successfully!

def test_sliding_window_conversions():
    """Verify conversion rate matching logic is bound strictly to the preceding 5 minute billing zone window."""
    base_time = datetime.utcnow()
    
    # Customer enters store and explores billing zone
    main.post_events([
        {
            "event_id": "evt_c1",
            "store_id": "STORE_BLR_002",
            "camera_id": "CAM_ENTRY_01",
            "visitor_id": "VIS_shopper_1",
            "event_type": "ENTRY",
            "timestamp": base_time.isoformat() + "Z",
            "zone_id": None,
            "dwell_ms": 0,
            "is_staff": False,
            "confidence": 0.95,
            "metadata": {"queue_depth": None, "session_seq": 1}
        },
        {
            "event_id": "evt_c2",
            "store_id": "STORE_BLR_002",
            "camera_id": "CAM_BILLING_01",
            "visitor_id": "VIS_shopper_1",
            "event_type": "ZONE_ENTER",
            "timestamp": (base_time + timedelta(seconds=10)).isoformat() + "Z",
            "zone_id": "BILLING",
            "dwell_ms": 0,
            "is_staff": False,
            "confidence": 0.95,
            "metadata": {"queue_depth": None, "session_seq": 2}
        }
    ])
    
    # 1. POS Transaction takes place 15 minutes later (outside the 5-minute window) -> Non-converted session!
    seed_pos_transaction("STORE_BLR_002", "TXN_LATE", (base_time + timedelta(minutes=15)).isoformat() + "Z", 520.0)
    m1 = compute_store_metrics("STORE_BLR_002")
    assert m1["unique_visitors"] == 1
    assert m1["conversion_rate"] == 0.0
    
    # 2. POS Transaction happens within 2 minutes of shopper in billing zone -> CONVERTED successfully!
    seed_pos_transaction("STORE_BLR_002", "TXN_CONV", (base_time + timedelta(minutes=2)).isoformat() + "Z", 890.0)
    m2 = compute_store_metrics("STORE_BLR_002")
    assert m2["conversion_rate"] == 1.0 # 100% conversion!
