import { db } from './database.js';
import { logger } from '../logger.js';

class WorldKnowledgeService {
  /**
   * Registers or updates a block's coordinates in the database.
   * @param {string} blockType 
   * @param {number} x 
   * @param {number} y 
   * @param {number} z 
   * @param {Object} attributes 
   */
  async registerBlock(blockType, x, y, z, attributes = {}) {
    const attrJson = JSON.stringify(attributes);
    const now = Date.now();
    const sql = `
      INSERT INTO world_knowledge (block_type, x, y, z, attributes, last_verified)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(x, y, z) DO UPDATE SET
        block_type = excluded.block_type,
        attributes = excluded.attributes,
        last_verified = excluded.last_verified;
    `;
    try {
      await db.run(sql, [blockType, x, y, z, attrJson, now]);
    } catch (err) {
      logger.error("WORLD_KNOWLEDGE", `Failed to register block: ${err.message}`);
    }
  }

  /**
   * Retrieves a block record from database by coordinates.
   * @param {number} x 
   * @param {number} y 
   * @param {number} z 
   */
  async getBlock(x, y, z) {
    const sql = `SELECT * FROM world_knowledge WHERE x = ? AND y = ? AND z = ?;`;
    try {
      const row = await db.get(sql, [x, y, z]);
      if (row && row.attributes) {
        row.attributes = JSON.parse(row.attributes);
      }
      return row;
    } catch (err) {
      logger.error("WORLD_KNOWLEDGE", `Failed to get block: ${err.message}`);
      return null;
    }
  }

  /**
   * Removes a block record from the cache.
   */
  async removeBlock(x, y, z) {
    const sql = `DELETE FROM world_knowledge WHERE x = ? AND y = ? AND z = ?;`;
    try {
      await db.run(sql, [x, y, z]);
    } catch (err) {
      logger.error("WORLD_KNOWLEDGE", `Failed to delete block: ${err.message}`);
    }
  }

  /**
   * Returns list of known blocks of a certain type, sorted by proximity to reference coordinates.
   * @param {string} blockType 
   * @param {Object} refPos - {x, y, z} reference position
   */
  async findBlocks(blockType, refPos = null) {
    const sql = `SELECT * FROM world_knowledge WHERE block_type = ?;`;
    try {
      const rows = await db.all(sql, [blockType]);
      
      const parsedRows = rows.map(r => {
        if (r.attributes) r.attributes = JSON.parse(r.attributes);
        return r;
      });

      if (refPos) {
        // Sort in-memory by Euclidean distance squared to save calculation time
        parsedRows.sort((a, b) => {
          const distA = Math.pow(a.x - refPos.x, 2) + Math.pow(a.y - refPos.y, 2) + Math.pow(a.z - refPos.z, 2);
          const distB = Math.pow(b.x - refPos.x, 2) + Math.pow(b.y - refPos.y, 2) + Math.pow(b.z - refPos.z, 2);
          return distA - distB;
        });
      }

      return parsedRows;
    } catch (err) {
      logger.error("WORLD_KNOWLEDGE", `Failed to query blocks: ${err.message}`);
      return [];
    }
  }

  /**
   * Performs real-time validation of a cached block using the bot's chunk state.
   * If state desynchronization occurs (e.g. block was broken), removes it.
   */
  async verifyBlock(bot, x, y, z) {
    const block = await this.getBlock(x, y, z);
    if (!block) return false;

    try {
      const vec3 = new (await import('vec3')).Vec3(x, y, z);
      const worldBlock = bot.blockAt(vec3);
      
      if (!worldBlock) {
        // Chunk is not loaded, we cannot verify right now. Keep cached but don't update verified time.
        return true;
      }

      if (worldBlock.name !== block.block_type) {
        logger.warn("WORLD_KNOWLEDGE", `Desync detected: Expected ${block.block_type} at ${x},${y},${z} but found ${worldBlock.name}. Evicting.`);
        await this.removeBlock(x, y, z);
        return false;
      }

      // Valid: update timestamp
      const now = Date.now();
      await db.run(`UPDATE world_knowledge SET last_verified = ? WHERE id = ?;`, [now, block.id]);
      return true;
    } catch (err) {
      logger.error("WORLD_KNOWLEDGE", `Verification error: ${err.message}`);
      return false;
    }
  }

  /**
   * Prunes database entries that have not been verified for a long time.
   * @param {number} maxAgeMs 
   */
  async invalidateObsolete(maxAgeMs = 604800000) { // Default 7 days
    const expiry = Date.now() - maxAgeMs;
    const sql = `DELETE FROM world_knowledge WHERE last_verified < ?;`;
    try {
      const res = await db.run(sql, [expiry]);
      if (res.changes > 0) {
        logger.info("WORLD_KNOWLEDGE", `Pruned ${res.changes} expired/obsolete blocks from database.`);
      }
    } catch (err) {
      logger.error("WORLD_KNOWLEDGE", `Expiration cleanup failed: ${err.message}`);
    }
  }
}

export const worldKnowledgeService = new WorldKnowledgeService();
