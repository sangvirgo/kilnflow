'use client';
import { useEffect, useState } from 'react';
import { API } from '../../lib/api';
import { SiteContent, DEFAULT_SITE_CONTENT, SiteServiceItem } from '@kilnflow/shared-types';

/** Phase 10 — CMS mini: chỉnh nội dung landing page, lưu qua PUT /cms/content. */
export default function CmsPage() {
  const [c, setC] = useState<SiteContent>(DEFAULT_SITE_CONTENT);
  const [token, setToken] = useState('kilnflow-cms');
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch(API + '/cms/content')
      .then((r) => r.json())
      .then((d) => setC({ ...DEFAULT_SITE_CONTENT, ...d }))
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, []);

  const set = <K extends keyof SiteContent>(section: K, patch: Partial<SiteContent[K]>) =>
    setC((prev) => ({ ...prev, [section]: { ...(prev[section] as object), ...patch } }));

  const savePayload = async (payload: SiteContent, okMsg: string) => {
    setSaving(true); setMsg('');
    try {
      const res = await fetch(API + '/cms/content', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-cms-token': token },
        body: JSON.stringify(payload),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.message || ('HTTP ' + res.status));
      setMsg(okMsg);
      setTimeout(() => setMsg(''), 4000);
    } catch (e: any) { setMsg('❌ ' + e.message); }
    setSaving(false);
  };
  const save = () => savePayload(c, '✅ Đã lưu! Mở trang chủ xem kết quả.');
  const reset = async () => {
    if (!window.confirm('Khôi phục nội dung mặc định?')) return;
    setC(DEFAULT_SITE_CONTENT);
    await savePayload(DEFAULT_SITE_CONTENT, '✅ Đã khôi phục mặc định.');
  };

  const input = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 outline-none';
  const label = 'text-xs font-bold text-slate-500 uppercase tracking-wide';

  return (
    <div className='max-w-4xl mx-auto space-y-5'>
      <div className='flex items-center justify-between gap-3 flex-wrap'>
        <div>
          <h1 className='text-2xl font-extrabold tracking-tight'>⚙️ CMS — Quản lý nội dung Landing</h1>
          <p className='text-sm text-slate-500 mt-0.5'>Chỉnh hero · số liệu · agents · giới thiệu · liên hệ → Lưu để cập nhật trang chủ.</p>
        </div>
        <div className='flex gap-2'>
          <button onClick={reset} disabled={saving} className='px-3 py-2 text-sm border rounded-xl hover:bg-slate-50 disabled:opacity-40'>↺ Mặc định</button>
          <button onClick={save} disabled={saving} className='px-5 py-2 rounded-xl bg-indigo-600 text-white font-bold text-sm shadow-md shadow-indigo-200 hover:bg-indigo-700 disabled:opacity-50'>
            {saving ? 'Đang lưu...' : '💾 Lưu thay đổi'}
          </button>
        </div>
      </div>

      {msg && <div className={'p-3 rounded-xl text-sm border ' + (msg.startsWith('✅') ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-700')}>{msg}</div>}

      <details className='bg-white rounded-2xl border p-4'>
        <summary className='text-sm font-bold cursor-pointer'>🔑 Token truy cập CMS</summary>
        <div className='mt-3 max-w-xs'>
          <input value={token} onChange={(e) => setToken(e.target.value)} className={input + ' font-mono'} />
          <p className='text-[11px] text-slate-400 mt-1'>Env CMS_TOKEN trên API (demo mặc định: kilnflow-cms)</p>
        </div>
      </details>

      <fieldset className='bg-white rounded-2xl border p-5 space-y-3'>
        <legend className={label + ' px-2'}>🖼 Hero</legend>
        <div className='grid md:grid-cols-2 gap-3'>
          <div><label className={label}>Badge</label><input className={input + ' mt-1'} value={c.hero.badge} onChange={(e) => set('hero', { badge: e.target.value })} /></div>
          <div><label className={label}>CTA chính</label><input className={input + ' mt-1'} value={c.hero.ctaPrimary} onChange={(e) => set('hero', { ctaPrimary: e.target.value })} /></div>
          <div><label className={label}>Tiêu đề</label><input className={input + ' mt-1'} value={c.hero.title} onChange={(e) => set('hero', { title: e.target.value })} /></div>
          <div><label className={label}>Từ nhấn (gradient)</label><input className={input + ' mt-1'} value={c.hero.highlight} onChange={(e) => set('hero', { highlight: e.target.value })} /></div>
          <div className='md:col-span-2'><label className={label}>Mô tả</label><textarea rows={2} className={input + ' mt-1'} value={c.hero.subtitle} onChange={(e) => set('hero', { subtitle: e.target.value })} /></div>
          <div><label className={label}>CTA phụ</label><input className={input + ' mt-1'} value={c.hero.ctaSecondary} onChange={(e) => set('hero', { ctaSecondary: e.target.value })} /></div>
        </div>
      </fieldset>

      <fieldset className='bg-white rounded-2xl border p-5'>
        <legend className={label + ' px-2'}>📊 Số liệu nổi bật</legend>
        <div className='grid grid-cols-1 sm:grid-cols-2 gap-3'>
          {c.stats.map((s, i) => (
            <div key={i} className='flex gap-2'>
              <input className={input + ' w-24 text-center font-bold'} value={s.value}
                onChange={(e) => setC((prev) => ({ ...prev, stats: prev.stats.map((x, j) => j === i ? { ...x, value: e.target.value } : x) }))} />
              <input className={input + ' flex-1'} value={s.label}
                onChange={(e) => setC((prev) => ({ ...prev, stats: prev.stats.map((x, j) => j === i ? { ...x, label: e.target.value } : x) }))} />
              <button onClick={() => setC((prev) => ({ ...prev, stats: prev.stats.filter((_, j) => j !== i) }))}
                className='px-2 rounded-lg bg-red-50 text-red-500 hover:bg-red-100'>×</button>
            </div>
          ))}
          <button onClick={() => setC((prev) => ({ ...prev, stats: [...prev.stats, { value: '?', label: 'Chỉ số mới' }] }))}
            className='text-xs border rounded-lg px-3 hover:bg-indigo-50'>+ Thêm chỉ số</button>
        </div>
      </fieldset>

      <fieldset className='bg-white rounded-2xl border p-5 space-y-3'>
        <legend className={label + ' px-2'}>🧩 Dịch vụ / Agents ({c.services.length})</legend>
        {c.services.map((s: SiteServiceItem, i) => (
          <div key={i} className='grid grid-cols-[56px_1fr_2fr_36px] gap-2 items-start'>
            <input className={input + ' text-center'} value={s.icon} aria-label='icon'
              onChange={(e) => setC((prev) => ({ ...prev, services: prev.services.map((x, j) => j === i ? { ...x, icon: e.target.value } : x) }))} />
            <input className={input} placeholder='Tên' value={s.title}
              onChange={(e) => setC((prev) => ({ ...prev, services: prev.services.map((x, j) => j === i ? { ...x, title: e.target.value } : x) }))} />
            <input className={input} placeholder='Mô tả ngắn' value={s.desc}
              onChange={(e) => setC((prev) => ({ ...prev, services: prev.services.map((x, j) => j === i ? { ...x, desc: e.target.value } : x) }))} />
            <button onClick={() => setC((prev) => ({ ...prev, services: prev.services.filter((_, j) => j !== i) }))}
              className='h-9 rounded-lg bg-red-50 text-red-500 hover:bg-red-100' title='Xóa mục'>×</button>
          </div>
        ))}
        <button onClick={() => setC((prev) => ({ ...prev, services: [...prev.services, { icon: '✨', title: 'Mục mới', desc: '' }] }))}
          className='mt-1 px-3 py-1.5 text-xs border rounded-lg hover:bg-indigo-50'>+ Thêm mục</button>
      </fieldset>

      <div className='grid md:grid-cols-2 gap-5'>
        <fieldset className='bg-white rounded-2xl border p-5 space-y-3'>
          <legend className={label + ' px-2'}>📖 Giới thiệu</legend>
          <input className={input} value={c.about.title} onChange={(e) => set('about', { title: e.target.value })} />
          <textarea rows={4} className={input} value={c.about.body} onChange={(e) => set('about', { body: e.target.value })} />
        </fieldset>
        <fieldset className='bg-white rounded-2xl border p-5 space-y-3'>
          <legend className={label + ' px-2'}>📞 Liên hệ</legend>
          <input className={input} placeholder='Điện thoại' value={c.contact.phone} onChange={(e) => set('contact', { phone: e.target.value })} />
          <input className={input} placeholder='Email' value={c.contact.email} onChange={(e) => set('contact', { email: e.target.value })} />
          <input className={input} placeholder='Địa chỉ' value={c.contact.address} onChange={(e) => set('contact', { address: e.target.value })} />
        </fieldset>
      </div>

      {!loaded && <div className='text-center text-xs text-slate-300'>đang tải nội dung hiện tại...</div>}
    </div>
  );
}
