'use client';
import { useState, useRef, useEffect } from 'react';
import { API } from '../lib/api';
import { KnowledgeSource } from '@kilnflow/shared-types';

interface ChatMessage {
  role: 'user' | 'bot';
  text: string;
  sources?: KnowledgeSource[];
  error?: boolean;
}

const SUGGESTIONS = [
  'Men xanh ngọc nung ở nhiệt độ bao nhiêu?',
  'Vì sao gốm bị nứt khi phơi khô?',
  'Xếp lò nung thế nào cho hiệu quả?',
];

export default function KnowledgeChat({ variant = 'page' }: { variant?: 'page' | 'widget' }) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'bot',
      text: 'Xin chào! Tôi là trợ lý tri thức gốm sứ của xưởng. Hãy hỏi tôi về đất sét, men, phơi khô, nung lò hay kiểm tra chất lượng — tôi sẽ trả lời dựa trên tài liệu nội bộ và kèm nguồn tham khảo.',
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const send = async (questionText?: string) => {
    const q = (questionText ?? input).trim();
    if (!q || loading) return;
    setMessages((prev) => [...prev, { role: 'user', text: q }]);
    setInput('');
    setLoading(true);
    try {
      const res = await fetch(API + '/knowledge/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: q }),
      });
      const data = await res.json();
      if (!res.ok || data.message) throw new Error(data?.message || ('HTTP ' + res.status));
      setMessages((prev) => [...prev, { role: 'bot', text: data.answer as string, sources: data.sources as KnowledgeSource[] }]);
    } catch (e: any) {
      setMessages((prev) => [...prev, { role: 'bot', text: 'Đã xảy ra lỗi: ' + e.message, error: true }]);
    }
    setLoading(false);
  };

  return (
    <div className={'flex flex-col ' + (variant === 'page' ? 'h-[calc(100vh-150px)] max-w-3xl mx-auto' : 'h-full')}>
      <div className='flex-1 overflow-y-auto bg-gray-50 p-3 space-y-3 rounded-lg border mb-2'>
        {messages.map((m, i) => (
          <div key={i} className={'flex ' + (m.role === 'user' ? 'justify-end' : 'justify-start')}>
            <div
              className={
                'max-w-[85%] rounded-2xl px-3 py-2 text-sm shadow-sm ' +
                (m.role === 'user'
                  ? 'bg-blue-600 text-white rounded-br-sm'
                  : m.error
                    ? 'bg-red-50 border border-red-300 text-red-700 rounded-bl-sm'
                    : 'bg-white border text-gray-800 rounded-bl-sm')
              }
            >
              <div className='whitespace-pre-wrap break-words'>{m.text}</div>
              {m.sources && m.sources.length > 0 && (
                <div className='mt-2 pt-2 border-t text-xs text-gray-500'>
                  <div className='font-bold text-gray-600 mb-1'>Nguồn tham khảo</div>
                  {m.sources.map((s, j) => (
                    <div key={j} className='mb-0.5'>
                      [{j + 1}]{' '}
                      {s.url ? (
                        <a href={s.url} target='_blank' rel='noopener noreferrer' className='text-blue-600 underline'>
                          {s.title}
                        </a>
                      ) : (
                        <span>{s.title}</span>
                      )}
                      {!variant || variant !== 'widget' ? <span className='text-gray-400'> — {s.snippet.slice(0, 100)}…</span> : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className='flex justify-start'>
            <div className='bg-white border rounded-2xl rounded-bl-sm px-4 py-2 text-sm text-gray-400 shadow-sm'>
              Đang tra cứu tài liệu<span className='animate-pulse'>...</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {messages.length <= 1 && (
        <div className='flex flex-wrap gap-1.5 mb-2'>
          {SUGGESTIONS.map((s) => (
            <button key={s} onClick={() => send(s)} className='text-xs px-3 py-1 bg-white border rounded-full hover:bg-blue-50 text-gray-600'>
              {s}
            </button>
          ))}
        </div>
      )}

      <div className='flex gap-2 items-end'>
        <textarea
          className='flex-1 border rounded-xl p-2 text-sm resize-none h-[44px] max-h-32'
          placeholder={variant === 'widget' ? 'Nhập câu hỏi...' : 'Nhập câu hỏi về kỹ thuật làm gốm... (Enter để gửi)'}
          value={input}
          rows={1}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button
          onClick={() => send()}
          disabled={loading || !input.trim()}
          className='px-4 h-[44px] bg-blue-600 text-white rounded-xl text-sm disabled:opacity-50 hover:bg-blue-700'
        >
          Gửi
        </button>
      </div>
    </div>
  );
}
