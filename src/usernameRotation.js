import { storageManager } from './storageManager.js';
import { logger } from './logger.js';
import { config } from './config.js';

class UsernameRotation {
  constructor() {
    this.filePath = "data/rotation.json";
    this.state = {
      currentIndex: 0,
      history: [],
      sessionCount: 0,
      uptimeStats: {}, // username -> total uptime ms
      failureStats: {} // username -> consecutive failures count
    };
  }

  init() {
    try {
      const parsed = storageManager.read(this.filePath, this.state);
      this.state = { ...this.state, ...parsed.data };
      logger.info("ROTATION", `Rotation engine initialized. Current username: ${this.getCurrentUsername()}`);
    } catch (err) {
      logger.error("ROTATION", `Failed to load rotation state: ${err.message}`);
    }
  }

  getCurrentUsername() {
    // If a forced username was set (e.g. from supervisor env), use it
    if (this._forcedUsername) return this._forcedUsername;
    const pool = config.usernameRotation.usernames;
    if (!pool || pool.length === 0) {
      throw new Error("No usernames configured in config.js");
    }
    return pool[this.state.currentIndex % pool.length];
  }

  /**
   * Forces a specific username to be used (set by supervisor via env variable).
   * @param {string} username
   */
  setCurrentUsername(username) {
    this._forcedUsername = username;
    logger.info("ROTATION", `Username forced to: ${username}`);
  }

  /**
   * Rotates to the next available username.
   * Skips usernames that have exceeded the consecutive failure limit.
   * @returns {string} The new username.
   */
  rotate() {
    const pool = config.usernameRotation.usernames;
    const maxFailures = config.usernameRotation.maxUsernameFailures || 3;
    const startIndex = this.state.currentIndex;
    let nextIndex = (startIndex + 1) % pool.length;

    while (nextIndex !== startIndex) {
      const candidate = pool[nextIndex];
      const failures = this.state.failureStats[candidate] || 0;

      if (failures < maxFailures) {
        this.state.currentIndex = nextIndex;
        this.state.sessionCount++;
        this.state.history.push({
          username: candidate,
          rotatedAt: new Date().toISOString()
        });
        
        // Keep history size reasonable (last 50 events)
        if (this.state.history.length > 50) {
          this.state.history.shift();
        }

        this.save();
        logger.info("ROTATION", `Rotated to username: ${candidate}. Current session index: ${this.state.sessionCount}`);
        return candidate;
      }

      logger.warn("ROTATION", `Skipping username '${candidate}' due to too many failures (${failures}/${maxFailures}).`);
      nextIndex = (nextIndex + 1) % pool.length;
    }

    // If all usernames are blacklisted/failed, reset all failures and force rotate
    logger.warn("ROTATION", "All usernames in the pool are blacklisted! Resetting failure counts.");
    for (const key in this.state.failureStats) {
      this.state.failureStats[key] = 0;
    }
    this.state.currentIndex = (startIndex + 1) % pool.length;
    this.save();
    return pool[this.state.currentIndex];
  }

  recordSuccess(username) {
    if (this.state.failureStats[username] !== 0) {
      this.state.failureStats[username] = 0;
      this.save();
    }
  }

  recordFailure(username) {
    const currentFailures = this.state.failureStats[username] || 0;
    this.state.failureStats[username] = currentFailures + 1;
    this.save();
    logger.warn("ROTATION", `Recorded failure for '${username}'. Total consecutive failures: ${this.state.failureStats[username]}`);
  }

  recordUptime(username, uptimeMs) {
    const currentUptime = this.state.uptimeStats[username] || 0;
    this.state.uptimeStats[username] = currentUptime + uptimeMs;
    this.save();
    logger.info("ROTATION", `Recorded ${Math.round(uptimeMs / 1000)}s uptime for '${username}'. Total: ${Math.round(this.state.uptimeStats[username] / 60000)}m.`);
  }

  save() {
    try {
      storageManager.write(this.filePath, this.state, 1);
    } catch (err) {
      logger.error("ROTATION", `Failed to save rotation state: ${err.message}`);
    }
  }
}

export const usernameRotation = new UsernameRotation();
