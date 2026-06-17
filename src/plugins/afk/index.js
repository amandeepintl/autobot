import { BaseWorker } from '../../worker/baseWorker.js';
import { logger } from '../../logger.js';
import { microMovement } from '../../microMovement.js';

export default class AfkWorker extends BaseWorker {
  constructor(name, config) {
    super(name, config);
    this.chatInterval = null;
    this.afkActionInterval = null;
    this.noticeInterval = null;
    this.lastTriggerTime = 0;
  }

  async initialize() {
    logger.info("AFK-PLUGIN", "Initializing AFK Plugin event listeners...");
    
    // Initialize microMovement with bot instance
    microMovement.init(this.bot);

    // Register event listeners
    this.bot.on('chat', (username, message) => this.handleChat(username, message));
    this.bot.on('health', () => {
      logger.debug("AFK-PLUGIN", `Health updated: ${this.bot.health}/20, Food: ${this.bot.food}/20`);
    });

    // Start background activity loops
    this.startAfkLoop();
    this.startChatLoop();
    this.startNoticeLoop();
  }

  handleChat(username, message) {
    if (username === this.bot.username) return;
    if (!this.config.farmer || !this.config.farmer.enabled) return;

    const msg = message.trim().toLowerCase();

    // 1. Help command
    if (msg.includes('@help')) {
      logger.info("AFK-PLUGIN", `Help command triggered by player: ${username}`);
      this.bot.chat("Commands: @farmer, @farm, @harvest (summons the farmer bot to farm & deposit food), @help (lists active bot commands).");
      return;
    }

    // 2. Farmer commands
    const isTrigger = this.config.farmer.triggerCommands.some(cmd => msg.includes(cmd.toLowerCase()));
    if (!isTrigger) return;

    // Trigger cooldown (30s) to prevent spamming worker forks
    const now = Date.now();
    const cooldown = this.config.farmer.cooldownMs || 30000;
    if (now - this.lastTriggerTime < cooldown) {
      const remaining = Math.round((cooldown - (now - this.lastTriggerTime)) / 1000);
      logger.warn("AFK-PLUGIN", `Trigger rate limit active. Cooldown remaining: ${remaining}s`);
      this.bot.chat(`Farmer command is on cooldown. Try again in ${remaining}s.`);
      return;
    }

    this.lastTriggerTime = now;
    logger.info("AFK-PLUGIN", `Trigger command matched! Player '${username}' requested farming cycle.`);
    this.bot.chat("Request approved. Spawning Farmer Bot...");
    
    // Send IPC request to supervisor to start the farmer bot
    this.sendIpc('worker_message', {
      type: 'start_worker',
      target: 'farmer'
    });
  }

  startAfkLoop() {
    if (this.afkActionInterval) clearInterval(this.afkActionInterval);

    const min = this.config.antiAfk.minIntervalMs || 15000;
    const max = this.config.antiAfk.maxIntervalMs || 15000;
    
    this.afkActionInterval = setInterval(async () => {
      if (!this.active || this.bot.isSleeping) return;

      const actions = [];
      if (this.config.antiAfk.actions.rotateHead) actions.push('rotateHead');
      if (this.config.antiAfk.actions.crouchToggle) actions.push('crouchToggle');
      if (this.config.antiAfk.actions.shortWalk) actions.push('shortWalk');
      if (this.config.antiAfk.actions.inventoryInteract) actions.push('inventoryInteract');

      if (actions.length === 0) return;

      const action = actions[Math.floor(Math.random() * actions.length)];
      
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
    }, min);
  }

  startChatLoop() {
    if (this.chatInterval) clearInterval(this.chatInterval);
    if (!this.config.behavior.chat.enabled) return;

    const min = this.config.behavior.chat.intervalMinMs || 300000;
    const max = this.config.behavior.chat.intervalMaxMs || 300000;

    this.chatInterval = setInterval(() => {
      if (!this.active || this.bot.isSleeping) return;

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

  startNoticeLoop() {
    if (this.noticeInterval) clearInterval(this.noticeInterval);

    this.noticeInterval = setInterval(() => {
      if (!this.active || this.bot.isSleeping) return;
      try {
        this.bot.chat("Tip: If you want a bot to farm food for you, type @farmer, @farm, or @harvest in the chat!");
      } catch (err) {
        logger.error("AFK-PLUGIN", `Failed to send notice chat: ${err.message}`);
      }
    }, 420000); // 7 minutes
  }

  async shutdown() {
    if (this.chatInterval) clearInterval(this.chatInterval);
    if (this.afkActionInterval) clearInterval(this.afkActionInterval);
    if (this.noticeInterval) clearInterval(this.noticeInterval);
    await super.shutdown();
  }
}
