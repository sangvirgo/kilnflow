'use client';
import { useEffect, useState } from 'react';
import { API } from '../lib/api';
import { BatchDto, AlertDto, STAGES, Stage } from '@kilnflow/shared-types';

const STAGE_INDEX: Record<string, number> = Object.fromEntries(STAGES.map((s, i) => [s, i]));

const STAGE_VN: Record<string, string> = {
  MOLDING: 'Tạo hình',
  DRYING_TRIMMING: 'Phơi khô & Tỉa',
  PAINTING: 'Vẽ hoa văn',
  GLAZING: 'Tráng men',
  FIRING: 'Nung',
  QC_PACKING: 'Kiểm tra & Đóng gói',
  DONE: 'Hoàn thành',
};

const STAGE_DOT: Record<string, string> = {
  MOLDING: 'bg-amber-400', DRYING_TRIMMING: 'bg-orange-400', PAINTING: 'bg-pink-400',
  GLAZING: 'bg-blue-400', FIRING: 'bg-red-500', QC_PACKING: 'bg-purple-400', DONE: 'bg-emerald-500',
};

const PRIORITY_BADGE: Record<string, string> = {
  high: 'bg-red-500 text-white',
  medium: 'bg-amber-300 text-amber-900',
  low: 'bg-slate-200 text-slate-600',
};
const PRIORITY_VN: Record<string, string> = { high: 'CAO', medium: 'TB', low: 'THẤP' };

const LEVEL_META: Record<string, { icon: string; label: string; cls: string }> = {
  critical: { icon: '🚨', label: 'NGHIÊM TRỌNG', cls: 'border-red-300 bg-red-50' },
  warning: { icon: '⚠️', label: 'CẢNH BÁO', cls: 'border-amber-300 bg-amber-50' },
  info: { icon: 'ℹ️', label: 'THÔNG TIN', cls: 'border-slate-200 bg-white' },
};

function timeAgo(iso: string): string {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return s + ' giây trước';
  const m = Math.floor(s / 60);
  if (m < 60) return m + ' phút trước';
  const h = Math.floor(m / 60);
  if (h < 24) return h + ' giờ trước';
  return Math.floor(h / 24) + ' ngày trước';
}

