import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';

class BackupManager {
  constructor() {
    this.dataDir = path.resolve("data");
    this.backupsDir = path.resolve("backups");
    this.configPath = path.resolve("src/config.js");
  }

  /**
   * Executes backup of all database JSON files and the current configuration.
   * Saved files include ISO-timestamp format for uniqueness.
   */
  backup() {
    logger.info("BACKUP", "Running scheduled database backup...");
    try {
      if (!fs.existsSync(this.backupsDir)) {
        fs.mkdirSync(this.backupsDir, { recursive: true });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filesToBackup = [
        "rotation.json",
        "worldMemory.json",
        "state.json",
        "metrics.json"
      ];

      // Copy database files
      for (const file of filesToBackup) {
        const sourcePath = path.join(this.dataDir, file);
        if (fs.existsSync(sourcePath)) {
          const destPath = path.join(this.backupsDir, `${path.basename(file, '.json')}_${timestamp}.json`);
          fs.copyFileSync(sourcePath, destPath);
        }
      }

      // Snapshot config.js
      if (fs.existsSync(this.configPath)) {
        const destConfigPath = path.join(this.backupsDir, `config_${timestamp}.js`);
        fs.copyFileSync(this.configPath, destConfigPath);
      }

      logger.info("BACKUP", `Database backup snapshot successfully created at timestamp: ${timestamp}`);
      this.purgeOldBackups();
    } catch (err) {
      logger.error("BACKUP", `Failed to complete backup: ${err.message}`);
    }
  }

  /**
   * Purges backups older than 7 days to prevent backups folder bloating
   */
  purgeOldBackups() {
    try {
      const files = fs.readdirSync(this.backupsDir);
      const now = Date.now();
      const purgeLimitMs = 7 * 24 * 60 * 60 * 1000; // Keep 7 days of backups

      for (const file of files) {
        const filePath = path.join(this.backupsDir, file);
        const stats = fs.statSync(filePath);
        if (now - stats.mtimeMs > purgeLimitMs) {
          fs.unlinkSync(filePath);
        }
      }
    } catch (err) {
      logger.warn("BACKUP", `Failed to purge old backups: ${err.message}`);
    }
  }
}

export const backupManager = new BackupManager();
