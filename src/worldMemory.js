import { storageManager } from './storageManager.js';
import { logger } from './logger.js';

class WorldMemory {
  constructor() {
    this.filePath = "data/worldMemory.json";
    this.memory = {
      home: null,
      bed: null,
      spawn: null,
      lastSafePosition: null,
      frequentlyVisited: [],
      lastLogoutPosition: null
    };
  }

  init() {
    try {
      const parsed = storageManager.read(this.filePath, this.memory);
      this.memory = { ...this.memory, ...parsed.data };
      this.validateAll();
      logger.info("MEMORY", "World memory loaded and validated.");
    } catch (err) {
      logger.error("MEMORY", `Failed to load world memory: ${err.message}`);
    }
  }

  isValidCoordinate(coord) {
    if (!coord) return false;
    const { x, y, z } = coord;
    return (
      typeof x === 'number' && Number.isFinite(x) &&
      typeof y === 'number' && Number.isFinite(y) && y >= -64 && y <= 320 &&
      typeof z === 'number' && Number.isFinite(z)
    );
  }

  validateAll() {
    if (this.memory.home && !this.isValidCoordinate(this.memory.home)) {
      logger.warn("MEMORY", "Invalid home coordinates detected in memory. Resetting.");
      this.memory.home = null;
    }
    if (this.memory.bed && !this.isValidCoordinate(this.memory.bed)) {
      logger.warn("MEMORY", "Invalid bed coordinates detected in memory. Resetting.");
      this.memory.bed = null;
    }
    if (this.memory.spawn && !this.isValidCoordinate(this.memory.spawn)) {
      logger.warn("MEMORY", "Invalid spawn coordinates detected in memory. Resetting.");
      this.memory.spawn = null;
    }
    if (this.memory.lastSafePosition && !this.isValidCoordinate(this.memory.lastSafePosition)) {
      logger.warn("MEMORY", "Invalid last safe position detected in memory. Resetting.");
      this.memory.lastSafePosition = null;
    }
    if (this.memory.lastLogoutPosition && !this.isValidCoordinate(this.memory.lastLogoutPosition)) {
      logger.warn("MEMORY", "Invalid last logout position detected in memory. Resetting.");
      this.memory.lastLogoutPosition = null;
    }
    this.memory.frequentlyVisited = (this.memory.frequentlyVisited || []).filter(item => {
      const valid = item && typeof item.name === 'string' && this.isValidCoordinate(item);
      if (!valid) logger.warn("MEMORY", `Filtered out invalid frequently visited node: ${JSON.stringify(item)}`);
      return valid;
    });
  }

  setHome(coord) {
    if (this.isValidCoordinate(coord)) {
      this.memory.home = { x: coord.x, y: coord.y, z: coord.z };
      this.save();
    }
  }

  setBed(coord) {
    if (this.isValidCoordinate(coord)) {
      this.memory.bed = { x: coord.x, y: coord.y, z: coord.z };
      this.save();
    }
  }

  /**
   * Clears the stored bed position (e.g. when a bed is destroyed).
   */
  clearBed() {
    this.memory.bed = null;
    this.save();
    logger.info("MEMORY", "Bed position cleared from memory.");
  }

  setSpawn(coord) {
    if (this.isValidCoordinate(coord)) {
      this.memory.spawn = { x: coord.x, y: coord.y, z: coord.z };
      this.save();
    }
  }

  setLastSafePosition(coord) {
    if (this.isValidCoordinate(coord)) {
      this.memory.lastSafePosition = { x: coord.x, y: coord.y, z: coord.z };
      this.save();
    }
  }

  setLastLogoutPosition(coord) {
    if (this.isValidCoordinate(coord)) {
      this.memory.lastLogoutPosition = { x: coord.x, y: coord.y, z: coord.z };
      this.save();
    }
  }

  addFrequentlyVisited(name, coord) {
    if (this.isValidCoordinate(coord)) {
      const existing = this.memory.frequentlyVisited.find(item => item.name === name);
      if (existing) {
        existing.x = coord.x;
        existing.y = coord.y;
        existing.z = coord.z;
      } else {
        this.memory.frequentlyVisited.push({ name, x: coord.x, y: coord.y, z: coord.z });
      }
      this.save();
    }
  }

  save() {
    try {
      storageManager.write(this.filePath, this.memory, 1);
    } catch (err) {
      logger.error("MEMORY", `Failed to save world memory: ${err.message}`);
    }
  }
}

export const worldMemory = new WorldMemory();
