from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, List
from datetime import datetime

class EventMetadata(BaseModel):
    queue_depth: Optional[int] = Field(None, description="Depth of billing checkout line, populated for BILLING_QUEUE_JOIN")
    sku_zone: Optional[str] = Field(None, description="Detailed product catalog subsection label from store layout config")
    session_seq: int = Field(1, description="Sequential index of behavioral action during customer's store visit session")

class RetailEvent(BaseModel):
    event_id: str = Field(..., description="UUID-v4 globally unique identifier of this event")
    store_id: str = Field(..., description="Store location code matching store_layout definitions")
    camera_id: str = Field(..., description="Camera identifier that observed the individual")
    visitor_id: str = Field(..., description="Cross-reidentification session token assigned to specific individual")
    event_type: str = Field(..., description="ENTRY, EXIT, ZONE_ENTER, ZONE_EXIT, ZONE_DWELL, BILLING_QUEUE_JOIN, BILLING_QUEUE_ABANDON, REENTRY")
    timestamp: datetime = Field(..., description="ISO 8601 UTC timestamp of occurrence")
    zone_id: Optional[str] = Field(None, description="ID of zone or department. Null for general entry/exit events")
    dwell_ms: int = Field(0, description="Duration in zone. 0 for instantaneous threshold crosses")
    is_staff: bool = Field(False, description="Flag indicating if tracking target has been identified as store personnel")
    confidence: float = Field(0.90, description="Bounding box classification and tracker confidence rating")
    metadata: EventMetadata

class PosTransaction(BaseModel):
    store_id: str
    transaction_id: str
    timestamp: datetime
    basket_value_inr: float

class IngestResponse(BaseModel):
    status: str
    ingested_count: int
    skipped_duplicates: int
    errors: List[Dict[str, Any]] = []
