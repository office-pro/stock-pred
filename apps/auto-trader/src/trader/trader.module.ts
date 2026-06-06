import { Module } from '@nestjs/common';
import { BrokerModule } from '../broker/broker.module';
import { TraderController } from './trader.controller';
import { TraderService } from './trader.service';

@Module({
  imports: [BrokerModule],
  controllers: [TraderController],
  providers: [TraderService],
})
export class TraderModule {}
