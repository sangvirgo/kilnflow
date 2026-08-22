import { Controller, Post } from '@nestjs/common';
import { SchedulerService } from './scheduler.service';

@Controller('scheduler')
export class SchedulerController {
  constructor(private service: SchedulerService) {}

  @Post('run')
  run() { return this.service.run(); }
}