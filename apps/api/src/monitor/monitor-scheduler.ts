import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { MonitorService } from './monitor.service';

/** @Interval-variant dang dung dynamic registration cho configurable interval. */
@Injectable()
export class MonitorInterval implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MonitorInterval.name);

  constructor(private config: ConfigService, private monitor: MonitorService, private registry: SchedulerRegistry) {}

  onModuleInit() {
    const enabled = this.config.get('monitor.enabled', true);
    if (!enabled) { this.logger.log('Monitor DISABLED by config.'); return; }
    const ms = this.config.get('monitor.intervalMs', 300000);
    this.logger.log('Monitor interval registered: every ' + ms + 'ms (' + Math.round(ms / 1000) + 's).');
    this.registry.addInterval('autonomous-monitor', setInterval(() => this.onTick(), ms));
  }

  onModuleDestroy() {
    try { this.registry.deleteInterval('autonomous-monitor'); } catch { /* ignore */ }
  }

  private async onTick() {
    try {
      const r = await this.monitor.tick();
      if (r.alerted) this.logger.warn('Monitor tick: ' + r.alerted + ' batch(es) bi canh bao tre.');
    } catch (err: any) { this.logger.error('Monitor tick failed: ' + (err?.message || err)); }
  }
}