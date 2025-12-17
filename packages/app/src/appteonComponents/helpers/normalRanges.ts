import { cn } from '../helpers/utils';
import * as React from 'react';

export type RangeTone = 'normal' | 'warning' | 'critical';
export type RangeStatus = { label: string; tone: RangeTone; helperText?: string };

// Basic adult reference ranges reviewed by Dr. Isaac
export const labNormalRanges: Record<string, { min: number; max: number; unit?: string }> = {
  // Core chem / metabolic
  Glucose: { min: 70, max: 99, unit: 'mg/dL' }, // fasting
  Creatinine: { min: 0.6, max: 1.2, unit: 'mg/dL' },
  BUN: { min: 7, max: 20, unit: 'mg/dL' },
  Sodium: { min: 135, max: 145, unit: 'mEq/L' },
  Potassium: { min: 3.5, max: 5.0, unit: 'mEq/L' },
  ALT: { min: 7, max: 55, unit: 'U/L' },
  AST: { min: 8, max: 48, unit: 'U/L' },

  // CBC
  Hemoglobin: { min: 12, max: 16, unit: 'g/dL' },

  'White Blood Cells': { min: 4.5, max: 11.0, unit: 'K/μL' },
  'Red Blood Cells': { min: 4.5, max: 5.9, unit: 'M/μL' },
  Platelets: { min: 150, max: 450, unit: 'K/μL' },

  // Aliases for CBC counts (for mapping flexibility)
  WBC: { min: 4.5, max: 11.0, unit: 'K/μL' },
  RBC: { min: 4.5, max: 5.9, unit: 'M/μL' },
  Leukocytes: { min: 4.5, max: 11.0, unit: 'K/μL' },
  Erythrocytes: { min: 4.5, max: 5.9, unit: 'M/μL' },

  // Red cell indices
  MCV: { min: 80, max: 100, unit: 'fL' },
  MCH: { min: 27, max: 33, unit: 'pg' },
  MCHC: { min: 32, max: 36, unit: 'g/dL' },
  Hematocrit: { min: 36, max: 50, unit: '%' }, // combined adult band

  // Red cell distribution width
  'RDW-CV': { min: 11.5, max: 14.5, unit: '%' },
  'RDW-SD': { min: 39, max: 46, unit: 'fL' },
  'Erythrocyte distribution width': { min: 39, max: 46, unit: 'fL' },

  // Platelet indices
  'Mean Platelet Volume': { min: 7.5, max: 12.0, unit: 'fL' },
  MPV: { min: 7.5, max: 12.0, unit: 'fL' },
  'Platelet Distribution Width': { min: 9.0, max: 14.0, unit: 'fL' },
  PDW: { min: 9.0, max: 14.0, unit: 'fL' },

  // Lipid panel (treating “optimal” as normal)
  Cholesterol: { min: 0, max: 199, unit: 'mg/dL' }, // Total cholesterol <200
  'HDL Cholesterol': { min: 40, max: 200, unit: 'mg/dL' }, // ≥40
  Triglycerides: { min: 0, max: 149, unit: 'mg/dL' }, // <150
  'LDL Cholesterol': { min: 0, max: 99, unit: 'mg/dL' }, // <100
  'Chol/HDL Ratio': { min: 0, max: 3.5, unit: '' }, // ≤3.5
  'Non-HDL Cholesterol': { min: 0, max: 129, unit: 'mg/dL' }, // <130

  // Lipoprotein fractionation (optimal zone as normal)
  'LDL Particle Number': { min: 0, max: 1137, unit: 'nmol/L' }, // <1138
  'LDL Small': { min: 0, max: 141, unit: 'nmol/L' }, // <142
  'LDL Medium': { min: 0, max: 214, unit: 'nmol/L' }, // <215
  'HDL Large': { min: 6729, max: 100_000, unit: 'nmol/L' }, // >6729
  'LDL Peak Size': { min: 222.9, max: 1_000, unit: 'Å' }, // >222.9 Angstrom

  // Apolipoproteins
  'Apolipoprotein B': { min: 0, max: 89, unit: 'mg/dL' }, // <90
  'Lipoprotein (a)': { min: 0, max: 74, unit: 'nmol/L' }, // <75

  // Inflammation
  Myeloperoxidase: { min: 0, max: 469, unit: 'pmol/L' }, // <470
  CRP: { min: 0, max: 3, unit: 'mg/L' }, // generic low-risk hs-CRP band

  // Metabolic markers
  'Hemoglobin A1c': { min: 4, max: 5.6, unit: '%' }, // 4-5.6 normal range
  'Vitamin D 25-OH Total': { min: 30, max: 150, unit: 'ng/mL' }, // 30–150
};

