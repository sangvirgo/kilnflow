'use client';
import { useState } from 'react';
import KnowledgeChat from './KnowledgeChat';

/** Ô chat nổi: nút tròn góc phải-dưới, bấm mở/đóng cửa sổ chat nhỏ trên mọi trang. */
export default function ChatWidget() {
  const [open, setOpen] = useState(false);

  return (
    <>
      {open && (
        <div className='fixed bottom-24 right-5 z-50 w-[92vw] max-w-[380px] h-[70vh] max-h-[560px] flex flex-col bg-white rounded-2xl shadow-2xl border overflow-hidden'>
          <div className='flex items-center justify-between px-4 py-2.5 bg-blue-600 text-white'>
            <div>
              <div className='text-sm font-bold'>Tri thức gốm</div>
              <div className='text-[11px] opacity-80'>Trợ lý RAG · trả lời kèm nguồn</div>
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label='Đóng chat'
              className='w-7 h-7 rounded-full hover:bg-white/20 text-lg leading-none'
            >
              ×
            </button>
          </div>
          <div className='flex-1 p-3 min-h-0'>
            <KnowledgeChat variant='widget' />
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Đóng cửa sổ chat' : 'Mở cửa sổ chat tri thức gốm'}
        className='fixed bottom-5 right-5 z-50 w-14 h-14 rounded-full bg-blue-600 hover:bg-blue-700 text-white shadow-xl flex items-center justify-center text-2xl transition-transform hover:scale-105'
      >
        {open ? '↓' : '💬'}
      </button>
    </>
  );
}
