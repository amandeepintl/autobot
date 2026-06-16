import { fork } from 'child_process';
import path from 'path';
import fs from 'fs';

const SUPERVISOR_LOG = path.resolve("logs/supervisor.log");

function log(message) {
  const timestamp = new Date().toISOString();
  const entry = `[${timestamp}] [SUPERVISOR] ${message}`;
  console.log(`\x1b[35m[SUPERVISOR]\x1b[0m ${message}`);
  try {
    // Ensure logs folder exists
    const dir = path.dirname(SUPERVISOR_LOG);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(SUPERVISOR_LOG, entry + "\n", "utf8");
  } catch (err) {
    console.error(`Failed to write supervisor log: ${err.message}`);
  }
}

class Supervisor {
  constructor() {
    this.childPath = path.resolve("src/index.js");
    this.child = null;
    this.lastHeartbeat = Date.now();
    this.heartbeatInterval = null;
    this.restartTimestamps = [];
    this.isShuttingDown = false;
  }

  start() {
    log("Initializing supervisor system...");
    this.spawnChild();
    this.startHeartbeatCheck();
    this.setupProcessSignals();
  }

  spawnChild() {
    if (this.child) {
      log("Child process already exists, clean termination before respawn...");
      try { this.child.kill('SIGKILL'); } catch (_) {}
      this.child = null;
    }

    // Clean old timestamps and assess loop frequency
    const now = Date.now();
    this.restartTimestamps = this.restartTimestamps.filter(t => now - t < 300000); // 5 minutes window

    let safeMode = false;
    if (this.restartTimestamps.length >= 5) {
      log("WARNING: 5 crashes detected within 5 minutes. Spawning child in EMERGENCY SAFE MODE.");
      safeMode = true;
    }

    this.restartTimestamps.push(now);

    const env = {
      ...process.env,
      EMERGENCY_SAFE_MODE: safeMode ? "true" : "false"
    };

    log(`Spawning child process index.js (Attempt count in 5m: ${this.restartTimestamps.length})...`);
    
    this.child = fork(this.childPath, [], {
      env,
      execArgv: ['--max-old-space-size=256', '--expose-gc'],
      stdio: ['inherit', 'inherit', 'inherit', 'ipc']
    });

    this.lastHeartbeat = Date.now(); // reset timer on spawn

    this.child.on('message', (message) => {
      if (message && message.type === 'heartbeat') {
        this.lastHeartbeat = Date.now();
      }
    });

    this.child.on('exit', (code, signal) => {
      if (this.isShuttingDown) {
        log("Child exited during supervisor shutdown. Ending supervisor.");
        return;
      }

      log(`Child process exited. Code: ${code}, Signal: ${signal}`);
      
      // If child exited with code 0 (clean shutdown request), we do not auto-restart.
      if (code === 0) {
        log("Child requested clean shutdown. Supervisor exiting...");
        process.exit(0);
      }

      // Re-spawn child after a small delay to prevent tight spin loops
      const delay = this.restartTimestamps.length > 5 ? 10000 : 2000;
      log(`Auto-restarting child process in ${delay / 1000} seconds...`);
      setTimeout(() => this.spawnChild(), delay);
    });

    this.child.on('error', (err) => {
      log(`Child process error: ${err.message}`);
    });
  }

  startHeartbeatCheck() {
    this.heartbeatInterval = setInterval(() => {
      if (!this.child || this.isShuttingDown) return;

      const elapsed = Date.now() - this.lastHeartbeat;
      if (elapsed > 120000) { // 120s timeout
        log(`CRITICAL: Child process failed to send heartbeat for ${Math.round(elapsed / 1000)} seconds (Limit 120s). Killing frozen process...`);
        try {
          this.child.kill('SIGKILL');
        } catch (err) {
          log(`Failed to kill unresponsive child: ${err.message}`);
        }
        // Spawning will happen automatically via 'exit' event handler
      }
    }, 10000); // Check every 10 seconds
  }

  setupProcessSignals() {
    const handleSignal = (signal) => {
      if (this.isShuttingDown) return;
      this.isShuttingDown = true;
      log(`Received ${signal}. Gracefully stopping supervisor and child process...`);

      if (this.heartbeatInterval) {
        clearInterval(this.heartbeatInterval);
      }

      if (this.child) {
        // Send signal to child to shut down gracefully
        this.child.kill(signal);
        
        // Timeout to force kill if child hangs
        const killTimeout = setTimeout(() => {
          log("Child failed to exit within 5s. Terminating forcefully...");
          if (this.child) {
            try { this.child.kill('SIGKILL'); } catch (_) {}
          }
          process.exit(0);
        }, 5000);

        this.child.on('exit', () => {
          clearTimeout(killTimeout);
          log("Child exited successfully. Supervisor exiting.");
          process.exit(0);
        });
      } else {
        process.exit(0);
      }
    };

    process.on('SIGINT', () => handleSignal('SIGINT'));
    process.on('SIGTERM', () => handleSignal('SIGTERM'));
  }
}

// Instantiate and start
const supervisor = new Supervisor();
supervisor.start();
