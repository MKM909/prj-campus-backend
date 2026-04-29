const { EventEmitter } = require('events');

const hub = new EventEmitter();
hub.setMaxListeners(100);

const emitRealtimeEvent = (type, payload) => {
  hub.emit('event', {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type,
    payload,
    created_at: new Date().toISOString()
  });
};

module.exports = {
  hub,
  emitRealtimeEvent
};