export default function Dashboard() {
  const [batches, setBatches] = useState<BatchDto[]>([]);
  const [alerts, setAlerts] = useState<AlertDto[]>([]);
  const [msg, setMsg] = useState('');
  const [qcBatchId, setQcBatchId] = useState<string | null>(null);
  const [qcCount, setQcCount] = useState('0');
  const [qcNote, setQcNote] = useState('');
  // ---- Kéo-thả đổi công đoạn (chỉ cho phép cột kế tiếp) ----
  const [dragging, setDragging] = useState<{ id: string; stage: string } | null>(null);
  const [overStage, setOverStage] = useState<Stage | null>(null);

  const load = async () => {
    try {
      const [b, a] = await Promise.all([
        fetch(API + '/batches').then((r) => r.json()),
        fetch(API + '/alerts?limit=30').then((r) => r.json()),
      ]);
      setBatches(b); setAlerts(a);
    } catch (e: any) { setMsg('Lỗi tải dữ liệu: ' + e.message); }
  };

  useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, []);

  const advance = async (id: string, note?: string) => {
    try {
      const res = await fetch(API + '/batches/' + id + '/stage', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(note ? { note } : {}) });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        setMsg('⚠️ ' + (err?.message || ('HTTP ' + res.status)));
      } else load();
    } catch (e: any) { setMsg('Lỗi tiến stage: ' + e.message); }
  };

  // ---- Kéo-thả ----
  const onCardDragStart = (e: React.DragEvent, b: BatchDto) => {
    if (b.currentStage === 'DONE') { e.preventDefault(); return; }
    setDragging({ id: b.id, stage: b.currentStage });
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', b.id);
  };
  const isValidTarget = (stage: Stage) =>
    !!dragging && STAGE_INDEX[stage] === STAGE_INDEX[dragging.stage] + 1;
  const onColumnDragOver = (e: React.DragEvent, stage: Stage) => {
    if (isValidTarget(stage)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOverStage(stage); }
  };
  const onColumnDrop = (e: React.DragEvent, stage: Stage) => {
    e.preventDefault();
    const b = dragging ? batches.find((x) => x.id === dragging.id) : null;
    setDragging(null); setOverStage(null);
    if (!b || !isValidTarget(stage)) return;
    advance(b.id, 'Kéo-thả trên Kanban');
  };

  const runScheduler = async () => {
    try {
      setMsg('⏳ Scheduler Agent đang xếp lò...');
      const res = await fetch(API + '/scheduler/run', { method: 'POST' }).then((r) => r.json());
      setMsg('🗓 Scheduler hoàn tất: ' + (res.scheduledCount ?? 0) + ' mẻ được xếp lò, ' + (res.delayedCount ?? 0) + ' mẻ trễ.' +
        (res.method === 'deterministic-fallback' ? ' (chế độ dự phòng)' : ''));
      load();
    } catch (e: any) { setMsg('Lỗi scheduler: ' + e.message); }
  };

  const submitQc = async (id: string) => {
    try {
      const res = await fetch(API + '/batches/' + id + '/qc-report', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ defectCount: Number(qcCount), note: qcNote || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || ('HTTP ' + res.status));
      const sevIcon = data.severity === 'critical' ? '🚨' : data.severity === 'warning' ? '⚠️' : 'ℹ️';
      setMsg(sevIcon + ' Đã ghi nhận QC — mức độ: ' + LEVEL_META[data.severity]?.label + '.\n' + (data.telegramMessage || ''));
      setQcBatchId(null); setQcCount('0'); setQcNote('');
      load();
    } catch (e: any) { setMsg('Lỗi gửi báo cáo QC: ' + e.message); }
  };

  // ---- KPI ----
  const active = batches.filter((b) => b.currentStage !== 'DONE');
  const firing = active.filter((b) => b.currentStage === 'FIRING').length;
  const unscheduled = active.filter((b) => !b.scheduledStart).length;
  const openAlerts = alerts.filter((a) => a.level !== 'info').length;
  const kpis = [
    { icon: '🏺', label: 'Lô đang chạy', value: active.length, cls: 'from-indigo-500 to-indigo-400' },
    { icon: '🔥', label: 'Đang trong lò nung', value: firing, cls: 'from-red-500 to-orange-400' },
    { icon: '🗓', label: 'Chờ xếp lò', value: unscheduled, cls: 'from-violet-500 to-fuchsia-400' },
    { icon: '⚠️', label: 'Cảnh báo mở', value: openAlerts, cls: 'from-amber-500 to-yellow-400' },
  ];

  return (
    <div>
      {/* Header */}
      <div className='flex flex-wrap items-center justify-between gap-3 mb-5'>
        <div>
          <h1 className='text-2xl font-extrabold tracking-tight'>Bảng sản xuất</h1>
          <p className='text-sm text-slate-500 mt-0.5'>Sơ đồ Kanban theo giai đoạn — cập nhật tự động mỗi 10 giây.</p>
        </div>
        <div className='flex gap-2'>
          <button onClick={load} className='px-3.5 py-2 bg-white border border-slate-300 rounded-xl text-sm font-medium hover:bg-slate-50'>↻ Làm mới</button>
          <button onClick={runScheduler} className='px-4 py-2 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-indigo-600 to-fuchsia-600 shadow-md shadow-indigo-200 hover:opacity-90'>
            🗓 Chạy Scheduler Agent
          </button>
        </div>
      </div>

      {msg && (
        <div className='mb-4 p-3 bg-indigo-50 border border-indigo-200 rounded-xl text-sm text-indigo-800 whitespace-pre-wrap'>
          {msg} <button onClick={() => setMsg('')} className='ml-2 text-slate-400 hover:text-slate-600'>×</button>
        </div>
      )}

      {/* KPI cards */}
      <div className='grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6'>
        {kpis.map((k) => (
          <div key={k.label} className='bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex items-center gap-3'>
            <div className={'w-11 h-11 rounded-xl bg-gradient-to-br text-xl flex items-center justify-center text-white shadow-md ' + k.cls}>{k.icon}</div>
            <div>
              <div className='text-2xl font-extrabold leading-none'>{k.value}</div>
              <div className='text-xs text-slate-500 mt-1'>{k.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Kanban */}
      <div className='text-xs text-slate-400 mb-2'>💡 Kéo thẻ sang <b>cột bên cạnh</b> để chuyển công đoạn (chỉ cho phép bước kế tiếp — nhảy cóc sẽ bị từ chối).</div>
      <div className='grid grid-cols-7 gap-2.5 mb-8'>
        {STAGES.map((stage) => {
          const list = batches.filter((b) => b.currentStage === stage);
          const isTarget = isValidTarget(stage);
          const isOver = overStage === stage && isTarget;
          return (
            <div
              key={stage}
              onDragOver={(e) => onColumnDragOver(e, stage)}
              onDragLeave={() => setOverStage((cur) => (cur === stage ? null : cur))}
              onDrop={(e) => onColumnDrop(e, stage)}
              className={
                'rounded-2xl border p-2 min-h-[240px] flex flex-col transition-all duration-150 ' +
                (isOver
                  ? 'border-indigo-500 bg-indigo-50 ring-2 ring-indigo-300 scale-[1.02]'
                  : isTarget
                    ? 'border-dashed border-indigo-400 bg-indigo-50/40'
                    : 'border-slate-200 bg-white/70')
              }
            >
              <div className='flex items-center justify-between mb-2 px-1'>
                <div className='flex items-center gap-1.5 min-w-0'>
                  <span className={'w-2 h-2 rounded-full shrink-0 ' + (STAGE_DOT[stage] || 'bg-slate-300')}></span>
                  <span className='text-[11px] font-bold text-slate-600 truncate'>{STAGE_VN[stage]}</span>
                </div>
                <span className='text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500'>{list.length}</span>
              </div>
              <div className='space-y-2 flex-1'>
                {list.map((b) => {
                  const isDragging = dragging?.id === b.id;
                  return (
                  <div
                    key={b.id}
                    draggable={stage !== 'DONE'}
                    onDragStart={(e) => onCardDragStart(e, b)}
                    onDragEnd={() => { setDragging(null); setOverStage(null); }}
                    title='Kéo sang cột bên cạnh để chuyển công đoạn'
                    className={
                      'bg-white rounded-xl border border-slate-200 shadow-sm p-2 text-[11px] hover:border-indigo-300 transition-all cursor-grab active:cursor-grabbing ' +
                      (isDragging ? 'opacity-40 rotate-2' : '')
                    }
                  >
                    <div className='flex items-center justify-between gap-1'>
                      <span className='font-mono font-bold text-slate-700'>#{b.batchCode}</span>
                      <span className={'px-1.5 py-0.5 rounded-md text-[9px] font-extrabold ' + (PRIORITY_BADGE[b.priority] || '')}>
                        {PRIORITY_VN[b.priority] || b.priority}
                      </span>
                    </div>
                    <div className='font-medium text-slate-600 truncate mt-0.5'>{b.productName}</div>
                    <div className='text-slate-400 mt-0.5'>×{b.quantity}{b.deadlineDays != null ? ` · hạn ${b.deadlineDays} ngày` : ''}</div>
                    {(b.kilnId || b.defectCount > 0) && (
                      <div className='flex gap-1 mt-1 flex-wrap'>
                        {b.kilnId && <span className='px-1.5 py-0.5 rounded-md bg-orange-50 text-orange-600 border border-orange-200'>🔥 lò {b.kilnId.slice(-3)}</span>}
                        {b.defectCount > 0 && <span className='px-1.5 py-0.5 rounded-md bg-red-50 text-red-600 border border-red-200'>✕ {b.defectCount} lỗi</span>}
                      </div>
                    )}
                    {stage !== 'DONE' && (
                      <button onClick={() => advance(b.id)} className='mt-1.5 w-full text-[10px] font-semibold bg-slate-100 hover:bg-indigo-100 hover:text-indigo-700 rounded-lg py-1 transition-colors'>
                        Tiến stage →
                      </button>
                    )}
                    {stage === 'QC_PACKING' && (
                      <button
                        onClick={() => { setQcBatchId(qcBatchId === b.id ? null : b.id); setQcCount('0'); setQcNote(''); }}
                        className={'mt-1 w-full text-[10px] font-semibold rounded-lg py-1 transition-colors ' +
                          (qcBatchId === b.id ? 'bg-red-600 text-white' : 'bg-orange-50 text-orange-700 hover:bg-orange-100')}
                      >
                        📋 Báo lỗi QC
                      </button>
                    )}
                    {stage === 'QC_PACKING' && qcBatchId === b.id && (
                      <div className='mt-1 p-1.5 bg-orange-50 rounded-lg border border-orange-200 space-y-1'>
                        <input type='number' min={0} value={qcCount} onChange={(e) => setQcCount(e.target.value)}
                          placeholder='Số SP lỗi' className='w-full border rounded-md px-1 py-0.5' />
                        <textarea value={qcNote} onChange={(e) => setQcNote(e.target.value)} rows={2}
                          placeholder='Ghi chú (vd: nứt men...)' className='w-full border rounded-md px-1 py-0.5 resize-none' />
                        <button onClick={() => submitQc(b.id)} className='w-full bg-red-600 text-white rounded-md py-1 hover:bg-red-700'>Gửi báo cáo</button>
                      </div>
                    )}
                  </div>
                  );
                })}
                {list.length === 0 && <div className='text-center text-[10px] text-slate-300 pt-6'>{isTarget ? '⬅ thả vào đây' : 'trống'}</div>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Alerts */}
      <div className='bg-white rounded-2xl border border-slate-200 shadow-sm p-4'>
        <div className='flex items-center justify-between mb-3'>
          <h2 className='font-bold text-slate-800'>Cảnh báo gần đây</h2>
          <span className='text-[11px] text-slate-400'>từ Risk/QC Agent · Monitor tự động · Scheduler</span>
        </div>
        <div className='space-y-1.5 max-h-80 overflow-y-auto kf-scroll pr-1'>
          {alerts.length === 0 && <div className='text-sm text-slate-300 py-6 text-center'>Chưa có cảnh báo nào — mọi thứ đang ổn ✨</div>}
          {alerts.map((a) => {
            const m = LEVEL_META[a.level] || LEVEL_META.info;
            return (
              <div key={a.id} className={'flex items-start gap-2.5 text-sm p-2.5 rounded-xl border ' + m.cls}>
                <span>{m.icon}</span>
                <div className='flex-1 min-w-0'>
                  <span className='font-bold text-xs mr-1.5'>{m.label}</span>
                  <span className='text-slate-700'>{a.message}</span>
                  <div className='text-[11px] text-slate-400 mt-0.5'>
                    #{a.batchCode} · {timeAgo(a.createdAt)} · nguồn: {a.source}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
