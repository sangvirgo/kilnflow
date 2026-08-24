'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { API } from '../lib/api';
import { SiteContent, DEFAULT_SITE_CONTENT } from '@kilnflow/shared-types';

export default function LandingPage() {
  const [content, setContent] = useState<SiteContent>(DEFAULT_SITE_CONTENT);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch(API + '/cms/content')
      .then((r) => r.json())
      .then((d) => setContent({ ...DEFAULT_SITE_CONTENT, ...d }))
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, []);

  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });

  return (
    <div className='-m-6'>
      {/* ===== HERO ===== */}
      <section className='relative overflow-hidden bg-slate-950 text-white'>
        <div className='absolute inset-0 opacity-40' style={{ background: 'radial-gradient(600px 300px at 20% 0%, #6366f1, transparent), radial-gradient(500px 280px at 85% 20%, #d946ef, transparent)' }} />
        <div className='relative max-w-6xl mx-auto px-6 py-24 md:py-32 text-center'>
          <span className='inline-block text-[11px] font-bold tracking-widest uppercase px-3 py-1 rounded-full border border-indigo-400/40 bg-indigo-500/10 text-indigo-300 mb-6'>
            {content.hero.badge}
          </span>
          <h1 className='text-4xl md:text-6xl font-extrabold leading-tight tracking-tight'>
            {content.hero.title}{' '}
            <span className='bg-gradient-to-r from-indigo-400 via-fuchsia-400 to-amber-300 bg-clip-text text-transparent'>{content.hero.highlight}</span>
          </h1>
          <p className='mt-5 text-base md:text-lg text-slate-300 max-w-2xl mx-auto leading-relaxed'>{content.hero.subtitle}</p>
          <div className='mt-8 flex flex-wrap justify-center gap-3'>
            <Link href='/dashboard' className='px-6 py-3 rounded-xl font-bold text-sm bg-white text-slate-900 hover:bg-indigo-100 shadow-lg transition-transform hover:-translate-y-0.5'>
              {content.hero.ctaPrimary} →
            </Link>
            <button onClick={() => scrollTo('features')} className='px-6 py-3 rounded-xl font-bold text-sm border border-white/25 hover:bg-white/10 transition-colors'>
              {content.hero.ctaSecondary}
            </button>
          </div>
        </div>
      </section>

      {/* ===== STATS ===== */}
      <section className='max-w-6xl mx-auto px-6 -mt-10 relative z-10'>
        <div className='grid grid-cols-2 md:grid-cols-4 gap-3'>
          {content.stats.map((s, i) => (
            <div key={i} className='bg-white rounded-2xl border border-slate-200 shadow-lg p-5 text-center'>
              <div className='text-3xl font-extrabold bg-gradient-to-br from-indigo-600 to-fuchsia-500 bg-clip-text text-transparent'>{s.value}</div>
              <div className='text-xs text-slate-500 mt-1 font-medium'>{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ===== FEATURES / SERVICES ===== */}
      <section id='features' className='max-w-6xl mx-auto px-6 py-20'>
        <h2 className='text-center text-3xl font-extrabold tracking-tight'>Đội hình AI Agents</h2>
        <p className='text-center text-slate-500 mt-2 text-sm'>Mỗi agent một nhiệm vụ hẹp — phối hợp lại thành quy trình tự động hoàn chỉnh</p>
        <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-10'>
          {content.services.map((s, i) => (
            <div key={i} className='group bg-white rounded-2xl border border-slate-200 p-6 shadow-sm hover:shadow-xl hover:border-indigo-300 hover:-translate-y-1 transition-all duration-300'>
              <div className='w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-100 to-fuchsia-100 flex items-center justify-center text-2xl group-hover:scale-110 transition-transform'>{s.icon}</div>
              <h3 className='font-bold mt-4 text-slate-800'>{s.title}</h3>
              <p className='text-sm text-slate-500 mt-2 leading-relaxed'>{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ===== ABOUT / WHY ===== */}
      <section className='bg-slate-900 text-white py-16'>
        <div className='max-w-4xl mx-auto px-6 text-center'>
          <h2 className='text-2xl md:text-3xl font-extrabold'>{content.about.title}</h2>
          <p className='mt-4 text-slate-300 leading-relaxed'>{content.about.body}</p>
          <div className='flex flex-wrap justify-center gap-2 mt-6 text-xs'>
            {['Zod validation', 'Self-correction', 'RAG', 'Human-in-the-loop', 'Race-safe', 'Fallback deterministic'].map((t) => (
              <span key={t} className='px-3 py-1 rounded-full bg-white/10 border border-white/15'>{t}</span>
            ))}
          </div>
        </div>
      </section>

      {/* ===== CTA + CONTACT ===== */}
      <section className='max-w-6xl mx-auto px-6 py-16 grid grid-cols-1 md:grid-cols-2 gap-8 items-center'>
        <div>
          <h2 className='text-2xl font-extrabold'>Sẵn sàng thấy nó chạy thật?</h2>
          <p className='text-sm text-slate-500 mt-2'>Mở bảng Kanban kéo-thả mẻ, phân tích đơn hàng xem AI agents làm việc, hoặc nhắn Telegram bot nhận việc ngay trên điện thoại.</p>
          <div className='flex gap-3 mt-5'>
            <Link href='/dashboard' className='px-5 py-2.5 rounded-xl bg-indigo-600 text-white font-bold text-sm hover:bg-indigo-700'>Mở Dashboard</Link>
            <Link href='/order' className='px-5 py-2.5 rounded-xl border border-slate-300 font-bold text-sm hover:bg-slate-50'>Tạo đơn hàng</Link>
          </div>
        </div>
        <div id='contact' className='bg-white rounded-2xl border border-slate-200 p-6 shadow-sm'>
          <h3 className='font-bold text-slate-700 mb-3'>📞 Liên hệ xưởng</h3>
          <ul className='space-y-2 text-sm text-slate-600'>
            <li>☎️ {content.contact.phone}</li>
            <li>✉️ {content.contact.email}</li>
            <li>📍 {content.contact.address}</li>
          </ul>
        </div>
      </section>

      {/* ===== FOOTER ===== */}
      <footer className='border-t border-slate-200 py-8 text-center text-xs text-slate-400'>
        🏺 Kilnflow — Multi-agent ceramics pipeline · Built with Next.js · NestJS · Gemini
        {!loaded && <span className='ml-2'>(đang tải nội dung...)</span>}
      </footer>
    </div>
  );
}
