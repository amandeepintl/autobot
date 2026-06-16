import { logger } from './logger.js';

class MicroMovement {
  constructor() {
    this.bot = null;
  }

  init(bot) {
    this.bot = bot;
  }

  /**
   * Moves the bot forward for a brief duration.
   * @param {number} ms Duration to hold control
   */
  async moveForward(ms = 500) {
    if (!this.bot) return;
    logger.debug("MOVEMENT", `MicroMove: Forward for ${ms}ms`);
    this.bot.setControlState('forward', true);
    await new Promise(resolve => setTimeout(resolve, ms));
    this.bot.setControlState('forward', false);
  }

  /**
   * Moves the bot backward for a brief duration.
   * @param {number} ms Duration to hold control
   */
  async moveBackward(ms = 500) {
    if (!this.bot) return;
    logger.debug("MOVEMENT", `MicroMove: Backward for ${ms}ms`);
    this.bot.setControlState('back', true);
    await new Promise(resolve => setTimeout(resolve, ms));
    this.bot.setControlState('back', false);
  }

  /**
   * Turns the bot's body relative to current orientation.
   * @param {number} degrees Pos for left, neg for right
   */
  async turn(degrees) {
    if (!this.bot) return;
    const radians = degrees * (Math.PI / 180);
    const newYaw = this.bot.entity.yaw + radians;
    await this.bot.look(newYaw, this.bot.entity.pitch, true);
    logger.debug("MOVEMENT", `MicroMove: Turned yaw by ${degrees} degrees.`);
  }

  async turnLeft(degrees = 90) {
    await this.turn(degrees);
  }

  async turnRight(degrees = 90) {
    await this.turn(-degrees);
  }

  /**
   * Looks directly at a position vector.
   * @param {Vec3} pos 
   */
  async lookAt(pos) {
    if (!this.bot) return;
    try {
      await this.bot.lookAt(pos, true);
    } catch (err) {
      logger.warn("MOVEMENT", `Failed to lookAt: ${err.message}`);
    }
  }

  /**
   * Makes the bot jump once.
   */
  async jump() {
    if (!this.bot) return;
    logger.debug("MOVEMENT", "MicroMove: Jumped");
    this.bot.setControlState('jump', true);
    await new Promise(resolve => setTimeout(resolve, 150));
    this.bot.setControlState('jump', false);
  }
}

export const microMovement = new MicroMovement();
