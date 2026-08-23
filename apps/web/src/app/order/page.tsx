'use client';
import { useState, useCallback, useRef, useEffect } from 'react';
import { API } from '../../lib/api';
import { OrderPreview, TraceEvent, RiskItem } from '@kilnflow/shared-types';
import AgentPipeline from '../../components/AgentPipeline';

const LEVEL_STYLE: Record<string, { icon: string; cls: string }> = {
  info: { icon: 'ℹ️', cls: 'text-slate-600' },
  success: { icon: '✅', cls: 'text-emerald-700' },
  warn: { icon: '⚠️', cls: 'text-amber-700' },
  error: { icon: '❌', cls: 'text-red-700' },
};

const FIELD_VN: Record<string, string> = {
  product_name: 'Tên sản phẩm', pattern: 'Hoa văn', glaze_color: 'Màu men',
  height_cm: 'Chiều cao (cm)', quantity: 'Số lượng', firing_temp_c: 'Nhiệt nung (°C)',
  estimated_clay_kg: 'Đất ước tính (kg)', glaze_type: 'Loại men',
  estimated_firing_hours: 'Giờ nung ước tính', priority: 'Ưu tiên', deadline_days: 'Hạn giao (ngày)',
};

const PRIORITY_BADGE: Record<string, string> = {
  high: 'bg-red-100 text-red-700 border-red-200',
  medium: 'bg-amber-100 text-amber-800 border-amber-200',
  low: 'bg-emerald-100 text-emerald-700 border-emerald-200',
};
const SEVERITY_VN: Record<string, string> = { high: 'cao', medium: 'trung bình', low: 'thấp' };

const EXAMPLES = [
  { label: '🟢 Đơn an toàn', text: '200 lọ hoa hoa văn sen, men xanh ngọc, cao 35cm, nung 1280 độ C, giao trong 10 ngày' },
  { label: '🔴 Đơn rủi ro', text: '500 chén sứ tráng men trắng ngà, cao 8cm, cần gấp giao sau 5 ngày, nung 1050 độ' },
];

