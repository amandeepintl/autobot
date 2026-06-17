import { fork } from 'child_process';
import path from 'path';
import { logger } from '../logger.js';
import { eventBus } from '../core/eventBus.js';

class WorkerPool {
  constructor() {
    this.workers = new Map(); // workerName -> process reference
    this.runnerPath = path.resolve("src/worker/workerRunner.js");
  }

  /**
   * Spawns a new worker process of a specific type.
   * @param {string} type - Worker type (e.g. 'afk', 'farmer')
   * @param {Object} envVariables - Environment variables to inject
   */
  spawnWorker(type, envVariables = {}) {
    if (this.workers.has(type)) {
      logger.warn("POOL", `Worker of type '${type}' is already running.`);
      return this.workers.get(type);
    }

    logger.info("POOL", `Spawning child worker process of type: ${type}`);

    const env = {
      ...process.env,
      WORKER_TYPE: type,
      ...envVariables
    };

    const child = fork(this.runnerPath, [], {
      env,
      execArgv: ['--max-old-space-size=256', '--expose-gc'],
      stdio: ['inherit', 'inherit', 'inherit', 'ipc']
    });

    this.workers.set(type, child);

    child.on('message', (message) => {
      if (!message || !message.type) return;

      // Forward heartbeat and standard telemetry to the supervisor
      if (message.type === 'heartbeat') {
        eventBus.emit('worker_heartbeat', { type, timestamp: message.timestamp });
      } else if (message.type === 'telemetry') {
        eventBus.emit('worker_telemetry', { type, data: message.data });
      } else {
        // Generic IPC message forwarding
        eventBus.emit('worker_message', { type, data: message });
      }
    });

    child.on('exit', (code, signal) => {
      logger.warn("POOL", `Worker process '${type}' exited with code: ${code}, signal: ${signal}`);
      this.workers.delete(type);
      eventBus.emit('worker_exited', { type, code, signal });
    });

    child.on('error', (err) => {
      logger.error("POOL", `Worker process '${type}' error: ${err.message}`);
      eventBus.emit('worker_error', { type, error: err });
    });

    return child;
  }

  /**
   * Terminates an active worker cleanly.
   * @param {string} type 
   */
  terminateWorker(type) {
    const child = this.workers.get(type);
    if (!child) {
      logger.warn("POOL", `No running worker of type '${type}' to terminate.`);
      return;
    }

    logger.info("POOL", `Terminating worker process: ${type}`);
    child.kill('SIGTERM');
    
    // Safety timeout to force-kill if worker doesn't exit cleanly
    const killTimeout = setTimeout(() => {
      if (this.workers.has(type)) {
        logger.error("POOL", `Worker '${type}' failed to exit cleanly. Force killing...`);
        try {
          child.kill('SIGKILL');
        } catch (_) {}
        this.workers.delete(type);
      }
    }, 5000);

    child.once('exit', () => {
      clearTimeout(killTimeout);
    });
  }

  /**
   * Shuts down all active workers.
   */
  shutdownAll() {
    logger.info("POOL", "Shutting down all active pool workers...");
    for (const type of this.workers.keys()) {
      this.terminateWorker(type);
    }
  }

  /**
   * Returns list of currently active worker types.
   */
  listActiveWorkers() {
    return Array.from(this.workers.keys());
  }

  /**
   * Checks if worker type is running.
   */
  isWorkerRunning(type) {
    return this.workers.has(type);
  }
}

export const workerPool = new WorkerPool();
