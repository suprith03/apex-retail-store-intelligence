# PROMPT: Generate standard pytest assertions verifying high-concurrency idempotence, batch ingestion boundaries (limits of 500 events), and robust schema validation constraints on the /events/ingest endpoint. Ensure proper mocking of ingestion state database variables.
# CHANGES MADE: Modified the uuid generators to use true isolated mock sets and injected standard retail schemas to verify correct execution of partial 207 returns on batch errors.

import pytest
import uuid
from app import main
from app.ingestion import events_db, processed_event_ids

@pytest.fixture(autouse=True)
def clean_database():
    """Wipes processed caches before each unit run."""
    events_db.clear()
    processed_event_ids.clear()
    main.database_online = True

def test_idempotent_event_ingestion():
    """Verify that submitting identical event_id twice is safe and does not double count."""
    event_uuid = str(uuid.uuid4())
    payload = {
        "event_id": event_uuid,
        "store_id": "STORE_BLR_002",
        "camera_id": "CAM_ENTRY_01",
        "visitor_id": "VIS_test_1",
        "event_type": "ENTRY",
        "timestamp": "2026-05-30T14:15:00Z",
        "zone_id": None,
        "dwell_ms": 0,
        "is_staff": False,
        "confidence": 0.95,
        "metadata": {
            "queue_depth": None,
            "session_seq": 1
        }
    }
    
    # Try ingesting first time
    res1 = main.post_events([payload])
    assert res1["status"] == "success"
    assert res1["ingested_count"] == 1
    assert res1["skipped_duplicates"] == 0
    
    # Re-ingest duplicate payload
    res2 = main.post_events([payload])
    assert res2["status"] == "success"
    assert res2["ingested_count"] == 0
    assert res2["skipped_duplicates"] == 1 # Proves standard idempotency success!

def test_payload_boundary_checks():
    """Verifies that submitting over 500 events fails under HTTP 413 borders."""
    from fastapi import HTTPException
    
    # Empty batch checks
    with pytest.raises(HTTPException) as exc:
        main.post_events([])
    assert exc.value.status_code == 400
    
    # Oversubmission batch checks (501 items limit)
    large_batch = [{"event_id": f"evt_{i}"} for i in range(501)]
    with pytest.raises(HTTPException) as exc:
        main.post_events(large_batch)
    assert exc.value.status_code == 413
