import { logger } from './logger.js';
import { eventBus } from './eventBus.js';
import { config } from './config.js';

class CircuitBreaker {
  constructor() {
    this.consecutiveFailures = 0;
    this.isOpen = false;
    this.openTime = 0;
  }

  canConnect() {
    if (!this.isOpen) return true;

    const cooldownLimit = config.reconnect.circuitBreakerCooldownMs || 1800000;
    const elapsed = Date.now() - this.openTime;

    if (elapsed >= cooldownLimit) {
      this.close();
      return true;
    }

    return false;
  }

  getCooldownRemainingSeconds() {
    if (!this.isOpen) return 0;
    const cooldownLimit = config.reconnect.circuitBreakerCooldownMs || 1800000;
    const elapsed = Date.now() - this.openTime;
    const remaining = Math.max(0, cooldownLimit - elapsed);
    return Math.round(remaining / 1000);
  }

  onAttemptFailed() {
    this.consecutiveFailures++;
    logger.warn("CIRCUIT", `Connection attempt failed. Consecutive failures: ${this.consecutiveFailures}`);

    const limit = config.reconnect.maxFailedAttemptsBeforeCircuitBreaker || 20;
    if (this.consecutiveFailures >= limit) {
      this.open();
    }
  }

  onAttemptSuccess() {
    if (this.consecutiveFailures > 0) {
      logger.info("CIRCUIT", `Connection successful. Resetting consecutive failures from ${this.consecutiveFailures} to 0.`);
      this.consecutiveFailures = 0;
    }
  }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.openTime = Date.now();
    logger.error("CIRCUIT", `Circuit breaker opened! Too many consecutive failures. Pausing connections.`);
    eventBus.emit('circuit_breaker_opened');
  }

  close() {
    this.isOpen = false;
    this.openTime = 0;
    this.consecutiveFailures = 0;
    logger.info("CIRCUIT", "Circuit breaker closed. Resuming connection attempts.");
    eventBus.emit('circuit_breaker_closed');
  }
}

export const circuitBreaker = new CircuitBreaker();
