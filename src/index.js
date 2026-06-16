import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// Subsystems import
import { logger } from './logger.js';
import { eventBus } from './eventBus.js';
import { config } from './config.js';
import { taskScheduler } from './taskScheduler.js';
import { deploymentManager } from './deployment.js';
import { diagnosticsEngine } from './diagnostics.js';
import { storageManager } from './storageManager.js';
import { backupManager } from './backupManager.js';
import { metricsEngine } from './metrics.js';
import { statusReporter } from './statusReporter.js';
import { circuitBreaker } from './circuitBreaker.js';
import { connectionManager } from './connection.js';
import { watchdogEngine } from './watchdog.js';
import { healthMonitor } from './healthMonitor.js';
import { networkMonitor } from './networkMonitor.js';
import { serverDetection } from './serverDetection.js';
import { memoryCleanupManager } from './cleanup.js';
import { usernameRotation } from './usernameRotation.js';
import { worldMemory } from './worldMemory.js';
import { microMovement } from './microMovement.js';
import { unstuckManager } from './unstuck.js';
import { sleepManager } from './sleepManager.js';
import { antiAfkModule } from './antiAfk.js';
import { behaviorManager } from './behavior.js';

class BotIndex {
  constructor() {
    this.safeMode = process.env.EMERGENCY_SAFE_MODE === 'true';
    this.configMtime = 0;
    this.configHash = "";
    this.configPath = path.resolve("src/config.js");
  }

  async run() {
    logger.info("SYSTEM", "==================================================");
    logger.info("SYSTEM", "Starting Simplified Bot Child Process...");
    
    try {
      // Phase 1: Deployment
      deploymentManager.deploy();

      // Phase 2: Diagnostics
      diagnosticsEngine.run();

      // Phase 3: Storage Load
      this.initStorage();

      // Phase 4: Connection Setups
      this.initConnection();

      // Phase 5: Behaviors & Subsystems
      this.initBehaviors();

      // Phase 6: Monitoring & Watchdogs
      this.initMonitoring();

      // Final Setup: IPC & Signals
      this.initProcessHandlers();

      logger.info("SYSTEM", "Bot initialized successfully. All startup phases complete.");
    } catch (err) {
      logger.error("SYSTEM", `Fatal Startup Failure: ${err.message}`);
      process.exit(1);
    }
  }

  initStorage() {
    logger.info("SYSTEM", "Running Phase 3: Storage Initialization...");
    
    logger.init(config);
    
    usernameRotation.init();
    worldMemory.init();
    metricsEngine.init();
    
    logger.info("SYSTEM", "Phase 3 complete: Databases loaded successfully.");
  }

  initConnection() {
    logger.info("SYSTEM", "Running Phase 4: Connection Setup...");
    
    const username = usernameRotation.getCurrentUsername();
    statusReporter.setBotContext(username, this.safeMode);
    
    eventBus.on('bot_spawn', (user) => {
      statusReporter.setBotContext(user, this.safeMode);
      
      const bot = connectionManager.bot;
      
      // Initialize simple movement/behaviors
      microMovement.init(bot);
      unstuckManager.init(bot);
      sleepManager.init(bot);
      antiAfkModule.init(bot);
      behaviorManager.init(bot, this.safeMode);
      
      watchdogEngine.init(bot);
      healthMonitor.init(bot);
      networkMonitor.init(bot);
      serverDetection.init(bot);
      memoryCleanupManager.init(bot);
    });

    eventBus.on('bot_reconnect', () => {
      logger.info("SYSTEM", "Watchdog triggered connect request.");
    });

    connectionManager.connect();
    
    logger.info("SYSTEM", "Phase 4 complete: Connection setups established.");
  }

  initBehaviors() {
    logger.info("SYSTEM", "Running Phase 5: Behaviors Subsystem...");
    logger.info("SYSTEM", "Phase 5 complete: Behaviors loaded.");
  }

  initBehaviorsOnReload() {
    if (!connectionManager.bot) return;
    const bot = connectionManager.bot;
    antiAfkModule.init(bot);
    behaviorManager.stop();
    behaviorManager.init(bot, this.safeMode);
  }

