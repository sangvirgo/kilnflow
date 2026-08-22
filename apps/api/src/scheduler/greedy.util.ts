// Thuat toan xep lop tham lam deterministic — dung lam FALLBACK cho Scheduler LLM
// va dung de sanity-check ket qua cua LLM.
import { SchedulerOutput, ScheduleEntry, DelayedBatch } from '@kilnflow/shared-types';

export interface SchedBatchInput { batchCode: string; priority: string; deadlineDays: number | null; estimatedFiringHours: number | null; }
export interface SchedKilnInput { id: string; name: string; capacity: number; }

export function greedySchedule(batches: SchedBatchInput[], kilns: SchedKilnInput[], now = new Date()): SchedulerOutput {
  const rank: Record<string, number> = { high: 0, medium: 1, low: 2 };
  const sorted = [...batches].sort((a, b) => {
    const r = (rank[a.priority] ?? 1) - (rank[b.priority] ?? 1);
    if (r !== 0) return r;
    const da = a.deadlineDays == null ? Infinity : a.deadlineDays;
    const db = b.deadlineDays == null ? Infinity : b.deadlineDays;
    return da - db;
  });
  const slots: { kilnId: string; kilnName: string; freeAt: number }[] = [];
  for (const k of kilns) for (let i = 0; i < Math.max(1, k.capacity || 1); i++) slots.push({ kilnId: k.id, kilnName: k.name, freeAt: now.getTime() });
  const schedule: ScheduleEntry[] = [];
  const delayed: DelayedBatch[] = [];
  for (const b of sorted) {
    if (!slots.length) {
      delayed.push({ batchCode: b.batchCode, reason: 'Khong co lo nao kha dung.', suggestion: 'Them lo hoac gop me.' });
      continue;
    }
    slots.sort((x, y) => x.freeAt - y.freeAt);
    const slot = slots[0];
    const start = slot.freeAt;
    slot.freeAt = start + Math.max(4, b.estimatedFiringHours ?? 12) * 3600_000;
    if (b.deadlineDays != null) {
      const finishBy = now.getTime() + b.deadlineDays * 24 * 3600_000;
      if (start + Math.max(4, b.estimatedFiringHours ?? 12) * 3600_000 > finishBy) {
        delayed.push({ batchCode: b.batchCode, reason: 'Slot gan nhat bat dau ' + new Date(start).toISOString().slice(0, 16).replace('T', ' ') + ' — vuot han ' + b.deadlineDays + ' ngay.', suggestion: 'Gop nung voi me cung nhiet do, them ca, hoac doi uu tien.' });
        continue;
      }
    }
    schedule.push({ batchCode: b.batchCode, kilnId: slot.kilnId, kilnName: slot.kilnName, startTime: new Date(start).toISOString() });
  }
  return { schedule, delayed_batches: delayed };
}