import fs from 'fs';
import path from 'path';

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};

class Logger {
  constructor() {
    this.config = {
      level: "INFO",
      maxSizeMb: 5,
      retentionDays: 30
    };
    this.logsDir = path.resolve("logs");
    this.archiveDir = path.resolve("logs/archive");
    this.latestLogPath = path.join(this.logsDir, "latest.log");
    this.performanceLogPath = path.join(this.logsDir, "performance.log");
    this.diagnosticsLogPath = path.join(this.logsDir, "diagnostics.log");
    this.supervisorLogPath = path.join(this.logsDir, "supervisor.log");
    
    this.writeQueue = [];
    this.isWriting = false;
  }

  /**
   * Initializes config and ensures directories exist.
   * @param {Object} cfg 
   */
  init(cfg) {
    if (cfg && cfg.logging) {
      this.config = { ...this.config, ...cfg.logging };
    }
    this.ensureDirectories();
    this.cleanOldLogs();
  }

  ensureDirectories() {
    if (!fs.existsSync(this.logsDir)) {
      fs.mkdirSync(this.logsDir, { recursive: true });
    }
    if (!fs.existsSync(this.archiveDir)) {
      fs.mkdirSync(this.archiveDir, { recursive: true });
    }
  }

  /**
   * Cleans archives older than config.retentionDays
   */
  cleanOldLogs() {
    try {
      if (!fs.existsSync(this.archiveDir)) return;
      const files = fs.readdirSync(this.archiveDir);
      const now = Date.now();
      const retentionMs = this.config.retentionDays * 24 * 60 * 60 * 1000;

      for (const file of files) {
        const filePath = path.join(this.archiveDir, file);
        const stats = fs.statSync(filePath);
        if (now - stats.mtimeMs > retentionMs) {
          fs.unlinkSync(filePath);
          this.writeConsole("CLEANUP", `Deleted old archived log: ${file}`, "INFO");
        }
      }
    } catch (err) {
      this.writeConsole("ERROR", `Failed to clean old logs: ${err.message}`, "WARN");
    }
  }

  /**
   * Rotates a log file if it exceeds the max size.
   * @param {string} logPath 
   */
  rotateLogIfNeeded(logPath) {
    try {
      if (!fs.existsSync(logPath)) return;
      const stats = fs.statSync(logPath);
      const maxSizeBytes = this.config.maxSizeMb * 1024 * 1024;
      
      if (stats.size >= maxSizeBytes) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const baseName = path.basename(logPath, ".log");
        const archiveName = `${baseName}_${timestamp}.log`;
        const archivePath = path.join(this.archiveDir, archiveName);
        
        fs.renameSync(logPath, archivePath);
        this.writeConsole("CLEANUP", `Rotated log file ${baseName}.log to archive/${archiveName}`, "INFO");
        this.cleanOldLogs();
      }
    } catch (err) {
      this.writeConsole("ERROR", `Failed to rotate log file ${logPath}: ${err.message}`, "WARN");
    }
  }

  /**
   * Queues a log message to prevent concurrent file write issues.
   * @param {string} category 
   * @param {string} message 
   * @param {string} level 
   */
  log(category, message, level = "INFO") {
    const targetLevelVal = LOG_LEVELS[this.config.level.toUpperCase()] ?? 1;
    const msgLevelVal = LOG_LEVELS[level.toUpperCase()] ?? 1;

    if (msgLevelVal < targetLevelVal) return;

    const timestamp = new Date().toISOString();
    const formattedMessage = `[${timestamp}] [${level}] [${category}] ${message}`;

    this.writeConsole(category, message, level);

    // Queue file writes
    this.writeQueue.push({ category, formattedMessage });
    this.processQueue();
  }

  writeConsole(category, message, level) {
    const colors = {
      DEBUG: "\x1b[36m", // Cyan
      INFO: "\x1b[32m",  // Green
      WARN: "\x1b[33m",  // Yellow
      ERROR: "\x1b[31m"  // Red
    };
    const reset = "\x1b[0m";
    const color = colors[level] || reset;
    console.log(`${color}[${level}] [${category}]${reset} ${message}`);
  }

  async processQueue() {
    if (this.isWriting || this.writeQueue.length === 0) return;
    this.isWriting = true;

    const { category, formattedMessage } = this.writeQueue.shift();

    try {
      this.ensureDirectories();

      // Determine target file
      let targetFile = this.latestLogPath;
      if (category === "SUPERVISOR") {
        targetFile = this.supervisorLogPath;
      } else if (category === "PERFORMANCE") {
        targetFile = this.performanceLogPath;
      } else if (category === "DIAGNOSTICS") {
        targetFile = this.diagnosticsLogPath;
      }

      this.rotateLogIfNeeded(targetFile);
      fs.appendFileSync(targetFile, formattedMessage + "\n", "utf8");

      // Always mirror all writes (except supervisor and diagnostics) to latest.log
      if (targetFile !== this.latestLogPath && category !== "SUPERVISOR" && category !== "DIAGNOSTICS") {
        this.rotateLogIfNeeded(this.latestLogPath);
        fs.appendFileSync(this.latestLogPath, formattedMessage + "\n", "utf8");
      }
    } catch (err) {
      console.error(`[LOGGER ERROR] Failed to write log: ${err.message}`);
    } finally {
      this.isWriting = false;
      // Yield to event loop to prevent stack overflow on large logs
      setImmediate(() => this.processQueue());
    }
  }

  debug(category, message) { this.log(category, message, "DEBUG"); }
  info(category, message) { this.log(category, message, "INFO"); }
  warn(category, message) { this.log(category, message, "WARN"); }
  error(category, message) { this.log(category, message, "ERROR"); }
}

export const logger = new Logger();
