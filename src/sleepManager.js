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
    this.lastSleepFailTime = 0; // 2 minutes cooldown on failure

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
   * Checks if it is nighttime/sunset and triggers the sleep routine with a countdown.
   */
  async checkAndSleep() {
    if (!this.bot || !this.bot.time || this.bot.time.timeOfDay === undefined || this.isSleepingState || this.isCountingDown) return;

    // Check failure cooldown
    if (Date.now() - this.lastSleepFailTime < 120000) return;

    const timeOfDay = this.bot.time.timeOfDay;
    // Sunset starts at 12000. Night sleep allowed from 12542.
    // Thunderstorm must be fully active (thunderState > 0.8) to sleep during the day.
    const isThundering = this.bot.thunderState > 0.8;
    const isNight = timeOfDay >= 12542 || timeOfDay < 120 || isThundering;
    const isSunset = timeOfDay >= 12000 && timeOfDay < 12542;
    
    if (!isNight && !isSunset) return;

    this.isCountingDown = true;
    logger.info("SLEEP", `Sunset/Night detected (Time: ${timeOfDay}, ThunderState: ${this.bot.thunderState}). Locating bed...`);

    let sleepSucceeded = false;

    try {
      let bedBlock = null;
      let bedPos = null;

      // 1. Check world memory first
      if (worldMemory.memory.bed) {
        const savedPos = worldMemory.memory.bed;
        bedPos = new Vec3(savedPos.x, savedPos.y, savedPos.z);
        
        const block = this.bot.blockAt(bedPos);
        if (block) {
          if (block.name.endsWith('_bed')) {
            bedBlock = block;
            logger.info("SLEEP", `Targeting saved bed at: ${bedPos}`);
          } else {
            logger.warn("SLEEP", `Saved bed at ${bedPos} is missing or destroyed (found: ${block.name}).`);
            worldMemory.setBed(null);
            bedPos = null;
          }
        } else {
          logger.info("SLEEP", `Saved bed at ${bedPos} is in an unloaded chunk. Targeting coordinates...`);
        }
      }

      // 2. Search for bed nearby if memory is empty or saved bed was destroyed
      if (!bedPos) {
        logger.info("SLEEP", "Searching for nearest bed in a 64-block radius...");
        bedBlock = this.bot.findBlock({
          matching: (block) => block.name.endsWith('_bed'),
          maxDistance: 64
        });
        if (bedBlock) {
          bedPos = bedBlock.position;
          logger.info("SLEEP", `Found a bed nearby at: ${bedPos}`);
        }
      }

      if (!bedPos) {
        logger.warn("SLEEP", "No beds found nearby within 64 blocks.");
        eventBus.emit('bed_failure');
        this.isCountingDown = false;
        return;
      }

      // 3. Move closer to the bed using pathfinder navigation
      let distance = this.bot.entity.position.distanceTo(bedPos);
      if (distance > 2.5) {
        logger.info("SLEEP", `Bed detected at ${bedPos} (distance: ${distance.toFixed(1)} blocks). Navigating...`);
        try {
          const minecraftData = await import('minecraft-data');
          const mcData = minecraftData.default(this.bot.version);
          await navigationService.navigateTo(this.bot, bedPos.x, bedPos.y, bedPos.z, { reach: 2.0, mcData, timeout: 8000 });
        } catch (navErr) {
          logger.warn("SLEEP", `Navigation to bed failed: ${navErr.message}. Attempting direct sleep anyway.`);
        }
      }

      // 4. Chat countdown ONLY during Sunset (when the sun is on the verge of setting)
      if (isSunset) {
        this.bot.chat("Sun is setting! I am going to sleep in 10 seconds...");
        for (let i = 10; i > 0; i--) {
          if (!this.bot) return;
          this.bot.chat(i.toString());
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      // 5. Sleep Attempt Loop (Aggressive retry every 1 second until time transitions to morning or sleep succeeds)
      let attempts = 0;
      while (this.bot && !this.bot.isSleeping && attempts < 20) {
        const currentTime = this.bot.time.timeOfDay;
        const stillNightOrSunset = (currentTime >= 12000 && currentTime < 23900) || (this.bot.thunderState > 0.8);
        if (!stillNightOrSunset) break;

        logger.info("SLEEP", `Attempting to enter bed at ${bedPos} (Attempt ${attempts + 1}/20)...`);
        
        // Find block again if it was not loaded initially
        if (!bedBlock) {
          const block = this.bot.blockAt(bedPos);
          if (block && block.name.endsWith('_bed')) {
            bedBlock = block;
          }
        }

        try {
          if (bedBlock) {
            await this.bot.lookAt(bedPos, true);
            await this.bot.sleep(bedBlock);
            worldMemory.setBed(bedPos);
            logger.info("SLEEP", "Successfully entered bed.");
            sleepSucceeded = true;
            break;
          } else {
            throw new Error("Bed block data not loaded yet.");
          }
        } catch (err) {
          logger.warn("SLEEP", `Bed use failed: ${err.message}`);
          attempts++;
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    } catch (err) {
      logger.error("SLEEP", `Sleep routine encountered error: ${err.message}`);
      eventBus.emit('bed_failure');
    } finally {
      this.isCountingDown = false;
      // If we went through the routine and failed to sleep, set a 2-minute cooldown
      if (!sleepSucceeded && this.bot && !this.bot.isSleeping) {
        this.lastSleepFailTime = Date.now();
        logger.info("SLEEP", "Sleep routine failed or ended without sleeping. Triggering 2-minute cooldown.");
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
