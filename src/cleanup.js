import { logger } from './logger.js';
import { eventBus } from './eventBus.js';
import { worldMemory } from './worldMemory.js';
import { usernameRotation } from './usernameRotation.js';

class MemoryCleanupManager {
  constructor() {
    this.bot = null;
  }

  init(bot) {
    this.bot = bot;
  }

  /**
   * Main cleanup operation.
   * Cleans redundant listeners and compacts database states.
   */
  cleanup() {
    logger.info("CLEANUP", "Running smart resource cleanup...");
    const memBefore = process.memoryUsage().rss / 1024 / 1024;

    try {
      this.cleanupEventListeners();
      this.compactFiles();
      this.forceGarbageCollection();

      const memAfter = process.memoryUsage().rss / 1024 / 1024;
      logger.info("CLEANUP", `Cleanup finished. RAM reduced from ${memBefore.toFixed(1)}MB to ${memAfter.toFixed(1)}MB.`);
      eventBus.emit('cleanup_completed', { before: memBefore, after: memAfter });
    } catch (err) {
      logger.error("CLEANUP", `Error during cleanup: ${err.message}`);
    }
  }

  cleanupEventListeners() {
    logger.debug("CLEANUP", "Pruning dead or duplicate event listeners.");
    const events = eventBus.eventNames();
    for (const ev of events) {
      const count = eventBus.listenerCount(ev);
      if (count > 10) {
        logger.warn("CLEANUP", `High event listener count (${count}) detected for event '${ev}'.`);
      }
    }
  }

  compactFiles() {
    logger.debug("CLEANUP", "Compacting database files...");
    
    // Clean old history items from rotation pool
    if (usernameRotation.state.history.length > 20) {
      usernameRotation.state.history = usernameRotation.state.history.slice(-20);
      usernameRotation.save();
    }

    worldMemory.validateAll();
    worldMemory.save();
  }

  forceGarbageCollection() {
    if (global.gc) {
      logger.debug("CLEANUP", "Forcing Node.js Garbage Collection.");
      global.gc();
    } else {
      logger.debug("CLEANUP", "Garbage collection not exposed.");
    }
  }
}

export const memoryCleanupManager = new MemoryCleanupManager();
