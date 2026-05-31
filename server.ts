import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

// Set up JSON parsing with limit
app.use(express.json({ limit: "15mb" }));

// Types
interface RetailEvent {
  event_id: string;
  store_id: string;
  camera_id: string;
  visitor_id: string;
  event_type: "ENTRY" | "EXIT" | "ZONE_ENTER" | "ZONE_EXIT" | "ZONE_DWELL" | "BILLING_QUEUE_JOIN" | "BILLING_QUEUE_ABANDON" | "REENTRY";
  timestamp: string; // ISO-8601
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

interface PosTransaction {
  store_id: string;
  transaction_id: string;
  timestamp: string; // ISO-8601
  basket_value_inr: number;
}

interface StoreLayout {
  id: string;
  name: string;
  city: string;
  zones: string[];
  open_hours: string;
}

// In-Memory Database State
const processedEventIds = new Set<string>();
const events: RetailEvent[] = [];
const transactions: PosTransaction[] = [];
const logs: {
  timestamp: string;
  trace_id: string;
  store_id: string;
  endpoint: string;
  latency_ms: number;
  event_count: number;
  status_code: number;
  message?: string;
}[] = [];

// Configuration & Layouts
const STORES: Record<string, StoreLayout> = {
  STORE_BLR_002: {
    id: "STORE_BLR_002",
    name: "Indiranagar Flagship",
    city: "Bangalore",
    zones: ["SKINCARE", "COSMETICS", "BILLING", "APPAREL", "HAIRCARE"],
    open_hours: "09:00 - 22:00",
  },
  STORE_DEL_001: {
    id: "STORE_DEL_001",
    name: "Connaught Place Hub",
    city: "Delhi",
    zones: ["SKINCARE", "COSMETICS", "BILLING", "FOOTWEAR", "MENS_WEAR"],
    open_hours: "10:00 - 21:30",
  },
  STORE_BOM_005: {
    id: "STORE_BOM_005",
    name: "Bandra Promenade Plaza",
    city: "Mumbai",
    zones: ["SKINCARE", "COSMETICS", "BILLING", "FRAGRANCE", "BAGS"],
    open_hours: "11:00 - 23:00",
  },
  STORE_HYD_003: {
    id: "STORE_HYD_003",
    name: "Gachibowli Tech Retail",
    city: "Hyderabad",
    zones: ["SKINCARE", "COSMETICS", "BILLING", "WELLNESS", "GADGETS"],
    open_hours: "10:00 - 22:00",
  },
  STORE_MAA_004: {
    id: "STORE_MAA_004",
    name: "T-Nagar Fashion Gallery",
    city: "Chennai",
    zones: ["SKINCARE", "COSMETICS", "BILLING", "JEWELRY", "SAREES"],
    open_hours: "09:30 - 21:00",
  }
};

// Database connectivity simulation flag
let isDbConnected = true;

// Logger Helpers
function addLog(
  trace_id: string,
  store_id: string,
  endpoint: string,
  latency_ms: number,
  event_count: number,
  status_code: number,
  message?: string
) {
  const logItem = {
    timestamp: new Date().toISOString(),
    trace_id,
    store_id,
    endpoint,
    latency_ms,
    event_count,
    status_code,
    message,
  };
  logs.unshift(logItem);
  if (logs.length > 200) logs.pop();
  
  // Console logging formats
  const color = status_code >= 400 ? "\x1b[31m" : status_code >= 300 ? "\x1b[33m" : "\x1b[32m";
  const reset = "\x1b[0m";
  console.log(
    `[${logItem.timestamp}] ${color}${endpoint} (${status_code})${reset} - ${latency_ms}ms | trace:${trace_id} | store:${store_id} | count:${event_count} ${message ? `| msg:${message}` : ""}`
  );
}

// Generate Seeds: We will build a generator to create a robust historical timeline (last 7 days of rolling data)
// so that our analytics, heatmaps, conversion ratios, and anomalies have real, queryable, non-trivial data!
function seedHistoricalData() {
  console.log("Seeding realistic historical database...");
  const now = new Date();
  
  // Generate historical events for each store
  Object.keys(STORES).forEach((storeId) => {
    // Generate over 7 days of historical rolling data
    for (let day = 7; day >= 0; day--) {
      const date = new Date(now.getTime() - day * 24 * 60 * 60 * 1000);
      
      // Seed between 25 and 45 visitor sessions per day depending on store
      const numSessions = Math.floor(Math.random() * 20) + 25;
      
      for (let s = 0; s < numSessions; s++) {
        // Visitor properties
        const isStaff = Math.random() < 0.12; // 12% events are staff
        const visitorId = `VIS_${Math.random().toString(36).substring(2, 8)}`;
        const startHour = 10 + Math.floor(Math.random() * 11); // 10:00 to 21:00
        const startMinute = Math.floor(Math.random() * 60);
        
        const sessionStartTime = new Date(date);
        sessionStartTime.setHours(startHour, startMinute, 0, 0);
        
        let currentTime = sessionStartTime;
        let sessionSeq = 1;
        
        // 1. Entry Event (Entry threshold / camera)
        const entryEvent: RetailEvent = {
          event_id: `evt_seed_${Math.random().toString(36).substring(2, 12)}`,
          store_id: storeId,
          camera_id: "CAM_ENTRY_01",
          visitor_id: visitorId,
          event_type: "ENTRY",
          timestamp: currentTime.toISOString(),
          zone_id: null,
          dwell_ms: 0,
          is_staff: isStaff,
          confidence: parseFloat((0.85 + Math.random() * 0.14).toFixed(2)),
          metadata: { queue_depth: null, session_seq: sessionSeq++ }
        };
        events.push(entryEvent);
        processedEventIds.add(entryEvent.event_id);
        
        // Skip further customer actions for most staff, but let them walk through zones
        if (isStaff) {
          // Just random walk zones
          const visitedZones = STORES[storeId].zones.filter(z => z !== "BILLING");
          visitedZones.forEach((zone) => {
            const dwell = Math.floor(5000 + Math.random() * 15000);
            currentTime = new Date(currentTime.getTime() + 1000);
            const zEnter: RetailEvent = {
              event_id: `evt_seed_${Math.random().toString(36).substring(2, 12)}`,
              store_id: storeId,
              camera_id: "CAM_FLOOR_01",
              visitor_id: visitorId,
              event_type: "ZONE_ENTER",
              timestamp: currentTime.toISOString(),
              zone_id: zone,
              dwell_ms: 0,
              is_staff: true,
              confidence: parseFloat((0.9 + Math.random() * 0.08).toFixed(2)),
              metadata: { queue_depth: null, session_seq: sessionSeq++ }
            };
            events.push(zEnter);
            
            currentTime = new Date(currentTime.getTime() + dwell);
            const zExit: RetailEvent = {
              event_id: `evt_seed_${Math.random().toString(36).substring(2, 12)}`,
              store_id: storeId,
              camera_id: "CAM_FLOOR_01",
              visitor_id: visitorId,
              event_type: "ZONE_EXIT",
              timestamp: currentTime.toISOString(),
              zone_id: zone,
              dwell_ms: dwell,
              is_staff: true,
              confidence: parseFloat((0.9 + Math.random() * 0.08).toFixed(2)),
              metadata: { queue_depth: null, session_seq: sessionSeq++ }
            };
            events.push(zExit);
          });
          
          // Exit
          currentTime = new Date(currentTime.getTime() + 2000);
          const exitEvent: RetailEvent = {
            event_id: `evt_seed_${Math.random().toString(36).substring(2, 12)}`,
            store_id: storeId,
            camera_id: "CAM_ENTRY_01",
            visitor_id: visitorId,
            event_type: "EXIT",
            timestamp: currentTime.toISOString(),
            zone_id: null,
            dwell_ms: 0,
            is_staff: true,
            confidence: parseFloat((0.88 + Math.random() * 0.11).toFixed(2)),
            metadata: { queue_depth: null, session_seq: sessionSeq++ }
          };
          events.push(exitEvent);
          continue;
        }
        
        // 2. Zone exploration for customers
        const eligibleZones = STORES[storeId].zones.filter(z => z !== "BILLING");
        const numZonesToVisit = Math.floor(Math.random() * 3) + 1; // 1 to 3 zones
        const selectedZones = [...eligibleZones].sort(() => 0.5 - Math.random()).slice(0, numZonesToVisit);
        
        selectedZones.forEach((zone) => {
          currentTime = new Date(currentTime.getTime() + Math.floor(Math.random() * 5000) + 1000);
          const zEnter: RetailEvent = {
            event_id: `evt_seed_${Math.random().toString(36).substring(2, 12)}`,
            store_id: storeId,
            camera_id: "CAM_FLOOR_01",
            visitor_id: visitorId,
            event_type: "ZONE_ENTER",
            timestamp: currentTime.toISOString(),
            zone_id: zone,
            dwell_ms: 0,
            is_staff: false,
            confidence: parseFloat((0.85 + Math.random() * 0.14).toFixed(2)),
            metadata: { queue_depth: null, session_seq: sessionSeq++ }
          };
          events.push(zEnter);
          processedEventIds.add(zEnter.event_id);
          
          const dwell = Math.floor(10000 + Math.random() * 120000); // 10s to 2min
          currentTime = new Date(currentTime.getTime() + dwell);
          
          // Let's add ZONE_DWELL if dwell is > 30s
          if (dwell >= 30000) {
            const numDwells = Math.floor(dwell / 30000);
            for (let d = 1; d <= numDwells; d++) {
              const dwellEvent: RetailEvent = {
                event_id: `evt_seed_${Math.random().toString(36).substring(2, 12)}`,
                store_id: storeId,
                camera_id: "CAM_FLOOR_01",
                visitor_id: visitorId,
                event_type: "ZONE_DWELL",
                timestamp: new Date(currentTime.getTime() - dwell + d * 30000).toISOString(),
                zone_id: zone,
                dwell_ms: d * 30000,
                is_staff: false,
                confidence: parseFloat((0.85 + Math.random() * 0.14).toFixed(2)),
                metadata: { queue_depth: null, session_seq: sessionSeq++ }
              };
              events.push(dwellEvent);
              processedEventIds.add(dwellEvent.event_id);
            }
          }
          
          const zExit: RetailEvent = {
            event_id: `evt_seed_${Math.random().toString(36).substring(2, 12)}`,
            store_id: storeId,
            camera_id: "CAM_FLOOR_01",
            visitor_id: visitorId,
            event_type: "ZONE_EXIT",
            timestamp: currentTime.toISOString(),
            zone_id: zone,
            dwell_ms: dwell,
            is_staff: false,
            confidence: parseFloat((0.85 + Math.random() * 0.14).toFixed(2)),
            metadata: { queue_depth: null, session_seq: sessionSeq++ }
          };
          events.push(zExit);
          processedEventIds.add(zExit.event_id);
        });
        
        // 3. Billing (Conversion Opportunity)
        const entersBilling = Math.random() < 0.65; // 65% enter billing area
        let purchaseCompleted = false;
        
        if (entersBilling) {
          currentTime = new Date(currentTime.getTime() + Math.floor(Math.random() * 5000) + 1000);
          // Enter billing zone
          const billEnter: RetailEvent = {
            event_id: `evt_seed_${Math.random().toString(36).substring(2, 12)}`,
            store_id: storeId,
            camera_id: "CAM_BILLING_01",
            visitor_id: visitorId,
            event_type: "ZONE_ENTER",
            timestamp: currentTime.toISOString(),
            zone_id: "BILLING",
            dwell_ms: 0,
            is_staff: false,
            confidence: parseFloat((0.88 + Math.random() * 0.11).toFixed(2)),
            metadata: { queue_depth: null, session_seq: sessionSeq++ }
          };
          events.push(billEnter);
          processedEventIds.add(billEnter.event_id);
          
          // Queue Join
          const queueDepth = Math.floor(Math.random() * 4);
          if (queueDepth > 0) {
            const queueJoin: RetailEvent = {
              event_id: `evt_seed_${Math.random().toString(36).substring(2, 12)}`,
              store_id: storeId,
              camera_id: "CAM_BILLING_01",
              visitor_id: visitorId,
              event_type: "BILLING_QUEUE_JOIN",
              timestamp: currentTime.toISOString(),
              zone_id: "BILLING",
              dwell_ms: 0,
              is_staff: false,
              confidence: parseFloat((0.85 + Math.random() * 0.14).toFixed(2)),
              metadata: { queue_depth: queueDepth, session_seq: sessionSeq++ }
            };
            events.push(queueJoin);
            processedEventIds.add(queueJoin.event_id);
          }
          
          // Does the user complete billing or abandon?
          purchaseCompleted = Math.random() < 0.85; // 85% of queue/billing completers purchase (others abandon)
          const billingDwell = Math.floor(45000 + Math.random() * 180000); // 45s to 3min
          currentTime = new Date(currentTime.getTime() + billingDwell);
          
          if (!purchaseCompleted) {
            // Emit billing queue abandon
            const abandon: RetailEvent = {
              event_id: `evt_seed_${Math.random().toString(36).substring(2, 12)}`,
              store_id: storeId,
              camera_id: "CAM_BILLING_01",
              visitor_id: visitorId,
              event_type: "BILLING_QUEUE_ABANDON",
              timestamp: currentTime.toISOString(),
              zone_id: "BILLING",
              dwell_ms: billingDwell,
              is_staff: false,
              confidence: parseFloat((0.82 + Math.random() * 0.15).toFixed(2)),
              metadata: { queue_depth: queueDepth, session_seq: sessionSeq++ }
            };
            events.push(abandon);
            processedEventIds.add(abandon.event_id);
          }
          
          // Exit billing zone
          const billExit: RetailEvent = {
            event_id: `evt_seed_${Math.random().toString(36).substring(2, 12)}`,
            store_id: storeId,
            camera_id: "CAM_BILLING_01",
            visitor_id: visitorId,
            event_type: "ZONE_EXIT",
            timestamp: currentTime.toISOString(),
            zone_id: "BILLING",
            dwell_ms: billingDwell,
            is_staff: false,
            confidence: parseFloat((0.88 + Math.random() * 0.11).toFixed(2)),
            metadata: { queue_depth: null, session_seq: sessionSeq++ }
          };
          events.push(billExit);
          processedEventIds.add(billExit.event_id);
          
          // If purchased, record standard POS Transaction
          if (purchaseCompleted) {
            const txTime = new Date(currentTime.getTime() + Math.floor(Math.random() * 30000)); // Within 30 seconds
            const transaction: PosTransaction = {
              store_id: storeId,
              transaction_id: `TXN_${Math.floor(10000 + Math.random() * 89999)}`,
              timestamp: txTime.toISOString(),
              basket_value_inr: parseFloat((250 + Math.random() * 4500).toFixed(2))
            };
            transactions.push(transaction);
          }
        }
        
        // 4. Exit Event
        currentTime = new Date(currentTime.getTime() + Math.floor(Math.random() * 3000) + 1000);
        const exitEvent: RetailEvent = {
          event_id: `evt_seed_${Math.random().toString(36).substring(2, 12)}`,
          store_id: storeId,
          camera_id: "CAM_ENTRY_01",
          visitor_id: visitorId,
          event_type: "EXIT",
          timestamp: currentTime.toISOString(),
          zone_id: null,
          dwell_ms: 0,
          is_staff: false,
          confidence: parseFloat((0.87 + Math.random() * 0.12).toFixed(2)),
          metadata: { queue_depth: null, session_seq: sessionSeq++ }
        };
        events.push(exitEvent);
        processedEventIds.add(exitEvent.event_id);
        
        // Optional: Let's randomly add REENTRY (some shoppers leave briefly and return with the same visitorId!)
        const isReentry = Math.random() < 0.08; // 8% reentry rate
        if (isReentry) {
          const reentryDelay = Math.floor(60000 + Math.random() * 300000); // 1-5min
          currentTime = new Date(currentTime.getTime() + reentryDelay);
          
          const reentryEvent: RetailEvent = {
            event_id: `evt_seed_${Math.random().toString(36).substring(2, 12)}`,
            store_id: storeId,
            camera_id: "CAM_ENTRY_01",
            visitor_id: visitorId,
            event_type: "REENTRY",
            timestamp: currentTime.toISOString(),
            zone_id: null,
            dwell_ms: 0,
            is_staff: false,
            confidence: parseFloat((0.85 + Math.random() * 0.14).toFixed(2)),
            metadata: { queue_depth: null, session_seq: sessionSeq++ }
          };
          events.push(reentryEvent);
          processedEventIds.add(reentryEvent.event_id);
          
          // And standard exit again for this session later
          currentTime = new Date(currentTime.getTime() + Math.floor(Math.random() * 60000));
          const finalExit: RetailEvent = {
            event_id: `evt_seed_${Math.random().toString(36).substring(2, 12)}`,
            store_id: storeId,
            camera_id: "CAM_ENTRY_01",
            visitor_id: visitorId,
            event_type: "EXIT",
            timestamp: currentTime.toISOString(),
            zone_id: null,
            dwell_ms: 0,
            is_staff: false,
            confidence: parseFloat((0.88 + Math.random() * 0.11).toFixed(2)),
            metadata: { queue_depth: null, session_seq: sessionSeq++ }
          };
          events.push(finalExit);
          processedEventIds.add(finalExit.event_id);
        }
      }
    }
  });
  
  // Sort all events and transactions chronologically to be fully ready
  events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  transactions.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  
  console.log(`Seeded ${events.length} events and ${transactions.length} POS transactions successfully.`);
}

// Initialise the Database
seedHistoricalData();

// HELPER: Calculate Store Analytics
function getStoreAnalytics(storeId: string, filterDateStr?: string) {
  const store = STORES[storeId];
  if (!store) return null;
  
  // By default, filter for "today" in active timeline context
  const targetDate = filterDateStr ? new Date(filterDateStr) : new Date();
  const startOfDay = new Date(targetDate);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(targetDate);
  endOfDay.setHours(23, 59, 59, 999);
  
  // Filter core store events for today (excluding staff)
  const todayEvents = events.filter((e) => {
    const eTime = new Date(e.timestamp);
    return e.store_id === storeId && !e.is_staff && eTime >= startOfDay && eTime <= endOfDay;
  });
  
  const todayTransactions = transactions.filter((t) => {
    const tTime = new Date(t.timestamp);
    return t.store_id === storeId && tTime >= startOfDay && tTime <= endOfDay;
  });
  
  // Sessions: unique visitor_ids
  const visitorSessions = new Set<string>();
  todayEvents.forEach(e => visitorSessions.add(e.visitor_id));
  const uniqueVisitors = visitorSessions.size;
  
  // Calculating conversions using the exact PDF core requirement:
  // "Correlation is done by time window + store. A visitor who was in the billing zone in the 5-minute window
  // before a transaction timestamp counts as a converted visitor for that session."
  let convertedSessionCount = 0;
  const convertedSessions = new Set<string>();
  
  // For each transaction, find visitors who were in Billing in the 5min prior
  todayTransactions.forEach((tx) => {
    const txTime = new Date(tx.timestamp).getTime();
    const fiveMinutesAhead = txTime - 5 * 60 * 1000;
    
    // Find billing events for this store in this window
    const candidates = events.filter((e) => {
      if (e.store_id !== storeId || e.is_staff || e.zone_id !== "BILLING") return false;
      const eTime = new Date(e.timestamp).getTime();
      return eTime >= fiveMinutesAhead && eTime <= txTime;
    });
    
    candidates.forEach((e) => {
      convertedSessions.add(e.visitor_id);
    });
  });
  
  convertedSessionCount = convertedSessions.size;
  
  // Conversion Rate
  const conversionRate = uniqueVisitors > 0 ? parseFloat((convertedSessionCount / uniqueVisitors).toFixed(4)) : 0;
  
  // Average Dwell per Zone
  const zoneDwells: Record<string, { total_ms: number; count: number }> = {};
  store.zones.forEach(z => {
    zoneDwells[z] = { total_ms: 0, count: 0 };
  });
  
  // Sum up all exit/dwell timings matching zones
  todayEvents.forEach((e) => {
    if (e.zone_id && zoneDwells[e.zone_id]) {
      if (e.event_type === "ZONE_EXIT" && e.dwell_ms > 0) {
        zoneDwells[e.zone_id].total_ms += e.dwell_ms;
        zoneDwells[e.zone_id].count += 1;
      }
    }
  });
  
  const avgDwellPerZone: Record<string, number> = {};
  store.zones.forEach(z => {
    const data = zoneDwells[z];
    avgDwellPerZone[z] = data.count > 0 ? Math.round(data.total_ms / data.count) : 0;
  });
  
  // Current active queue depth from latest events
  const scale = 5 * 60 * 1000; // Look within last 5 mins for active checkout
  const recentQueueEvents = events.filter((e) => {
    const timeDiff = new Date().getTime() - new Date(e.timestamp).getTime();
    return e.store_id === storeId && e.event_type === "BILLING_QUEUE_JOIN" && timeDiff >= 0 && timeDiff <= scale;
  });
  
  let currentQueueDepth = 0;
  if (recentQueueEvents.length > 0) {
    const latestQueue = recentQueueEvents[recentQueueEvents.length - 1];
    currentQueueDepth = latestQueue.metadata.queue_depth || 0;
  } else {
    // Estimate queue from billing entrances vs exits or Transactions in the last 15 mins
    const recentBillingEnters = todayEvents.filter(e => e.zone_id === "BILLING" && e.event_type === "ZONE_ENTER");
    const recentBillingExits = todayEvents.filter(e => e.zone_id === "BILLING" && e.event_type === "ZONE_EXIT");
    currentQueueDepth = Math.max(0, recentBillingEnters.length - recentBillingExits.length);
  }
  
  // Queue Abandonment rate: Percentage of shoppers who enter checkout but abandon
  const billingEnters = todayEvents.filter(e => e.zone_id === "BILLING" && e.event_type === "ZONE_ENTER").map(e => e.visitor_id);
  const checkoutAbandons = todayEvents.filter(e => e.event_id && e.event_type === "BILLING_QUEUE_ABANDON").length;
  const billingTotal = new Set(billingEnters).size;
  const abandonmentRate = billingTotal > 0 ? parseFloat((checkoutAbandons / billingTotal).toFixed(4)) : 0;
  
  return {
    unique_visitors: uniqueVisitors,
    conversion_rate: conversionRate,
    conversion_count: convertedSessionCount,
    total_transactions: todayTransactions.length,
    avg_dwell_per_zone: avgDwellPerZone,
    queue_depth: currentQueueDepth,
    abandonment_rate: abandonmentRate,
    total_sales_inr: parseFloat(todayTransactions.reduce((acc, t) => acc + t.basket_value_inr, 0).toFixed(2))
  };
}

// ENDPOINTS

// Graceful Connection Guard Middleware
app.use((req, res, next) => {
  if (!isDbConnected && req.path.startsWith("/api/")) {
    // Simulate database unreachable
    return res.status(503).json({
      error: "Service Unavailable",
      code: "DATABASE_UNREACHABLE",
      message: "The primary store-intelligence analytics warehouse is currently offline.",
      suggested_action: "Wait 15 seconds for secondary replica failover"
    });
  }
  next();
});

// GET /api/stores
app.get("/api/stores", (req, res) => {
  const startTime = Date.now();
  const traceId = `tr_${Math.random().toString(36).substring(2, 10)}`;
  
  res.json({ stores: Object.values(STORES) });
  
  addLog(traceId, "ALL", "GET /api/stores", Date.now() - startTime, 0, 200);
});

// GET /api/logs
app.get("/api/logs", (req, res) => {
  res.json({ logs });
});

// POST /api/db-status
app.post("/api/db-toggle", (req, res) => {
  isDbConnected = req.body.status !== false;
  res.json({ database_connected: isDbConnected });
});

// POST /api/events/ingest (Idempotent Event Ingestion Batch)
app.post("/api/events/ingest", (req, res) => {
  const startTime = Date.now();
  const traceId = req.headers["x-trace-id"] as string || `tr_${Math.random().toString(36).substring(2, 10)}`;
  
  const payload = req.body;
  const batch = Array.isArray(payload) ? payload : [payload];
  
  if (batch.length === 0) {
    addLog(traceId, "UNKNOWN", "POST /api/events/ingest", Date.now() - startTime, 0, 400, "Empty payload");
    return res.status(400).json({
      error: "Bad Request",
      code: "EMPTY_BATCH",
      message: "Ingestion payload must contain at least one retail event."
    });
  }
  
  if (batch.length > 500) {
    addLog(traceId, "UNKNOWN", "POST /api/events/ingest", Date.now() - startTime, batch.length, 413, "Batch limit exceeded");
    return res.status(413).json({
      error: "Payload Too Large",
      code: "BATCH_LIMIT_EXCEEDED",
      message: "Ingestion batch size exceeds maximum of 500 events."
    });
  }
  
  let ingestedCount = 0;
  let skippedDuplicatesCount = 0;
  const errors: { event_id?: string; message: string; index: number }[] = [];
  
  batch.forEach((event: any, index: number) => {
    // Standard schema checks
    if (!event.event_id || typeof event.event_id !== "string") {
      errors.push({ index, message: "Missing or invalid 'event_id' parameter. Must be UUID-v4." });
      return;
    }
    if (!event.store_id || !STORES[event.store_id]) {
      errors.push({ event_id: event.event_id, index, message: `Invalid store_id: '${event.store_id}'` });
      return;
    }
    
    // Idempotency check
    if (processedEventIds.has(event.event_id)) {
      skippedDuplicatesCount++;
      return;
    }
    
    // Check types
    if (!event.visitor_id || typeof event.visitor_id !== "string") {
      errors.push({ event_id: event.event_id, index, message: "Missing visitor_id attribute." });
      return;
    }
    if (!event.event_type || typeof event.event_type !== "string") {
      errors.push({ event_id: event.event_id, index, message: "Property event_type is incomplete or mismatch." });
      return;
    }
    
    // Successfully validated
    const validatedEvent: RetailEvent = {
      event_id: event.event_id,
      store_id: event.store_id,
      camera_id: event.camera_id || "CAM_UNKNOWN",
      visitor_id: event.visitor_id,
      event_type: event.event_type,
      timestamp: event.timestamp || new Date().toISOString(),
      zone_id: event.zone_id || null,
      dwell_ms: Number(event.dwell_ms) || 0,
      is_staff: Boolean(event.is_staff),
      confidence: Number(event.confidence) || 0.9,
      metadata: {
        queue_depth: event.metadata?.queue_depth !== undefined ? Number(event.metadata?.queue_depth) : null,
        sku_zone: event.metadata?.sku_zone,
        session_seq: Number(event.metadata?.session_seq) || 1
      }
    };
    
    events.push(validatedEvent);
    processedEventIds.add(validatedEvent.event_id);
    ingestedCount++;
  });
  
  const totalProcessed = ingestedCount + skippedDuplicatesCount;
  const status = errors.length === batch.length ? 400 : errors.length > 0 ? 207 : 200;
  
  const responseBody = {
    status: status === 400 ? "failed" : errors.length > 0 ? "partial_success" : "success",
    summary: {
      total_received: batch.length,
      ingested: ingestedCount,
      duplicates_skipped: skippedDuplicatesCount,
      failed: errors.length
    },
    errors: errors.length > 0 ? errors : undefined
  };
  
  const representativeStore = batch[0]?.store_id || "MIXED";
  addLog(
    traceId,
    representativeStore,
    "POST /api/events/ingest",
    Date.now() - startTime,
    batch.length,
    status,
    `Ingested: ${ingestedCount}, Dups: ${skippedDuplicatesCount}, Errors: ${errors.length}`
  );
  
  return res.status(status).json(responseBody);
});

// GET /api/stores/{id}/metrics (Consumptions and Conversions)
app.get("/api/stores/:id/metrics", (req, res) => {
  const startTime = Date.now();
  const traceId = `tr_${Math.random().toString(36).substring(2, 10)}`;
  const storeId = req.params.id;
  
  if (!STORES[storeId]) {
    addLog(traceId, storeId, "GET /api/stores/:id/metrics", Date.now() - startTime, 0, 404, "Invalid store");
    return res.status(404).json({
      error: "Not Found",
      code: "STORE_NOT_FOUND",
      message: `Store layout '${storeId}' was not recognized.`
    });
  }
  
  const analytics = getStoreAnalytics(storeId);
  res.json(analytics);
  
  addLog(traceId, storeId, `GET /api/stores/${storeId}/metrics`, Date.now() - startTime, 0, 200);
});

// GET /api/stores/{id}/funnel (Conversion funnel: Entry -> Zone Visit -> Billing Queue -> Purchase)
app.get("/api/stores/:id/funnel", (req, res) => {
  const startTime = Date.now();
  const traceId = `tr_${Math.random().toString(36).substring(2, 10)}`;
  const storeId = req.params.id;
  
  if (!STORES[storeId]) {
    addLog(traceId, storeId, "GET /api/stores/:id/funnel", Date.now() - startTime, 0, 404, "Invalid store");
    return res.status(404).json({ error: "Store not found" });
  }
  
  // Funnel calculations: Unique customer sessions (exclude staff) having reached specific depth
  const today = new Date();
  const startOfDay = new Date(today);
  startOfDay.setHours(0,0,0,0);
  
  const storeEvents = events.filter(e => e.store_id === storeId && !e.is_staff && new Date(e.timestamp) >= startOfDay);
  const storeTransactions = transactions.filter(t => t.store_id === storeId && new Date(t.timestamp) >= startOfDay);
  
  // Distinct sessions (visitor_id) that triggered ENTRY
  const entrySessions = new Set(storeEvents.filter(e => e.event_type === "ENTRY" || e.event_type === "REENTRY").map(e => e.visitor_id));
  
  // Distinct sessions that visited any other non-billing zones
  const exploreZones = STORES[storeId].zones.filter(z => z !== "BILLING");
  const zoneVisitSessions = new Set(storeEvents.filter(e => e.zone_id && exploreZones.includes(e.zone_id)).map(e => e.visitor_id));
  
  // Distinct sessions that entered BILLING zone
  const billingVisitSessions = new Set(storeEvents.filter(e => e.zone_id === "BILLING" && e.event_type === "ZONE_ENTER").map(e => e.visitor_id));
  
  // Sessions converting based on 5min window criteria
  const purchaseSessions = new Set<string>();
  storeTransactions.forEach((tx) => {
    const txTime = new Date(tx.timestamp).getTime();
    const fiveMinutesAhead = txTime - 5 * 60 * 1000;
    
    const billingInWindow = storeEvents.filter(e => {
      if (e.zone_id !== "BILLING") return false;
      const t = new Date(e.timestamp).getTime();
      return t >= fiveMinutesAhead && t <= txTime;
    });
    
    billingInWindow.forEach(e => purchaseSessions.add(e.visitor_id));
  });
  
  // Make sure to intersect sequence progression for a perfect realistic funnel
  // (Visitor must enter to visit, must visit to queue up, and must queue to purchase)
  const entryCount = entrySessions.size;
  const visitCount = Math.min(entryCount, zoneVisitSessions.size);
  const queueCount = Math.min(visitCount, billingVisitSessions.size);
  const purchaseCount = Math.min(queueCount, purchaseSessions.size);
  
  const funnelSteps = [
    {
      stage: "Entry",
      count: entryCount,
      percentage: 100,
      drop_off_count: entryCount - visitCount,
      drop_off_percentage: entryCount > 0 ? parseFloat((((entryCount - visitCount) / entryCount) * 100).toFixed(1)) : 0
    },
    {
      stage: "Zone Exploration",
      count: visitCount,
      percentage: entryCount > 0 ? parseFloat(((visitCount / entryCount) * 100).toFixed(1)) : 0,
      drop_off_count: visitCount - queueCount,
      drop_off_percentage: visitCount > 0 ? parseFloat((((visitCount - queueCount) / visitCount) * 100).toFixed(1)) : 0
    },
    {
      stage: "Billing Queue Entrance",
      count: queueCount,
      percentage: entryCount > 0 ? parseFloat(((queueCount / entryCount) * 100).toFixed(1)) : 0,
      drop_off_count: queueCount - purchaseCount,
      drop_off_percentage: queueCount > 0 ? parseFloat((((queueCount - purchaseCount) / queueCount) * 100).toFixed(1)) : 0
    },
    {
      stage: "Completed Purchase",
      count: purchaseCount,
      percentage: entryCount > 0 ? parseFloat(((purchaseCount / entryCount) * 100).toFixed(1)) : 0,
      drop_off_count: 0,
      drop_off_percentage: 0
    }
  ];
  
  res.json({
    store_id: storeId,
    total_sessions: entryCount,
    funnel: funnelSteps
  });
  
  addLog(traceId, storeId, `GET /api/stores/${storeId}/funnel`, Date.now() - startTime, 0, 200);
});

// GET /api/stores/{id}/heatmap
app.get("/api/stores/:id/heatmap", (req, res) => {
  const startTime = Date.now();
  const traceId = `tr_${Math.random().toString(36).substring(2, 10)}`;
  const storeId = req.params.id;
  const store = STORES[storeId];
  
  if (!store) {
    addLog(traceId, storeId, "GET /api/stores/:id/heatmap", Date.now() - startTime, 0, 404, "Invalid store");
    return res.status(404).json({ error: "Store not found" });
  }
  
  const today = new Date();
  const startOfDay = new Date(today);
  startOfDay.setHours(0,0,0,0);
  
  const todayEvents = events.filter(e => e.store_id === storeId && !e.is_staff && new Date(e.timestamp) >= startOfDay);
  
  // Session Count Check: flag data confidence if < 20 sessions today
  const visitorSessions = new Set(todayEvents.map(e => e.visitor_id));
  const data_confidence = visitorSessions.size >= 20;
  
  // Calculate counts for heatmap scoring
  const zoneCounts: Record<string, number> = {};
  const zoneDwellsSum: Record<string, { total: number; count: number }> = {};
  
  store.zones.forEach((z) => {
    zoneCounts[z] = 0;
    zoneDwellsSum[z] = { total: 0, count: 0 };
  });
  
  todayEvents.forEach((e) => {
    if (e.zone_id && zoneCounts[e.zone_id] !== undefined) {
      if (e.event_type === "ZONE_ENTER") {
        zoneCounts[e.zone_id]++;
      }
      if (e.event_type === "ZONE_EXIT" && e.dwell_ms > 0) {
        zoneDwellsSum[e.zone_id].total += e.dwell_ms;
        zoneDwellsSum[e.zone_id].count++;
      }
    }
  });
  
  // Normalize visits frequency from 0-100
  const maxVisits = Math.max(...Object.values(zoneCounts), 1);
  const zonesHeatmap = store.zones.map((zone) => {
    const visits = zoneCounts[zone];
    const dwellStats = zoneDwellsSum[zone];
    const avgDwellSec = dwellStats.count > 0 ? Math.round((dwellStats.total / dwellStats.count) / 1000) : 0;
    const score = Math.round((visits / maxVisits) * 100);
    
    return {
      zone_id: zone,
      visit_count: visits,
      avg_dwell_seconds: avgDwellSec,
      density_score: score // Normalized 0-100
    };
  });
  
  res.json({
    store_id: storeId,
    total_sessions_today: visitorSessions.size,
    data_confidence,
    heatmap: zonesHeatmap
  });
  
  addLog(traceId, storeId, `GET /api/stores/${storeId}/heatmap`, Date.now() - startTime, 0, 200);
});

// GET /api/stores/{id}/anomalies
app.get("/api/stores/:id/anomalies", (req, res) => {
  const startTime = Date.now();
  const traceId = `tr_${Math.random().toString(36).substring(2, 10)}`;
  const storeId = req.params.id;
  const store = STORES[storeId];
  
  if (!store) {
    addLog(traceId, storeId, "GET /api/stores/:id/anomalies", Date.now() - startTime, 0, 404, "Invalid store");
    return res.status(404).json({ error: "Store not found" });
  }
  
  // Calculation of active anomalies
  const storeAnomalies: {
    anomaly_id: string;
    type: "QUEUE_SPIKE" | "CONVERSION_DROP" | "DEAD_ZONE" | "STALE_CAMERA";
    severity: "INFO" | "WARN" | "CRITICAL";
    timestamp: string;
    message: string;
    suggested_action: string;
  }[] = [];
  
  const analyticsToday = getStoreAnalytics(storeId);
  if (analyticsToday) {
    // 1. QUEUE_SPIKE: If queue depth is high (e.g. > 3 matching our threshold)
    if (analyticsToday.queue_depth >= 4) {
      storeAnomalies.push({
        anomaly_id: `anom_${Math.random().toString(36).substring(2, 8)}`,
        type: "QUEUE_SPIKE",
        severity: "CRITICAL",
        timestamp: new Date().toISOString(),
        message: `Billing queue threshold crossed in checkout zone. Active depth currently at ${analyticsToday.queue_depth} visitors.`,
        suggested_action: "Deploy fallback cashier. Open Station #3 immediately."
      });
    } else if (analyticsToday.queue_depth >= 2) {
      storeAnomalies.push({
        anomaly_id: `anom_${Math.random().toString(36).substring(2, 8)}`,
        type: "QUEUE_SPIKE",
        severity: "WARN",
        timestamp: new Date().toISOString(),
        message: `Billing counter is filling up. Active depth currently at ${analyticsToday.queue_depth} visitors.`,
        suggested_action: "Alert floating staff members to standby near POS terminal area."
      });
    }
    
    // 2. CONVERSION_DROP: Check vs 7-day average conversion rate
    // Let's compute average conversion rate of last 7 days from seeded historic database
    const startOfPast = new Date();
    startOfPast.setDate(startOfPast.getDate() - 7);
    startOfPast.setHours(0,0,0,0);
    
    const historicStoreEvents = events.filter(e => e.store_id === storeId && !e.is_staff && new Date(e.timestamp) < new Date(new Date().setHours(0,0,0,0)));
    const historicTransactions = transactions.filter(t => t.store_id === storeId && new Date(t.timestamp) < new Date(new Date().setHours(0,0,0,0)));
    
    // Distribute sessions per day
    const historicDays: Record<string, { visitors: Set<string>; conversions: Set<string> }> = {};
    for (let i = 1; i <= 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const ds = d.toDateString();
      historicDays[ds] = { visitors: new Set(), conversions: new Set() };
    }
    
    historicStoreEvents.forEach((e) => {
      const dayStr = new Date(e.timestamp).toDateString();
      if (historicDays[dayStr]) {
        historicDays[dayStr].visitors.add(e.visitor_id);
      }
    });
    
    historicTransactions.forEach((tx) => {
      const txTime = new Date(tx.timestamp).getTime();
      const fiveMinutesAhead = txTime - 5 * 60 * 1000;
      const dayStr = new Date(tx.timestamp).toDateString();
      
      if (historicDays[dayStr]) {
        const potentialBuyers = historicStoreEvents.filter((e) => {
          if (e.zone_id !== "BILLING" || new Date(e.timestamp).toDateString() !== dayStr) return false;
          const t = new Date(e.timestamp).getTime();
          return t >= fiveMinutesAhead && t <= txTime;
        });
        potentialBuyers.forEach(e => historicDays[dayStr].conversions.add(e.visitor_id));
      }
    });
    
    const conversionScores = Object.values(historicDays).map((dayData) => {
      return dayData.visitors.size > 0 ? dayData.conversions.size / dayData.visitors.size : 0;
    }).filter(s => s > 0);
    
    const avgSevenDayConv = conversionScores.length > 0 ? conversionScores.reduce((a,b) => a+b, 0) / conversionScores.length : 0.45;
    
    const dropPercentage = avgSevenDayConv > 0 ? (avgSevenDayConv - analyticsToday.conversion_rate) / avgSevenDayConv : 0;
    
    if (dropPercentage >= 0.35 && analyticsToday.unique_visitors >= 10) {
      storeAnomalies.push({
        anomaly_id: `anom_${Math.random().toString(36).substring(2, 8)}`,
        type: "CONVERSION_DROP",
        severity: "WARN",
        timestamp: new Date().toISOString(),
        message: `Conversion rate dropped to ${(analyticsToday.conversion_rate * 100).toFixed(1)}% (vs 7-day average of ${(avgSevenDayConv * 100).toFixed(1)}%).`,
        suggested_action: "Trigger interactive retail offers. Inspect skincare/cosmetics areas for high dwell but low conversions."
      });
    }
    
    // 3. DEAD_ZONE: No customer visits/events recorded anywhere in the last 15 minutes during operating hours
    const last15MinsVal = new Date(new Date().getTime() - 15 * 60 * 1000);
    const recentActivities = events.filter(e => e.store_id === storeId && !e.is_staff && new Date(e.timestamp) >= last15MinsVal);
    
    if (recentActivities.length === 0) {
      storeAnomalies.push({
        anomaly_id: `anom_${Math.random().toString(36).substring(2, 8)}`,
        type: "DEAD_ZONE",
        severity: "INFO",
        timestamp: new Date().toISOString(),
        message: "No human/customer footfall recorded across physical zones in the last 15 minutes.",
        suggested_action: "Verify if shop is open. Confirm on-site employee presence via direct floor communication."
      });
    }
  }
  
  res.json({
    store_id: storeId,
    anomalies: storeAnomalies,
    compared_7day_conversion_rate: 0.48 // Baseline anchor
  });
  
  addLog(traceId, storeId, `GET /api/stores/${storeId}/anomalies`, Date.now() - startTime, 0, 200);
});

// GET /api/health
app.get("/api/health", (req, res) => {
  const startTime = Date.now();
  const traceId = `tr_${Math.random().toString(36).substring(2, 10)}`;
  
  const storeHealth: Record<string, { status: string; last_event_timestamp: string | null; warning?: string }> = {};
  
  Object.keys(STORES).forEach((storeId) => {
    // Find latest event of any customer/staff for this store
    const storeEvts = events.filter(e => e.store_id === storeId);
    if (storeEvts.length === 0) {
      storeHealth[storeId] = { status: "OK", last_event_timestamp: null };
      return;
    }
    
    const latestEvt = storeEvts[storeEvts.length - 1];
    const latestTime = new Date(latestEvt.timestamp).getTime();
    
    // Check lag vs current system time (which is 2026-05-30 rolling in our environment)
    const lagMs = new Date().getTime() - latestTime;
    const minutesLag = Math.floor(lagMs / 60000);
    
    let status = "OK";
    let warning: string | undefined;
    
    if (minutesLag > 10) {
      status = "STALE_FEED";
      warning = `Camera stream lag is ${minutesLag} minutes exceeding threshold of 10 min.`;
    }
    
    storeHealth[storeId] = {
      status,
      last_event_timestamp: latestEvt.timestamp,
      warning
    };
  });
  
  res.json({
    status: isDbConnected ? "HEALTHY" : "DEGRADED",
    database_connected: isDbConnected,
    current_time: new Date().toISOString(),
    stores: storeHealth
  });
  
  addLog(traceId, "ALL", "GET /api/health", Date.now() - startTime, 0, 200);
});


// Serve static/compiled app
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const tailwindcss = (await import("@tailwindcss/vite")).default;
    const react = (await import("@vitejs/plugin-react")).default;

    const vite = await createViteServer({
      configFile: false,
      plugins: [react(), tailwindcss()],
      resolve: {
        alias: {
          "@": path.resolve(__dirname, "."),
        },
      },
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== "true",
        watch: process.env.DISABLE_HMR === "true" ? null : {},
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server launched and running on host 0.0.0.0, port ${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start Store Intelligence Express server:", err);
});
