import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import configuration from './config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { LlmModule } from './llm/llm.module';
import { EmbeddingsModule } from './embeddings/embeddings.module';
import { TelegramModule } from './telegram/telegram.module';
import { AgentsModule } from './agents/agents.module';
import { OrdersModule } from './orders/orders.module';
import { BatchesModule } from './batches/batches.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { MonitorModule } from './monitor/monitor.module';
import { KnowledgeModule } from './knowledge/knowledge.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: ['.env', '../../.env'],
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    LlmModule,
    EmbeddingsModule,
    TelegramModule,
    AgentsModule,
    OrdersModule,
    BatchesModule,
    SchedulerModule,
    MonitorModule,
    KnowledgeModule,
  ],
})
export class AppModule {}