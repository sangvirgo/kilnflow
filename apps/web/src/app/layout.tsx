import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = { title: 'Kilnflow — Ceramics Workshop', description: 'AI-powered ceramics production pipeline' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang='vi'>
    <body className='bg-gray-50 text-gray-900 min-h-screen'>
      <nav className='bg-white shadow-sm border-b px-6 py-3 flex gap-6 text-sm font-medium'>
        <a href='/' className='hover:text-blue-600'>Kanban</a>
        <a href='/order' className='hover:text-blue-600'>Don hang moi</a>
        <a href='/knowledge' className='hover:text-blue-600'>Tri thuc</a>
      </nav>
      <main className='max-w-7xl mx-auto p-6'>{children}</main>
    </body>
    </html>
  );
}