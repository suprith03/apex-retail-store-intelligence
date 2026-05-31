#!/usr/bin/env bash
# Apex Retail - CCTV Pipeline Process Coordinator
# Executes CV models against raw store video feeds and posts results to Intel REST API

set -e

echo "=== Apex Retail Store Intelligence Pipeline ==="
echo "[*] Initialising edge ingestion stream players..."

# Setup default configurations
CLI_ENDPOINT_URL=${1:-"http://localhost:8000/events/ingest"}
VIDEO_DATA_DIR=${2:-"./clips"}
STORE_REF=${3:-"STORE_BLR_002"}

# Verify python deployment environment
if ! command -v python3 &> /dev/null
then
    echo "[!] Error: python3 runtime is absent. Install dependencies before running."
    exit 1
fi

echo "[*] Target API Server: $CLI_ENDPOINT_URL"
echo "[*] Raw clip assets cache directory: $VIDEO_DATA_DIR"
echo "[*] Core active store reference ID: $STORE_REF"

# Loop and run Yolov8 extraction on camera streams in target workspace
# 1. Doorway entry camera
echo "[*] Process #1 starting: Analyzing entry/exit thresholds..."
python3 detect.py \
    --vids-path "$VIDEO_DATA_DIR/entrance_camera.mp4" \
    --store-id "$STORE_REF" \
    --camera-id "CAM_ENTRY_01" \
    --export-endpoint "$CLI_ENDPOINT_URL"

# 2. Main floor camera
echo "[*] Process #2 starting: Surveying cosmetics & skincare zones..."
python3 detect.py \
    --vids-path "$VIDEO_DATA_DIR/floor_camera.mp4" \
    --store-id "$STORE_REF" \
    --camera-id "CAM_FLOOR_01" \
    --export-endpoint "$CLI_ENDPOINT_URL"

# 3. Cashier billing camera
echo "[*] Process #3 starting: Gauging checkout queues..."
python3 detect.py \
    --vids-path "$VIDEO_DATA_DIR/checkout_camera.mp4" \
    --store-id "$STORE_REF" \
    --camera-id "CAM_BILLING_01" \
    --export-endpoint "$CLI_ENDPOINT_URL"

echo "=== CCTV Processing Streams Terminated Successfully ==="
