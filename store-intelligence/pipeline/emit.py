import json
import uuid
import requests
from datetime import datetime
from typing import List, Dict, Any, Optional

class EventEmissionPipeline:
    """Emits serialised JSON retail events in batches conformant to raw API payload schemas."""
    def __init__(self, endpoint: str, store_id: str):
        self.endpoint = endpoint
        self.store_id = store_id
        self.batch_queue: List[Dict[str, Any]] = []
        
    def queue_event(self, visitor_id: str, camera_id: str, event_type: str, confidence: float, zone_id: Optional[str] = None):
        event = {
            "event_id": str(uuid.uuid4()),
            "store_id": self.store_id,
            "camera_id": camera_id,
            "visitor_id": visitor_id,
            "event_type": event_type,
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "zone_id": zone_id,
            "dwell_ms": 45000 if event_type == "ZONE_DWELL" else 0,
            "is_staff": False,
            "confidence": round(confidence, 2),
            "metadata": {
                "queue_depth": 0 if event_type == "BILLING_QUEUE_JOIN" else None,
                "session_seq": 1
            }
        }
        self.batch_queue.append(event)
        
        # Auto flush on boundary thresholds
        if len(self.batch_queue) >= 100:
            self.flush()
            
    def flush(self):
        if not self.batch_queue:
            return
            
        print(f"[*] Transacting {len(self.batch_queue)} events to ingest API endpoint: {self.endpoint}")
        try:
            res = requests.post(self.endpoint, json=self.batch_queue, headers={"Content-Type": "application/json"}, timeout=5)
            if res.status_code in (200, 207):
                print(f"[+] Ingestion batch processed successfully. Status: {res.status_code}")
                self.batch_queue.clear()
            else:
                print(f"[!] Warning: API rejected ingestion parameters. Return code: {res.status_code}")
        except Exception as e:
            print(f"[!] Target API unreachable: {e}. Preserving offline cache structures.")
