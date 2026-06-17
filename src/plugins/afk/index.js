import { BaseWorker } from '../../worker/baseWorker.js';
import { logger } from '../../logger.js';
import { microMovement } from '../../microMovement.js';
import { sleepManager } from '../../sleepManager.js';

export default class AfkWorker extends BaseWorker {
  constructor(name, config) {
    super(name, config);
    this.chatInterval = null;
    this.afkActionTimeout = null;
    this.sleepCheckInterval = null;
  }

  async initialize() {
    logger.info("AFK-PLUGIN", "Initializing AFK Plugin...");
    
    // Initialize microMovement & sleepManager
    microMovement.init(this.bot);
    sleepManager.init(this.bot);

    // Register event listeners
    this.bot.on('health', () => {
      logger.debug("AFK-PLUGIN", `Health updated: ${this.bot.health}/20, Food: ${this.bot.food}/20`);
    });

    // Start background loops
    this.startAfkLoop();
    this.startSleepCheckLoop();
    this.startChatLoop();
  }

  startAfkLoop() {
    if (this.afkActionTimeout) clearTimeout(this.afkActionTimeout);

    const min = this.config.antiAfk.minIntervalMs || 5000;
    const max = this.config.antiAfk.maxIntervalMs || 10000;

    const scheduleNextAfk = () => {
      const delay = Math.floor(Math.random() * (max - min + 1)) + min;
      this.afkActionTimeout = setTimeout(async () => {
        if (this.active && this.bot && !this.bot.isSleeping && !sleepManager.isCountingDown) {
          await this.executeAfkAction();
        }
        if (this.active) {
          scheduleNextAfk();
        }
      }, delay);
    };

    scheduleNextAfk();
  }

  async executeAfkAction() {
    const actions = [];
    if (this.config.antiAfk.actions.rotateHead) actions.push('rotateHead');
    if (this.config.antiAfk.actions.crouchToggle) actions.push('crouchToggle');
    if (this.config.antiAfk.actions.shortWalk) actions.push('shortWalk');
    if (this.config.antiAfk.actions.inventoryInteract) actions.push('inventoryInteract');

    if (actions.length === 0) return;

    const action = actions[Math.floor(Math.random() * actions.length)];
    logger.info("AFK-PLUGIN", `Performing AFK movement: ${action}`);

    try {
      switch (action) {
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
          const walkDuration = 400 + Math.random() * 400;
          await microMovement.moveForward(walkDuration);
          await new Promise(resolve => setTimeout(resolve, 500));
          await microMovement.moveBackward(walkDuration);
          break;
        case 'inventoryInteract':
          const randomSlot = Math.floor(Math.random() * 9);
          this.bot.setQuickBarSlot(randomSlot);
          break;
      }
    } catch (err) {
      logger.error("AFK-PLUGIN", `AFK action failed (${action}): ${err.message}`);
    }
  }

  startSleepCheckLoop() {
    if (this.sleepCheckInterval) clearInterval(this.sleepCheckInterval);

    // Sleep check every 2 seconds for high responsiveness
    this.sleepCheckInterval = setInterval(async () => {
      if (this.active && this.bot) {
        await sleepManager.checkAndSleep();
      }
    }, 2000);
  }

  startChatLoop() {
    if (this.chatInterval) clearInterval(this.chatInterval);
    if (!this.config.behavior.chat.enabled) return;

    const min = this.config.behavior.chat.intervalMinMs || 300000;
    const max = this.config.behavior.chat.intervalMaxMs || 300000;

    this.chatInterval = setInterval(() => {
      if (!this.active || !this.bot || this.bot.isSleeping) return;

      const list = this.config.behavior.chat.paragraphs;
      if (!list || list.length === 0) return;

      const paragraph = list[Math.floor(Math.random() * list.length)];
      try {
        this.bot.chat(paragraph);
      } catch (err) {
        logger.error("AFK-PLUGIN", `Failed to send chat: ${err.message}`);
      }
    }, min);
  }

  async shutdown() {
    this.active = false;
    if (this.chatInterval) clearInterval(this.chatInterval);
    if (this.afkActionTimeout) clearTimeout(this.afkActionTimeout);
    if (this.sleepCheckInterval) clearInterval(this.sleepCheckInterval);
    await super.shutdown();
  }
}
