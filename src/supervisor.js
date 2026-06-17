
import { workerPool } from './worker/workerPool.js';
import { eventBus } from './core/eventBus.js';
import { config } from './config.js';
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
    this.afkUsernameIndex = 0;
  }

  async start() {
    log("Initializing Minecraft Worker Platform (MWP) Supervisor...");

    // Load last rotation index if exists
    try {
      const rotationFile = path.resolve("data/rotation.json");
      if (fs.existsSync(rotationFile)) {
        const fileContent = fs.readFileSync(rotationFile, 'utf8');
        if (fileContent.trim()) {
          const data = JSON.parse(fileContent);
          if (data && data.data && typeof data.data.currentIndex === 'number') {
            this.afkUsernameIndex = data.data.currentIndex;
            log(`Loaded saved username rotation index from rotation.json: ${this.afkUsernameIndex}`);
          }
        }
      }
    } catch (err) {
      log(`Failed to load username rotation index: ${err.message}`);
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


    // Handle unexpected exits
    eventBus.on('worker_exited', ({ type, code, signal }) => {
      if (this.isShuttingDown) return;

      log(`Worker '${type}' exited. Code: ${code}, Signal: ${signal}`);
      
      // Auto-restart permanent workers (like 'afk')
      if (type === 'afk') {
        if (config.usernameRotation?.enabled) {
          this.afkUsernameIndex++;
          this.saveRotationIndex();
        }
        const delay = config.usernameRotation?.delayBetweenRotationMs || 10000;
        log(`Auto-restarting primary AFK worker in ${delay / 1000} seconds...`);
        setTimeout(() => {
          if (!this.isShuttingDown) {
            this.spawnAfkWorker();
          }
        }, delay);
      }
    });
  }

  spawnAfkWorker() {
    const list = config.usernameRotation?.usernames || ["MWPBot"];
    let username = list[0];
    if (config.usernameRotation?.enabled) {
      const index = this.afkUsernameIndex % list.length;
      username = list[index];
    }
    log(`Spawning primary AFK worker using username: ${username} (rotation index: ${this.afkUsernameIndex})`);
    workerPool.spawnWorker('afk', { BOT_USERNAME: username });
  }

  saveRotationIndex() {
    try {
      const rotationFile = path.resolve("data/rotation.json");
      const dir = path.dirname(rotationFile);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      
      let fileData = { schemaVersion: 1, data: { currentIndex: this.afkUsernameIndex } };
      if (fs.existsSync(rotationFile)) {
        try {
          const fileContent = fs.readFileSync(rotationFile, 'utf8');
          if (fileContent.trim()) {
            const existing = JSON.parse(fileContent);
            if (existing && existing.data) {
              fileData = existing;
              fileData.data.currentIndex = this.afkUsernameIndex;
            }
          }
        } catch (_) {}
      }
      fs.writeFileSync(rotationFile, JSON.stringify(fileData, null, 2), 'utf8');
    } catch (err) {
      log(`Failed to save username rotation index: ${err.message}`);
    }
  }

  spawnInitialWorkers() {
    log("Starting primary worker: 'afk'...");
    this.spawnAfkWorker();
  }

  setupProcessSignals() {
    const handleShutdown = (signal) => {
      if (this.isShuttingDown) return;
      this.isShuttingDown = true;
      log(`Received ${signal}. Gracefully stopping all workers and shutting down database...`);

      workerPool.shutdownAll();

      log("Graceful shutdown complete. Exiting supervisor.");
      process.exit(0);
    };

    process.on('SIGINT', () => handleShutdown('SIGINT'));
    process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  }

  startHttpServer() {
    const port = process.env.PORT || 7860;
    try {
      const server = http.createServer((req, res) => {
        const parsedPath = (req.url || '').split('?')[0];
        if (parsedPath.startsWith('/logs')) {
          res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
          if (parsedPath === '/logs/latest') {
            const file = path.resolve("logs/latest.log");
            res.end(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : "No latest log file found.");
          } else if (parsedPath === '/logs/diagnostics') {
            const file = path.resolve("logs/diagnostics.log");
            res.end(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : "No diagnostics log file found.");
          } else {
            let response = "--- LOG FILES LIST ---\n";
            try {
              if (fs.existsSync("logs")) {
                const files = fs.readdirSync("logs");
                response += files.map(f => `- ${f}`).join("\n") + "\n\n";
              } else {
                response += "logs/ directory does not exist.\n\n";
              }
            } catch (err) {
              response += `Error listing logs directory: ${err.message}\n\n`;
            }
            response += "--- SUPERVISOR LOGS ---\n";
            response += fs.existsSync(SUPERVISOR_LOG) ? fs.readFileSync(SUPERVISOR_LOG, 'utf8') : "No supervisor log file found.";
            res.end(response);
          }
          return;
        }

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
