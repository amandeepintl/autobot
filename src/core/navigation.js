import pkgPathfinder from 'mineflayer-pathfinder';
const { pathfinder, Movements, goals } = pkgPathfinder;
import { Vec3 } from 'vec3';
import { logger } from '../logger.js';

class NavigationService {
  constructor() {
    this.routeCache = new Map(); // string key -> path array
  }

  /**
   * Initializes pathfinder plugin on a bot.
   * @param {Object} bot 
   */
  initializePlugin(bot) {
    if (!bot.pathfinder) {
      bot.loadPlugin(pathfinder);
      logger.info("NAVIGATION", "Loaded mineflayer-pathfinder plugin onto bot client.");
    }
  }

  /**
   * Computes movements configurations for a bot.
   * @param {Object} bot 
   * @param {Object} mcData 
   */
  getMovements(bot, mcData) {
    const movements = new Movements(bot, mcData);
    // Configure safe traversal options
    movements.canDig = false; // Prevent bot from breaking world block layouts during navigation
    movements.allowSprinting = true;
    movements.allowParkour = true; // Enable parkour so the bot can climb 1-block boundaries/steps
    
    // Keep farmland in blocksToAvoid to prevent trampling crops while AFK
    if (mcData.blocksByName.farmland) movements.blocksToAvoid.add(mcData.blocksByName.farmland.id);
    
    return movements;
  }

  /**
   * Safe wrapper that navigates the bot to a coordinate with stuck & timeout safety limits.
   * @param {Object} bot 
   * @param {number} x 
   * @param {number} y 
   * @param {number} z 
   * @param {Object} options - { timeout: 30000, reach: 1, mcData: Object }
   */
  async navigateTo(bot, x, y, z, options = {}) {
    this.initializePlugin(bot);

    const mcData = options.mcData || (await import('minecraft-data')).default(bot.version);
    const movements = this.getMovements(bot, mcData);
    bot.pathfinder.setMovements(movements);

    const goal = new goals.GoalNear(x, y, z, options.reach || 1);
    const timeout = options.timeout || 30000; // 30s default timeout
    const startPos = bot.entity.position.clone();
    
    logger.info("NAVIGATION", `Starting navigation to ${x}, ${y}, ${z} (Timeout: ${timeout / 1000}s)`);

    return new Promise((resolve, reject) => {
      let stuckCheckTimer = null;
      let pathTimeoutTimer = null;
      let lastPos = bot.entity.position.clone();
      let stuckTicks = 0;

      const cleanUp = () => {
        if (stuckCheckTimer) clearInterval(stuckCheckTimer);
        if (pathTimeoutTimer) clearTimeout(pathTimeoutTimer);
        bot.removeListener('path_update', onPathUpdate);
        bot.pathfinder.setGoal(null);
      };

      const onPathUpdate = (results) => {
        if (results.status === 'noPath') {
          logger.warn("NAVIGATION", `No path found to ${x},${y},${z}.`);
          cleanUp();
          reject(new Error("no_path"));
        }
      };

      // Register path update failures
      bot.on('path_update', onPathUpdate);

      // Start movement stuck monitor
      stuckCheckTimer = setInterval(() => {
        const currentPos = bot.entity.position;
        const distanceMoved = currentPos.distanceTo(lastPos);
        
        if (distanceMoved < 0.1) {
          stuckTicks++;
          if (stuckTicks >= 5) {
            logger.warn("NAVIGATION", "Stuck detected! Initiating local unstuck action.");
            
            // Check if farmland is directly under the bot's feet
            const blockUnder = bot.blockAt(bot.entity.position.offset(0, -0.5, 0));
            const isFarmlandUnder = blockUnder && blockUnder.name === 'farmland';

            if (!isFarmlandUnder) {
              bot.setControlState('jump', true);
              setTimeout(() => {
                bot.setControlState('jump', false);
              }, 500);
            } else {
              logger.warn("NAVIGATION", "Stuck directly on farmland - avoiding jump to protect crops. Resetting goal.");
              bot.pathfinder.setGoal(null);
            }

            stuckTicks = 0;
          }
        } else {
          stuckTicks = 0;
        }
        lastPos = currentPos.clone();
      }, 500);

      // Enforce navigation timeout budget
      pathTimeoutTimer = setTimeout(() => {
        logger.error("NAVIGATION", `Navigation timed out after ${timeout / 1000}s.`);
        cleanUp();
        reject(new Error("navigation_timeout"));
      }, timeout);

      // Trigger pathfinder goal execution
      bot.pathfinder.setGoal(goal);

      // Hook path completion event
      const onGoalReached = () => {
        logger.info("NAVIGATION", "Goal reached successfully.");
        cleanUp();
        bot.removeListener('goal_reached', onGoalReached);
        resolve(true);
      };

      bot.on('goal_reached', onGoalReached);

      // If the goal fails completely (e.g. plugin aborts)
      bot.once('goal_reset', () => {
        cleanUp();
        bot.removeListener('goal_reached', onGoalReached);
        reject(new Error("goal_aborted"));
      });
    });
  }
}

export const navigationService = new NavigationService();
