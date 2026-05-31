from datetime import datetime, timedelta
from typing import Dict, Any, List
from app.ingestion import events_db, transactions_db

def compute_store_metrics(store_id: str) -> Dict[str, Any]:
    """
    Computes real-time sales performance and customer logistics.
    Excludes store staff from visitor counts.
    Correlates conversions using a sliding 5-minute pre-billing window.
    """
    now = datetime.utcnow()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    
    # Filter store activities for today
    today_events = [
        e for e in events_db 
        if e.store_id == store_id and not e.is_staff and e.timestamp >= today_start
    ]
    
    today_tx = [
        tx for tx in transactions_db 
        if tx.store_id == store_id and tx.timestamp >= today_start
    ]
    
    # Unique visitors today (by custom visitor ID)
    visitors_today = set(e.visitor_id for e in today_events)
    unique_visitors = len(visitors_today)
    
    # Conversion Rate:
    # "A visitor who was in the billing zone in the 5-minute window before a transaction counts as a converted visitor for that session."
    converted_visitors = set()
    for tx in today_tx:
        tx_time = tx.timestamp
        window_start = tx_time - timedelta(minutes=5)
        
        # Find who entered billing in this store under this window
        billing_visitors = [
            e.visitor_id for e in events_db
            if e.store_id == store_id 
            and not e.is_staff 
            and e.zone_id == "BILLING"
            and window_start <= e.timestamp <= tx_time
        ]
        for v in billing_visitors:
            converted_visitors.add(v)
            
    # Keep conversions bound to active visitors of today
    converted_count = len(converted_visitors.intersection(visitors_today))
    conversion_rate = float(converted_count / unique_visitors) if unique_visitors > 0 else 0.0
    
    # Avg Dwell per Zone: Average of all exited zone dwells
    zone_dwells: Dict[str, List[int]] = {}
    for e in today_events:
        if e.zone_id and e.event_type == "ZONE_EXIT" and e.dwell_ms > 0:
            zone_dwells.setdefault(e.zone_id, []).append(e.dwell_ms)
            
    avg_dwell_per_zone = {
        zone: int(sum(dwells) / len(dwells)) if len(dwells) > 0 else 0
        for zone, dwells in zone_dwells.items()
    }
    
    # Current active checkout queue depth
    # Estimated by inspecting recent queue entries within the last 5 minutes
    five_mins_ago = now - timedelta(minutes=5)
    recent_joins = [
        e for e in events_db 
        if e.store_id == store_id 
        and e.event_type == "BILLING_QUEUE_JOIN" 
        and e.timestamp >= five_mins_ago
    ]
    
    queue_depth = 0
    if recent_joins:
        latest = recent_joins[-1]
        queue_depth = latest.metadata.queue_depth if latest.metadata.queue_depth is not None else 0
    else:
        # Fallback tracking estimations Enter vs Exit
        billing_enters = [e for e in today_events if e.zone_id == "BILLING" and e.event_type == "ZONE_ENTER"]
        billing_exits = [e for e in today_events if e.zone_id == "BILLING" and e.event_type == "ZONE_EXIT"]
        queue_depth = max(0, len(billing_enters) - len(billing_exits))
        
    # Checkout Queue Abandonment Rate:
    # Ratio of BILLING_QUEUE_ABANDON events vs total unique entrants to checkout
    abandonments = len([
        e for e in today_events 
        if e.event_type == "BILLING_QUEUE_ABANDON"
    ])
    checkout_entrants = len(set(
        e.visitor_id for e in today_events 
        if e.zone_id == "BILLING" and e.event_type == "ZONE_ENTER"
    ))
    
    abandonment_rate = float(abandonments / checkout_entrants) if checkout_entrants > 0 else 0.0
    
    return {
        "unique_visitors": unique_visitors,
        "conversion_rate": round(conversion_rate, 4),
        "queue_depth": queue_depth,
        "abandonment_rate": round(abandonment_rate, 4),
        "total_sales_inr": sum(tx.basket_value_inr for tx in today_tx)
    }