export default function OrderPage() {
  const [text, setText] = useState('');
  const [traces, setTraces] = useState<TraceEvent[]>([]);
  const [preview, setPreview] = useState<OrderPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [traces]);

  const parse = useCallback(() => {
    if (!text.trim()) return;
    setLoading(true); setTraces([]); setPreview(null); setError(''); setConfirmed(false);
    const es = new EventSource(API + '/orders/parse/stream?text=' + encodeURIComponent(text));
    es.addEventListener('trace', (ev) => {
      const e: TraceEvent = JSON.parse((ev as MessageEvent).data);
      setTraces((prev) => [...prev, e]);
    });
    es.addEventListener('preview', (ev) => {
      setPreview(JSON.parse((ev as MessageEvent).data));
      setLoading(false);
      es.close();
    });
    es.addEventListener('error', (ev) => {
      const data = (ev as MessageEvent).data ? JSON.parse((ev as MessageEvent).data) : null;
      setError(data?.message || 'Lỗi kết nối SSE');
      setLoading(false);
      es.close();
    });
    es.onerror = () => { setError('Mất kết nối SSE'); setLoading(false); es.close(); };
  }, [text]);

  const confirmOrder = async () => {
    if (!preview) return;
    try {
      const res = await fetch(API + '/orders/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rawText: preview.rawText, parsed: preview.parsed, riskReview: preview.risk, overrideRisk: false }),
      });
      if (res.status === 409) {
        const err = await res.json().catch(() => null);
        const risks: RiskItem[] = err?.detail?.risks || preview.risk.risks || [];
        const riskList = risks.map((r) => '• [' + (SEVERITY_VN[r.severity] || r.severity) + '] ' + r.detail).join('\n');
        const proceed = window.confirm(
          '⚠️ Hệ thống phát hiện RỦI RO trước sản xuất:\n\n' + riskList +
          '\n\nBạn có chắc muốn VẪN TIẾP TỤC tạo batch không?\n(OK = chấp nhận rủi ro và tiếp tục, Cancel = quay lại)',
        );
        if (!proceed) { setError('Đã hủy — bạn có thể chỉnh sửa đơn hàng rồi phân tích lại.'); return; }
        const retry = await fetch(API + '/orders/confirm', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ rawText: preview.rawText, parsed: preview.parsed, riskReview: preview.risk, overrideRisk: true }),
        });
        if (!retry.ok) {
          const e2 = await retry.json().catch(() => null);
          throw new Error(e2?.message || ('HTTP ' + retry.status));
        }
      } else if (!res.ok) {
        const e1 = await res.json().catch(() => null);
        throw new Error(e1?.message || ('HTTP ' + res.status));
      }
      setConfirmed(true);
    } catch (e: any) { setError('Lỗi xác nhận: ' + e.message); }
  };

  return (
    <div>
      <div className='mb-5'>
        <h1 className='text-2xl font-extrabold tracking-tight'>Đơn hàng mới</h1>
        <p className='text-sm text-slate-500 mt-0.5'>Nhập mô tả tự do — xem 3 AI agents phối hợp phân tích theo thời gian thực trước khi tạo batch.</p>
      </div>

      <div className='grid grid-cols-1 xl:grid-cols-[420px_1fr] gap-5 items-start'>
        {/* ===== Cột trái: nhập liệu + luồng agent + trace ===== */}
        <div className='space-y-4'>
          <div className='bg-white rounded-2xl border border-slate-200 shadow-sm p-4'>
            <label className='text-xs font-bold text-slate-500 uppercase tracking-wide'>Mô tả đơn hàng (tiếng Việt tự do)</label>
            <textarea
              className='w-full border border-slate-300 rounded-xl p-3 h-28 text-sm mt-2 focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 outline-none resize-none'
              placeholder='Ví dụ: 200 lọ hoa hoa văn sen, men xanh ngọc, cao 35cm, nung 1280 độ C, deadline 10 ngày...'
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <div className='flex flex-wrap gap-1.5 mt-2'>
              {EXAMPLES.map((ex) => (
                <button key={ex.label} onClick={() => setText(ex.text)} disabled={loading}
                  className='text-[11px] px-2.5 py-1 bg-slate-50 border rounded-full hover:bg-indigo-50 hover:border-indigo-200 text-slate-500 transition-colors disabled:opacity-40'>
                  {ex.label}
                </button>
              ))}
            </div>
            <button
              onClick={parse}
              disabled={loading || !text.trim()}
              className='mt-3 w-full py-2.5 rounded-xl font-semibold text-sm text-white bg-gradient-to-r from-indigo-600 to-fuchsia-600 hover:opacity-90 disabled:opacity-40 shadow-md shadow-indigo-200 transition-all'
            >
              {loading ? '⏳ Các agents đang làm việc...' : '🚀 Phân tích đơn hàng'}
            </button>
            {error && <div className='mt-2 p-2 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 whitespace-pre-wrap'>{error}</div>}
          </div>

          <AgentPipeline traces={traces} finished={!!preview} />

          <div className='bg-white rounded-2xl border border-slate-200 shadow-sm p-4'>
            <h3 className='text-sm font-bold text-slate-700 mb-2'>Nhật ký hoạt động</h3>
            <div ref={logRef} className='kf-scroll h-56 overflow-y-auto space-y-1 pr-1'>
              {traces.length === 0 && !loading && (
                <div className='h-full flex items-center justify-center text-center'>
                  <p className='text-xs text-slate-300 leading-relaxed'>Nhập đơn hàng và nhấn<br/><b className='text-slate-400'>“Phân tích đơn hàng”</b><br/>để xem các agent làm việc</p>
                </div>
              )}
              {traces.map((t, i) => {
                const st = LEVEL_STYLE[t.level] || LEVEL_STYLE.info;
                return (
                  <div key={i} className={'flex gap-2 text-xs items-start border-l-2 pl-2 py-0.5 ' + (t.level === 'success' ? 'border-emerald-300' : t.level === 'warn' ? 'border-amber-300' : t.level === 'error' ? 'border-red-300' : 'border-slate-200')}>
                    <span>{st.icon}</span>
                    <span className={'flex-1 ' + st.cls}>{t.message}</span>
                    <span className='text-slate-300 whitespace-nowrap'>{new Date(t.at).toLocaleTimeString('vi-VN')}</span>
                  </div>
                );
              })}
              {loading && (
                <div className='flex items-center gap-2 text-xs text-indigo-500 pl-2 pt-1'>
                  <span className='w-2 h-2 rounded-full bg-indigo-400 animate-ping'></span> đang chờ phản hồi...
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ===== Cột phải: preview ===== */}
        <div className='bg-white rounded-2xl border border-slate-200 shadow-sm p-5 min-h-[420px]'>
          {!preview && !confirmed && (
            <div className='h-[380px] flex flex-col items-center justify-center text-center gap-3'>
              <div className='text-5xl opacity-20'>📋</div>
              <p className='text-sm text-slate-300 max-w-xs'>Bản xem trước kết quả của Parser → Estimator → Risk/QC sẽ xuất hiện tại đây.<br/>Chưa có gì được lưu cho đến khi bạn xác nhận.</p>
            </div>
          )}
          {preview && (
            <>
              <div className='flex items-center justify-between mb-3'>
                <h2 className='font-bold text-slate-800'>Bản xem trước — chưa lưu vào hệ thống</h2>
                <span className='text-[11px] px-2 py-1 rounded-full bg-slate-100 text-slate-500 font-medium'>LLM: {preview.llmProvider}</span>
              </div>

              <div className='grid grid-cols-2 md:grid-cols-3 gap-2 mb-4'>
                {Object.entries(preview.parsed)
                  .filter(([k]) => k !== 'assumptions')
                  .map(([k, v]) => (
                    <div key={k} className={'rounded-xl border p-2.5 ' + (k === 'priority' ? PRIORITY_BADGE[String(v)] || 'border-slate-200' : 'border-slate-200 bg-slate-50/60')}>
                      <div className='text-[10px] uppercase tracking-wide text-slate-400 font-bold'>{FIELD_VN[k] || k}</div>
                      <div className={'text-sm font-bold mt-0.5 truncate ' + (v == null ? 'text-slate-300' : '')}>
                        {v == null ? '—' : String(v)}
                      </div>
                    </div>
                  ))}
              </div>

              {preview.parsed.assumptions.length > 0 && (
                <div className='rounded-xl border border-amber-200 bg-amber-50 p-3 mb-3'>
                  <div className='text-xs font-bold text-amber-800 mb-1'>🤔 Giả định AI đã đưa ra</div>
                  <ul className='list-disc ml-4 text-xs text-amber-900/90 space-y-0.5'>
                    {preview.parsed.assumptions.map((a, i) => <li key={i}>{a}</li>)}
                  </ul>
                </div>
              )}

              <div className={'rounded-xl border p-3 mb-3 ' + (preview.estimation.method === 'historical' ? 'border-violet-200 bg-violet-50' : 'border-slate-200 bg-slate-50')}>
                <div className='flex items-center justify-between mb-1'>
                  <span className='text-xs font-bold text-violet-800'>📦 Ước lượng từ dữ liệu thật</span>
                  <span className={'text-[11px] font-bold px-2 py-0.5 rounded-full ' + (preview.estimation.confidence === 'high' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500')}>
                    {preview.estimation.confidence === 'high' ? 'độ tin cậy CAO' : 'độ tin cậy thấp (cold start)'}
                  </span>
                </div>
                <div className='text-xs text-slate-600'>
                  Đất sét ≈ <b>{preview.estimation.estimatedClayKg} kg</b> · Nung ≈ <b>{preview.estimation.estimatedFiringHours} h</b>
                  {' '}· dựa trên {preview.estimation.basis.length} mẻ lịch sử tương tự
                </div>
                {preview.estimation.basis.length > 0 && (
                  <table className='w-full mt-2 text-[11px]'>
                    <thead><tr className='text-left text-slate-400'><th className='py-0.5'>Mẻ</th><th>Cao</th><th>Thực tế</th><th>Giống</th></tr></thead>
                    <tbody>
                      {preview.estimation.basis.map((b, i) => (
                        <tr key={i} className='border-t border-white/70 text-slate-600'>
                          <td className='py-0.5'>{b.productName}{b.pattern ? ` (${b.pattern})` : ''}</td>
                          <td>{b.heightCm ?? '?'} cm</td>
                          <td>{b.actualClayKg}kg / {b.actualFiringHours}h</td>
                          <td className='font-mono'>{Math.round(b.similarity * 100)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <div className={'rounded-xl border p-3 mb-4 ' + (preview.risk.recommend_proceed ? 'border-emerald-200 bg-emerald-50' : 'border-red-300 bg-red-50')}>
                <div className='text-xs font-bold mb-1'>
                  {preview.risk.recommend_proceed ? '🛡️ Risk/QC: KHÔNG có rủi ro đáng kể' : '⛔ Risk/QC: PHÁT HIỆN RỦI RO'}
                </div>
                {preview.risk.risks.filter((r) => r.type !== 'general').map((risk, i) => (
                  <div key={i} className='ml-1 text-xs'>
                    • <span className={'font-bold ' + (risk.severity === 'high' ? 'text-red-600' : risk.severity === 'medium' ? 'text-amber-600' : 'text-slate-500')}>[{SEVERITY_VN[risk.severity]}]</span> {risk.detail}
                  </div>
                ))}
              </div>

              {!confirmed ? (
                <button
                  onClick={confirmOrder}
                  className={'w-full py-3 rounded-xl font-bold text-sm text-white shadow-lg transition-all ' +
                    (preview.risk.recommend_proceed ? 'bg-gradient-to-r from-emerald-600 to-teal-600 shadow-emerald-200 hover:opacity-90' : 'bg-gradient-to-r from-red-600 to-orange-500 shadow-red-200 hover:opacity-90')}
                >
                  {preview.risk.recommend_proceed ? '✔ Xác nhận tạo Batch' : '⚠ Vẫn tạo Batch (chấp nhận rủi ro)'}
                </button>
              ) : (
                <div className='text-center py-3 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-700 font-bold text-sm animate-pulse'>
                  ✔ Batch đã được tạo! Xem ngay trên Bảng sản xuất.
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
