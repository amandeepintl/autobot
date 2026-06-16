import { logger } from './logger.js';
import { config } from './config.js';
import { taskScheduler } from './taskScheduler.js';
import { microMovement } from './microMovement.js';
import { eventBus } from './eventBus.js';

class AntiAfkModule {
  constructor() {
    this.bot = null;
    this.isActive = false;

    eventBus.on('bot_disconnect', () => {
      this.bot = null;
    });
    eventBus.on('session_expired', () => {
      this.bot = null;
    });
  }

  init(bot) {
    this.bot = bot;
    this.isActive = config.antiAfk.enabled;

    if (this.isActive) {
      this.scheduleNextAction();
    }
  }

  scheduleNextAction() {
    const min = config.antiAfk.minIntervalMs || 180000;
    const max = config.antiAfk.maxIntervalMs || 600000;
    const randomInterval = Math.floor(Math.random() * (max - min + 1)) + min;

    logger.info("AFK", `Scheduling next Anti-AFK action in ${Math.round(randomInterval / 60000)} minutes.`);

    taskScheduler.addTask(
      "antiAfk",
      randomInterval,
      () => this.executeRandomAction(),
      false
    );
  }

  async executeRandomAction() {
    if (!this.bot || !this.isActive) return;

    if (this.bot.isSleeping) {
      logger.debug("AFK", "Bot is sleeping. Postponing Anti-AFK action.");
      this.scheduleNextAction();
      return;
    }

    logger.info("AFK", "Executing Anti-AFK action...");

    const actions = [];
    if (config.antiAfk.actions.rotateHead) actions.push('rotateHead');
    if (config.antiAfk.actions.crouchToggle) actions.push('crouchToggle');
    if (config.antiAfk.actions.shortWalk) actions.push('shortWalk');
    if (config.antiAfk.actions.inventoryInteract) actions.push('inventoryInteract');

    if (actions.length === 0) return;

    const chosenAction = actions[Math.floor(Math.random() * actions.length)];
    logger.info("AFK", `Performing AFK action: ${chosenAction}`);

    try {
      switch (chosenAction) {
        case 'rotateHead':
          const yaw = (Math.random() * 360 - 180) * (Math.PI / 180);
          const pitch = (Math.random() * 90 - 45) * (Math.PI / 180);
          await this.bot.look(yaw, pitch, true);
          break;
        case 'crouchToggle':
          this.bot.setControlState('sneak', true);
          await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 1000));
          this.bot.setControlState('sneak', false);
          break;
        case 'shortWalk':
          // Move forward then backward using microMovement
          const walkDuration = 400 + Math.random() * 400;
          await microMovement.moveForward(walkDuration);
          await new Promise(resolve => setTimeout(resolve, 500));
          await microMovement.moveBackward(walkDuration);
          break;
        case 'inventoryInteract':
          const randomSlot = Math.floor(Math.random() * 9);
          this.bot.setQuickBarSlot(randomSlot);
          await new Promise(resolve => setTimeout(resolve, 500));
          break;
      }
    } catch (err) {
      logger.error("AFK", `Failed to execute AFK action ${chosenAction}: ${err.message}`);
    }

    this.scheduleNextAction();
  }
}

export const antiAfkModule = new AntiAfkModule();
