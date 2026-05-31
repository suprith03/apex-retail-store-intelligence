from datetime import datetime, timedelta
from typing import Dict, Any, List
from app.ingestion import events_db, transactions_db

def compute_store_funnel(store_id: str) -> Dict[str, Any]:
    """
    Computes aggregated conversion funnel step progression metrics.
    Ensures re-entries and multiple zones do not inflate unique sessions.
    
    Stages:
    1. Entry -> Shopper crossed entry threshold.
    2. Zone Visit -> Shopper visited at least one interior product department.
    3. Billing Queue -> Shopper entered checkout counter zone.
    4. Completed Purchase -> Correlated with POS tx.
    """
    now = datetime.utcnow()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    
    # Events filtering matching requirements
    store_events = [
        e for e in events_db 
        if e.store_id == store_id and not e.is_staff and e.timestamp >= today_start
    ]
    
    store_tx = [
        tx for tx in transactions_db 
        if tx.store_id == store_id and tx.timestamp >= today_start
    ]
    
    # 1. Entry sessions
    entry_sessions = set(
        e.visitor_id for e in store_events 
        if e.event_type in ("ENTRY", "REENTRY")
    )
    
    # 2. Zone exploration sessions
    zone_visit_sessions = set(
        e.visitor_id for e in store_events 
        if e.zone_id and e.zone_id != "BILLING"
    )
    
    # 3. Billing counter entrants
    billing_queue_sessions = set(
        e.visitor_id for e in store_events 
        if e.zone_id == "BILLING" and e.event_type == "ZONE_ENTER"
    )
    
    # 4. Completed sales conversions match
    purchase_sessions = set()
    for tx in store_tx:
        window_start = tx.timestamp - timedelta(minutes=5)
        candidates = [
            e.visitor_id for e in store_events
            if e.zone_id == "BILLING" 
            and window_start <= e.timestamp <= tx.timestamp
        ]
        for v in candidates:
            purchase_sessions.add(v)
            
    # Ensure logical sequential subset containment
    stages = ["Entry", "Zone Exploration", "Billing Queue Entrance", "Completed Purchase"]
    
    entry_count = len(entry_sessions)
    explore_count = len(entry_sessions.intersection(zone_visit_sessions))
    queue_count = len(entry_sessions.intersection(billing_queue_sessions))
    purchase_count = len(entry_sessions.intersection(purchase_sessions))
    
    # Prevent hierarchical boundary overflows
    explore_count = min(entry_count, explore_count)
    queue_count = min(explore_count, queue_count)
    purchase_count = min(queue_count, purchase_count)
    
    # Compile Steps list
    step_data = []
    counts = [entry_count, explore_count, queue_count, purchase_count]
    
    for idx, count in enumerate(counts):
        p = round((count / entry_count) * 100, 1) if entry_count > 0 else 0.0
        
        # Calculate drop_offs
        drop_count = 0
        drop_perc = 0.0
        if idx < len(counts) - 1:
            next_count = counts[idx+1]
            drop_count = count - next_count
            drop_perc = round((drop_count / count) * 100, 1) if count > 0 else 0.0
            
        step_data.append({
            "stage": stages[idx],
            "count": count,
            "percentage": p,
            "drop_off_count": drop_count,
            "drop_off_percentage": drop_perc
        })
        
    return {
        "store_id": store_id,
        "total_sessions": entry_count,
        "funnel": step_data
    }
