'use client';
import { useState, useRef, useCallback } from 'react';
import { API } from '../lib/api';
import { OrderPreview, TraceEvent, RiskReviewOutput, EstimatorOutput } from '@kilnflow/shared-types';

export default function OrderPage() {
  const [text, setText] = useState('');
  const [traces, setTraces] = useState<TraceEvent[]>([]);
  const [preview, setPreview] = useState<OrderPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  const parse = useCallback(() => {
    if (!text.trim()) return;
    setLoading(true); setTraces([]); setPreview(null); setError(''); setConfirmed(false);
    const url = API + '/orders/parse/stream?text=' + encodeURIComponent(text);
    const es = new EventSource(url);
    esRef.current = es;
    es.addEventListener('trace', (ev) => {
      const e: TraceEvent = JSON.parse(ev.data);
      setTraces((prev) => [...prev, e]);
    });
    es.addEventListener('preview', (ev) => {
      const p: OrderPreview = JSON.parse(ev.data);
      setPreview(p); setLoading(false); es.close();
    });
    es.addEventListener('error', (ev) => {
      const data = (ev as MessageEvent).data ? JSON.parse((ev as MessageEvent).data) : null;
      setError(data?.message || 'Loi ket noi SSE'); setLoading(false); es.close();
    });
    es.onerror = () => { setError('SSE connection lost'); setLoading(false); es.close(); };
  }, [text]);

  const confirm = async () => {
    if (!preview) return;
    try {
      await fetch(API + '/orders/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rawText: preview.rawText, parsed: preview.parsed, riskAcknowledgeOverride: !preview.risk.recommend_proceed }),
      });
      setConfirmed(true);
    } catch (e: any) { setError('Loi confirm: ' + e.message); }
  };

  const LEVEL_ICON: Record<string, string> = { info: 'ℹ️', success: '✅', warn: '⚠️', error: '❌' };

  return (
    <div className='grid grid-cols-1 lg:grid-cols-2 gap-6'>
      <div>
        <h1 className='text-xl font-bold mb-3'>Don hang moi</h1>
        <textarea
          className='w-full border rounded p-3 h-32 text-sm'
          placeholder='Mo ta don hang (tieng Viet, tu do)...'
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button onClick={parse} disabled={loading || !text.trim()} className='mt-2 px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50 text-sm'>
          {loading ? 'Dang xu ly...' : 'Phan tich don hang'}
        </button>
        {error && <div className='mt-2 p-2 bg-red-50 border border-red-200 rounded text-sm text-red-700'>{error}</div>}

        {/* Reasoning trace */}
        {traces.length > 0 && (
          <div className='mt-4 border rounded p-3 bg-gray-50 max-h-64 overflow-y-auto'>
            <div className='text-xs font-bold text-gray-500 mb-2'>Reasoning Trace</div>
            {traces.map((t, i) => (
              <div key={i} className='text-sm mb-1'>
                <span>{LEVEL_ICON[t.level] || '•'}</span> {t.message}
                <span className='text-gray-400 text-xs ml-1'>({new Date(t.at).toLocaleTimeString()})</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        {preview && (
          <div className='border rounded p-4 bg-white'>
            <h2 className='font-bold mb-2'>Preview ket qua AI</h2>
            <table className='text-sm w-full mb-3'><tbody>
              {Object.entries(preview.parsed).filter(([k]) => k !== 'assumptions').map(([k, v]) => (
                <tr key={k} className='border-b'><td className='font-mono text-gray-500 pr-2'>{k}</td><td>{v == null ? '—' : String(v)}</td></tr>
              ))}
            </tbody></table>
            {preview.parsed.assumptions.length > 0 && (
              <div className='text-xs bg-yellow-50 p-2 rounded mb-2'><b>Gia dinh:</b> {preview.parsed.assumptions.join('; ')}</div>
            )}
            <div className='text-xs text-gray-500 mb-1'>Estimation: {preview.estimation.method} ({preview.estimation.confidence}) — clay {preview.estimation.estimatedClayKg}kg, hours {preview.estimation.estimatedFiringHours}h{preview.estimation.basis.length ? ', su dung ' + preview.estimation.basis.length + ' me lich su' : ''}</div>
            <div className={'text-xs p-2 rounded mb-3 ' + (preview.risk.recommend_proceed ? 'bg-green-50' : 'bg-red-50')}'>
              <b>Risk:</b> {preview.risk.recommend_proceed ? '✅ Khuyen nghi tiep tuc' : '⛔ Co rui ro — xem chi tiet:'}
              {preview.risk.risks.map((r, i) => <div key={i} className='ml-2'>• [{r.severity}] {r.detail}</div>)}
            </div>
            {!confirmed ? (
              <button onClick={confirm} className='px-4 py-2 bg-green-600 text-white rounded text-sm'>Xac nhan tao Batch</button>
            ) : (
              <div className='text-green-700 font-bold'>✅ Batch da duoc tao thanh cong!</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}