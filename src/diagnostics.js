import fs from 'fs';
import path from 'path';
import { config } from './config.js';

class DiagnosticsEngine {
  constructor() {
    this.diagnosticsLogPath = path.resolve("logs/diagnostics.log");
    this.logs = [];
  }

  log(status, message) {
    const time = new Date().toISOString();
    const entry = `[${time}] [${status}] ${message}`;
    this.logs.push(entry);
    console.log(`[DIAGNOSTICS] [${status}] ${message}`);
  }

  /**
   * Run startup integrity checks.
   * Assumes Phase 2 of Startup.
   * @returns {boolean} true if checks pass, throws error otherwise.
   */
  run() {
    this.logs = [];
    this.log("START", "Running Phase 2: Diagnostics & Environment Checks...");

    try {
      this.checkConfig();
      this.checkDirectories();
      this.checkDataFiles();
      this.checkWritePermissions();
      this.checkDependencies();
      this.checkMemoryLimit();
      
      this.log("SUCCESS", "All diagnostic checks passed successfully.");
      this.writeLog();
      return true;
    } catch (err) {
      this.log("CRITICAL", `Diagnostics failed: ${err.message}`);
      this.writeLog();
      throw new Error(`Diagnostics failed: ${err.message}`);
    }
  }

  checkConfig() {
    this.log("CHECK", "Verifying config...");
    if (!config.server || !config.server.host || !config.server.port) {
      throw new Error("Invalid config: Missing config.server.host or config.server.port");
    }
    if (!config.usernameRotation || !config.usernameRotation.usernames || config.usernameRotation.usernames.length === 0) {
      throw new Error("Invalid config: Missing username pool");
    }
    this.log("PASS", "Config settings validated.");
  }

  checkDirectories() {
    this.log("CHECK", "Verifying directories...");
    const dirs = ["logs", "logs/archive", "data", "backups"];
    for (const dir of dirs) {
      const dirPath = path.resolve(dir);
      if (!fs.existsSync(dirPath)) {
        throw new Error(`Required directory missing: ${dir}`);
      }
    }
    this.log("PASS", "All required directories exist.");
  }

  checkDataFiles() {
    this.log("CHECK", "Verifying data files...");
    const files = [
      "data/rotation.json",
      "data/worldMemory.json",
      "data/metrics.json"
    ];

    for (const file of files) {
      const filePath = path.resolve(file);
      if (!fs.existsSync(filePath)) {
        throw new Error(`Required data file missing: ${file}`);
      }
      // Attempt parse
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(content);
        if (!parsed.schemaVersion || !parsed.data) {
          throw new Error(`Invalid schema structure in ${file}`);
        }
      } catch (e) {
        throw new Error(`Corrupted JSON file ${file}: ${e.message}`);
      }
    }
    this.log("PASS", "Data files are present and syntactically valid.");
  }

  checkWritePermissions() {
    this.log("CHECK", "Verifying file system write permissions...");
    const testFile = path.resolve("data/.test_write");
    try {
      fs.writeFileSync(testFile, "test", "utf8");
      fs.unlinkSync(testFile);
    } catch (err) {
      throw new Error(`File system is read-only or permission is denied: ${err.message}`);
    }
    this.log("PASS", "Write permissions verified.");
  }

  checkDependencies() {
    this.log("CHECK", "Verifying node modules/dependencies...");
    const requiredModules = ['mineflayer', 'minecraft-data', 'vec3'];
    for (const mod of requiredModules) {
      try {
        const modPath = path.resolve(`node_modules/${mod}`);
        if (!fs.existsSync(modPath)) {
          throw new Error(`Module folder not found: node_modules/${mod}`);
        }
      } catch (err) {
        throw new Error(`Dependency check failed for module ${mod}: ${err.message}`);
      }
    }
    this.log("PASS", "All standard dependencies are present.");
  }

  checkMemoryLimit() {
    this.log("CHECK", "Verifying system memory states...");
    const memory = process.memoryUsage();
    const rssMb = Math.round(memory.rss / 1024 / 1024);
    this.log("INFO", `Current process RSS memory usage: ${rssMb} MB`);
    if (rssMb > (config.healthMonitor.maxMemoryRssMb || 120)) {
      throw new Error(`Current memory usage (${rssMb} MB) exceeds maximum allowed limit (${config.healthMonitor.maxMemoryRssMb} MB)`);
    }
    this.log("PASS", "Memory limits verified.");
  }

  writeLog() {
    try {
      fs.writeFileSync(this.diagnosticsLogPath, this.logs.join("\n") + "\n", "utf8");
    } catch (err) {
      console.error(`[DIAGNOSTICS ERROR] Failed to write diagnostics.log: ${err.message}`);
    }
  }
}

export const diagnosticsEngine = new DiagnosticsEngine();
