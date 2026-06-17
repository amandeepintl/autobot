import { EventEmitter } from 'events';
import { logger } from '../logger.js';

export class BaseWorker extends EventEmitter {
  constructor(name, config) {
    super();
    this.name = name;
    this.config = config;
    this.bot = null;
    this.active = false;
    this.heartbeatInterval = null;
  }

  /**
   * Initial diagnostics phase.
   */
  async bootstrap() {
    logger.info(`WORKER-${this.name.toUpperCase()}`, "Bootstrapping worker environment...");
  }

  /**
   * Handshakes with Minecraft server and sets up base listeners.
   * @param {Object} botInstance - The mineflayer bot instance
   */
  async connect(botInstance) {
    this.bot = botInstance;
    this.active = true;
    
    // Start heartbeat IPC loop
    this.startHeartbeat();

    logger.info(`WORKER-${this.name.toUpperCase()}`, "Worker connected and active.");
    await this.initialize();
  }

  /**
   * Hook for plugins to register standard bot event listeners.
   */
  async initialize() {
    // Override in subclass
  }

  /**
   * Core task queue execution loop.
   */
  async run(taskQueue) {
    logger.info(`WORKER-${this.name.toUpperCase()}`, "Running worker task loop...");
  }

  /**
   * Interrupt task runner and preserve state checkpoint.
   * @param {string} reason 
   */
  async interrupt(reason) {
    logger.warn(`WORKER-${this.name.toUpperCase()}`, `Worker execution interrupted: ${reason}`);
  }

  /**
   * Revalidate environment and resume queue.
   */
  async resume() {
    logger.info(`WORKER-${this.name.toUpperCase()}`, "Worker execution resuming...");
  }

  /**
   * Clean termination hook. Clears event listeners, intervals, and exits bot.
   */
  async shutdown() {
    this.active = false;
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    
    if (this.bot) {
      try {
        this.bot.quit();
      } catch (_) {}
      this.bot = null;
    }

    logger.info(`WORKER-${this.name.toUpperCase()}`, "Worker shut down cleanly.");
    this.emit('shutdown');
  }

  /**
   * IPC message helper to send status, heartbeats, or metrics to Supervisor.
   * @param {string} type 
   * @param {Object} payload 
   */
  sendIpc(type, payload = {}) {
    if (process.send) {
      process.send({
        type,
        worker: this.name,
        timestamp: Date.now(),
        ...payload
      });
    }
  }

  startHeartbeat() {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    this.heartbeatInterval = setInterval(() => {
      if (this.active) {
        // Memory watchdog (Level 3)
        const memRssMb = Math.round(process.memoryUsage().rss / (1024 * 1024));
        const maxMem = this.config.healthMonitor?.maxMemoryRssMb || 250;
        if (memRssMb > maxMem) {
          logger.error(`WORKER-${this.name.toUpperCase()}`, `Memory limit exceeded: ${memRssMb}MB / ${maxMem}MB. Executing safety exit.`);
          this.shutdown().then(() => process.exit(1));
          return;
        }

        this.sendIpc('heartbeat');
      }
    }, 30000); // Heartbeat every 30 seconds
  }
}
