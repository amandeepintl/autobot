import { EventEmitter } from 'events';

class EventBus extends EventEmitter {
  constructor() {
    super();
    // Increase limit to support multiple decoupled modules listening to same events
    this.setMaxListeners(30);
  }
}

export const eventBus = new EventBus();
