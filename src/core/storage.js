import { worldKnowledgeService } from './worldKnowledge.js';
import { navigationService } from './navigation.js';
import { Vec3 } from 'vec3';
import { logger } from '../logger.js';

class StorageService {
  /**
   * Registers a chest coordinate location in WorldKnowledge.
   */
  async registerChest(x, y, z, priority = 'general') {
    await worldKnowledgeService.registerBlock('chest', x, y, z, { priority, full: false });
    logger.info("STORAGE", `Registered chest at coordinates: ${x}, ${y}, ${z} (Priority: ${priority})`);
  }

  /**
   * Safe chest deposit route. Finds closest chest, navigates to it, and transfers items.
   * If a chest is full, flags it and attempts fallback chests.
   * @param {Object} bot 
   * @param {string} itemName 
   * @param {number} count 
   * @param {Object} mcData 
   */
  async storeItem(bot, itemName, count, mcData) {
    logger.info("STORAGE", `Request to deposit ${count}x ${itemName}`);
    
    // Find all known chests
    const botPos = bot.entity.position;
    const chests = await worldKnowledgeService.findBlocks('chest', botPos);
    
    const availableChests = chests.filter(c => !c.attributes?.full);
    
    if (availableChests.length === 0) {
      throw new Error("no_chests_available");
    }

    for (const cachedChest of availableChests) {
      const { x, y, z } = cachedChest;
      
      // 1. Verify block still exists in world
      const exists = await worldKnowledgeService.verifyBlock(bot, x, y, z);
      if (!exists) continue; // broken, verifyBlock evicted it, try next

      try {
        // 2. Navigate to chest
        await navigationService.navigateTo(bot, x, y, z, { reach: 2, mcData });

        // 3. Interact with chest block
        const chestBlock = bot.blockAt(new Vec3(x, y, z));
        if (!chestBlock) continue;

        const chestWindow = await bot.openChest(chestBlock);
        
        // Find item in bot inventory
        const botItem = bot.inventory.items().find(i => i.name === itemName);
        if (!botItem) {
          chestWindow.close();
          logger.warn("STORAGE", `Item '${itemName}' not found in bot inventory.`);
          return false;
        }

        const depositCount = Math.min(botItem.count, count);
        
        // Try transferring items
        try {
          await chestWindow.deposit(botItem.type, null, depositCount);
          logger.info("STORAGE", `Deposited ${depositCount}x ${itemName} successfully in chest at ${x},${y},${z}`);
          chestWindow.close();
          return true;
        } catch (depositErr) {
          // If error is full, flag chest
          if (depositErr.message.toLowerCase().includes("full") || depositErr.message.toLowerCase().includes("no space")) {
            logger.warn("STORAGE", `Chest at ${x},${y},${z} is FULL. Flagging in database.`);
            const attributes = cachedChest.attributes || {};
            attributes.full = true;
            await worldKnowledgeService.registerBlock('chest', x, y, z, attributes);
          }
          chestWindow.close();
          logger.error("STORAGE", `Deposit failed on chest ${x},${y},${z}: ${depositErr.message}`);
        }
      } catch (err) {
        logger.error("STORAGE", `Failed navigating/opening chest at ${x},${y},${z}: ${err.message}`);
      }
    }

    throw new Error("all_chests_full_or_unreachable");
  }

  /**
   * Retrieves specific items from nearby chests.
   */
  async retrieveItem(bot, itemName, count, mcData) {
    logger.info("STORAGE", `Request to retrieve ${count}x ${itemName}`);
    
    const botPos = bot.entity.position;
    const chests = await worldKnowledgeService.findBlocks('chest', botPos);

    for (const cachedChest of chests) {
      const { x, y, z } = cachedChest;
      
      const exists = await worldKnowledgeService.verifyBlock(bot, x, y, z);
      if (!exists) continue;

      try {
        await navigationService.navigateTo(bot, x, y, z, { reach: 2, mcData });

        const chestBlock = bot.blockAt(new Vec3(x, y, z));
        if (!chestBlock) continue;

        const chestWindow = await bot.openChest(chestBlock);
        const chestItem = chestWindow.items().find(i => i.name === itemName);
        
        if (!chestItem) {
          chestWindow.close();
          continue; // item not in this chest, try next
        }

        const withdrawCount = Math.min(chestItem.count, count);
        await chestWindow.withdraw(chestItem.type, null, withdrawCount);
        logger.info("STORAGE", `Withdrew ${withdrawCount}x ${itemName} from chest at ${x},${y},${z}`);
        
        chestWindow.close();
        return true;
      } catch (err) {
        logger.error("STORAGE", `Withdrawal attempt failed on chest ${x},${y},${z}: ${err.message}`);
      }
    }

    throw new Error("item_not_found_in_any_chest");
  }
}

export const storageService = new StorageService();
