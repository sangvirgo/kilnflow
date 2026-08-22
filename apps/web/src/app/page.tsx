'use client';
import { useEffect, useState } from 'react';
import { API } from '../lib/api';
import { BatchDto, AlertDto, STAGES, Stage } from '@kilnflow/shared-types';

const STAGE_COLORS: Record<string, string> = {
  MOLDING: 'bg-amber-100 border-amber-300',
  DRYING_TRIMMING: 'bg-orange-100 border-orange-300',
  PAINTING: 'bg-pink-100 border-pink-300',
  GLAZING: 'bg-blue-100 border-blue-300',
  FIRING: 'bg-red-100 border-red-300',
  QC_PACKING: 'bg-purple-100 border-purple-300',
  DONE: 'bg-green-100 border-green-300',
};
const PRI_BADGE: Record<string, string> = { high: 'bg-red-500 text-white', medium: 'bg-yellow-400 text-yellow-900', low: 'bg-green-200 text-green-800' };

export default function Dashboard() {
  const [batches, setBatches] = useState<BatchDto[]>([]);
  const [alerts, setAlerts] = useState<AlertDto[]>([]);
  const [msg, setMsg] = useState('');

  const load = async () => {
    try {
      const [b, a] = await Promise.all([
        fetch(API + '/batches').then((r) => r.json()),
        fetch(API + '/alerts?limit=30').then((r) => r.json()),
      ]);
      setBatches(b);
      setAlerts(a);
    } catch (e: any) { setMsg('Loi load: ' + e.message); }
  };

  useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, []);

  const advance = async (id: string) => {
    try {
      await fetch(API + '/batches/' + id + '/stage', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{}' });
      load();
    } catch (e: any) { setMsg('Loi advance: ' + e.message); }
  };

  const runScheduler = async () => {
    try {
      const res = await fetch(API + '/scheduler/run', { method: 'POST' }).then((r) => r.json());
      setMsg('Scheduler: ' + (res.scheduledCount ?? 0) + ' me xep lo, ' + (res.delayedCount ?? 0) + ' me tre.');
      load();
    } catch (e: any) { setMsg('Loi scheduler: ' + e.message); }
  };

  return (
    <div>
      <div className='flex items-center justify-between mb-4'>
        <h1 className='text-xl font-bold'>Kanban Dashboard</h1>
        <div className='flex gap-2'>
          <button onClick={load} className='px-3 py-1 bg-gray-200 rounded text-sm'>Lam moi</button>
          <button onClick={runScheduler} className='px-3 py-1 bg-indigo-600 text-white rounded text-sm'>Chay Scheduler</button>
        </div>
      </div>
      {msg && <div className='mb-3 p-2 bg-blue-50 border border-blue-200 rounded text-sm'>{msg} <button onClick={() => setMsg('')} className='ml-2 text-gray-400'>x</button></div>}
      <div className='grid grid-cols-7 gap-2 mb-6'>
        {STAGES.map((stage) => (
          <div key={stage} className={'rounded border p-2 min-h-[200px] ' + (STAGE_COLORS[stage] || 'bg-gray-100')} >
            <div className='text-xs font-bold mb-2 truncate'>{stage.replace('_', ' ')}</div>
            {batches.filter((b) => b.currentStage === stage).map((b) => (
              <div key={b.id} className='bg-white rounded shadow p-2 mb-2 text-xs'>
                <div className='font-mono font-bold'>#{b.batchCode}</div>
                <div className='truncate'>{b.productName} x{b.quantity}</div>
                <div className='flex items-center gap-1 mt-1'>
                  <span className={'px-1 rounded text-[10px] ' + (PRI_BADGE[b.priority] || '')}>{b.priority}</span>
                  {b.kilnId && <span className='text-gray-400'>lo:{b.kilnId.slice(-3)}</span>}
                </div>
                {stage !== 'DONE' && (
                  <button onClick={() => advance(b.id)} className='mt-1 w-full text-[10px] bg-gray-100 hover:bg-gray-200 rounded py-0.5'>Tien stage</button>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
      <h2 className='text-lg font-bold mb-2'>Alerts</h2>
      <div className='space-y-1'>
        {alerts.length === 0 && <div className='text-sm text-gray-400'>Chua co alert.</div>}
        {alerts.map((a) => (
          <div key={a.id} className={'text-sm p-2 rounded border ' + (a.level === 'critical' ? 'bg-red-50 border-red-300' : a.level === 'warning' ? 'bg-yellow-50 border-yellow-300' : 'bg-gray-50 border-gray-200')}>
            <span className='font-mono text-xs text-gray-500'>#{a.batchCode}</span> 
            <span className={'font-bold ' + (a.level === 'critical' ? 'text-red-600' : a.level === 'warning' ? 'text-yellow-600' : '')}>{a.level.toUpperCase()}</span>
            {' '}{a.message}
            <span className='text-gray-400 text-xs ml-2'>({a.source})</span>
          </div>
        ))}
      </div>
    </div>
  );
}