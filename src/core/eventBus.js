import { EventEmitter } from 'events';

class EventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(100);
  }
}

export const eventBus = new EventBus();

export const EVENTS = {
  WORKER_STARTED: 'worker_started',
  WORKER_STOPPED: 'worker_stopped',
  TASK_ASSIGNED: 'task_assigned',
  TASK_COMPLETED: 'task_completed',
  TASK_FAILED: 'task_failed',
  PATH_FAILED: 'path_failed',
  CHEST_FULL: 'chest_full',
  RESOURCE_DEPLETED: 'resource_depleted',
  DANGER_DETECTED: 'danger_detected'
};
