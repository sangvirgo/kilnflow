import { Module } from '@nestjs/common';
import { BatchesModule } from '../batches/batches.module';
import { AgentsModule } from '../agents/agents.module';
import { TelegramListenerService } from './telegram.listener';
import { TelegramController } from './telegram.controller';

/**
 * Phase 8 — module bot tương tác. Import BatchesModule/AgentsModule (không tạo vòng
 * phụ thuộc: TelegramModule gốc không phụ thuộc ngược lại gì cả).
 */
@Module({
  imports: [BatchesModule, AgentsModule],
  controllers: [TelegramController],
  providers: [TelegramListenerService],
})
export class TelegramListenerModule {}
