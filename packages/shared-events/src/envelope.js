'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.createEnvelope = createEnvelope;
exports.serializeEnvelope = serializeEnvelope;
exports.parseEnvelope = parseEnvelope;
const crypto_1 = require('crypto');
function createEnvelope(topic, payload) {
  return {
    id: (0, crypto_1.randomUUID)(),
    topic,
    payload,
    producedAt: Date.now(),
    version: 1,
  };
}
function serializeEnvelope(envelope) {
  return JSON.stringify(envelope);
}
function parseEnvelope(raw) {
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw.toString());
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'id' in parsed &&
      'topic' in parsed &&
      'payload' in parsed
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}
//# sourceMappingURL=envelope.js.map
