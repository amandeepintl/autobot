
import { fork } from 'child_process';
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
    this.lastHeartbeat = 0;
    this.isShuttingDown = false;
    this.afkUsernameIndex = 0;
    this.child = null; // Single child process reference
  }

  async start() {
    log("Initializing Autobot Supervisor...");

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

    // Spawn the single bot process
    this.spawnBotProcess();

    // Setup signal handlers and HTTP health server
    this.setupProcessSignals();
    this.startHttpServer();
  }

  getUsername() {
    const list = config.usernameRotation?.usernames || ["MWPBot"];
    if (config.usernameRotation?.enabled) {
      const index = this.afkUsernameIndex % list.length;
      return list[index];
    }
    return list[0];
  }

  spawnBotProcess() {
    if (this.child) {
      log("Killing existing child process before respawn...");
      try { this.child.kill('SIGTERM'); } catch (_) {}
      this.child = null;
    }

    const username = this.getUsername();
    log(`Spawning bot process with username: ${username} (rotation index: ${this.afkUsernameIndex})`);

    const botEntryPoint = path.resolve("src/index.js");

    const env = {
      ...process.env,
      BOT_USERNAME: username
    };

    const child = fork(botEntryPoint, [], {
      env,
      execArgv: ['--max-old-space-size=256'],
      stdio: ['inherit', 'inherit', 'inherit', 'ipc']
    });

    this.child = child;

    child.on('message', (message) => {
      if (!message || !message.type) return;
      if (message.type === 'heartbeat') {
        this.lastHeartbeat = Date.now();
      }
    });

    child.on('exit', (code, signal) => {
      log(`Bot process exited. Code: ${code}, Signal: ${signal}`);
      this.child = null;

      if (this.isShuttingDown) return;

      // Don't rotate username on crash/restart — rotation is handled
      // inside connectionManager within the child process itself

      const delay = config.usernameRotation?.delayBetweenRotationMs || 10000;
      log(`Auto-restarting bot process in ${delay / 1000} seconds...`);
      setTimeout(() => {
        if (!this.isShuttingDown) {
          this.spawnBotProcess();
        }
      }, delay);
    });

    child.on('error', (err) => {
      log(`Bot process error: ${err.message}`);
    });
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

  setupProcessSignals() {
    const handleShutdown = (signal) => {
      if (this.isShuttingDown) return;
      this.isShuttingDown = true;
      log(`Received ${signal}. Gracefully stopping bot process...`);

      if (this.child) {
        try { this.child.kill('SIGTERM'); } catch (_) {}
      }

      // Give child 3 seconds to exit, then force kill
      setTimeout(() => {
        if (this.child) {
          try { this.child.kill('SIGKILL'); } catch (_) {}
        }
        log("Graceful shutdown complete. Exiting supervisor.");
        process.exit(0);
      }, 3000);
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
        const childHealthy = this.child !== null && (now - this.lastHeartbeat < 120000 || this.lastHeartbeat === 0);

        res.end(JSON.stringify({
          status: childHealthy ? "healthy" : "degraded",
          uptimeSeconds: Math.round(process.uptime()),
          botRunning: this.child !== null,
          lastHeartbeatSecondsAgo: this.lastHeartbeat > 0 ? Math.round((now - this.lastHeartbeat) / 1000) : null,
          currentUsername: this.getUsername(),
          rotationIndex: this.afkUsernameIndex
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
