from datetime import datetime, timedelta
from typing import List, Dict, Any
from app.metrics import compute_store_metrics
from app.ingestion import events_db

def detect_store_anomalies(store_id: str) -> List[Dict[str, Any]]:
    """
    Scans recent metrics to detect operational anomalies.
    Supported anomaly categories:
    1. QUEUE_SPIKE (High checkout build-up)
    2. CONVERSION_DROP (Conversion falling under historical averages)
    3. DEAD_ZONE (Operating hours without visitor movement)
    """
    anomalies = []
    now = datetime.utcnow()
    
    metrics = compute_store_metrics(store_id)
    
    # 1. QUEUE_SPIKE Check
    if metrics["queue_depth"] >= 5:
        anomalies.append({
            "anomaly_id": f"anom_q_{now.strftime('%H%M%S')}",
            "type": "QUEUE_SPIKE",
            "severity": "CRITICAL",
            "timestamp": now.isoformat() + "Z",
            "message": f"Critical checkout length detected. Bounding depth active count: {metrics['queue_depth']} shoppers.",
            "suggested_action": "Deploy additional personnel to auxiliary counters. Unlock backup cash registers."
        })
    elif metrics["queue_depth"] >= 3:
        anomalies.append({
            "anomaly_id": f"anom_q_{now.strftime('%H%M%S')}",
            "type": "QUEUE_SPIKE",
            "severity": "WARN",
            "timestamp": now.isoformat() + "Z",
            "message": f"Checkout line is thickening. Bounding depth active count: {metrics['queue_depth']} shoppers.",
            "suggested_action": "Alert hovering floor staff to stand-by near cashier counter."
        })
        
    # 2. CONVERSION_DROP Check
    # Compare with a mock 7-day average baseline threshold constant of 0.45
    baseline_rate = 0.48
    if metrics["unique_visitors"] >= 12:
        performance_ratio = metrics["conversion_rate"] / baseline_rate if baseline_rate > 0 else 1.0
        if performance_ratio < 0.65:
            anomalies.append({
                "anomaly_id": f"anom_c_{now.strftime('%H%M%S')}",
                "type": "CONVERSION_DROP",
                "severity": "WARN",
                "timestamp": now.isoformat() + "Z",
                "message": f"Conversion rate slipped sharply to {int(metrics['conversion_rate']*100)}% (compared to historic 7-day average rating of {int(baseline_rate*100)}%).",
                "suggested_action": "Trigger flash promotion discounts. Assess products on high-dwell departments for blockage."
            })
            
    # 3. DEAD_ZONE Check
    # No visitor transitions in the last 15 minutes during store operation
    fifteen_mins_ago = now - timedelta(minutes=15)
    recent_store_events = [
        e for e in events_db 
        if e.store_id == store_id and not e.is_staff and e.timestamp >= fifteen_mins_ago
    ]
    
    if len(recent_store_events) == 0:
        anomalies.append({
            "anomaly_id": f"anom_d_{now.strftime('%H%M%S')}",
            "type": "DEAD_ZONE",
            "severity": "INFO",
            "timestamp": now.isoformat() + "Z",
            "message": "Zero customer traffic mapped across spatial paths in the past 15 minutes.",
            "suggested_action": "Verify if store is open. Inspect camera hardware for video stream freeze issues."
        })
        
    return anomalies
