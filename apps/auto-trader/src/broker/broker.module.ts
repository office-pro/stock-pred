/**
 * Broker Module
 *
 * Provides BrokerRouter to auto-trader service.
 * Selects broker adapter based on BROKER_TYPE environment variable (default: PAPER).
 */

import { Module } from '@nestjs/common';
import { BrokerRouter } from '@stockpred/broker-sdk';

@Module({
  providers: [
    {
      provide: BrokerRouter,
      useFactory: async () => {
        const brokerType = (process.env.BROKER_TYPE || 'PAPER').toUpperCase();
        console.log(`[broker-module] Creating BrokerRouter with broker type: ${brokerType}`);
        const router = new BrokerRouter({ brokerType });
        if (brokerType === 'PAPER') {
          await router.login();
          console.log('[broker-module] paper adapter ready (no credentials)');
        }
        return router;
      },
    },
  ],
  exports: [BrokerRouter],
})
export class BrokerModule {}
