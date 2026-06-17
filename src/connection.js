import mineflayer from 'mineflayer';
import { config } from './config.js';
import { logger } from './logger.js';
import { eventBus } from './eventBus.js';
import { usernameRotation } from './usernameRotation.js';
import { circuitBreaker } from './circuitBreaker.js';


class ConnectionManager {
  constructor() {
    this.bot = null;
    this.reconnectTimer = null;
    this.backoffIndex = 0;
    this.sessionTimer = null;
    this.connectAttemptCount = 0;

    // Listen to watchdog events to recover from socket/loop freezes
    eventBus.on('watchdog_soft_reconnect', (reason) => {
      logger.warn("CONNECT", `Watchdog soft reconnect triggered: ${reason}`);
      this.destroyBot();
      this.connect();
    });

    eventBus.on('watchdog_hard_reconnect', (reason) => {
      logger.warn("CONNECT", `Watchdog hard reconnect triggered: ${reason}`);
      this.destroyBot();
      const nextUser = usernameRotation.rotate();
      logger.info("CONNECT", `Watchdog rotating username to ${nextUser}`);
      this.connect();
    });
  }

  /**
   * Initializes and starts the bot connection sequence.
   */
  connect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.bot) {
      this.destroyBot();
    }

    if (!circuitBreaker.canConnect()) {
      const remaining = circuitBreaker.getCooldownRemainingSeconds();
      logger.warn("CONNECT", `Circuit breaker is OPEN. Pausing connection attempts. Cooldown remaining: ${remaining}s.`);
      this.scheduleReconnect(config.aternos.offlineRetryIntervalMs || 120000);
      return;
    }

    const username = usernameRotation.getCurrentUsername();
    logger.info("CONNECT", `Attempting connection using username: ${username} to ${config.server.host}:${config.server.port}...`);
    this.connectAttemptCount++;

    try {
      this.bot = mineflayer.createBot({
        host: config.server.host,
        port: config.server.port,
        username: username,
        version: config.server.version || false,
        hideErrors: true // Suppress unhandled socket dumps, we log them gracefully
      });

      this.registerBotEvents(username);
    } catch (err) {
      logger.error("CONNECT", `Mineflayer instantiation critical error: ${err.message}`);
      this.handleConnectionFailure(err.message);
    }
  }

  registerBotEvents(username) {
    this.bot.once('spawn', () => {
      logger.info("CONNECT", `Bot spawned successfully as '${username}'!`);
      this.backoffIndex = 0; // Reset backoff on successful join
      
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      
      circuitBreaker.onAttemptSuccess();
      usernameRotation.recordSuccess(username);
      
      eventBus.emit('bot_spawn', username);

      // Start session rotation timer
      this.startSessionTimer(username);
    });

    this.bot.on('login', () => {
      logger.info("CONNECT", "Logged into server successfully.");
    });

    this.bot.on('death', () => {
      logger.warn("CONNECT", "Bot died! Attempting to respawn...");
      setTimeout(() => {
        if (this.bot) {
          try {
            this.bot.respawn();
            logger.info("CONNECT", "Respawn packet sent.");
          } catch (e) {
            logger.error("CONNECT", `Failed to respawn: ${e.message}`);
          }
        }
      }, 3000);
    });

    this.bot.on('kicked', (reason) => {
      const reasonStr = typeof reason === 'string' ? reason : JSON.stringify(reason);
      logger.warn("CONNECT", `Kicked from server. Reason: ${reasonStr}`);
      this.handleConnectionFailure(reasonStr);
    });

    this.bot.on('error', (err) => {
      logger.error("CONNECT", `Connection error: ${err.message}`);
      this.handleConnectionFailure(err.message);
    });

    this.bot.on('end', (reason) => {
      logger.warn("CONNECT", `Bot socket ended. Reason: ${reason}`);
      this.handleConnectionFailure(reason);
    });
  }

  startSessionTimer(username) {
    if (this.sessionTimer) clearTimeout(this.sessionTimer);

    if (config.usernameRotation.rotationSchedule === 'time') {
      const duration = config.usernameRotation.sessionDurationMs || 7200000;
      logger.info("CONNECT", `Scheduling username rotation in ${Math.round(duration / 60000)} minutes.`);
      
      this.sessionTimer = setTimeout(() => {
        logger.info("CONNECT", `Session limit reached for ${username}. Commencing graceful rotation...`);
        this.rotateSession();
      }, duration);
    }
  }

  rotateSession() {
    eventBus.emit('session_expired');
    const oldUsername = usernameRotation.getCurrentUsername();
    
    // Graceful disconnect
    this.destroyBot();
    
    // Record uptime
    const uptimeMs = config.usernameRotation.sessionDurationMs || 3600000;
    usernameRotation.recordUptime(oldUsername, uptimeMs);

    logger.info("CONNECT", `Session expired for ${oldUsername}. Exiting process to allow supervisor to rotate.`);
    
    // Allow logs to flush and disconnect to finish, then exit.
    // The supervisor.js will see the exit, rotate the afkUsernameIndex, and spawn a new bot.
    setTimeout(() => {
      process.exit(0);
    }, 2000);
  }

  handleConnectionFailure(reason) {
    if (this.reconnectTimer) return; // avoid duplicate triggers

    circuitBreaker.onAttemptFailed();

    const username = usernameRotation.getCurrentUsername();
    usernameRotation.recordFailure(username);
    
    eventBus.emit('bot_disconnect', reason);

    // Assess Aternos state based on errors/messages
    let delay = this.getBackoffDelay();
    const reasonLower = (reason || "").toLowerCase();

    if (reasonLower.includes("econnrefused") || reasonLower.includes("connect econnrefused")) {
      // Server is offline
      delay = config.aternos.offlineRetryIntervalMs || 120000;
      logger.warn("CONNECT", `Aternos server offline (ECONNREFUSED). Retrying in ${Math.round(delay / 1000)}s.`);
    } else if (reasonLower.includes("starting") || reasonLower.includes("loading")) {
      // Server is starting
      delay = config.aternos.startingRetryIntervalMs || 60000;
      logger.warn("CONNECT", `Aternos server is starting up. Retrying in ${Math.round(delay / 1000)}s.`);
    } else if (reasonLower.includes("sleeping") || reasonLower.includes("asleep")) {
      // Server is sleeping
      delay = config.aternos.sleepingRetryIntervalMs || 180000;
      logger.warn("CONNECT", `Aternos server is sleeping. Retrying in ${Math.round(delay / 1000)}s.`);
    } else {
      logger.warn("CONNECT", `Standard connection recovery. Retrying in ${Math.round(delay / 1000)}s.`);
    }

    // Clean bot and schedule reconnect
    this.destroyBot();
    this.scheduleReconnect(delay);
  }

  getBackoffDelay() {
    const seq = config.reconnect.backoffSequence || [10000, 20000, 40000, 80000, 160000, 300000];
    const delay = seq[this.backoffIndex];
    if (this.backoffIndex < seq.length - 1) {
      this.backoffIndex++;
    }
    return delay;
  }

  scheduleReconnect(ms) {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      eventBus.emit('bot_reconnect');
      this.connect();
    }, ms);
  }

  destroyBot() {
    if (this.sessionTimer) {
      clearTimeout(this.sessionTimer);
      this.sessionTimer = null;
    }
    
    if (this.bot) {
      try {
        // Remove all listeners to prevent memory leaks on socket re-creation
        this.bot.removeAllListeners();
        this.bot.end();
      } catch (_) {}
      this.bot = null;
      logger.info("CONNECT", "Bot instance destroyed safely.");
    }
  }

  gracefulShutdown() {
    logger.info("CONNECT", "Initiating connection graceful shutdown...");
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.destroyBot();
  }
}

export const connectionManager = new ConnectionManager();
