import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';

class StorageManager {
  /**
   * Safely reads and parses a JSON file, falling back to backup if corrupted.
   * @param {string} filePath 
   * @param {Object} defaultValue 
   * @returns {Object} { schemaVersion: number, data: Object }
   */
  read(filePath, defaultValue = {}) {
    const resolvedPath = path.resolve(filePath);
    const backupPath = resolvedPath + '.backup';

    // Ensure default structure matches versioned structure
    const defaultStructure = {
      schemaVersion: 1,
      data: defaultValue
    };

    if (!fs.existsSync(resolvedPath)) {
      if (fs.existsSync(backupPath)) {
        logger.warn("STORAGE", `Primary file missing. Restoring from backup: ${filePath}`);
        return this.restoreFromBackup(resolvedPath, backupPath, defaultStructure);
      }
      return defaultStructure;
    }

    try {
      const content = fs.readFileSync(resolvedPath, 'utf8');
      const parsed = JSON.parse(content);
      
      // Validate schema
      if (typeof parsed !== 'object' || parsed === null || !('schemaVersion' in parsed) || !('data' in parsed)) {
        throw new Error("Invalid structure: missing schemaVersion or data field");
      }
      return parsed;
    } catch (err) {
      logger.error("STORAGE", `File corruption detected in ${filePath}: ${err.message}`);
      return this.restoreFromBackup(resolvedPath, backupPath, defaultStructure);
    }
  }

  /**
   * Restores from backup, or returns default if backup fails too.
   */
  restoreFromBackup(resolvedPath, backupPath, defaultStructure) {
    if (fs.existsSync(backupPath)) {
      try {
        const content = fs.readFileSync(backupPath, 'utf8');
        const parsed = JSON.parse(content);
        if (typeof parsed === 'object' && parsed !== null && 'schemaVersion' in parsed && 'data' in parsed) {
          logger.info("STORAGE", `Successfully restored from backup file: ${backupPath}`);
          // Re-create the primary file from backup atomically
          this.write(resolvedPath, parsed.data, parsed.schemaVersion);
          return parsed;
        }
      } catch (backupErr) {
        logger.error("STORAGE", `Backup file also corrupted: ${backupErr.message}`);
      }
    }

    logger.warn("STORAGE", `Re-creating file with defaults: ${resolvedPath}`);
    this.write(resolvedPath, defaultStructure.data, defaultStructure.schemaVersion);
    return defaultStructure;
  }

  /**
   * Writes data atomically using temporary files and manages the backup file.
   * @param {string} filePath 
   * @param {Object} data 
   * @param {number} schemaVersion 
   */
  write(filePath, data, schemaVersion = 1) {
    const resolvedPath = path.resolve(filePath);
    const dir = path.dirname(resolvedPath);
    const tempPath = resolvedPath + '.tmp';
    const backupPath = resolvedPath + '.backup';

    const payload = {
      schemaVersion,
      data
    };

    try {
      // Ensure directory exists
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // If current primary file exists and is valid, backup it first
      if (fs.existsSync(resolvedPath)) {
        try {
          const currentContent = fs.readFileSync(resolvedPath, 'utf8');
          JSON.parse(currentContent); // Verify it's valid JSON before backing up
          fs.writeFileSync(backupPath, currentContent, 'utf8');
        } catch (e) {
          // Current file was invalid, don't overwrite backup with garbage
          logger.warn("STORAGE", `Skipping backup copy, current file is invalid JSON: ${e.message}`);
        }
      }

      // Write atomically to temp file
      fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2), 'utf8');
      
      // Rename temp to replace primary file (atomic on POSIX, clean overwrite)
      if (process.platform === 'win32') {
        // Windows rename can fail if destination exists, so we delete first if exists
        if (fs.existsSync(resolvedPath)) {
          fs.unlinkSync(resolvedPath);
        }
      }
      fs.renameSync(tempPath, resolvedPath);
    } catch (err) {
      logger.error("STORAGE", `Atomic write failed for ${filePath}: ${err.message}`);
      // Clean up temp file if it remains
      if (fs.existsSync(tempPath)) {
        try { fs.unlinkSync(tempPath); } catch (_) {}
      }
      throw err; // Propagate up for recovery handling
    }
  }
}

export const storageManager = new StorageManager();
