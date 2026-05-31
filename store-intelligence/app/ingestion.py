from typing import List, Dict, Any, Set
from datetime import datetime
from app.models import RetailEvent, PosTransaction

# In-Memory Event and Transaction Repository representing the Datastore for the Python API
events_db: List[RetailEvent] = []
transactions_db: List[PosTransaction] = []
processed_event_ids: Set[str] = set()

def ingest_events_batch(batch_data: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Ingests, validates, and deduplicates a batch of up to 500 retail events.
    Ensures safe idempotency under high retries.
    """
    ingested_count = 0
    skipped_duplicates = 0
    errors = []
    
    for idx, raw_evt in enumerate(batch_data):
        try:
            # Idempotency check 
            event_id = raw_evt.get("event_id")
            if not event_id:
                errors.append({"index": idx, "message": "Missing 'event_id' attribute"})
                continue
                
            if event_id in processed_event_ids:
                skipped_duplicates += 1
                continue
                
            # Parse & Validate using Pydantic
            evt = RetailEvent(**raw_evt)
            events_db.append(evt)
            processed_event_ids.add(evt.event_id)
            ingested_count += 1
            
        except Exception as e:
            errors.append({"index": idx, "message": str(e), "event_id": raw_evt.get("event_id", "Unknown")})
            
    # Sort events chronologically to preserve tracking calculations
    events_db.sort(key=lambda x: x.timestamp)
    
    status = "success"
    if len(errors) == len(batch_data):
        status = "failed"
    elif len(errors) > 0:
        status = "partial_success"
        
    return {
        "status": status,
        "ingested_count": ingested_count,
        "skipped_duplicates": skipped_duplicates,
        "failed_count": len(errors),
        "errors": errors
    }

def seed_pos_transaction(store_id: str, transaction_id: str, timestamp_str: str, basket_value: float):
    dt = datetime.fromisoformat(timestamp_str.replace("Z", "+00:00"))
    tx = PosTransaction(
        store_id=store_id,
        transaction_id=transaction_id,
        timestamp=dt,
        basket_value_inr=basket_value
    )
    transactions_db.append(tx)
    transactions_db.sort(key=lambda x: x.timestamp)
