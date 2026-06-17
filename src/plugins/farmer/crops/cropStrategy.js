export class CropStrategy {
  /**
   * Evaluates if a block is fully grown based on its block state metadata.
   * @param {Object} block 
   * @returns {boolean}
   */
  isFullyGrown(block) {
    throw new Error("isFullyGrown must be implemented by subclass.");
  }

  /**
   * Returns the seed item name needed to replant this crop.
   * @returns {string}
   */
  getSeedName() {
    throw new Error("getSeedName must be implemented by subclass.");
  }

  /**
   * Returns the harvested item name produced by this crop.
   * @returns {string}
   */
  getHarvestName() {
    throw new Error("getHarvestName must be implemented by subclass.");
  }
}
