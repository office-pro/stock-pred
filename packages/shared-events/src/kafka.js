'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.EventConsumer = exports.EventProducer = void 0;
exports.createKafkaClient = createKafkaClient;
const kafkajs_1 = require('kafkajs');
const envelope_1 = require('./envelope');
function createKafkaClient(clientId, brokers) {
  const brokerList = brokers ?? (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(',');
  return new kafkajs_1.Kafka({
    clientId,
    brokers: brokerList,
    // Services log their own connection status; kafkajs retry noise would
    // flood the logs whenever the platform runs in degraded (no-Kafka) mode.
    logLevel: kafkajs_1.logLevel.NOTHING,
    retry: { initialRetryTime: 300, retries: 5 },
  });
}
/** Thin producer with JSON envelope serialization and key-by-symbol support. */
class EventProducer {
  producer;
  connected = false;
  constructor(kafka) {
    this.producer = kafka.producer({ allowAutoTopicCreation: true });
  }
  async connect() {
    if (this.connected) return;
    await this.producer.connect();
    this.connected = true;
  }
  async disconnect() {
    if (!this.connected) return;
    await this.producer.disconnect();
    this.connected = false;
  }
  async publish(topic, payload, key) {
    const envelope = (0, envelope_1.createEnvelope)(topic, payload);
    await this.producer.send({
      topic,
      messages: [{ key: key ?? null, value: (0, envelope_1.serializeEnvelope)(envelope) }],
    });
    return envelope;
  }
}
exports.EventProducer = EventProducer;
/** Thin consumer that decodes envelopes and dispatches them to a handler. */
class EventConsumer {
  consumer;
  connected = false;
  constructor(kafka, groupId) {
    this.consumer = kafka.consumer({ groupId });
  }
  async connect() {
    if (this.connected) return;
    await this.consumer.connect();
    this.connected = true;
  }
  async disconnect() {
    if (!this.connected) return;
    await this.consumer.disconnect();
    this.connected = false;
  }
  async subscribe(topics) {
    for (const topic of topics) {
      await this.consumer.subscribe({ topic, fromBeginning: false });
    }
  }
  async run(handler) {
    await this.consumer.run({
      eachMessage: async ({ topic, message }) => {
        const envelope = (0, envelope_1.parseEnvelope)(message.value);
        if (envelope === null) return;
        try {
          await handler(topic, envelope);
        } catch (error) {
          // Never crash the consumer loop on a single bad event.
          console.error(`[kafka] handler error on ${topic}:`, error);
        }
      },
    });
  }
}
exports.EventConsumer = EventConsumer;
//# sourceMappingURL=kafka.js.map
