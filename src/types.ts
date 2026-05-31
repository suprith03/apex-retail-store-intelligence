export interface RetailEvent {
  event_id: string;
  store_id: string;
  camera_id: string;
  visitor_id: string;
  event_type: "ENTRY" | "EXIT" | "ZONE_ENTER" | "ZONE_EXIT" | "ZONE_DWELL" | "BILLING_QUEUE_JOIN" | "BILLING_QUEUE_ABANDON" | "REENTRY";
  timestamp: string;
  zone_id: string | null;
  dwell_ms: number;
  is_staff: boolean;
  confidence: number;
  metadata: {
    queue_depth: number | null;
    sku_zone?: string;
    session_seq: number;
  };
}

export interface StoreLayout {
  id: string;
  name: string;
  city: string;
  zones: string[];
  open_hours: string;
}

export interface StoreMetrics {
  unique_visitors: number;
  conversion_rate: number;
  conversion_count: number;
  total_transactions: number;
  avg_dwell_per_zone: Record<string, number>;
  queue_depth: number;
  abandonment_rate: number;
  total_sales_inr: number;
}

export interface FunnelStep {
  stage: string;
  count: number;
  percentage: number;
  drop_off_count: number;
  drop_off_percentage: number;
}

export interface StoreFunnel {
  store_id: string;
  total_sessions: number;
  funnel: FunnelStep[];
}

export interface HeatmapRecord {
  zone_id: string;
  visit_count: number;
  avg_dwell_seconds: number;
  density_score: number;
}

export interface StoreHeatmap {
  store_id: string;
  total_sessions_today: number;
  data_confidence: boolean;
  heatmap: HeatmapRecord[];
}

export interface StoreAnomaly {
  anomaly_id: string;
  type: "QUEUE_SPIKE" | "CONVERSION_DROP" | "DEAD_ZONE" | "STALE_CAMERA";
  severity: "INFO" | "WARN" | "CRITICAL";
  timestamp: string;
  message: string;
  suggested_action: string;
}

export interface ServerLog {
  timestamp: string;
  trace_id: string;
  store_id: string;
  endpoint: string;
  latency_ms: number;
  event_count: number;
  status_code: number;
  message?: string;
}
