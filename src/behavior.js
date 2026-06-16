import { logger } from './logger.js';
import { eventBus } from './eventBus.js';
import { config } from './config.js';
import { taskScheduler } from './taskScheduler.js';

class BehaviorManager {
  constructor() {
    this.bot = null;
    this.safeMode = false;
    this.chatTaskName = "randomChat";

    eventBus.on('bot_disconnect', () => {
      this.bot = null;
    });
    eventBus.on('session_expired', () => {
      this.bot = null;
    });
  }

  init(bot, safeMode = false) {
    this.bot = bot;
    this.safeMode = safeMode;

    logger.info("BEHAVIOR", `Initializing behaviors. Emergency Safe Mode: ${this.safeMode}`);

    if (this.safeMode) {
      logger.warn("BEHAVIOR", "Running in EMERGENCY SAFE MODE. Chat actions are disabled.");
      return;
    }

    // Initialize Chat
    if (config.behavior.chat.enabled) {
      // Schedule first chat after 5 seconds to let the bot stabilize on spawn
      taskScheduler.addTask(
        this.chatTaskName,
        5000,
        () => this.sendRandomChatParagraph(),
        false
      );
    }

    this.registerEvents();
  }

  registerEvents() {
    this.bot.on('health', () => {
      const health = this.bot.health;
      const food = this.bot.food;
      logger.debug("BEHAVIOR", `Stats updated: Health=${health}/20, Food=${food}/20`);
    });
  }

  scheduleNextChat() {
    const min = config.behavior.chat.intervalMinMs || 600000;
    const max = config.behavior.chat.intervalMaxMs || 1800000;
    const interval = Math.floor(Math.random() * (max - min + 1)) + min;

    logger.info("BEHAVIOR", `Scheduling next chat paragraph in ${Math.round(interval / 60000)} minutes.`);
    
    taskScheduler.addTask(
      this.chatTaskName,
      interval,
      () => this.sendRandomChatParagraph(),
      false
    );
  }

  sendRandomChatParagraph() {
    if (!this.bot || this.safeMode || !config.behavior.chat.enabled) return;

    const list = config.behavior.chat.paragraphs;
    if (!list || list.length === 0) return;

    const paragraph = list[Math.floor(Math.random() * list.length)];
    logger.info("BEHAVIOR", "Sending random paragraph to chat...");
    
    try {
      this.bot.chat(paragraph);
      eventBus.emit('message_sent');
    } catch (err) {
      logger.error("BEHAVIOR", `Failed to send chat message: ${err.message}`);
    }

    this.scheduleNextChat();
  }

  stop() {
    taskScheduler.removeTask(this.chatTaskName);
  }
}

export const behaviorManager = new BehaviorManager();
