//
// Mock LLM provider — dung khi KHONG co API key (demo offline / kiem thu retry-loop).
// Khong phai 'AI that' nhung mo phong day du hop dong output cua tung agent de
// ca pipeline (validate -> self-correct -> persist) van chay dung nhu thuc.
// Cac test-directive trong text: [MALFORMED_ONCE] (sai schema 1 lan roi tu sua),
// [ALWAYS_MALFORMED] (luon sai -> phai fail ro rang).
//
import { LlmCompleteOptions, LlmMessage, LlmProvider } from '../llm.core';

const PAYLOAD_RE = /<<<PAYLOAD\n([\s\S]*?)\nPAYLOAD>>>/;

function extractPayload(userText: string): any | null {
  const m = userText.match(PAYLOAD_RE);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

function num(s: string): number { return Number(String(s).replace(/\./g, '').replace(/,/g, '.')); }

export class MockLlmProvider implements LlmProvider {
  readonly name = 'mock';
  readonly model = 'rule-based-v1';
  private malformedOnceCounter = 0;

  async raw(messages: LlmMessage[], _opts: LlmCompleteOptions): Promise<string> {
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
    const user = messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n');
    await new Promise((r) => setTimeout(r, 120)); // mo phong do tre mang
    if (system.includes('PARSER_AGENT')) return this.parser(user);
    if (system.includes('RISK_REVIEW_AGENT')) return this.riskReview(extractPayload(user));
    if (system.includes('QC_MESSAGE_AGENT')) return this.qcMessage(extractPayload(user));
    if (system.includes('SCHEDULER_AGENT')) return this.scheduler(extractPayload(user));
    if (system.includes('KNOWLEDGE_AGENT')) return this.knowledge(extractPayload(user));
    return '{"error":"mock provider: unknown agent kind"}';
  }

  // ---------------- Parser ----------------
  private parser(user: string): string {
    // Test-directive: chuoc vai LLM 'bi loi' de chung minh self-correction loop chay that.
    if (user.includes('[ALWAYS_MALFORMED]')) {
      return 'Xin loi toi khong hien duoc JSON: {product_name: "Lo hoa", quantity: "hai tram"}';
    }
    if (user.includes('[MALFORMED_ONCE]')) {
      this.malformedOnceCounter++;
      if (this.malformedOnceCounter % 2 === 1) {
        // Lan 1: sai kieu du lieu (quantity la string) -> Zod se tu choi -> agent gui lai bao loi.
        return '{"product_name":"Lo hoa sen","pattern":"hoa sen","glaze_color":"xanh ngoc","height_cm":35,"quantity":"200","firing_temp_c":1280,"estimated_clay_kg":420,"glaze_type":"stoneware","estimated_firing_hours":12,"priority":"high","deadline_days":10,"assumptions":[]}';
      }
    }
    const t = user.toLowerCase();
    const assumptions: string[] = [];

    let productName = 'San pham gom theo yeu cau';
    const productMatch = t.match(/(lo hoa|binh hoa|bo am|am tra|tach|chen|dia|bat|ly|cup|mug|binh|tuong|gach|binh gom)/);
    if (productMatch) productName = productMatch[1];
    else assumptions.push('Khong xac dinh ro ten san pham -> gia dinh san pham gom tong quat.');

    let quantity = NaN;
    const qtyM = t.match(/(\d[\d.,]*)\s*(?:san pham|chiec|cai|em|bo)/) || t.match(/(?:dat|order|xuong)\s*(\d[\d.,]*)/) || t.match(/^(?:tao|lam|thuc hien)?\s*(\d[\d.,]*)\s+/);
    const qtyNoun = t.match(/(\d[\d.,]*)\s*(lo hoa|binh|bát|chen|dia|tach|ly|cup|mug|vase|bowls?|plates?)/);
    if (qtyM) quantity = num(qtyM[1]); else if (qtyNoun) quantity = num(qtyNoun[1]);
    if (!Number.isFinite(quantity) || quantity <= 0) { quantity = 100; assumptions.push('Khong tim thay so luong -> gia dinh 100 san pham.'); }

    let heightCm: number | null = null;
    const hM = t.match(/(?:cao|chieu cao|height)[^\d]{0,8}(\d+(?:[.,]\d+)?)\s*cm/);
    if (hM) heightCm = Number(hM[1].replace(',', '.'));
    else assumptions.push('Khong de cap chieu cao -> gia dinh 25cm.');
    if (heightCm == null) heightCm = 25;

    let firingTempC = NaN;
    const tM = t.match(/(\d{4})\s*(?:do|°)?\s*c/) || t.match(/nung[^.\d]{0,24}(\d{4})/);
    if (tM) firingTempC = parseInt(tM[1], 10);
    if (!Number.isFinite(firingTempC)) { firingTempC = 1250; assumptions.push('Khong ghi nhiet do nung -> gia dinh 1250°C (stoneware pho thong).'); }

    let deadlineDays: number | null = null;
    const dM = t.match(/(?:deadline|trong|hoan thanh|giao hang|can)[^\d]{0,14}(\d+)\s*ngay/);
    if (dM) deadlineDays = parseInt(dM[1], 10);
    if (deadlineDays == null) { deadlineDays = null; assumptions.push('Khong co deadline -> de null, priority mac dinh medium.'); }

    let glazeColor: string | null = null;
    const colorM = t.match(/men\s*(xanh ngoc|xanh lam|trang nga|nau den|nau|den vang|vang kem|celadon|trang suxa|xanh)/) || t.match(/mau\s*(xanh ngoc|xanh lam|trang nga|nau|den|vang kem|xanh)/);
    if (colorM) glazeColor = colorM[1];
    if (!glazeColor) assumptions.push('Khong neu mau men -> de null.');

    let pattern: string | null = null;
    const patM = t.match(/(?:hoa van|hoat iet|pattern|kieu)\s+([^,.]{2,30})/);
    const knownPat = t.match(/(hoa sen|trong dong|rong|phuong|chim cong|sen|la tre|van cach)/);
    pattern = patM ? patM[1].trim() : knownPat ? knownPat[1] : null;
    if (!pattern) assumptions.push('Khong neu hoa van -> de null.');

    const glazeType = firingTempC >= 1200 ? 'stoneware' : 'earthenware';
    if (!t.includes('men')) assumptions.push('Chon glaze_type=' + glazeType + ' dua tren nhiet do nung.');

    const clayKg = Math.round((heightCm / 10) * 0.6 * quantity * 10) / 10;
    let hours = quantity < 100 ? 8 : quantity < 300 ? 12 : quantity < 1000 ? 18 : 26;
    if (firingTempC >= 1280) hours += 4;
    const priority = deadlineDays == null ? 'medium' : deadlineDays <= 7 ? 'high' : deadlineDays <= 15 ? 'medium' : 'low';

    return JSON.stringify({
      product_name: productName,
      pattern,
      glaze_color: glazeColor,
      height_cm: heightCm,
      quantity,
      firing_temp_c: firingTempC,
      estimated_clay_kg: clayKg,
      glaze_type: glazeType,
      estimated_firing_hours: hours,
      priority,
      deadline_days: deadlineDays,
      assumptions,
    });
  }

  // ---------------- Risk review ----------------
  private riskReview(p: any): string {
    if (!p || !p.parsed) return '{"risks":[{"type":"internal","severity":"low","detail":"Thieu payload de danh gia."}],"recommend_proceed":true}';
    const parsed = p.parsed; const risks: any[] = [];
    const gt = String(parsed.glaze_type || '').toLowerCase();
    if ((gt.includes('stoneware') || gt.includes('porcelain')) && parsed.firing_temp_c < 1200) {
      risks.push({ type: 'temp_glaze_mismatch', severity: 'high', detail: 'Men ' + gt + ' can nhiet do >=1200°C nhung don chi nung ' + parsed.firing_temp_c + '°C.' });
    }
    if ((gt.includes('earthenware')) && parsed.firing_temp_c > 1150) {
      risks.push({ type: 'temp_glaze_mismatch', severity: 'medium', detail: 'Earthenware thuong <=1150°C, don yeu cau ' + parsed.firing_temp_c + '°C — co the lam chay men.' });
    }
    if (parsed.deadline_days != null && p.kilnBacklogHours != null && parsed.deadline_days <= 7 && p.kilnBacklogHours > parsed.deadline_days * 16) {
      risks.push({ type: 'deadline_tight', severity: 'high', detail: 'Backlog lò ~' + p.kilnBacklogHours + 'h trong khi deadline chi ' + parsed.deadline_days + ' ngay.' });
    }
    if (p.historicalAvgClayKgPerUnit != null && parsed.quantity > 0) {
      const perUnit = parsed.estimated_clay_kg / parsed.quantity;
      const dev = Math.abs(perUnit - p.historicalAvgClayKgPerUnit) / p.historicalAvgClayKgPerUnit;
      if (dev > 0.45) risks.push({ type: 'clay_estimate_outlier', severity: 'medium', detail: 'Clay/sp (' + perUnit.toFixed(2) + 'kg) lech ' + Math.round(dev * 100) + '% so voi trung binh lich su (' + p.historicalAvgClayKgPerUnit.toFixed(2) + 'kg).' });
    }
    if (risks.length === 0) risks.push({ type: 'general', severity: 'low', detail: 'Khong phat hien rui ro lon: men/nhiet do hop le, deadline kha thi.' });
    const recommend = !risks.some((r) => r.severity === 'high');
    return JSON.stringify({ risks, recommend_proceed: recommend });
  }

  // ---------------- QC message ----------------
  private qcMessage(p: any): string {
    const rate = Math.round((p?.defectRate ?? 0) * 1000) / 10;
    const sev = p?.severity ?? 'info';
    const icon = sev === 'critical' ? '🚨' : sev === 'warning' ? '⚠️' : 'ℹ️';
    const msg = icon + ' QC Batch #' + (p?.batchCode ?? '?') + ': ' + p?.defectCount + '/' + p?.totalQuantity + ' loi (' + rate + '%). Mức độ: ' + sev.toUpperCase() + '. Ghi chú: ' + (p?.note || 'không có') ;
    return JSON.stringify({ message: msg });
  }

  // ---------------- Scheduler ----------------
  private scheduler(p: any): string {
    if (!p || !Array.isArray(p.batches) || !Array.isArray(p.kilns)) {
      return '{"schedule":[],"delayed_batches":[]}';
    }
    const rankOf: Record<string, number> = { high: 0, medium: 1, low: 2 };
    const batches = [...p.batches].sort((a: any, b: any) => {
      const r = (rankOf[a.priority] ?? 1) - (rankOf[b.priority] ?? 1);
      if (r !== 0) return r;
      const da = a.deadlineDays == null ? 9999 : a.deadlineDays;
      const db = b.deadlineDays == null ? 9999 : b.deadlineDays;
      return da - db;
    });
    const now = Date.now();
    const slots: { kilnId: string; kilnName: string; freeAt: number }[] = [];
    for (const k of p.kilns) for (let i = 0; i < (k.capacity ?? 1); i++) slots.push({ kilnId: k.id, kilnName: k.name, freeAt: now });
    const schedule: any[] = []; const delayed: any[] = [];
    for (const b of batches) {
      slots.sort((x, y) => x.freeAt - y.freeAt);
      const slot = slots[0];
      const start = slot.freeAt;
      slot.freeAt = start + (b.estimatedFiringHours ?? 12) * 3600_000;
      const deadlineMs = b.deadlineDays == null ? null : now + b.deadlineDays * 24 * 3600_000;
      if (deadlineMs != null && start > deadlineMs - (b.estimatedFiringHours ?? 12) * 3600_000) {
        delayed.push({ batchCode: b.batchCode, reason: 'Het slot lo truoc deadline (' + b.deadlineDays + ' ngay) — bat dau ' + new Date(start).toISOString().slice(0, 10), suggestion: 'Gop nung voi me khac cung nhiet do hoac them ca nung ngoai gio.' });
        continue;
      }
      schedule.push({ batchCode: b.batchCode, kilnId: slot.kilnId, kilnName: slot.kilnName, startTime: new Date(start).toISOString() });
    }
    return JSON.stringify({ schedule, delayed_batches: delayed });
  }

  // ---------------- Knowledge RAG answer ----------------
  private knowledge(p: any): string {
    if (!p || !Array.isArray(p.contexts) || p.contexts.length === 0) {
      return '{"answer":"Khong tim thay tai lieu phu hop trong kho tri thuc noi bo."}';
    }
    const q = String(p.question || '');
    const top = p.contexts.slice(0, 2);
    const sentences = top.map((c: any) => {
      const sents = String(c.content).split(/(?<=[.!?])\s+/).slice(0, 2).join(' ');
      return sents.trim() + ' [Source ' + c.index + ']';
    });
    const answer = 'Theo tai lieu noi bo ve "' + q.trim() + '": ' + sentences.join(' ') + ' (Tra loi CHI dua tren cac doan trich duoc truy xuat.)';
    return JSON.stringify({ answer });
  }
}