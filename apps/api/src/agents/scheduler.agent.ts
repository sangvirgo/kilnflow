import { Injectable } from '@nestjs/common';
import { SchedulerOutputSchema, SchedulerOutput } from '@kilnflow/shared-types';
import { LlmService } from '../llm/llm.service';
import { parseLlmJson } from '../llm/llm.utils';
import { greedySchedule, SchedBatchInput, SchedKilnInput } from '../scheduler/greedy.util';
import { TraceEmitter } from './trace';
import { SCHEDULER_SYSTEM_PROMPT } from './scheduler.prompts';

export interface SchedulerRunResult { output: SchedulerOutput; mode: 'llm' | 'deterministic-fallback'; notes: string[]; }

/**
 * Scheduler Agent — LLM reasoning version UU TIEN; ket qua PHAI qua:
 * 1) Zod schema validation, 2) sanity re-check nghiep vu trong code
 * (batchCode/kilnId ton tai, khong vuot capacity). Vi pham -> fallback greedy deterministic.
 */
@Injectable()
export class SchedulerAgent {
  constructor(private llm: LlmService) {}

  async propose(batches: SchedBatchInput[], kilns: SchedKilnInput[], emit: TraceEmitter): Promise<SchedulerRunResult> {
    const nowIso = new Date().toISOString();
    const payload = { now: nowIso, batches, kilns };
    const userMsg = '<<<PAYLOAD\n' + JSON.stringify(payload) + '\nPAYLOAD>>>\nPropose the schedule JSON now.';
    const notes: string[] = [];

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const raw = await this.llm.complete(
          [{ role: 'system', content: SCHEDULER_SYSTEM_PROMPT }, { role: 'user', content: attempt === 1 ? userMsg : userMsg + '\nPREVIOUS FAILED:\n' + (notes[0] || '') + '\nReturn corrected JSON only.' }],
          { jsonMode: true, temperature: 0.2, label: 'scheduler-' + attempt },
);
        const cand = parseLlmJson<unknown>(raw);
        const parsed = SchedulerOutputSchema.safeParse(cand);
        if (!parsed.success) {
          notes[0] = parsed.error.issues.map((i) => i.path.join('.') + ': ' + i.message).join('; ');
          continue;
        }
        const violations = this.sanityCheck(parsed.data, batches, kilns);
        if (violations.length) {
          notes[0] = 'sanity violations: ' + violations.join('; ');
          continue;
        }
        emit('✓', 'Scheduler LLM đề xuất ' + parsed.data.schedule.length + ' mẻ vào lò, ' + parsed.data.delayed_batches.length + ' mẻ bị trễ.', 'success', 'scheduler');
        return { output: parsed.data, mode: 'llm', notes };
      } catch (err: any) {
        notes[0] = err?.message || String(err);
      }
    }

    emit('⚠️', 'Scheduler LLM không đạt yêu cầu (' + (notes[0] || '').slice(0, 90) + ') — chuyển sang thuật toán tham lam deterministic.', 'warn', 'scheduler');
    return { output: greedySchedule(batches, kilns), mode: 'deterministic-fallback', notes };
  }

  private sanityCheck(out: SchedulerOutput, batches: SchedBatchInput[], kilns: SchedKilnInput[]): string[] {
    const codes = new Set(batches.map((b) => b.batchCode));
    const kilnById = new Map(kilns.map((k) => [k.id, k]));
    const perKiln = new Map<string, number>();
    const errs: string[] = [];
    for (const s of out.schedule) {
      if (!codes.has(s.batchCode)) errs.push('unknown batchCode ' + s.batchCode);
      const k = kilnById.get(s.kilnId);
      if (!k) errs.push('unknown kilnId ' + s.kilnId);
      else perKiln.set(s.kilnId, (perKiln.get(s.kilnId) || 0) + 1);
      if (Number.isNaN(Date.parse(s.startTime))) errs.push('bad startTime for ' + s.batchCode);
    }
    for (const [kid, count] of perKiln) {
      const cap = kilnById.get(kid)?.capacity ?? 1;
      if (count > cap) errs.push('kiln ' + kid + ' over capacity (' + count + '>' + cap + ')');
    }
    return errs;
  }
}