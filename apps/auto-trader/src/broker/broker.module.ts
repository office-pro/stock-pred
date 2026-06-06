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
      useFactory: () => {
        const brokerType = process.env.BROKER_TYPE || 'PAPER';
        console.log(`[broker-module] Creating BrokerRouter with broker type: ${brokerType}`);
        return new BrokerRouter({ brokerType });
      },
    },
  ],
  exports: [BrokerRouter],
})
export class BrokerModule {}
