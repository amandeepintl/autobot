import { logger } from '../logger.js';

export const SEVERITY = {
  RECOVERABLE: 1, // Level 1: stuck physics, pathing failures
  TRANSIENT: 2,   // Level 2: disconnects, network packet drops
  PERMANENT: 3,   // Level 3: chest full, target block missing/destroyed
  FATAL: 4        // Level 4: auth errors, continuous crash loop, OOM
};

class RecoveryEngine {
  constructor() {
    this.handlers = new Map(); // workerName -> Map(severity -> Array of callbacks)
  }

  /**
   * Registers a custom recovery handler for a worker plugin.
   * @param {string} workerName 
   * @param {number} severity 
   * @param {Function} callback 
   */
  registerHandler(workerName, severity, callback) {
    if (!this.handlers.has(workerName)) {
      this.handlers.set(workerName, new Map());
    }
    const workerMap = this.handlers.get(workerName);
    if (!workerMap.has(severity)) {
      workerMap.set(severity, []);
    }
    workerMap.get(severity).push(callback);
    logger.info("RECOVERY", `Registered severity L${severity} recovery handler for worker: ${workerName}`);
  }

  /**
   * Core failure routing method. Executes mitigations based on severity.
   * @param {Object} workerInstance - BaseWorker child instance
   * @param {Error} error 
   * @param {number} severity 
   */
  async handleFailure(workerInstance, error, severity) {
    const name = workerInstance.name;
    logger.error("RECOVERY", `Failure detected on worker '${name}' (Severity L${severity}): ${error.message}`);

    // Fetch custom handlers registered by the plugin
    const workerMap = this.handlers.get(name);
    const customCallbacks = workerMap ? workerMap.get(severity) : null;

    if (customCallbacks && customCallbacks.length > 0) {
      logger.info("RECOVERY", `Executing ${customCallbacks.length} custom recovery handlers for worker '${name}'...`);
      for (const callback of customCallbacks) {
        try {
          const mitigated = await callback(workerInstance, error);
          if (mitigated) {
            logger.info("RECOVERY", `Failure mitigated successfully by custom handler.`);
            return true;
          }
        } catch (callbackErr) {
          logger.error("RECOVERY", `Custom recovery handler failed: ${callbackErr.message}`);
        }
      }
    }

    // Default Fallback Escalation Routines
    switch (severity) {
      case SEVERITY.RECOVERABLE:
        logger.info("RECOVERY", "Default L1 Recovery: Executing unstuck jump and resetting active goal.");
        if (workerInstance.bot) {
          workerInstance.bot.setControlState('jump', true);
          setTimeout(() => {
            if (workerInstance.bot) workerInstance.bot.setControlState('jump', false);
          }, 500);
        }
        return true;

      case SEVERITY.TRANSIENT:
        logger.warn("RECOVERY", "Default L2 Recovery: Re-attempting connection sequence.");
        // baseWorker will automatically disconnect/exit and supervisor will restart it.
        if (workerInstance.bot) {
          try { workerInstance.bot.quit(); } catch (_) {}
        }
        process.exit(1);
        return false;

      case SEVERITY.PERMANENT:
        logger.warn("RECOVERY", "Default L3 Recovery: Clearing active target cache and requesting queue reload.");
        // Skip current queue item
        workerInstance.emit('skip_task', error);
        return true;

      case SEVERITY.FATAL:
      default:
        logger.error("RECOVERY", "Default L4 Recovery: FATAL state. Terminating worker process.");
        if (workerInstance.bot) {
          try { workerInstance.bot.quit(); } catch (_) {}
        }
        workerInstance.sendIpc('fatal_error', { message: error.message });
        process.exit(1);
        return false;
    }
  }
}

export const recoveryEngine = new RecoveryEngine();
