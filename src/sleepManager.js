import { logger } from './logger.js';
import { eventBus } from './eventBus.js';
import { worldMemory } from './worldMemory.js';
import { config } from './config.js';
import { navigationService } from './core/navigation.js';
import Vec3Module from 'vec3';

const { Vec3 } = Vec3Module;

class SleepManager {
  constructor() {
    this.bot = null;
    this.isSleepingState = false;
    this.isCountingDown = false;

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
  }

  /**
   * Checks if it is nighttime and triggers the sleep routine aggressively.
   */
  async checkAndSleep() {
    if (!this.bot || this.isSleepingState || this.isCountingDown) return;

    const timeOfDay = this.bot.time.timeOfDay;
    // Sunset starts at 12000, sleep is allowed from 12542 to 23999, thundering allows sleep anytime.
    const isNight = timeOfDay >= 12540 || timeOfDay < 120 || this.bot.isRaining;
    
    if (!isNight) return;

    this.isCountingDown = true;
    logger.info("SLEEP", `Night/Sunset detected (Time: ${timeOfDay}). Locating bed...`);

    try {
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
        this.isCountingDown = false;
        return;
      }

      const bedPos = bedBlock.position;
      
      // 3. Move closer to the bed using pathfinder navigation
      let distance = this.bot.entity.position.distanceTo(bedPos);
      if (distance > 2.5) {
        logger.info("SLEEP", `Bed detected at ${bedPos} (distance: ${distance.toFixed(1)} blocks). Navigating...`);
        try {
          const minecraftData = await import('minecraft-data');
          const mcData = minecraftData.default(this.bot.version);
          await navigationService.navigateTo(this.bot, bedPos.x, bedPos.y, bedPos.z, { reach: 2.0, mcData, timeout: 5000 });
        } catch (navErr) {
          logger.warn("SLEEP", `Navigation to bed failed: ${navErr.message}. Attempting direct sleep anyway.`);
        }
      }

      // 4. Sleep Attempt Loop (Aggressive retry every 1 second until time transitions to morning or sleep succeeds)
      let attempts = 0;
      while (this.bot && !this.bot.isSleeping && attempts < 15) {
        const currentTime = this.bot.time.timeOfDay;
        const stillNight = currentTime >= 12540 || currentTime < 120 || this.bot.isRaining;
        if (!stillNight) break;

        logger.info("SLEEP", `Attempting to enter bed at ${bedPos} (Attempt ${attempts + 1}/15)...`);
        try {
          // Look at bed first to guarantee action is facing the block
          await this.bot.lookAt(bedPos, true);
          await this.bot.sleep(bedBlock);
          worldMemory.setBed(bedPos);
          logger.info("SLEEP", "Successfully entered bed.");
          break;
        } catch (err) {
          logger.debug("SLEEP", `Bed use failed: ${err.message}`);
          attempts++;
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    } catch (err) {
      logger.error("SLEEP", `Sleep routine encountered error: ${err.message}`);
      eventBus.emit('bed_failure');
    } finally {
      this.isCountingDown = false;
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