  initMonitoring() {
    logger.info("SYSTEM", "Running Phase 6: Monitoring, Watchdog & Schedulers...");

    taskScheduler.start();

    // 1. Config Hot Reload check: every 30 seconds
    this.recordConfigState();
    taskScheduler.addTask("configCheck", 30000, () => this.checkConfigHotReload(), false);

    // 2. Metrics flushing: every 5 minutes
    taskScheduler.addTask("metricsFlush", 300000, () => metricsEngine.flush(), false);

    // 3. Status reporting: every 60 seconds
    taskScheduler.addTask("statusFlush", 60000, () => statusReporter.flush(), false);

    // 4. Smart Cleanup: every 30 minutes
    taskScheduler.addTask("cleanup", config.performance.cleanupIntervalMs || 1800000, () => memoryCleanupManager.cleanup(), false);

    // 5. Scheduled Backups: every 6 hours
    taskScheduler.addTask("scheduledBackup", config.backup.intervalMs || 21600000, () => backupManager.backup(), false);

    // 6. Network check: every 10 seconds
    taskScheduler.addTask("networkCheck", 10000, () => {
      if (connectionManager.bot) {
        networkMonitor.checkNetwork();
      }
    }, false);

    // 7. Night sleep check: every 30 seconds
    taskScheduler.addTask("sleepCheck", 30000, () => {
      if (connectionManager.bot) {
        sleepManager.checkAndSleep();
      }
    }, false);

    logger.info("SYSTEM", "Phase 6 complete: Monitoring ticks active.");
  }

  initProcessHandlers() {
    if (process.send) {
      logger.info("SYSTEM", "IPC connection detected. Heartbeat reporting active (every 60s).");
      process.send({ type: 'heartbeat' });
      taskScheduler.addTask("heartbeat", 60000, () => {
        process.send({ type: 'heartbeat' });
      }, false);
    } else {
      logger.warn("SYSTEM", "No IPC channel active. Running in standalone mode.");
    }

    process.on('uncaughtException', (err) => {
      logger.error("SYSTEM", `Uncaught Exception: ${err.message}\n${err.stack}`);
      this.gracefulShutdown("uncaughtException", 1);
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.error("SYSTEM", `Unhandled Rejection at: ${promise}, reason: ${reason}`);
      this.gracefulShutdown("unhandledRejection", 1);
    });

    process.on('SIGINT', () => this.gracefulShutdown("SIGINT", 0));
    process.on('SIGTERM', () => this.gracefulShutdown("SIGTERM", 0));
  }

  recordConfigState() {
    try {
      const stats = fs.statSync(this.configPath);
      this.configMtime = stats.mtimeMs;
      
      const content = fs.readFileSync(this.configPath, 'utf8');
      this.configHash = crypto.createHash('md5').update(content).digest('hex');
    } catch (_) {}
  }

  async checkConfigHotReload() {
    try {
      const stats = fs.statSync(this.configPath);
      if (stats.mtimeMs !== this.configMtime) {
        const content = fs.readFileSync(this.configPath, 'utf8');
        const hash = crypto.createHash('md5').update(content).digest('hex');
        
        if (hash !== this.configHash) {
          logger.info("SYSTEM", "Config file modification detected. Hot-reloading settings...");
          
          this.configMtime = stats.mtimeMs;
          this.configHash = hash;

          const updatedModule = await import(`./config.js?t=${Date.now()}`);
          Object.assign(config, updatedModule.config);
          
          logger.init(config);
          this.initBehaviorsOnReload();

          logger.info("SYSTEM", "Configuration hot-reloaded successfully.");
        }
      }
    } catch (err) {
      logger.error("SYSTEM", `Failed to hot reload configuration: ${err.message}`);
    }
  }

  async gracefulShutdown(reason, exitCode = 0) {
    logger.info("SYSTEM", `Graceful shutdown initiated. Reason: ${reason}`);
    
    taskScheduler.stop();
    connectionManager.gracefulShutdown();
    behaviorManager.stop();

    logger.info("SYSTEM", "Saving rotation pool, world coordinates, and metrics...");
    try {
      metricsEngine.flush();
      worldMemory.save();
      usernameRotation.save();
      statusReporter.flush();
    } catch (err) {
      logger.error("SYSTEM", `Failed to save files on shutdown: ${err.message}`);
    }

    logger.info("SYSTEM", "Flushing remaining log buffers...");
    setTimeout(() => {
      logger.info("SYSTEM", "Shutdown complete. Exiting process.");
      process.exit(exitCode);
    }, 1000);
  }
}

const botProcess = new BotIndex();
botProcess.run();
