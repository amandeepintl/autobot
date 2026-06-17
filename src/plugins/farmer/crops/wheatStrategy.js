import { CropStrategy } from './cropStrategy.js';

export class WheatStrategy extends CropStrategy {
  isFullyGrown(block) {
    if (!block) return false;
    const ageProp = block.blockState?.properties?.age ?? block.metadata;
    const age = typeof ageProp === 'string' ? parseInt(ageProp, 10) : ageProp;
    return age === 7;
  }

  getSeedName() {
    return 'wheat_seeds';
  }

  getHarvestName() {
    return 'wheat';
  }
}
