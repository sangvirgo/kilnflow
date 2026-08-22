import { Controller, Post } from '@nestjs/common';
import { MonitorService } from './monitor.service';

@Controller('monitor')
export class MonitorController {
  constructor(private service: MonitorService) {}

  /** Trigger tay de demo — khong can doi interval. */
  @Post('tick')
  tick() { return this.service.tick(); }
}