export const vitalNormalRanges = {
  // Core vitals (adults)
  bloodPressure: {
    systolic: { min: 90, max: 120 }, // ≤120
    diastolic: { min: 60, max: 80 }, // ≤80
  },
  heartRate: { min: 60, max: 100 }, // bpm
  respiratoryRate: { min: 12, max: 20 }, // breaths/min
  oxygenSaturation: { min: 95, max: 100 }, // %
  temperatureC: { min: 36.1, max: 37.2 }, // °C (oral)
  temperatureF: { min: 97.0, max: 99.0 }, // °F (oral)

  // Anthropometrics
  bmi: { min: 18.5, max: 24.9 }, // kg/m²
  weight: { min: 50, max: 120 }, // kg – generic adult band, not strict
  bsa: { min: 1.6, max: 2.2 }, // m² typical adult
  waistCircumferenceMale: { min: 0, max: 40 }, // in, <40
  waistCircumferenceFemale: { min: 0, max: 35 }, // in, <35

  // Respiratory / oxygenation
  peakExpiratoryFlow: { min: 400, max: 700 }, // L/min (very population-dependent)
  etco2: { min: 35, max: 45 }, // mmHg
  fio2: { min: 21, max: 21 }, // % (room air normal)
  oxygenFlowRate: { min: 0, max: 6 }, // L/min nasal cannula typical

  // Metabolic / circulatory bedside measures
  bloodGlucoseFasting: { min: 70, max: 99 }, // mg/dL
  lactate: { min: 0.5, max: 2.0 }, // mmol/L
  capillaryRefillSeconds: { min: 0, max: 2 }, // s, <2 considered normal
  map: { min: 70, max: 105 }, // mmHg
  pulsePressure: { min: 30, max: 50 }, // mmHg

  // Pain (treating 0–3 as “acceptable” for range logic)
  painScore: { min: 0, max: 3 }, // 0 ideal; >3 often clinically significant
};

const numberFromString = (value?: string | null) => {
  if (!value) return null;
  const cleaned = value.replace(/[^0-9.-]/g, '');
  const num = parseFloat(cleaned);
  return Number.isFinite(num) ? num : null;
};

// Normalize lab names and provide some common aliases so external lab result
// descriptions (which often include bracketed units, specimen, or method)
// map to the keys defined in `labNormalRanges`.
const normalizeLabName = (raw?: string | null) => {
  if (!raw) return '';
  let s = raw.toString();

  // Remove bracketed or parenthetical qualifiers like [Entitic volume], (Automated count), etc.
  s = s.replace(/\[[^\]]*\]|\([^)]*\)/g, '');

  // Remove common trailing phrases like "in Blood" or "by Automated count" and similar.
  s = s.replace(/\b(in|of)\b\s+[^,;\-]*/i, (m) => {
    // Only strip short phrases like "in Blood" but keep longer meaningful names.
    // We'll apply a light-touch: if phrase contains just one or two words, remove it.
    return m.split(/\s+/).length <= 3 ? '' : m;
  });
  s = s.replace(/\bby\b\s+.*$/i, '');

  // Normalize punctuation/spacing
  s = s.replace(/[:,]/g, '');
  s = s.replace(/\s+/g, ' ').trim();

  return s;
};

const labAliases: Array<[RegExp, string]> = [
  [/platelet mean volume/i, 'Mean Platelet Volume'],
  [/mean platelet volume/i, 'Mean Platelet Volume'],
  [/mpv\b/i, 'MPV'],
  [/platelet distribution width/i, 'Platelet Distribution Width'],
  [/pdw\b/i, 'PDW'],
  [/platelets?\b/i, 'Platelets'],
  [/hemoglobin/i, 'Hemoglobin'],
  [/hematocrit/i, 'Hematocrit'],
  [/mcv\b/i, 'MCV'],
  [/mchc\b/i, 'MCHC'],
  [/mch\b/i, 'MCH'],
  [/erythrocyte distribution width/i, 'Erythrocyte distribution width'],
  [/erythrocytes?\b/i, 'Erythrocytes'],
  [/leukocytes?\b|white blood cells|wbc\b/i, 'Leukocytes'],
  [/red blood cells|rbc\b/i, 'Red Blood Cells'],
  [/rdw[- ]?cv/i, 'RDW-CV'],
  [/rdw[- ]?sd/i, 'RDW-SD'],
];

const findCanonicalLabKey = (rawName: string) => {
  const cleaned = normalizeLabName(rawName);
  if (!cleaned) return rawName;

  // 1) direct exact (case-insensitive) match against keys
  const keys = Object.keys(labNormalRanges);
  const exact = keys.find((k) => k.toLowerCase() === cleaned.toLowerCase());
  if (exact) return exact;

  // 2) run alias map
  for (const [rx, canonical] of labAliases) {
    if (rx.test(cleaned)) {
      // If the canonical exists as a key, prefer that. Otherwise return canonical directly.
      return keys.includes(canonical) ? canonical : canonical;
    }
  }

  // 3) fuzzy: match when all words of a key appear in the cleaned name
  const cleanedLower = cleaned.toLowerCase();
  for (const k of keys) {
    const keyTokens = k.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    if (keyTokens.length === 0) continue;
    const allPresent = keyTokens.every((t) => cleanedLower.includes(t));
    if (allPresent) return k;
  }

  // fallback to original rawName (no mapping)
  return rawName;
};

