import { BaseWorker } from '../../worker/baseWorker.js';
import { logger } from '../../logger.js';
import { worldKnowledgeService } from '../../core/worldKnowledge.js';
import { navigationService } from '../../core/navigation.js';
import { storageService } from '../../core/storage.js';
import { recoveryEngine, SEVERITY } from '../../core/recovery.js';
import { telemetryFramework } from '../../core/telemetry.js';
import { Vec3 } from 'vec3';

// Load crop strategies
import { WheatStrategy } from './crops/wheatStrategy.js';
import { CarrotStrategy } from './crops/carrotStrategy.js';
import { PotatoStrategy } from './crops/potatoStrategy.js';
import { BeetrootStrategy } from './crops/beetrootStrategy.js';

export default class FarmerWorker extends BaseWorker {
  constructor(name, config) {
    super(name, config);
    this.strategies = {
      wheat: new WheatStrategy(),
      carrots: new CarrotStrategy(),
      potatoes: new PotatoStrategy(),
      beetroots: new BeetrootStrategy()
    };
    this.homePos = null;
    this.mcData = null;
  }

  async initialize() {
    logger.info("FARMER-PLUGIN", "Initializing Farmer Worker plugin...");
    
    const minecraftData = await import('minecraft-data');
    this.mcData = minecraftData.default(this.bot.version);

    // Initialize services
    navigationService.initializePlugin(this.bot);
    telemetryFramework.startReportingInterval(this, 15000);

    // Set home position where bot spawned
    this.homePos = this.bot.entity.position.clone();
    logger.info("FARMER-PLUGIN", `Home position set to current spawn coordinates: ${this.homePos}`);

    // Register custom recovery handlers
    recoveryEngine.registerHandler(this.name, SEVERITY.PERMANENT, async (worker, err) => {
      logger.warn("FARMER-PLUGIN", `Handling permanent error via custom recovery: ${err.message}`);
      return false; // let default fallback handle it
    });

    // Run the main farming task flow
    this.runFarmingCycle().catch(async (err) => {
      logger.error("FARMER-PLUGIN", `Farming cycle failed with error: ${err.message}`);
      await recoveryEngine.handleFailure(this, err, SEVERITY.FATAL);
    });
  }

  async runFarmingCycle() {
    this.bot.chat("Farmer Bot online. Waiting for chunks to load...");
    await new Promise(resolve => setTimeout(resolve, 5000));

    this.bot.chat("Commencing scanning phase...");
    // 1. Scan the environment for resources (crops, chests, crafting tables)
    await this.scanResources();

    // 2. Harvest all fully grown crops and replant them
    await this.harvestAndReplant();

    // 3. Drop excess seeds to prevent inventory clogging
    await this.tossExcessSeeds();

    // 4. Deposit harvested crops in chest. If full, craft/place new chest.
    await this.depositHarvestedGoods();

    // 5. Return home and announce completion
    await this.returnHome();

    // 6. Request clean exit
    this.bot.chat("Farming tasks complete. Shutting down.");
    this.sendIpc('worker_message', { type: 'stop_worker', target: 'farmer' });
  }

  async scanResources() {
    logger.info("FARMER-PLUGIN", "Scanning nearby chunks for crops, chests, and crafting tables...");

    const radius = this.config.farmer.searchRadius || 32;

    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
      // Find chests
      const chests = this.bot.findBlocks({
        matching: this.mcData.blocksByName.chest.id,
        maxDistance: radius,
        count: 10
      });

      // Find crafting tables
      const tables = this.bot.findBlocks({
        matching: this.mcData.blocksByName.crafting_table.id,
        maxDistance: radius,
        count: 5
      });

      // Find crop blocks
      let totalCropsFound = 0;
      const cropBlockNames = Object.keys(this.strategies);
      const cropsToRegister = [];

      for (const cropName of cropBlockNames) {
        const blockId = this.mcData.blocksByName[cropName]?.id;
        if (!blockId) continue;

        const crops = this.bot.findBlocks({
          matching: blockId,
          maxDistance: radius,
          count: 100
        });
        totalCropsFound += crops.length;
        cropsToRegister.push({ cropName, crops });
      }

      if (chests.length > 0 || tables.length > 0 || totalCropsFound > 0) {
        // Register everything we found
        for (const c of chests) {
          await storageService.registerChest(c.x, c.y, c.z);
        }
        for (const t of tables) {
          await worldKnowledgeService.registerBlock('crafting_table', t.x, t.y, t.z);
        }
        for (const { cropName, crops } of cropsToRegister) {
          for (const cropPos of crops) {
            await worldKnowledgeService.registerBlock(cropName, cropPos.x, cropPos.y, cropPos.z);
          }
        }
        logger.info("FARMER-PLUGIN", `Scan successful! Found ${chests.length} chests, ${tables.length} crafting tables, and ${totalCropsFound} crop blocks.`);
        return;
      }

      attempts++;
      if (attempts < maxAttempts) {
        logger.warn("FARMER-PLUGIN", `Scan returned nothing (attempt ${attempts}/${maxAttempts}). Waiting 3 seconds for chunks to stream...`);
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }

    logger.warn("FARMER-PLUGIN", "Scanning finished but found absolutely no nearby crops, chests, or crafting tables.");
  }

