import { storageManager } from './storageManager.js';
import { eventBus } from './eventBus.js';
import { logger } from './logger.js';

class MetricsEngine {
  constructor() {
    this.filePath = "data/metrics.json";
    this.stats = {
      totalUptimeHours: 0,
      longestSessionMs: 0,
      reconnects: 0,
      crashesRecovered: 0,
      accountsUsed: 0,
      messagesSent: 0,
      bedsUsed: 0,
      distanceWalked: 0,
      sleepAttempts: 0,
      sleepSuccesses: 0,
      bedFailures: 0,
      pathfinderFailures: 0,
      averagePing: 0,
      pingSamples: 0
    };
    
    this.sessionStartTime = null;
    this.usernamesUsed = new Set();
  }

  init() {
    try {
      const parsed = storageManager.read(this.filePath, this.stats);
      this.stats = { ...this.stats, ...parsed.data };
      logger.info("METRICS", "Successfully loaded historical metrics.");
    } catch (err) {
      logger.warn("METRICS", `Failed to load metrics, using defaults: ${err.message}`);
    }

    this.registerEvents();
  }

  registerEvents() {
    eventBus.on('bot_spawn', (username) => {
      this.sessionStartTime = Date.now();
      if (!this.usernamesUsed.has(username)) {
        this.usernamesUsed.add(username);
        this.stats.accountsUsed = this.usernamesUsed.size;
      }
    });

    eventBus.on('bot_disconnect', () => {
      this.calculateSessionUptime();
    });

    eventBus.on('bot_reconnect', () => {
      this.stats.reconnects++;
      this.calculateSessionUptime();
    });

    eventBus.on('crash_recovered', () => {
      this.stats.crashesRecovered++;
    });

    eventBus.on('message_sent', () => {
      this.stats.messagesSent++;
    });

    eventBus.on('bed_used', () => {
      this.stats.bedsUsed++;
    });

    eventBus.on('distance_walked', (blocks) => {
      if (typeof blocks === 'number' && !isNaN(blocks)) {
        this.stats.distanceWalked += blocks;
      }
    });

    eventBus.on('sleep_attempt', () => {
      this.stats.sleepAttempts++;
    });

    eventBus.on('sleep_success', () => {
      this.stats.sleepSuccesses++;
    });

    eventBus.on('bed_failure', () => {
      this.stats.bedFailures++;
    });

    eventBus.on('pathfinder_failure', () => {
      this.stats.pathfinderFailures++;
    });

    eventBus.on('ping_updated', (ping) => {
      if (typeof ping === 'number' && ping >= 0) {
        const totalPingWeight = this.stats.averagePing * this.stats.pingSamples;
        this.stats.pingSamples++;
        this.stats.averagePing = Math.round((totalPingWeight + ping) / this.stats.pingSamples);
      }
    });
  }

  calculateSessionUptime() {
    if (!this.sessionStartTime) return;
    const sessionMs = Date.now() - this.sessionStartTime;
    this.sessionStartTime = null;

    if (sessionMs > this.stats.longestSessionMs) {
      this.stats.longestSessionMs = sessionMs;
    }

    const sessionHours = sessionMs / (1000 * 60 * 60);
    this.stats.totalUptimeHours = parseFloat((this.stats.totalUptimeHours + sessionHours).toFixed(4));
  }

  getSleepSuccessRate() {
    if (this.stats.sleepAttempts === 0) return 1.0;
    return parseFloat((this.stats.sleepSuccesses / this.stats.sleepAttempts).toFixed(2));
  }

  flush() {
    this.calculateSessionUptime();
    // Refresh active session start time so uptime keeps accumulating
    this.sessionStartTime = Date.now();

    const currentStats = {
      ...this.stats,
      sleepSuccessRate: this.getSleepSuccessRate()
    };

    try {
      storageManager.write(this.filePath, currentStats, 1);
      logger.debug("METRICS", "Metrics flushed to disk.");
    } catch (err) {
      logger.error("METRICS", `Failed to flush metrics: ${err.message}`);
    }
  }
}

export const metricsEngine = new MetricsEngine();