export const evaluateLabStatus = (name: string, value?: string | null): RangeStatus | null => {
  if (!value) return null;

  const canonical = findCanonicalLabKey(name || '');
  const range = labNormalRanges[canonical as keyof typeof labNormalRanges] || labNormalRanges[name];
  if (!range) return null;

  const numeric = numberFromString(value);
  if (numeric === null) return null;

  const helper = `${range.min}-${range.max} ${range.unit || ''}`.trim();

  if (numeric < range.min) {
    return { label: 'Low', tone: 'warning', helperText: helper };
  }
  if (numeric > range.max) {
    // Treat values above the “normal” band as at least warning; callers can decide if some are critical.
    return { label: 'High', tone: 'warning', helperText: helper };
  }

  return { label: 'Normal', tone: 'normal', helperText: helper };
};

export const evaluateVitalStatus = (
  type: keyof typeof vitalNormalRanges | 'bloodPressure' | 'temperature',
  value?: string | null
): RangeStatus | null => {
  if (!value) return null;

  switch (type) {
    case 'bloodPressure': {
      const match = value.match(/(\d{2,3})\s*\/\s*(\d{2,3})/);
      if (!match) return null;
      const systolic = parseFloat(match[1]);
      const diastolic = parseFloat(match[2]);
      const { systolic: sysRange, diastolic: diaRange } = vitalNormalRanges.bloodPressure;

      const systolicHigh = systolic > sysRange.max;
      const systolicLow = systolic < sysRange.min;
      const diastolicHigh = diastolic > diaRange.max;
      const diastolicLow = diastolic < diaRange.min;

      const helperText = `${sysRange.min}-${sysRange.max}/${diaRange.min}-${diaRange.max} mmHg`;

      if (systolicLow || diastolicLow) {
        return { label: 'Low', tone: 'warning', helperText };
      }
      if (systolicHigh || diastolicHigh) {
        return { label: 'High', tone: 'warning', helperText };
      }
      return { label: 'Normal', tone: 'normal', helperText };
    }

    case 'temperature': {
      const numeric = numberFromString(value);
      if (numeric === null) return null;
      const isFahrenheit = /f|°f/i.test(value);
      const range = isFahrenheit ? vitalNormalRanges.temperatureF : vitalNormalRanges.temperatureC;
      const helperText = `${range.min}-${range.max}${isFahrenheit ? ' °F' : ' °C'}`;

      if (numeric < range.min) {
        return { label: 'Low', tone: 'warning', helperText };
      }
      if (numeric > range.max) {
        return { label: 'High', tone: 'warning', helperText };
      }
      return { label: 'Normal', tone: 'normal', helperText };
    }

    case 'oxygenSaturation': {
      const numeric = numberFromString(value);
      if (numeric === null) return null;
      const range = vitalNormalRanges.oxygenSaturation;
      const helperText = `${range.min}%+`;

      if (numeric < range.min) {
        // Treat low SpO₂ as critical because it often requires prompt attention.
        return { label: 'Low', tone: 'critical', helperText };
      }
      return { label: 'Normal', tone: 'normal', helperText };
    }

    default: {
      const numeric = numberFromString(value);
      if (numeric === null) return null;

      // Handles heartRate, respiratoryRate, bmi, weight, map, pulsePressure, etc.
      const range = (vitalNormalRanges as any)[type];
      if (!range || typeof range.min !== 'number' || typeof range.max !== 'number') return null;

      const helperText = `${range.min}-${range.max}`;

      if (numeric < range.min) {
        return { label: 'Low', tone: 'warning', helperText };
      }
      if (numeric > range.max) {
        return { label: 'High', tone: 'warning', helperText };
      }
      return { label: 'Normal', tone: 'normal', helperText };
    }
  }
};

export const StatusPill = ({ status, className }: { status?: RangeStatus | null; className?: string }) => {
  if (!status) return null;

  let toneClasses =
    status.tone === 'normal'
      ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
      : status.tone === 'critical'
      ? 'bg-red-100 text-red-700 border-red-200'
      : 'bg-amber-100 text-amber-700 border-amber-200';

  // Treat explicit High/Low labels as red (critical) so they visually stand out.
  const labelLower = (status.label || '').toString().toLowerCase();
  if ((labelLower === 'high' || labelLower === 'low') && status.tone === 'warning') {
    toneClasses = 'bg-red-100 text-red-700 border-red-200';
  }

  return React.createElement(
    'span',
    {
      className: cn(
        // Use the shared `emr-badge` base so pills visually match other badges
        'emr-badge inline-flex items-center gap-1',
        toneClasses,
        className
      ),
    },
    status.label
  );
};