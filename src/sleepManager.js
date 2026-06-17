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
    this.lastSleepFailTime = 0;
    this._onSleep = null;
    this._onWake = null;

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
    // Remove old listeners to prevent duplication on reconnect
    if (this.bot && this._onSleep) {
      try {
        this.bot.removeListener('sleep', this._onSleep);
        this.bot.removeListener('wake', this._onWake);
      } catch (_) {}
    }

    this.bot = bot;
    this.isSleepingState = false;
    this.isCountingDown = false;

    this._onSleep = () => {
      this.isSleepingState = true;
      logger.info("SLEEP", "Bot is now sleeping in bed.");
      eventBus.emit('sleep_success');
    };

    this._onWake = () => {
      this.isSleepingState = false;
      logger.info("SLEEP", "Bot has woken up.");
      eventBus.emit('wake');
    };

    bot.on('sleep', this._onSleep);
    bot.on('wake', this._onWake);
  }

  /**
   * Checks if it is nighttime/sunset and triggers the sleep routine with a countdown.
   * 
   * Minecraft time reference:
   *   0      = Sunrise / start of day
   *   6000   = Noon
   *   12000  = Sunset begins
   *   12542  = Sleep becomes allowed
   *   13000  = Night (mobs start spawning)
   *   18000  = Midnight
   *   23000  = Dawn approaches
   *   24000  = Next day starts (wraps to 0)
   * 
   * We start countdown at 12300 so that by the time the 10-second countdown
   * finishes (~12542+), sleep is actually allowed by the server.
   */
  async checkAndSleep() {
    if (!this.bot || !this.bot.time || this.bot.time.timeOfDay === undefined || this.isSleepingState || this.isCountingDown) return;

    // Short cooldown on failure (15 seconds instead of 2 minutes)
    if (Date.now() - this.lastSleepFailTime < 15000) return;

    const timeOfDay = this.bot.time.timeOfDay;
    const isThundering = this.bot.thunderState > 0.8;

    // Time ranges where we should sleep:
    //   12300+ (approaching sleep-allowed time) through to 23900 (before dawn)
    //   OR during heavy thunderstorm (sleep allowed any time)
    const shouldSleep = (timeOfDay >= 12300 && timeOfDay <= 23900) || isThundering;

    if (!shouldSleep) return;

    // Determine if we should do a countdown (sun is just setting: 12300-12542)
    const isSunsetCountdown = timeOfDay >= 12300 && timeOfDay < 12542;

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
            worldMemory.clearBed();
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

      // 4. Chat countdown ONLY when sun is about to set (12300-12542)
      if (isSunsetCountdown) {
        this.bot.chat("Sun is setting! Sleeping in 10...");
        for (let i = 10; i > 0; i--) {
          if (!this.bot) return;
          this.bot.chat(i.toString());
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      // 5. Sleep Attempt Loop — retry every 1.5 seconds until sleep succeeds or time passes
      let attempts = 0;
      while (this.bot && !this.bot.isSleeping && attempts < 30) {
        const currentTime = this.bot.time.timeOfDay;
        // Keep trying as long as it's nighttime (12542-23900) or thundering
        const canStillSleep = (currentTime >= 12542 && currentTime <= 23900) || (this.bot.thunderState > 0.8);
        if (!canStillSleep) {
          // If we're in early sunset (12300-12541), wait for sleep to become available
          if (currentTime >= 12300 && currentTime < 12542) {
            attempts++;
            await new Promise(resolve => setTimeout(resolve, 1000));
            continue;
          }
          break; // It's daytime, stop trying
        }

        logger.info("SLEEP", `Attempting to enter bed at ${bedPos} (Attempt ${attempts + 1}/30)...`);
        
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
          await new Promise(resolve => setTimeout(resolve, 1500));
        }
      }
    } catch (err) {
      logger.error("SLEEP", `Sleep routine encountered error: ${err.message}`);
      eventBus.emit('bed_failure');
    } finally {
      this.isCountingDown = false;
      if (!sleepSucceeded && this.bot && !this.bot.isSleeping) {
        this.lastSleepFailTime = Date.now();
        logger.info("SLEEP", "Sleep routine failed. 15-second cooldown before next attempt.");
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
