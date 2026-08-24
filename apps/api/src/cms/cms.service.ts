import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/errors';
import { DEFAULT_SITE_CONTENT, SiteContent } from '@kilnflow/shared-types';

const KEY = 'landing';
const FALLBACK_TOKEN = 'kilnflow-cms';

/**
 * Phase 10 — CMS mini: lưu/nạp nội dung landing page.
 * Merge sâu theo section với DEFAULT để schema thêm field mới không vỡ nội dung cũ.
 */
@Injectable()
export class CmsService {
  constructor(private prisma: PrismaService) {}

  get token(): string {
    return process.env.CMS_TOKEN || FALLBACK_TOKEN;
  }

  async get(): Promise<SiteContent> {
    const row = await this.prisma.siteContent.findUnique({ where: { key: KEY } });
    if (!row?.value) return DEFAULT_SITE_CONTENT;
    const saved = row.value as unknown as Partial<SiteContent>;
    return this.merge(DEFAULT_SITE_CONTENT, saved);
  }

  async save(body: unknown): Promise<SiteContent> {
    const incoming = this.validate(body);
    const saved = await this.prisma.siteContent.upsert({
      where: { key: KEY },
      create: { key: KEY, value: incoming as any },
      update: { value: incoming as any },
    });
    return saved.value as unknown as SiteContent;
  }

  /** Chặn dữ liệu rác ở mức tối thiểu: đủ 5 section, string không rỗng ở trường chính. */
  private validate(body: unknown): SiteContent {
    const b = (body ?? {}) as Partial<SiteContent>;
    const err = (m: string) => new AppError(400, 'CMS_INVALID', m);
    if (!b.hero || typeof b.hero.title !== 'string' || !b.hero.title.trim()) throw err('Thiếu hero.title');
    if (!Array.isArray(b.services) || b.services.length === 0) throw err('services phải là mảng có ít nhất 1 mục');
    for (const s of b.services) {
      if (!s?.title?.trim()) throw err('Mỗi service cần title');
    }
    if (!Array.isArray(b.stats)) throw err('stats phải là mảng');
    if (!b.about?.body?.trim()) throw err('Thiếu about.body');
    if (!b.contact?.email?.trim()) throw err('Thiếu contact.email');
    // Trả về object đã "sạch" — chỉ nhận các field thuộc schema
    return {
      hero: { ...DEFAULT_SITE_CONTENT.hero, ...b.hero },
      stats: b.stats.map((x) => ({ value: String(x?.value ?? ''), label: String(x?.label ?? '') })),
      services: b.services.map((s, i) => ({
        icon: String(s?.icon || '✨'),
        title: String(s?.title || 'Mục ' + (i + 1)),
        desc: String(s?.desc || ''),
      })),
      about: { title: String(b.about.title || ''), body: String(b.about.body) },
      contact: { phone: String(b.contact.phone || ''), email: String(b.contact.email), address: String(b.contact.address || '') },
    };
  }

  /** Deep-merge đơn giản 2 cấp (section -> field). */
  private merge(base: SiteContent, override: Partial<SiteContent>): SiteContent {
    return {
      hero: { ...base.hero, ...(override.hero || {}) },
      stats: Array.isArray(override.stats) && override.stats.length ? override.stats : base.stats,
      services: Array.isArray(override.services) && override.services.length ? override.services : base.services,
      about: { ...base.about, ...(override.about || {}) },
      contact: { ...base.contact, ...(override.contact || {}) },
    };
  }
}
