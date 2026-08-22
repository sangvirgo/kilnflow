import { Module } from '@nestjs/common';
import { MonitorService } from './monitor.service';
import { MonitorController } from './monitor.controller';
import { MonitorInterval } from './monitor-scheduler';

@Module({
  controllers: [MonitorController],
  providers: [MonitorService, MonitorInterval],
})
export class MonitorModule {}