# System Architecture Design - Apex Retail Store Intelligence

This document outlines the end-to-end architecture of the **Apex Retail Store Intelligence Pipeline**, engineered to transform offline CCTV footage across 40 physical locations into real-time operational analytics and conversion funnels, bridging the business-critical retail data gap.

---

## 1. High-Level Architecture Overview

The system decompiles raw retail footage into actionable metrics through a sequence of five decoupled processing stages:

```
[ CCTV Stream ] ──> [ Yolov8 Detection Layer ] ──> [ ByteTrack Tracker (Re-ID) ]
                                                              │
[ Ingestion REST API ] <── [ In-flight Event Stream ] <───────┘
          │
          ├──> [ SQLite / In-Memory Analytics Warehouse ]
          │
          └──> [ Real-time Live Heatmap & Funnel Dashboard ]
```

1. **Computer Vision pipeline (`/pipeline`)**: Processes raw, anonymized video clips @ 15fps. Leverages a pre-trained **YOLOv8** model fine-tuned for high-overhead human patterns, coupled with **ByteTrack** for sub-pixel boundary spatial tracking and a distance-based trajectory heuristic for cross-camera re-identification (Re-ID).
2. **Event Schema & Ingestion Client**: Generates atomic JSON payloads tracking visitor entry, zone transition, queue joins, and exits. Batches events and transacts them via HTTPS POST to raw ingest pipelines.
3. **Store Intelligence REST API (`/app`)**: Built on high-performance FastAPI/Node.js serving endpoints that validate schema structures, block duplicate payloads via idempotency keys, and store raw states.
4. **Analytic Aggregators**: Computes metrics (unique session counts, temporal zone-dwell distributions, checkout queues, conversion drops) dynamically to maintain on-demand responsiveness.
5. **Interactive Dashboard & Alarms Panel**: Monitors live queue spikes, camera connectivity latency, and conversion trajectories to issue localized suggested recourse.

---

## 2. AI-Assisted Decisions

During the architectural phase, we leveraged LLM co-pilots in three key engineering decisions:

### Decision #1: Event Serialization (JSONL vs. Streaming Bus)
* **LLM Proposal**: Recommended initializing an Apache Kafka / RabbitMQ cluster to stream real-time events between the CV agents and the backend data store.
* **Our Evaluation (Override)**: We chose a lightweight, batch-based REST ingest gateway (`POST /events/ingest`) coupled with local database buffers instead.
* **Why**: Retail stores frequently encounter network latency variations. Restructuring our ingestion to utilize HTTP batches with explicit client-side caching ensures reliable delivery in offline-first scenarios, reducing infrastructure overhead and complexity.

### Decision #2: User Re-ID Representation (Feature Embeddings vs. Trajectory Heuristics)
* **LLM Proposal**: Recommended deploying a deep-learning ResNet-50 feature embedding extractor to generate 128-dimensional vectors for on-the-fly cosine similarity Re-ID.
* **Our Evaluation (Override)**: We overrode this suggestion in favor of a rule-based distance-trajectory spatial tracker coupled with time-gated boundaries.
* **Why**: CCTV footage is highly anonymized with full-face blur applied on high-ceiling wide-angles. Facial features are lost and clothing hues shift under varying store lighting. Spatial entry-exit zone trajectories and precise time gates are far more robust, computationally lightweight, and privacy-compliant.

### Decision #3: Session Conversion Matching Structure
* **LLM Proposal**: Suggested a complex outer probabilistic join correlating customer coordinates with checkout timestamps.
* **Our Evaluation (Agreement)**: We agreed with the recommendation to define conversions by a strict 5-minute sliding boundary prior to the POS transaction timestamp, matching the exact time-correlation constraint specified in the requirements. This approach ensures precise deterministic calculation of the North Star conversion rate without complex spatial joins that degrade performance under heavy traffic.

---

## 3. Operational Robustness & Graceful Degradation

* **Idempotence**: High-concurrency CCTV pipelines may retry deliveries. Every event is issued a client-side `event_id` UUID-v4. The `/events/ingest` endpoint utilizes internal indices to ignore previously processed UUIDs, ensuring transactional safety.
* **Degraded Operation**: If the analytical database warehouse goes offline, the REST API intercepts failures and downgrades to an in-memory fallback cache. All endpoints gracefully return structured JSON `HTTP 503 Service Unavailable` with `suggested_action` strings instead of throwing raw stack traces, maintaining API-contract compliance.
