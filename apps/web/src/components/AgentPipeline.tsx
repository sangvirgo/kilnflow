'use client';
import { TraceEvent } from '@kilnflow/shared-types';

export type AgentKey = 'parser' | 'estimator' | 'risk';
type State = 'pending' | 'active' | 'done';

const AGENTS: { key: AgentKey; icon: string; name: string; desc: string; color: string }[] = [
  { key: 'parser', icon: '🔍', name: 'Parser Agent', desc: 'Đọc đơn tự do → JSON có kiểm chứng', color: 'sky' },
  { key: 'estimator', icon: '📦', name: 'Estimator Agent', desc: 'RAG tra mẻ lịch sử để ước lượng', color: 'violet' },
  { key: 'risk', icon: '🛡️', name: 'Risk/QC Agent', desc: 'Rà rủi ro men · nhiệt · deadline', color: 'rose' },
];

/** Tính trạng thái từng agent từ chuỗi trace events (theo thứ tự thời gian). */
export function computeAgentStates(traces: TraceEvent[], finished: boolean): Record<AgentKey, State> {
  const st: Record<AgentKey, State> = { parser: 'pending', estimator: 'pending', risk: 'pending' };
  for (const t of traces) {
    const ag = t.agent as AgentKey | undefined;
    if (ag && ag in st) st[ag] = 'active';
    // agent kế tiếp bắt đầu => các agent trước đó đã xong
    if (ag === 'estimator') st.parser = 'done';
    if (ag === 'risk') { st.parser = 'done'; st.estimator = 'done'; }
  }
  if (finished) return { parser: 'done', estimator: 'done', risk: 'done' };
  return st;
}

function lastMessage(traces: TraceEvent[], key: AgentKey): string | null {
  for (let i = traces.length - 1; i >= 0; i--) {
    if (traces[i].agent === key) return traces[i].icon + ' ' + traces[i].message;
  }
  return null;
}

const RING: Record<string, { active: string; done: string }> = {
  sky: { active: 'ring-sky-400 bg-sky-50 border-sky-300', done: 'border-emerald-200 bg-emerald-50' },
  violet: { active: 'ring-violet-400 bg-violet-50 border-violet-300', done: 'border-emerald-200 bg-emerald-50' },
  rose: { active: 'ring-rose-400 bg-rose-50 border-rose-300', done: 'border-emerald-200 bg-emerald-50' },
};

export default function AgentPipeline({ traces, finished }: { traces: TraceEvent[]; finished: boolean }) {
  const states = computeAgentStates(traces, finished);
  const anyActive = Object.values(states).some((s) => s === 'active');

  return (
    <div className='bg-white rounded-2xl border border-slate-200 shadow-sm p-4'>
      <div className='flex items-center justify-between mb-3'>
        <h3 className='text-sm font-bold text-slate-700'>Luồng phối hợp AI Agents</h3>
        <span className={'text-[11px] font-semibold px-2 py-1 rounded-full ' + (anyActive ? 'bg-indigo-50 text-indigo-600' : finished ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500')}>
          {anyActive ? '● Đang chạy...' : finished ? '✓ Hoàn tất' : '○ Chờ đơn hàng'}
        </span>
      </div>
      <div className='flex items-stretch gap-2'>
        {AGENTS.map((a, idx) => {
          const s = states[a.key];
          const msg = lastMessage(traces, a.key);
          return (
            <div key={a.key} className='flex-1 flex flex-col min-w-0'>
              <div
                className={
                  'rounded-xl border p-2.5 h-full transition-all duration-300 relative ' +
                  (s === 'active'
                    ? RING[a.color].active + ' kf-node-active ring-2'
                    : s === 'done'
                      ? RING[a.color].done
                      : 'border-slate-200 bg-slate-50')
                }
              >
                {s === 'done' && (
                  <span className='absolute top-1.5 right-1.5 w-4.5 h-4.5 min-w-[18px] min-h-[18px] text-[10px] bg-emerald-500 text-white rounded-full flex items-center justify-center'>✓</span>
                )}
                <div className={'text-xl ' + (s === 'pending' ? 'grayscale opacity-40' : '')}>{a.icon}</div>
                <div className={'text-xs font-bold mt-1 truncate ' + (s === 'pending' ? 'text-slate-400' : 'text-slate-700')}>{a.name}</div>
                <div className={'text-[10.5px] leading-snug mt-0.5 ' + (s === 'pending' ? 'text-slate-300' : 'text-slate-500')}>{a.desc}</div>
                {msg && (
                  <div className={
                    'mt-2 text-[10px] leading-snug rounded-lg px-1.5 py-1 line-clamp-2 ' +
                    (s === 'active' ? 'bg-white/80 text-indigo-700 font-medium' : 'bg-white text-slate-400')
                  }>
                    {msg}
                  </div>
                )}
              </div>
              {idx < AGENTS.length - 1 && (
                <div
                  aria-hidden
                  className={'kf-arrow self-center w-6 h-1.5 rounded-full my-auto -mx-1 z-10 ' +
                    (states[AGENTS[idx + 1].key] !== 'pending' || s === 'active' ? 'kf-arrow-active' : 'opacity-40')}
                />
              )}
            </div>
          );
        })}
      </div>
      {anyActive && (
        <div className='mt-3 h-1 bg-indigo-100 rounded-full overflow-hidden'>
          <div className='h-full w-1/3 bg-gradient-to-r from-transparent via-indigo-500 to-transparent kf-loader-bar' />
        </div>
      )}
    </div>
  );
}
