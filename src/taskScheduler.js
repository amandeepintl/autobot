import { logger } from './logger.js';

class TaskScheduler {
  constructor() {
    this.tasks = [];
    this.timerId = null;
    this.tickIntervalMs = 1000; // Single master clock tick
  }

  /**
   * Registers a task into the scheduler.
   * @param {string} name 
   * @param {number} intervalMs 
   * @param {Function} callback 
   * @param {boolean} immediate Whether to run once immediately on startup
   */
  addTask(name, intervalMs, callback, immediate = false) {
    // Remove if task already exists
    this.removeTask(name);

    this.tasks.push({
      name,
      intervalMs,
      callback,
      lastRun: immediate ? 0 : Date.now(),
      enabled: true
    });
  }

  removeTask(name) {
    this.tasks = this.tasks.filter(t => t.name !== name);
  }

  disableTask(name) {
    const task = this.tasks.find(t => t.name === name);
    if (task) task.enabled = false;
  }

  enableTask(name) {
    const task = this.tasks.find(t => t.name === name);
    if (task) task.enabled = true;
  }

  start() {
    if (this.timerId) return;
    logger.info("SCHEDULER", "Starting master tick clock...");
    this.timerId = setInterval(() => this.tick(), this.tickIntervalMs);
  }

  stop() {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
      logger.info("SCHEDULER", "Stopped master tick clock.");
    }
  }

  tick() {
    const now = Date.now();
    for (const task of this.tasks) {
      if (!task.enabled) continue;
      
      if (now - task.lastRun >= task.intervalMs) {
        task.lastRun = now;
        try {
          task.callback();
        } catch (err) {
          logger.error("SCHEDULER", `Error executing task ${task.name}: ${err.message}`);
        }
      }
    }
  }
}

export const taskScheduler = new TaskScheduler();
