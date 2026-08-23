import type { Metadata } from 'next';
import './globals.css';
import NavLinks from '../components/NavLinks';
import ChatWidget from '../components/ChatWidget';

export const metadata: Metadata = { title: 'Kilnflow — Xưởng gốm điều phối bởi AI', description: 'Hệ thống multi-agent quản lý dây chuyền sản xuất gốm sứ' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang='vi'>
    <body className='kf-page-bg text-slate-900 min-h-screen'>
      <header className='sticky top-0 z-40 bg-white/85 backdrop-blur border-b border-slate-200'>
        <div className='max-w-7xl mx-auto px-6 py-2.5 flex items-center gap-8'>
          <a href='/' className='flex items-center gap-2.5'>
            <span className='w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 flex items-center justify-center text-lg shadow-md shadow-indigo-200'>🏺</span>
            <span>
              <span className='block font-extrabold text-[17px] leading-tight tracking-tight bg-gradient-to-r from-indigo-600 to-fuchsia-600 bg-clip-text text-transparent'>Kilnflow</span>
              <span className='block text-[10.5px] leading-tight text-slate-400 font-medium'>Multi-agent sản xuất gốm sứ</span>
            </span>
          </a>
          <nav className='flex-1'><NavLinks /></nav>
          <div className='hidden md:flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1.5 rounded-full'>
            <span className='w-2 h-2 rounded-full bg-emerald-500 kf-dot-alert'></span>
            AI Agents đang hoạt động
          </div>
        </div>
      </header>
      <main className='max-w-7xl mx-auto p-6'>{children}</main>
      <ChatWidget />
    </body>
    </html>
  );
}
