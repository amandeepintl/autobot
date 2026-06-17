import { logger } from '../logger.js';

class TelemetryFramework {
  constructor() {
    this.metrics = new Map(); // workerName -> metrics object
    this.intervals = new Map(); // workerName -> interval reference
  }

  /**
   * Initializes metrics object for a worker if it doesn't exist.
   * @param {string} workerName 
   */
  ensureMetrics(workerName) {
    if (!this.metrics.has(workerName)) {
      this.metrics.set(workerName, {
        tasksCompleted: 0,
        tasksFailed: 0,
        stuckCount: 0,
        pathSuccesses: 0,
        pathFailures: 0,
        itemsDeposited: 0,
        errorsCount: 0,
        startTime: Date.now()
      });
    }
    return this.metrics.get(workerName);
  }

  recordTaskSuccess(workerName) {
    const m = this.ensureMetrics(workerName);
    m.tasksCompleted++;
  }

  recordTaskFailure(workerName) {
    const m = this.ensureMetrics(workerName);
    m.tasksFailed++;
  }

  recordStuck(workerName) {
    const m = this.ensureMetrics(workerName);
    m.stuckCount++;
  }

  recordPathSuccess(workerName, success = true) {
    const m = this.ensureMetrics(workerName);
    if (success) {
      m.pathSuccesses++;
    } else {
      m.pathFailures++;
    }
  }

  recordItemDeposit(workerName, count = 1) {
    const m = this.ensureMetrics(workerName);
    m.itemsDeposited += count;
  }

  recordError(workerName) {
    const m = this.ensureMetrics(workerName);
    m.errorsCount++;
  }

  /**
   * Returns calculated telemetry report for the supervisor.
   * @param {string} workerName 
   */
  getReport(workerName) {
    const m = this.ensureMetrics(workerName);
    const totalPaths = m.pathSuccesses + m.pathFailures;
    const pathSuccessRate = totalPaths > 0 ? (m.pathSuccesses / totalPaths) : 1.0;

    return {
      worker: workerName,
      uptimeSeconds: Math.round((Date.now() - m.startTime) / 1000),
      tasksCompleted: m.tasksCompleted,
      tasksFailed: m.tasksFailed,
      stuckCount: m.stuckCount,
      pathSuccessRate: Math.round(pathSuccessRate * 100) / 100,
      itemsDeposited: m.itemsDeposited,
      errorsCount: m.errorsCount,
      memoryUsageRssMb: Math.round(process.memoryUsage().rss / (1024 * 1024))
    };
  }

  /**
   * Starts periodic reporting to the supervisor via IPC.
   * @param {Object} workerInstance 
   * @param {number} intervalMs 
   */
  startReportingInterval(workerInstance, intervalMs = 60000) {
    const name = workerInstance.name;
    
    if (this.intervals.has(name)) {
      clearInterval(this.intervals.get(name));
    }

    const interval = setInterval(() => {
      if (workerInstance.active) {
        const report = this.getReport(name);
        workerInstance.sendIpc('telemetry', { data: report });
      }
    }, intervalMs);

    this.intervals.set(name, interval);
    logger.info("TELEMETRY", `Started telemetry reporting loop for worker '${name}' (Interval: ${intervalMs / 1000}s)`);
  }

  stopReportingInterval(workerName) {
    if (this.intervals.has(workerName)) {
      clearInterval(this.intervals.get(workerName));
      this.intervals.delete(workerName);
    }
  }
}

export const telemetryFramework = new TelemetryFramework();
