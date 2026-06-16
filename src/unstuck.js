import { logger } from './logger.js';
import { config } from './config.js';
import { taskScheduler } from './taskScheduler.js';
import { microMovement } from './microMovement.js';
import { eventBus } from './eventBus.js';

class UnstuckManager {
  constructor() {
    this.bot = null;
    this.lastPosition = null;
    this.stuckTimeMs = 0;

    eventBus.on('bot_disconnect', () => {
      this.bot = null;
    });
    eventBus.on('session_expired', () => {
      this.bot = null;
    });
  }

  init(bot) {
    this.bot = bot;
    this.lastPosition = bot.entity.position.clone();
    this.stuckTimeMs = 0;

    // Register check in Task Scheduler
    taskScheduler.addTask(
      "unstuckCheck",
      config.unstuck.checkIntervalMs || 30000,
      () => this.checkStuckStatus(),
      false
    );

    logger.info("UNSTUCK", "Unstuck detection module initialized.");
  }

  checkStuckStatus() {
    if (!this.bot || this.bot.isSleeping) {
      this.stuckTimeMs = 0;
      return;
    }

    const currentPos = this.bot.entity.position;
    const distance = currentPos.distanceTo(this.lastPosition);

    const checkInterval = config.unstuck.checkIntervalMs || 30000;
    const stuckTimeout = config.unstuck.stuckTimeoutMs || 300000;

    // If bot moved less than 0.05 blocks since last check
    if (distance < 0.05) {
      this.stuckTimeMs += checkInterval;
      
      if (this.stuckTimeMs >= stuckTimeout) {
        logger.warn("UNSTUCK", `Bot detected stuck at ${currentPos.toString()} for ${Math.round(this.stuckTimeMs / 60000)} minutes. Executing unstuck protocol...`);
        this.executeUnstuckProtocol();
      }
    } else {
      this.stuckTimeMs = 0;
      this.lastPosition = currentPos.clone();
    }
  }

  async executeUnstuckProtocol() {
    try {
      // 1. Turn head randomly
      const randomAngle = Math.random() * 360;
      await microMovement.turn(randomAngle);

      // 2. Jump
      await microMovement.jump();
      
      // 3. Short forward step
      await microMovement.moveForward(800);

      logger.info("UNSTUCK", "Unstuck sequence executed.");
      
      // Reset stuck metrics
      this.stuckTimeMs = 0;
      if (this.bot) {
        this.lastPosition = this.bot.entity.position.clone();
      }
    } catch (err) {
      logger.error("UNSTUCK", `Failed to run unstuck routine: ${err.message}`);
    }
  }
}

export const unstuckManager = new UnstuckManager();