  async harvestAndReplant() {
    logger.info("FARMER-PLUGIN", "Analyzing crop growth cycles...");
    const cropBlockNames = Object.keys(this.strategies);
    const botPos = this.bot.entity.position;

    for (const cropName of cropBlockNames) {
      const strategy = this.strategies[cropName];
      const knownBlocks = await worldKnowledgeService.findBlocks(cropName, botPos);

      for (const cachedBlock of knownBlocks) {
        const { x, y, z } = cachedBlock;
        
        // Load block chunk and verify it exists
        const exists = await worldKnowledgeService.verifyBlock(this.bot, x, y, z);
        if (!exists) continue;

        const block = this.bot.blockAt(new Vec3(x, y, z));
        if (!block || !strategy.isFullyGrown(block)) continue;

        logger.info("FARMER-PLUGIN", `Harvesting fully grown ${cropName} at ${x}, ${y}, ${z}`);
        
        try {
          // Navigate to crop (using 2.5 reach so the bot walks less and harvests faster)
          await navigationService.navigateTo(this.bot, x, y, z, { reach: 2.5, mcData: this.mcData });

          // Break the crop block
          await this.bot.dig(block);
          telemetryFramework.recordTaskSuccess(this.name);

          // Wait 100ms to allow block breaking physics to process
          await new Promise(resolve => setTimeout(resolve, 100));

          // Replant seed on farmland block (farmland is directly beneath, at y - 1)
          const seedName = strategy.getSeedName();
          const seedItem = this.bot.inventory.items().find(i => i.name === seedName);
          
          if (seedItem) {
            const farmlandPos = new Vec3(x, y - 1, z);
            let farmlandBlock = this.bot.blockAt(farmlandPos);

            // Check if farmland reverted to dirt/grass and needs tilling
            if (farmlandBlock && farmlandBlock.name !== 'farmland') {
              logger.warn("FARMER-PLUGIN", `Farmland destroyed at ${x}, ${y - 1}, ${z} (found: ${farmlandBlock.name}). Attempting repair...`);
              try {
                const hoe = await this.ensureHoe();
                await this.bot.equip(hoe, 'hand');
                await this.bot.activateBlock(farmlandBlock);
                await new Promise(resolve => setTimeout(resolve, 300));
                farmlandBlock = this.bot.blockAt(farmlandPos);
              } catch (hoeErr) {
                logger.error("FARMER-PLUGIN", `Failed to repair/till farmland: ${hoeErr.message}`);
              }
            }

            if (farmlandBlock && farmlandBlock.name === 'farmland') {
              await this.bot.equip(seedItem, 'hand');
              await this.bot.placeBlock(farmlandBlock, new Vec3(0, 1, 0));
              logger.info("FARMER-PLUGIN", `Replanted ${seedName} at ${x}, ${y}, ${z}`);
            }
          }
        } catch (err) {
          logger.error("FARMER-PLUGIN", `Failed harvesting crop at ${x},${y},${z}: ${err.message}`);
          telemetryFramework.recordTaskFailure(this.name);
          await recoveryEngine.handleFailure(this, err, SEVERITY.RECOVERABLE);
        }
      }
    }

    // Sweep and collect any items left on the ground after harvesting the field
    await this.collectNearbyDroppedItems();
  }

