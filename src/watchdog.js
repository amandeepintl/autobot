import { logger } from './logger.js';
import { eventBus } from './eventBus.js';
import { config } from './config.js';
import { taskScheduler } from './taskScheduler.js';
import { healthMonitor } from './healthMonitor.js';

class WatchdogEngine {
  constructor() {
    this.bot = null;
    this.lastPacket = Date.now();
    this.lastChat = Date.now();
    this.lastTick = Date.now();
    this.consecutiveFailures = 0;
    this.checkInterval = 5000;

    // Listen for disconnects to release bot reference
    eventBus.on('bot_disconnect', () => {
      this.bot = null;
      this.consecutiveFailures = 0;
    });

    eventBus.on('session_expired', () => {
      this.bot = null;
      this.consecutiveFailures = 0;
    });
  }

  init(bot) {
    this.bot = bot;
    this.lastPacket = Date.now();
    this.lastChat = Date.now();
    this.lastTick = Date.now();
    
    // Check-in on startup
    healthMonitor.checkIn("watchdog");

    // Listen to events to feed watchdog
    bot.on('physicTick', () => {
      this.lastTick = Date.now();
    });

    bot._client.on('packet', () => {
      this.lastPacket = Date.now();
    });

    bot.on('message', () => {
      this.lastChat = Date.now();
    });

    // Centralize checks in Task Scheduler
    taskScheduler.addTask(
      "watchdogCheck",
      config.watchdog.checkIntervalMs || 5000,
      () => this.performCheck(),
      false
    );

    logger.info("WATCHDOG", "Watchdog system armed and active.");
  }

  performCheck() {
    if (!this.bot || !this.bot.entity) return;

    // Report heart beat to health monitor
    healthMonitor.checkIn("watchdog");

    const now = Date.now();
    const packetElapsed = now - this.lastPacket;
    const tickElapsed = now - this.lastTick;
    const chatElapsed = now - this.lastChat;

    const packetLimit = config.watchdog.packetTimeoutMs || 30000;
    const tickLimit = config.watchdog.tickTimeoutMs || 15000;
    const chatLimit = config.watchdog.chatTimeoutMs || 300000;

    let triggerRecovery = false;
    let faultReason = "";

    // 1. Packet Timeout Check
    if (packetElapsed > packetLimit) {
      triggerRecovery = true;
      faultReason = `No packet received for ${Math.round(packetElapsed / 1000)}s (Limit: ${packetLimit / 1000}s)`;
    }

    // 2. Tick Timeout Check
    else if (tickElapsed > tickLimit) {
      triggerRecovery = true;
      faultReason = `Event loop / physics ticks frozen for ${Math.round(tickElapsed / 1000)}s (Limit: ${tickLimit / 1000}s)`;
    }

    // 3. Chat Timeout Check (only warn/ping, as silent servers don't emit chat)
    else if (chatElapsed > chatLimit) {
      logger.warn("WATCHDOG", `Silent connection warning: No chat events for ${Math.round(chatElapsed / 60000)} minutes.`);
      // We don't force recovery on chat alone, unless configured, to avoid false positives on quiet servers.
      this.lastChat = now; // reset to avoid duplicate logs
    }

    if (triggerRecovery) {
      logger.error("WATCHDOG", `Watchdog detected freeze: ${faultReason}`);
      this.handleFault(faultReason);
    }
  }

  handleFault(reason) {
    this.consecutiveFailures++;
    logger.error("WATCHDOG", `Executing Watchdog recovery phase. Current failure count: ${this.consecutiveFailures}`);
    this.bot = null; // Set to null to prevent further checks during recovery

    if (this.consecutiveFailures === 1) {
      // Phase 1: Soft Reconnect (rejoin server)
      logger.warn("WATCHDOG", "Initiating recovery Phase 1: Soft Reconnect...");
      eventBus.emit('watchdog_soft_reconnect', reason);
    } else if (this.consecutiveFailures === 2) {
      // Phase 2: Hard Reconnect (recreate mineflayer instance)
      logger.warn("WATCHDOG", "Initiating recovery Phase 2: Hard Reconnect...");
      eventBus.emit('watchdog_hard_reconnect', reason);
    } else {
      // Phase 3: Full Restart (terminate child process, supervisor will respawn)
      logger.error("WATCHDOG", "Recovery phase failed to restore stability. Triggering Phase 3: Full Process Restart.");
      eventBus.emit('watchdog_process_restart', reason);
      
      // Exit with code 1 to prompt supervisor restart
      process.exit(1);
    }
  }

  resetFailures() {
    if (this.consecutiveFailures > 0) {
      logger.info("WATCHDOG", `Watchdog state stabilized. Resetting failures count from ${this.consecutiveFailures} to 0.`);
      this.consecutiveFailures = 0;
    }
  }
}

export const watchdogEngine = new WatchdogEngine();
