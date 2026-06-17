import { CropStrategy } from './cropStrategy.js';

export class BeetrootStrategy extends CropStrategy {
  isFullyGrown(block) {
    if (!block) return false;
    const ageProp = block.blockState?.properties?.age ?? block.metadata;
    const age = typeof ageProp === 'string' ? parseInt(ageProp, 10) : ageProp;
    return age === 3;
  }

  getSeedName() {
    return 'beetroot_seeds';
  }

  getHarvestName() {
    return 'beetroot';
  }
}
