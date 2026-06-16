import { logger } from './logger.js';
import { eventBus } from './eventBus.js';
import { worldMemory } from './worldMemory.js';
import { microMovement } from './microMovement.js';
import { config } from './config.js';
import Vec3Module from 'vec3';

const { Vec3 } = Vec3Module;

class SleepManager {
  constructor() {
    this.bot = null;
    this.isSleepingState = false;
    this.isCountingDown = false;
    this.sleepAborted = false;
    this.lastAbortTime = 0;

    eventBus.on('bot_disconnect', () => {
      this.bot = null;
      this.isCountingDown = false;
    });
    eventBus.on('session_expired', () => {
      this.bot = null;
      this.isCountingDown = false;
    });
  }

  init(bot) {
    this.bot = bot;

    bot.on('sleep', () => {
      this.isSleepingState = true;
      logger.info("SLEEP", "Bot is now sleeping in bed.");
      eventBus.emit('sleep_success');
    });

    bot.on('wake', () => {
      this.isSleepingState = false;
      logger.info("SLEEP", "Bot has woken up.");
      eventBus.emit('wake');
    });

    bot.on('chat', (username, message) => {
      if (username === bot.username) return;
      if (this.isCountingDown && message.trim().toLowerCase() === 'no') {
        this.sleepAborted = true;
        logger.info("SLEEP", `Sleep aborted by player: ${username}`);
      }
    });
  }

  /**
   * Checks if it is nighttime and triggers the sleep routine.
   */
  async checkAndSleep() {
    if (!this.bot || this.isSleepingState || this.isCountingDown) return;
    if (Date.now() - this.lastAbortTime < 300000) return; // 5-minute cooldown after abort

    const timeOfDay = this.bot.time.timeOfDay;
    const isNight = timeOfDay >= 13000 && timeOfDay < 23000;
    
    if (!isNight) return;

    logger.info("SLEEP", "Night detected. Starting countdown to sleep...");
    this.isCountingDown = true;
    this.sleepAborted = false;

    try {
      this.bot.chat("I'm going to sleep. If you want to keep it night, say 'no' in 15 seconds!");

      for (let i = 15; i > 0; i--) {
        await new Promise(resolve => setTimeout(resolve, 1000));

        if (!this.bot) {
          // Bot was destroyed/disconnected during countdown
          this.isCountingDown = false;
          return;
        }

        if (this.sleepAborted) {
          this.bot.chat("Sleep countdown aborted.");
          this.isCountingDown = false;
          this.lastAbortTime = Date.now();
          return;
        }

        this.bot.chat(i.toString());
      }

      this.isCountingDown = false;
      logger.info("SLEEP", "Countdown finished. Locating bed...");
      eventBus.emit('sleep_attempt');

      let bedBlock = null;

      // 1. Check world memory first
      if (worldMemory.memory.bed) {
        const savedPos = worldMemory.memory.bed;
        const targetVec = new Vec3(savedPos.x, savedPos.y, savedPos.z);
        const block = this.bot.blockAt(targetVec);
        if (block && block.name.endsWith('_bed')) {
          bedBlock = block;
          logger.info("SLEEP", `Targeting saved bed at: ${targetVec}`);
        } else {
          logger.warn("SLEEP", `Saved bed at ${targetVec} is missing or destroyed.`);
          worldMemory.setBed(null);
        }
      }

      // 2. Search for bed nearby if memory is empty
      if (!bedBlock) {
        logger.info("SLEEP", "Searching for nearest bed in a 32-block radius...");
        bedBlock = this.bot.findBlock({
          matching: (block) => block.name.endsWith('_bed'),
          maxDistance: 32
        });
      }

      if (!bedBlock) {
        logger.warn("SLEEP", "No beds found nearby.");
        eventBus.emit('bed_failure');
        return;
      }

      const bedPos = bedBlock.position;
      
      // 3. Move closer to the bed using microMovement iterations
      let attempts = 0;
      let distance = this.bot.entity.position.distanceTo(bedPos);
      logger.info("SLEEP", `Bed detected at distance: ${distance.toFixed(1)} blocks.`);

      // Minecraft sleeping reach is around 3.5 blocks. We aim to get within 3.0 blocks.
      while (distance > 3.0 && attempts < 5) {
        attempts++;
        logger.info("SLEEP", `Bed is too far (${distance.toFixed(1)} blocks). Micro-stepping closer (Attempt ${attempts}/5)...`);
        
        // Turn toward the bed
        await microMovement.lookAt(bedPos);
        
        // Step forward (400ms is about 1 block walk)
        await microMovement.moveForward(400);
        
        // Let physics update position
        await new Promise(resolve => setTimeout(resolve, 300));
        
        distance = this.bot.entity.position.distanceTo(bedPos);
      }

      // 4. Attempt Sleep
      if (distance <= 3.5) {
        await this.attemptSleep(bedBlock);
      } else {
        logger.error("SLEEP", `Abort sleep routine. Failed to get close to the bed after 5 steps. Distance remaining: ${distance.toFixed(1)} blocks.`);
        eventBus.emit('bed_failure');
      }

    } catch (err) {
      logger.error("SLEEP", `Sleep routine error: ${err.message}`);
      eventBus.emit('bed_failure');
    }
  }

  async attemptSleep(bedBlock) {
    if (!this.bot) return;

    logger.info("SLEEP", `Attempting to use bed at: ${bedBlock.position}`);
    
    try {
      await microMovement.lookAt(bedBlock.position);
      await this.bot.sleep(bedBlock);
      // Save bed details to memory on success
      worldMemory.setBed(bedBlock.position);
      logger.info("SLEEP", `Bed registered successfully in memory at: ${bedBlock.position}`);
    } catch (err) {
      logger.error("SLEEP", `Failed to sleep: ${err.message}`);
      eventBus.emit('bed_failure');
      
      if (err.message.includes('occupied')) {
        logger.warn("SLEEP", "Bed is currently occupied.");
      }
    }
  }

  async wakeUp() {
    if (!this.bot || !this.isSleepingState) return;

    logger.info("SLEEP", "Waking up manually...");
    try {
      await this.bot.wake();
    } catch (err) {
      logger.error("SLEEP", `Failed to wake up: ${err.message}`);
    }
  }
}

export const sleepManager = new SleepManager();
