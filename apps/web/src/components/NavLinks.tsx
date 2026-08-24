'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/', label: 'Trang chủ', icon: '🏠' },
  { href: '/dashboard', label: 'Bảng sản xuất', icon: '🏭' },
  { href: '/order', label: 'Đơn hàng mới', icon: '🧾' },
  { href: '/cms', label: 'CMS', icon: '⚙️' },
];

export default function NavLinks() {
  const pathname = usePathname();
  return (
    <div className='flex items-center gap-1'>
      {LINKS.map((l) => {
        const active = l.href === '/' ? pathname === '/' : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={
              'px-3.5 py-2 rounded-lg text-sm font-medium transition-colors ' +
              (active
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-600 hover:text-indigo-700 hover:bg-indigo-50')
            }
          >
            <span className='mr-1.5'>{l.icon}</span>
            {l.label}
          </Link>
        );
      })}
    </div>
  );
}
