import { Module } from '@nestjs/common';
import { ParserAgent } from './parser.agent';
import { EstimatorAgent } from './estimator.agent';
import { RiskQcAgent } from './risk-qc.agent';
import { SchedulerAgent } from './scheduler.agent';
import { OrchestratorService } from './orchestrator.service';

@Module({
  providers: [ParserAgent, EstimatorAgent, RiskQcAgent, SchedulerAgent, OrchestratorService],
  exports: [ParserAgent, EstimatorAgent, RiskQcAgent, SchedulerAgent, OrchestratorService],
})
export class AgentsModule {}