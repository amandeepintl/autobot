import { logger } from './logger.js';
import { eventBus } from './eventBus.js';
import { config } from './config.js';
import { taskScheduler } from './taskScheduler.js';
import { statusReporter } from './statusReporter.js';

class HealthMonitor {
  constructor() {
    this.bot = null;
    this.consecutiveViolations = 0;
    this.lastLoopTime = Date.now();
    this.eventLoopLag = 0;
    
    // Module Health Registry
    this.moduleRegistry = new Map();
    
    // Setup standard timeouts for modules
    this.moduleTimeouts = {
      watchdog: 30000,
      antiAfk: 900000,
      metrics: 300000,
      cleanup: 3600000,
      backup: 21600000,
      unstuckCheck: 60000
    };

    // Listen for disconnects to release bot reference
    eventBus.on('bot_disconnect', () => {
      this.bot = null;
    });
    eventBus.on('session_expired', () => {
      this.bot = null;
    });
  }

  init(bot) {
    this.bot = bot;
    this.consecutiveViolations = 0;
    this.lastLoopTime = Date.now();

    // Reset module check-in times on spawn to prevent immediate watchdog timeout
    for (const [name, data] of this.moduleRegistry.entries()) {
      data.lastUpdate = Date.now();
      data.healthy = true;
    }

    // Register this check in Task Scheduler
    taskScheduler.addTask(
      "healthCheck",
      config.healthMonitor.checkIntervalMs || 10000,
      () => this.runDiagnostics(),
      false
    );

    this.checkIn("healthCheck");
    
    logger.info("HEALTH", "Health monitor initialized.");
  }

  /**
   * Registers or updates a module's heart beat in the registry.
   * @param {string} moduleName 
   */
  checkIn(moduleName) {
    this.moduleRegistry.set(moduleName, {
      healthy: true,
      lastUpdate: Date.now()
    });
  }

  /**
   * Executes resource checks and module registry health inspections.
   */
  runDiagnostics() {
    this.checkIn("healthCheck");
    this.checkEventLoopLag();
    this.checkResources();
    if (this.bot) {
      this.checkModuleRegistry();
    }
  }

  checkEventLoopLag() {
    const now = Date.now();
    const interval = config.healthMonitor.checkIntervalMs || 10000;
    const elapsed = now - this.lastLoopTime;
    this.eventLoopLag = Math.max(0, elapsed - interval);
    this.lastLoopTime = now;

    if (this.eventLoopLag > 100) {
      logger.debug("HEALTH", `Event loop lag detected: ${this.eventLoopLag}ms`);
    }
  }

  checkResources() {
    const memory = process.memoryUsage();
    const rssMb = Math.round(memory.rss / 1024 / 1024);
    const limitMb = config.healthMonitor.maxMemoryRssMb || 120;
    const lagLimit = config.healthMonitor.maxEventLoopLagMs || 500;

    let violation = false;
    let reason = "";

    if (rssMb > limitMb) {
      violation = true;
      reason = `RAM usage (${rssMb}MB) exceeds limit (${limitMb}MB)`;
    }

    if (this.eventLoopLag > lagLimit) {
      violation = true;
      reason = `Event loop lag (${this.eventLoopLag}ms) exceeds limit (${lagLimit}ms)`;
    }

    if (violation) {
      this.consecutiveViolations++;
      logger.warn("HEALTH", `Resource violation detected (${this.consecutiveViolations}/${config.healthMonitor.consecutiveViolationsLimit || 3}): ${reason}`);

      if (this.consecutiveViolations >= (config.healthMonitor.consecutiveViolationsLimit || 3)) {
        logger.error("HEALTH", `Critical health failure limit reached. Triggering process restart. Reason: ${reason}`);
        this.triggerRestart();
      }
    } else {
      if (this.consecutiveViolations > 0) {
        this.consecutiveViolations = 0;
      }
    }

    // Dynamic Performance Scaling (Adaptive Profile)
    if (config.performance.profile === "Adaptive") {
      this.applyAdaptiveScaling(rssMb, limitMb);
    }
  }

  checkModuleRegistry() {
    const now = Date.now();
    for (const [name, data] of this.moduleRegistry.entries()) {
      const timeout = this.moduleTimeouts[name] || 60000;
      const elapsed = now - data.lastUpdate;

      if (elapsed > timeout) {
        logger.error("HEALTH", `Module health check-in timeout! Subsystem '${name}' failed to check-in for ${Math.round(elapsed / 1000)}s (Limit: ${Math.round(timeout / 1000)}s).`);
        data.healthy = false;
        
        if (name === "watchdog" || name === "healthCheck") {
          logger.error("HEALTH", `Critical subsystem '${name}' failed. Initiating restart...`);
          this.triggerRestart();
          break;
        }
      }
    }
  }

  applyAdaptiveScaling(rssMb, limitMb) {
    const player = this.bot ? this.bot.players[this.bot.username] : null;
    const ping = player ? player.ping : 0;
    const tps = this.bot ? (this.bot.tps || 20) : 20;

    const criticalTps = config.performance.tpsThresholds.critical || 10;

    // A. Critical TPS -> Enlarge AFK action intervals
    if (tps <= criticalTps) {
      logger.warn("HEALTH", `Server TPS is critical (${tps.toFixed(1)}). Extending Anti-AFK intervals.`);
      config.antiAfk.minIntervalMs = 600000; // 10m
      config.antiAfk.maxIntervalMs = 1200000; // 20m
    }
  }

  triggerRestart() {
    eventBus.emit('health_failure');
    process.exit(2);
  }
}

export const healthMonitor = new HealthMonitor();
