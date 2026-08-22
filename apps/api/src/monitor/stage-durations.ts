// Thoi gian du kien toi thieu cua moi stage (hours), dung cho monitor canh bao tre.
// FIRING lay tu estimatedFiringHours cua batch neu co, nguoc lai mac dinh 14h.
export const STAGE_EXPECTED_HOURS: Record<string, number> = {
  MOLDING: 24,
  DRYING_TRIMMING: 48,
  PAINTING: 36,
  GLAZING: 24,
  FIRING: 14,   // override per-batch neu co estimatedFiringHours
  QC_PACKING: 12,
  DONE: Infinity,
};
export const OVERMARGIN = 1.3; // 30% vuot thoi gian du kien -> canh bao (spec 5.6)