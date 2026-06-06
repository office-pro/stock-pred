'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.STOCK_UNIVERSE = exports.PrismaClient = void 0;
exports.getPrismaClient = getPrismaClient;
exports.disconnectPrisma = disconnectPrisma;
const client_1 = require('@prisma/client');
let client;
/** Process-wide Prisma singleton (avoids connection-pool exhaustion). */
function getPrismaClient() {
  if (!client) {
    client = new client_1.PrismaClient();
  }
  return client;
}
async function disconnectPrisma() {
  if (client) {
    await client.$disconnect();
    client = undefined;
  }
}
var client_2 = require('@prisma/client');
Object.defineProperty(exports, 'PrismaClient', {
  enumerable: true,
  get: function () {
    return client_2.PrismaClient;
  },
});
var universe_1 = require('./universe');
Object.defineProperty(exports, 'STOCK_UNIVERSE', {
  enumerable: true,
  get: function () {
    return universe_1.STOCK_UNIVERSE;
  },
});
//# sourceMappingURL=index.js.map
