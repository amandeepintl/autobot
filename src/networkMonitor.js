import { logger } from './logger.js';
import { eventBus } from './eventBus.js';
import { config } from './config.js';
import { statusReporter } from './statusReporter.js';

class NetworkMonitor {
  constructor() {
    this.bot = null;
    this.latencyHistory = [];
    this.lastPacketTime = Date.now();
    this.packetLossSamples = 0;
    this.packetCount = 0;
    this.latencyState = "normal"; // "normal", "high", "critical"

    eventBus.on('bot_disconnect', () => {
      this.bot = null;
    });
    eventBus.on('session_expired', () => {
      this.bot = null;
    });
  }

  init(bot) {
    this.bot = bot;
    this.lastPacketTime = Date.now();
    this.packetCount = 0;

    // Track inbound packets for general activity
    bot._client.on('packet', () => {
      this.packetCount++;
      this.lastPacketTime = Date.now();
    });

    logger.info("NETWORK", "Network monitor initialized.");
  }

  /**
   * Evaluates current network latency and takes safety precautions if lag is severe.
   * Called by centralized Task Scheduler.
   */
  checkNetwork() {
    if (!this.bot) return;

    // Retrieve ping from player list
    const player = this.bot.players[this.bot.username];
    const currentPing = player ? player.ping : 0;

    if (currentPing > 0) {
      this.latencyHistory.push(currentPing);
      if (this.latencyHistory.length > 10) this.latencyHistory.shift();
      
      // Update status reporter
      statusReporter.updatePing(currentPing);
      eventBus.emit('ping_updated', currentPing);
    }

    const highThreshold = config.performance.pingThresholds.high || 500;
    const criticalThreshold = config.performance.pingThresholds.critical || 1500;

    if (currentPing >= criticalThreshold) {
      if (this.latencyState !== "critical") {
        logger.error("NETWORK", `CRITICAL LAG DETECTED! Ping is ${currentPing}ms (Threshold: ${criticalThreshold}ms). Pausing movement.`);
        this.latencyState = "critical";
        eventBus.emit('network_latency_critical', currentPing);
      }
    } else if (currentPing >= highThreshold) {
      if (this.latencyState !== "high") {
        logger.warn("NETWORK", `High ping detected: ${currentPing}ms (Threshold: ${highThreshold}ms). Reducing bot activity.`);
        this.latencyState = "high";
        eventBus.emit('network_latency_high', currentPing);
      }
    } else {
      if (this.latencyState !== "normal") {
        logger.info("NETWORK", `Network latency recovered. Ping: ${currentPing}ms.`);
        this.latencyState = "normal";
        eventBus.emit('network_latency_recovered', currentPing);
      }
    }

    // Packet check: if no packets for > 15s, flag connection warning
    const idleTime = Date.now() - this.lastPacketTime;
    if (idleTime > 15000) {
      logger.warn("NETWORK", `No network packets received for ${Math.round(idleTime / 1000)} seconds.`);
      eventBus.emit('network_stalled', idleTime);
    }
  }
}

export const networkMonitor = new NetworkMonitor();
