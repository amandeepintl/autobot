import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';
import { storageManager } from './storageManager.js';

class DeploymentManager {
  constructor() {
    this.directories = [
      path.resolve("logs"),
      path.resolve("logs/archive"),
      path.resolve("data"),
      path.resolve("backups")
    ];
  }

  /**
   * Deploys the necessary folders and default data files.
   * Assumes Phase 1 of Startup.
   */
  deploy() {
    logger.info("DEPLOYMENT", "Running Phase 1: Deployment & Folder Setup...");
    
    // Create folders
    for (const dir of this.directories) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        logger.info("DEPLOYMENT", `Created folder: ${path.relative(process.cwd(), dir)}`);
      }
    }

    // Generate default data files if missing
    this.initFile("data/rotation.json", {
      currentIndex: 0,
      history: [],
      sessionCount: 0,
      uptimeStats: {}, // username -> total uptime ms
      failureStats: {} // username -> consecutive failures count
    });

    this.initFile("data/worldMemory.json", {
      home: null,
      bed: null,
      spawn: null,
      lastSafePosition: null,
      frequentlyVisited: [], // Array of { name, x, y, z }
      lastLogoutPosition: null
    });

    this.initFile("data/metrics.json", {
      totalUptimeHours: 0,
      longestSessionMs: 0,
      reconnects: 0,
      crashesRecovered: 0,
      accountsUsed: 0,
      messagesSent: 0,
      bedsUsed: 0,
      distanceWalked: 0,
      sleepAttempts: 0,
      sleepSuccesses: 0,
      bedFailures: 0,
      pathfinderFailures: 0,
      averagePing: 0,
      pingSamples: 0
    });

    logger.info("DEPLOYMENT", "Phase 1 complete: Folder and file deployment validated.");
  }

  initFile(filePath, defaultData) {
    const resolvedPath = path.resolve(filePath);
    if (!fs.existsSync(resolvedPath)) {
      try {
        storageManager.write(resolvedPath, defaultData, 1);
        logger.info("DEPLOYMENT", `Initialized default file: ${filePath}`);
      } catch (err) {
        logger.error("DEPLOYMENT", `Failed to deploy default file ${filePath}: ${err.message}`);
        throw err;
      }
    }
  }
}

export const deploymentManager = new DeploymentManager();