  async collectNearbyDroppedItems() {
    const radius = 6;
    const botPos = this.bot.entity.position;
    
    // Find all items nearby
    const itemEntities = Object.values(this.bot.entities).filter(e => {
      const isItem = e.type === 'item' || e.name === 'item' || e.objectType === 'Item' || e.objectType === 'Dropped Item';
      if (!isItem) return false;
      return e.position.distanceTo(botPos) <= radius;
    });

    if (itemEntities.length === 0) {
      logger.info("FARMER-PLUGIN", "No dropped items found nearby to collect.");
      return;
    }

    logger.info("FARMER-PLUGIN", `Found ${itemEntities.length} dropped items on the ground. Commencing collection sweep...`);
    for (const item of itemEntities) {
      try {
        // Navigate directly to the item with a fast timeout and tight reach
        await navigationService.navigateTo(this.bot, item.position.x, item.position.y, item.position.z, { reach: 0.5, mcData: this.mcData, timeout: 4000 });
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (err) {
        logger.debug("FARMER-PLUGIN", `Failed to collect dropped item: ${err.message}`);
      }
    }
  }

  async tossExcessSeeds() {
    const minSeeds = this.config.farmer.minSeedsToKeep || 32;
    const cropBlockNames = Object.keys(this.strategies);

    for (const cropName of cropBlockNames) {
      const strategy = this.strategies[cropName];
      const seedName = strategy.getSeedName();
      
      const seedItems = this.bot.inventory.items().filter(i => i.name === seedName);
      const totalSeeds = seedItems.reduce((acc, item) => acc + item.count, 0);

      if (totalSeeds > minSeeds) {
        const tossCount = totalSeeds - minSeeds;
        logger.info("FARMER-PLUGIN", `Tossing ${tossCount} excess seeds of ${seedName}`);
        
        // Loop and toss slots containing seeds
        let thrown = 0;
        for (const item of seedItems) {
          if (thrown >= tossCount) break;
          const throwAmount = Math.min(item.count, tossCount - thrown);
          try {
            await this.bot.toss(item.type, null, throwAmount);
            thrown += throwAmount;
          } catch (err) {
            logger.error("FARMER-PLUGIN", `Failed to toss items: ${err.message}`);
          }
        }
      }
    }
  }

  async depositHarvestedGoods() {
    const cropBlockNames = Object.keys(this.strategies);
    const foodItems = [];

    // Find all harvested products in inventory
    for (const cropName of cropBlockNames) {
      const strategy = this.strategies[cropName];
      const harvestName = strategy.getHarvestName();
      const items = this.bot.inventory.items().filter(i => i.name === harvestName);
      foodItems.push(...items);
    }

    if (foodItems.length === 0) {
      logger.info("FARMER-PLUGIN", "No harvested goods in inventory to deposit.");
      return;
    }

    try {
      for (const food of foodItems) {
        await storageService.storeItem(this.bot, food.name, food.count, this.mcData);
        telemetryFramework.recordItemDeposit(this.name, food.count);
      }
    } catch (err) {
      if (err.message === "all_chests_full_or_unreachable" || err.message === "no_chests_available") {
        logger.warn("FARMER-PLUGIN", "All chests are full. Initiating emergency chest crafting sequence...");
        await this.emergencyCraftAndPlaceChest();
        
        // Retry deposit after placing new chest
        for (const food of foodItems) {
          await storageService.storeItem(this.bot, food.name, food.count, this.mcData);
          telemetryFramework.recordItemDeposit(this.name, food.count);
        }
      } else {
        logger.error("FARMER-PLUGIN", `Deposit failed: ${err.message}`);
        await recoveryEngine.handleFailure(this, err, SEVERITY.PERMANENT);
      }
    }
  }

  async emergencyCraftAndPlaceChest() {
    // 1. Check if we have logs. If not, cut wood!
    const logItems = this.bot.inventory.items().filter(i => i.name.includes("log"));
    const totalLogs = logItems.reduce((acc, item) => acc + item.count, 0);

    if (totalLogs < 2) {
      const logsNeeded = 2 - totalLogs;
      logger.info("FARMER-PLUGIN", `Farming ${logsNeeded} wood logs...`);
      await this.farmWoodLogs(logsNeeded);
    }

    // 2. Find crafting table
    const botPos = this.bot.entity.position;
    const tables = await worldKnowledgeService.findBlocks('crafting_table', botPos);
    if (tables.length === 0) {
      throw new Error("No nearby crafting tables found in database. Cannot craft chest.");
    }
    const tablePos = tables[0];
    
    // 3. Navigate to crafting table
    await navigationService.navigateTo(this.bot, tablePos.x, tablePos.y, tablePos.z, { reach: 2, mcData: this.mcData });

    // 4. Convert logs to planks (planks can be crafted in 2x2 grid)
    const logs = this.bot.inventory.items().find(i => i.name.includes("log"));
    const logName = logs.name;
    const plankName = logName.replace("log", "planks");
    const plankItemId = this.mcData.itemsByName[plankName].id;
    
    const plankRecipes = this.bot.recipesFor(plankItemId, null, 1, null);
    if (plankRecipes.length === 0) {
      throw new Error(`Failed to find recipe for ${plankName}`);
    }
    await this.bot.craft(plankRecipes[0], 2, null); // Craft 2 times (produces 8 planks)
    logger.info("FARMER-PLUGIN", `Crafted 8x ${plankName}`);

    // 5. Open Crafting Table to craft chest (requires 3x3)
    const tableBlock = this.bot.blockAt(new Vec3(tablePos.x, tablePos.y, tablePos.z));
    const tableWindow = await this.bot.openCraftingTable(tableBlock);

    const chestItemId = this.mcData.itemsByName.chest.id;
    const chestRecipes = this.bot.recipesFor(chestItemId, null, 1, tableWindow);
    if (chestRecipes.length === 0) {
      tableWindow.close();
      throw new Error("Failed to find chest recipe inside crafting table window.");
    }
    await this.bot.craft(chestRecipes[0], 1, tableWindow);
    tableWindow.close();
    logger.info("FARMER-PLUGIN", "Successfully crafted chest at crafting table!");

    // 6. Find empty adjacent space and place the chest
    const chestItem = this.bot.inventory.items().find(i => i.name === 'chest');
    if (!chestItem) {
      throw new Error("Chest missing from inventory after crafting.");
    }

    // Attempt to place chest on block adjacent to crafting table
    const placePos = new Vec3(tablePos.x + 1, tablePos.y, tablePos.z);
    const referenceBlock = this.bot.blockAt(new Vec3(tablePos.x + 1, tablePos.y - 1, tablePos.z));
    
    if (referenceBlock) {
      await this.bot.equip(chestItem, 'hand');
      await this.bot.placeBlock(referenceBlock, new Vec3(0, 1, 0));
      
      // Register new chest in database
      await storageService.registerChest(placePos.x, placePos.y, placePos.z);
      this.bot.chat(`I placed a new chest at coordinates ${placePos.x}, ${placePos.y}, ${placePos.z}`);
      logger.info("FARMER-PLUGIN", `Placed new chest at ${placePos.x}, ${placePos.y}, ${placePos.z}`);
    }
  }

  async farmWoodLogs(count) {
    const radius = this.config.farmer.searchRadius || 32;
    const botPos = this.bot.entity.position;
    
    // Find matching logs in the world
    const logBlockIds = [];
    const logNames = ['oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'dark_oak_log', 'acacia_log', 'mangrove_log'];
    for (const name of logNames) {
      const id = this.mcData.blocksByName[name]?.id;
      if (id) logBlockIds.push(id);
    }

    const logBlocks = this.bot.findBlocks({
      matching: logBlockIds,
      maxDistance: radius,
      count: count
    });

    if (logBlocks.length === 0) {
      throw new Error("No trees / log blocks found nearby. Cannot farm wood.");
    }

    let logsGathered = 0;
    for (const logPos of logBlocks) {
      if (logsGathered >= count) break;

      try {
        await navigationService.navigateTo(this.bot, logPos.x, logPos.y, logPos.z, { reach: 2, mcData: this.mcData });
        const logBlock = this.bot.blockAt(new Vec3(logPos.x, logPos.y, logPos.z));
        
        if (logBlock) {
          await this.bot.dig(logBlock);
          logsGathered++;
          
          // Wait 1s to collect drop
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (err) {
        logger.error("FARMER-PLUGIN", `Failed to cut log block: ${err.message}`);
      }
    }
  }

  async returnHome() {
    logger.info("FARMER-PLUGIN", "Returning to home coordinates...");
    try {
      await navigationService.navigateTo(this.bot, this.homePos.x, this.homePos.y, this.homePos.z, { reach: 1, mcData: this.mcData });
    } catch (err) {
      logger.error("FARMER-PLUGIN", `Failed to return home: ${err.message}`);
    }
  }

  async ensureHoe() {
    let hoe = this.bot.inventory.items().find(i => i.name.includes('hoe'));
    if (hoe) return hoe;

    logger.info("FARMER-PLUGIN", "No hoe in inventory. Starting hoe crafting sequence...");

    // 1. Check current logs, planks, and sticks count
    const logItems = this.bot.inventory.items().filter(i => i.name.includes('log'));
    const totalLogs = logItems.reduce((acc, i) => acc + i.count, 0);

    const plankItems = this.bot.inventory.items().filter(i => i.name.includes('planks'));
    const totalPlanks = plankItems.reduce((acc, i) => acc + i.count, 0);

    const stickItem = this.bot.inventory.items().find(i => i.name === 'stick');
    const totalSticks = stickItem ? stickItem.count : 0;

    // A wooden hoe requires 2 planks and 2 sticks.
    // Crafting sticks requires 2 planks.
    const sticksNeeded = Math.max(0, 2 - totalSticks);
    const planksForSticks = sticksNeeded > 0 ? 2 : 0;
    const totalPlanksNeeded = 2 + planksForSticks;

    if (totalPlanks < totalPlanksNeeded) {
      const planksToCraft = totalPlanksNeeded - totalPlanks;
      const logsNeeded = Math.ceil(planksToCraft / 4);
      const logsToFarm = Math.max(0, logsNeeded - totalLogs);

      if (logsToFarm > 0) {
        logger.info("FARMER-PLUGIN", `Farming ${logsToFarm} wood logs for hoe crafting...`);
        await this.farmWoodLogs(logsToFarm);
      }

      // Convert logs to planks
      const freshLogs = this.bot.inventory.items().find(i => i.name.includes('log'));
      if (!freshLogs) throw new Error("Failed to gather logs for hoe.");
      const logName = freshLogs.name;
      const plankName = logName.replace("log", "planks");
      const plankItemId = this.mcData.itemsByName[plankName].id;

      const plankRecipes = this.bot.recipesFor(plankItemId, null, 1, null);
      if (plankRecipes.length === 0) throw new Error(`No plank recipe found for ${plankName}`);
      
      const craftPlankCount = Math.ceil((totalPlanksNeeded - totalPlanks) / 4);
      await this.bot.craft(plankRecipes[0], craftPlankCount, null);
      logger.info("FARMER-PLUGIN", "Crafted planks from logs.");
    }

    // 2. Craft sticks if needed (2 planks = 4 sticks)
    if (totalSticks < 2) {
      const stickItemId = this.mcData.itemsByName.stick.id;
      const stickRecipes = this.bot.recipesFor(stickItemId, null, 1, null);
      if (stickRecipes.length === 0) throw new Error("No stick recipe found.");
      await this.bot.craft(stickRecipes[0], 1, null);
      logger.info("FARMER-PLUGIN", "Crafted sticks from planks.");
    }

    // 3. Find and navigate to crafting table
    const botPos = this.bot.entity.position;
    const tables = await worldKnowledgeService.findBlocks('crafting_table', botPos);
    if (tables.length === 0) {
      throw new Error("No nearby crafting tables found in database. Cannot craft hoe.");
    }
    const tablePos = tables[0];
    await navigationService.navigateTo(this.bot, tablePos.x, tablePos.y, tablePos.z, { reach: 2, mcData: this.mcData });

    // 4. Open crafting table and craft wooden hoe
    const tableBlock = this.bot.blockAt(new Vec3(tablePos.x, tablePos.y, tablePos.z));
    const tableWindow = await this.bot.openCraftingTable(tableBlock);

    const hoeItemId = this.mcData.itemsByName.wooden_hoe.id;
    const hoeRecipes = this.bot.recipesFor(hoeItemId, null, 1, tableWindow);
    if (hoeRecipes.length === 0) {
      tableWindow.close();
      throw new Error("Failed to find wooden hoe recipe inside crafting table window.");
    }
    
    await this.bot.craft(hoeRecipes[0], 1, tableWindow);
    tableWindow.close();
    logger.info("FARMER-PLUGIN", "Wooden hoe crafted successfully!");

    const craftedHoe = this.bot.inventory.items().find(i => i.name === 'wooden_hoe');
    if (!craftedHoe) {
      throw new Error("Wooden hoe missing from inventory after crafting.");
    }
    return craftedHoe;
  }

  async shutdown() {
    telemetryFramework.stopReportingInterval(this.name);
    await super.shutdown();
  }
}
