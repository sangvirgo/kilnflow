'use client';
import { useState } from 'react';
import { API } from '../../lib/api';
import { KnowledgeAnswer } from '@kilnflow/shared-types';

export default function KnowledgePage() {
  const [q, setQ] = useState('');
  const [answer, setAnswer] = useState<KnowledgeAnswer | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const ask = async () => {
    if (!q.trim()) return;
    setLoading(true); setError(''); setAnswer(null);
    try {
      const res = await fetch(API + '/knowledge/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: q }),
      }).then((r) => r.json());
      if (res.message) throw new Error(res.message);
      setAnswer(res);
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  };

  return (
    <div className='max-w-2xl'>
      <h1 className='text-xl font-bold mb-3'>Hoi dap tri thuc gom</h1>
      <div className='flex gap-2'>
        <input
          className='flex-1 border rounded p-2 text-sm'
          placeholder='Dat cau hoi ve ky thuat lam gom...'
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && ask()}
        />
        <button onClick={ask} disabled={loading || !q.trim()} className='px-4 py-2 bg-blue-600 text-white rounded text-sm disabled:opacity-50'>
          {loading ? '...' : 'Hoi'}
        </button>
      </div>
      {error && <div className='mt-3 p-2 bg-red-50 border border-red-200 rounded text-sm text-red-700'>{error}</div>}
      {answer && (
        <div className='mt-4 border rounded p-4 bg-white'>
          <div className='text-sm mb-3 whitespace-pre-wrap'>{answer.answer}</div>
          {answer.sources.length > 0 && (
            <div className='border-t pt-2'>
              <div className='text-xs font-bold text-gray-500 mb-1'>Nguon</div>
              {answer.sources.map((s, i) => (
                <div key={i} className='text-xs mb-1'>
                  [{i + 1}] {s.url ? <a href={s.url} target='_blank' rel='noopener' className='text-blue-600 underline'>{s.title}</a> : s.title}
                  <span className='text-gray-400 ml-1'>— {s.snippet}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}