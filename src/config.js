/**
 * Autobot Configuration File
 * Supports hot-reloading by checking file modifications periodically.
 */
import fs from 'fs';

try {
  if (fs.existsSync('.env')) {
    process.loadEnvFile('.env');
  }
} catch (_) {}

export const config = {
  server: {
    host: process.env.MC_SERVER_HOST || "localhost",
    port: parseInt(process.env.MC_SERVER_PORT) || 25565,
    version: process.env.MC_SERVER_VERSION || "1.20.4" // Auto-negotiates if null, specify for faster connection
  },
  reconnect: {
    backoffSequence: [10000, 20000, 40000, 80000, 160000, 300000],
    maxFailedAttemptsBeforeCircuitBreaker: 20,
    circuitBreakerCooldownMs: 1800000 // 30 minutes
  },
  watchdog: {
    enabled: true,
    packetTimeoutMs: 30000, // 30s without packet = stuck
    chatTimeoutMs: 300000,  // 5m without any chat event
    tickTimeoutMs: 15000,   // 15s without tick update
    checkIntervalMs: 5000   // Watchdog loop check frequency
  },
  antiAfk: {
    enabled: true,
    minIntervalMs: 5000,  // 5 seconds
    maxIntervalMs: 10000, // 10 seconds
    actions: {
      rotateHead: true,
      crouchToggle: true,
      shortWalk: true,
      inventoryInteract: true
    }
  },
  unstuck: {
    enabled: true,
    checkIntervalMs: 30000,  // Check position every 30s
    stuckTimeoutMs: 300000   // Trigger unstuck after 5m of absolute zero movement
  },
  usernameRotation: {
    enabled: false,
    usernames: ["BOT999"],
    rotationSchedule: "manual",
    sessionDurationMs: 7200000,
    maxUsernameFailures: 3,
    delayBetweenRotationMs: 10000
  },
  healthMonitor: {
    enabled: true,
    checkIntervalMs: 10000,
    maxMemoryRssMb: 300,       // Memory threshold for restart
    maxEventLoopLagMs: 500,    // Event loop blockage detection
    consecutiveViolationsLimit: 3
  },
  logging: {
    level: "INFO", // DEBUG, INFO, WARN, ERROR
    maxSizeMb: 5,
    retentionDays: 30
  },
  performance: {
    profile: "Adaptive", // "Ultra-Low", "Balanced", "Active", "Adaptive"
    tpsThresholds: {
      low: 15,
      critical: 10
    },
    pingThresholds: {
      high: 500,
      critical: 1500
    },
    worldCacheExpiryMs: 1000,
    cleanupIntervalMs: 1800000 // 30 minutes
  },
  backup: {
    intervalMs: 21600000 // 6 hours
  },
  behavior: {
    chat: {
      enabled: true,
      intervalMinMs: 300000,  // 5 minutes
      intervalMaxMs: 300000,  // 5 minutes
      paragraphs: [
        "Just chilling here, hope everyone has a great game! MADE BY Aman",
        "AFK for a bit. Beautiful day to watch the clouds roll by. MADE BY Aman",
        "Chilling near spawn, taking a quick break. MADE BY Aman",
        "Just staying online to keep the server active. Have fun! MADE BY Aman",
        "Watching the iron golems patrol. Good vibes only. MADE BY Aman"
      ]
    }
  },
  aternos: {
    detectOffline: true,
    detectStarting: true,
    detectSleeping: true,
    offlineRetryIntervalMs: 120000, // Wait 2 minutes if offline
    startingRetryIntervalMs: 60000, // Wait 1 minute if starting
    sleepingRetryIntervalMs: 180000 // Wait 3 minutes if sleeping
  },
};

