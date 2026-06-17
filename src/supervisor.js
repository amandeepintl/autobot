import { db } from './core/database.js';
import { workerPool } from './worker/workerPool.js';
import { eventBus } from './core/eventBus.js';
import path from 'path';
import fs from 'fs';
import http from 'http';

const SUPERVISOR_LOG = path.resolve("logs/supervisor.log");

function log(message) {
  const timestamp = new Date().toISOString();
  const entry = `[${timestamp}] [SUPERVISOR] ${message}`;
  console.log(`\x1b[35m[SUPERVISOR]\x1b[0m ${message}`);
  try {
    const dir = path.dirname(SUPERVISOR_LOG);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(SUPERVISOR_LOG, entry + "\n", "utf8");
  } catch (err) {
    console.error(`Failed to write supervisor log: ${err.message}`);
  }
}

class Supervisor {
  constructor() {
    this.lastHeartbeats = new Map(); // workerName -> timestamp
    this.workerMetrics = new Map();  // workerName -> telemetry report
    this.isShuttingDown = false;
  }

  async start() {
    log("Initializing Minecraft Worker Platform (MWP) Supervisor...");

    // 1. Initialize SQLite WAL Database
    try {
      await db.open();
      await db.configure();
      await db.initializeSchema();
    } catch (err) {
      log(`CRITICAL: Database initialization failed: ${err.message}`);
      process.exit(1);
    }

    // 2. Setup Event Bus Listeners
    this.setupEventBus();

    // 3. Spawn initial permanent workers
    this.spawnInitialWorkers();

    // 4. Setup signal handlers and HTTP telemetry server
    this.setupProcessSignals();
    this.startHttpServer();
  }

  setupEventBus() {
    // Listen to heartbeats from active workers
    eventBus.on('worker_heartbeat', ({ type, timestamp }) => {
      this.lastHeartbeats.set(type, timestamp);
    });

    // Listen to worker telemetry updates
    eventBus.on('worker_telemetry', ({ type, data }) => {
      this.workerMetrics.set(type, data);
    });

    // Handle dynamically triggered worker spawning
    eventBus.on('worker_message', ({ type, data }) => {
      if (data.type === 'start_worker' && data.target) {
        log(`Trigger request received: Spawning worker '${data.target}'`);
        workerPool.spawnWorker(data.target);
      } else if (data.type === 'stop_worker' && data.target) {
        log(`Trigger request received: Stopping worker '${data.target}'`);
        workerPool.terminateWorker(data.target);
      }
    });

    // Handle unexpected exits
    eventBus.on('worker_exited', ({ type, code, signal }) => {
      if (this.isShuttingDown) return;

      log(`Worker '${type}' exited. Code: ${code}, Signal: ${signal}`);
      
      // Auto-restart permanent workers (like 'afk')
      if (type === 'afk') {
        log("Auto-restarting primary AFK worker in 5 seconds...");
        setTimeout(() => {
          if (!this.isShuttingDown) {
            workerPool.spawnWorker('afk');
          }
        }, 5000);
      }
    });
  }

  spawnInitialWorkers() {
    log("Starting primary worker: 'afk'...");
    workerPool.spawnWorker('afk');
  }

  setupProcessSignals() {
    const handleShutdown = (signal) => {
      if (this.isShuttingDown) return;
      this.isShuttingDown = true;
      log(`Received ${signal}. Gracefully stopping all workers and shutting down database...`);

      workerPool.shutdownAll();

      db.close().then(() => {
        log("Database connections closed cleanly. Exiting supervisor.");
        process.exit(0);
      }).catch((err) => {
        log(`Error closing database: ${err.message}`);
        process.exit(1);
      });
    };

    process.on('SIGINT', () => handleShutdown('SIGINT'));
    process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  }

  startHttpServer() {
    const port = process.env.PORT || 7860;
    try {
      const server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        
        const now = Date.now();
        const activeWorkers = workerPool.listActiveWorkers();
        const workerStatuses = {};

        for (const worker of activeWorkers) {
          const lastHb = this.lastHeartbeats.get(worker) || 0;
          const metrics = this.workerMetrics.get(worker) || {};
          workerStatuses[worker] = {
            status: (now - lastHb < 120000) ? "healthy" : "lagging",
            lastHeartbeatSecondsAgo: Math.round((now - lastHb) / 1000),
            metrics
          };
        }

        res.end(JSON.stringify({
          status: "healthy",
          uptimeSeconds: Math.round(process.uptime()),
          activeWorkers,
          workers: workerStatuses
        }));
      });

      server.listen(port, () => {
        log(`Supervisor HTTP status server listening on port ${port}`);
      });
    } catch (err) {
      log(`Failed to start HTTP server: ${err.message}`);
    }
  }
}

// Instantiate and start
const supervisor = new Supervisor();
supervisor.start();
