import { storageManager } from './storageManager.js';
import { metricsEngine } from './metrics.js';
import { logger } from './logger.js';

class StatusReporter {
  constructor() {
    this.filePath = "data/status.json";
    this.startupTime = Date.now();
    this.currentUsername = "Unknown";
    this.ping = 0;
    this.safeMode = false;
  }

  setBotContext(username, safeMode) {
    this.currentUsername = username;
    this.safeMode = safeMode;
  }

  updatePing(ping) {
    this.ping = ping;
  }

  generateReport() {
    const memory = process.memoryUsage();
    const memoryPercent = Math.round((memory.rss / (1024 * 1024))); // RSS in MB
    const totalUptimeSeconds = Math.round((Date.now() - this.startupTime) / 1000);

    return {
      uptimeSeconds: totalUptimeSeconds,
      ping: this.ping,
      memoryRssMb: memoryPercent,
      reconnects: metricsEngine.stats.reconnects,
      username: this.currentUsername,
      safeMode: this.safeMode,
      schemaVersion: 1
    };
  }

  flush() {
    const report = this.generateReport();
    try {
      storageManager.write(this.filePath, report, 1);
      logger.debug("STATUS", `Status report updated: ${JSON.stringify(report)}`);
    } catch (err) {
      logger.error("STATUS", `Failed to write status report: ${err.message}`);
    }
  }
}

export const statusReporter = new StatusReporter();
