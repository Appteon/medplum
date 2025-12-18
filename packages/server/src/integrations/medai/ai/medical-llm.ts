// SPDX-License-Identifier: Apache-2.0
// Medical LLM utilities for AI-powered clinical note generation
import { invokeLlama3 } from './bedrock.js';

const model = 'meta.llama3-70b-instruct-v1:0';

// ============================================================================
// Type Definitions
// ============================================================================

export type BaseAIResult = {
  summary?: string;
  changes?: string;
  model?: string;
  prompt_tokens?: number;
  completion_tokens?: number;
  // SOAP format fields for scribed summary
  subjective?: string;
  objective?: string;
  assessment?: string;
  plan?: string;
};

export type SmartSynthesisContext = {
  patient: {
    patient_id: string;
    first_name?: string;
    last_name?: string;
    dob?: string | null;
    sex?: string | null;
    blood_type?: string | null;
  };
  chronic_conditions: Array<{
    condition_name: string;
    status?: string | null;
    control_level?: string | null;
    diagnosis_time?: string | null;
    recorded_at?: string | Date | null;
    notes?: string | null;
  }>;
  diagnoses: Array<{
    diagnosis: string;
    summary?: string | null;
    mode?: string | null;
    recorded_at?: string | Date | null;
    accepted?: boolean | null;
  }>;
  current_medications: Array<{
    medication_name: string;
    dose?: any;
    dose_unit?: string | null;
    route?: string | null;
    frequency?: string | null;
    indication?: string | null;
    is_active?: boolean;
    last_reviewed?: string | Date | null;
  }>;
  allergies: Array<{
    allergen: string;
    category?: string | null;
    reaction?: string | null;
    severity?: string | null;
    status?: string | null;
    recorded_at?: string | Date | null;
  }>;
  vitals: Array<{
    recorded_at: string | Date | null;
    type: string;
    value: string;
    unit?: string | null;
    notes?: string | null;
  }>;
  lab_results?: Array<{
    recorded_at?: string | Date | null;
    test_name: string;
    value?: any;
    unit?: string | null;
  }>;
  past_notes?: Array<{
    note: string;
    recorded_at: string | Date | null;
    entered_by?: string | null;
  }>;
  family_history?: {
    text?: string | null;
  };
  social_history?: {
    smoking_history?: string | null;
    alcohol_use_history?: string | null;
    drug_use_history?: string | null;
    activity_level?: string | null;
  };
  preventive_care?: Array<{
    item: string;
    category?: string | null;
    status?: string | null;
    last_date?: string | Date | null;
    next_due?: string | Date | null;
    notes?: string | null;
  }>;
};

export type PreChartContext = {
  patient: {
    patient_id: string;
    first_name?: string;
    last_name?: string;
    dob?: string | null;
    sex?: string | null;
    blood_type?: string | null;
    mrn?: string | null;
    preferred_language?: string | null;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    preferred_pharmacy?: string | null;
  };
  reason_for_visit?: string | null;
  chronic_conditions: Array<{
    condition_name: string;
    status?: string | null;
    control_level?: string | null;
    diagnosis_time?: string | null;
    recorded_at?: string | Date | null;
    notes?: string | null;
  }>;
  diagnoses: Array<{
    diagnosis: string;
    summary?: string | null;
    mode?: string | null;
    recorded_at?: string | Date | null;
    accepted?: boolean | null;
  }>;
  current_medications: Array<{
    medication_name: string;
    dose?: any;
    dose_unit?: string | null;
    route?: string | null;
    frequency?: string | null;
    indication?: string | null;
    is_active?: boolean;
    last_reviewed?: string | Date | null;
  }>;
  completed_medications: Array<{
    medication_name: string;
    end_date?: string | Date | null;
    discontinued_reason?: string | null;
  }>;
  allergies: Array<{
    allergen: string;
    category?: string | null;
    reaction?: string | null;
    severity?: string | null;
    status?: string | null;
    recorded_at?: string | Date | null;
  }>;
  vitals: Array<{
    recorded_at: string | Date | null;
    type: string;
    value: string;
    unit?: string | null;
    notes?: string | null;
  }>;
  lab_results?: Array<{
    recorded_at?: string | Date | null;
    test_name: string;
    value?: any;
    unit?: string | null;
    status?: string | null;
  }>;
  past_notes?: Array<{
    note: string;
    recorded_at: string | Date | null;
    entered_by?: string | null;
    is_transcript?: boolean;
  }>;
  family_history?: {
    text?: string | null;
  };
  social_history?: {
    smoking_history?: string | null;
    alcohol_use_history?: string | null;
    drug_use_history?: string | null;
    activity_level?: string | null;
  };
  preventive_care?: Array<{
    item: string;
    category?: string | null;
    status?: string | null;
    last_date?: string | Date | null;
    next_due?: string | Date | null;
    notes?: string | null;
  }>;
  immunizations?: Array<{
    vaccine_name: string;
    date?: string | Date | null;
    status?: string | null;
    dose_number?: string | null;
  }>;
  procedures?: Array<{
    procedure_name: string;
    date?: string | Date | null;
    notes?: string | null;
  }>;
  last_encounter?: {
    date?: string | Date | null;
    summary?: string | null;
    provider?: string | null;
  };
};

// ============================================================================
// Helper Functions
// ============================================================================

function safeDate(d?: string | Date | null): string {
  if (!d) return '';
  try {
    return new Date(d).toISOString().split('T')[0];
  } catch {
    return '';
  }
}

function yearsFromDob(dob?: string | null): number | null {
  if (!dob) return null;
  try {
    const diff = Date.now() - new Date(dob).getTime();
    return Math.floor(diff / (365.25 * 24 * 60 * 60 * 1000));
  } catch {
    return null;
  }
}

function extractJsonFromResponse(text: string): any {
  // Try to find JSON in the response
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch {
      // Fall through
    }
  }
  // Try array
  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      return JSON.parse(arrayMatch[0]);
    } catch {
      // Fall through
    }
  }
  return null;
}

// ============================================================================
// AI Scribe Notes Generation
// ============================================================================

/**
 * Generate AI Scribe Notes from raw transcript using Llama 3 via Bedrock
 * Returns SOAP-formatted clinical notes
 */
export async function generateAIScribeNotes(
  transcriptText: string,
  _modelChoice: 'llama' | 'openai' | 'xai' = 'llama'
): Promise<BaseAIResult> {
  const systemInstructions = `You are a medical scribe AI assistant. Your task is to convert a clinical encounter transcript into structured SOAP notes.

CRITICAL RULES:
1. Only include information explicitly stated in the transcript
2. Do not invent, assume, or hallucinate any medical information
3. If information for a section is not available, write "Not documented in encounter"
4. Use professional medical terminology
5. Be concise but thorough
6. Extract the chief complaint as a brief, single-line statement of the patient's main concern

OUTPUT FORMAT:
Return a JSON object with these exact fields:
{
  "chiefComplaint": "Brief single-line statement of patient's main concern (e.g., 'Chest pain for 3 days')",
  "subjective": "Patient's reported symptoms, history of present illness, and concerns",
  "objective": "Physical exam findings, vital signs, and observations documented",
  "assessment": "Clinical impressions and diagnoses discussed",
  "plan": "Treatment plan, medications, follow-up, and patient education discussed",
  "summary": "Brief 2-3 sentence summary of the encounter"
}`;

  const prompt = `${systemInstructions}

TRANSCRIPT:
${transcriptText}

Generate SOAP notes from this transcript. Return only valid JSON.`;

  try {
    const result = await invokeLlama3({
      prompt,
      maxTokens: 2048,
      temperature: 0.3,
      topP: 0.9,
    });

    const parsed = extractJsonFromResponse(result);
    if (parsed) {
      const chiefComplaint = parsed.chiefComplaint || parsed.chief_complaint || 'Not documented';
      const subjective = parsed.subjective || 'Not documented in encounter';
      const objective = parsed.objective || 'Not documented in encounter';
      const assessment = parsed.assessment || 'Not documented in encounter';
      const plan = parsed.plan || 'Not documented in encounter';
      const summary = parsed.summary || chiefComplaint;

      return {
        subjective,
        objective,
        assessment,
        plan,
        summary,
        model,
        // Store chief complaint for use in summary building
        changes: JSON.stringify({ chiefComplaint, subjective, objective, assessment, plan }),
      };
    }

    // Fallback: return raw text as summary
    return {
      summary: result.trim(),
      subjective: 'See summary',
      objective: 'See summary',
      assessment: 'See summary',
      plan: 'See summary',
      model,
    };
  } catch (err: any) {
    console.error('Error generating AI scribe notes:', err);
    throw new Error(`AI scribe generation failed: ${err.message}`);
  }
}

// ============================================================================
// Smart Synthesis Note Generation
// ============================================================================

/**
 * Generate a Smart Synthesis Note by combining EMR data and today's transcript
 */
export async function generateSmartSynthesisNote(
  context: SmartSynthesisContext,
  todayTranscript: string
): Promise<BaseAIResult> {
  const transcript = (todayTranscript ?? '').trim() || 'No transcript provided.';

  // Filter out non-medical content (criminal/employment/education) from transcript
  const NON_MEDICAL_PATTERNS = [
    /\b(criminal|arrest|felony|misdemeanor|prison|incarcerat|legal case|court|probation)\b/i,
    /\b(employment|employer|occupation|job|workplace|layoff|promotion|salary|compensation)\b/i,
    /\b(education|school|college|university|degree|diploma|graduat)\b/i,
  ];

  const scrubNonMedicalText = (text?: string) => {
    if (!text) return '';
    let t = String(text);
    for (const rx of NON_MEDICAL_PATTERNS) {
      const r = new RegExp(rx.source, 'gi');
      t = t.replace(r, '');
    }
    // Clean up whitespace and punctuation
    t = t.replace(/\s+/g, ' ');
    t = t.replace(/\s+([,;:\.\!\?])/g, '$1');
    t = t.replace(/^[,;:\.\-\s]+/, '').replace(/[,;:\.\-\s]+$/, '');
    t = t.replace(/(\.{2,}|\!{2,}|\?{2,})/g, '.');
    return t.trim();
  };

  const filteredTranscript = scrubNonMedicalText(transcript);

  const patient = context.patient;
  const age = yearsFromDob(patient.dob);
  const patientName = [patient.first_name, patient.last_name].filter(Boolean).join(' ') || 'Unknown';

  // Sort by date descending
  const sDesc = <T extends { recorded_at?: any }>(arr: T[]) =>
    [...(arr || [])].sort((a, b) => new Date(b.recorded_at || 0).getTime() - new Date(a.recorded_at || 0).getTime());

  // Build EMR context sections
  const demoLine = `Patient: ${patientName}, Age: ${age ?? 'unknown'}, Sex: ${patient.sex ?? 'unknown'}, Blood Type: ${patient.blood_type ?? 'unknown'}`;

  const activeProblems = (context.chronic_conditions || [])
    .filter((c) => c.status !== 'resolved' && c.status !== 'inactive')
    .slice(0, 15)
    .map(
      (c) =>
        `- ${c.condition_name} (status: ${c.status ?? 'active'}, control: ${c.control_level ?? 'unknown'}, dx: ${safeDate(c.diagnosis_time || c.recorded_at)})${c.notes ? ` [${c.notes}]` : ''}`
    )
    .join('\n');

  const inactiveProblems = (context.chronic_conditions || [])
    .filter((c) => c.status === 'resolved' || c.status === 'inactive')
    .slice(0, 8)
    .map((c) => `- ${c.condition_name} (${c.status}, ${safeDate(c.recorded_at)})`)
    .join('\n');

  const recentDiagnoses = sDesc(context.diagnoses || [])
    .slice(0, 10)
    .map((d) => `- ${safeDate(d.recorded_at)}: ${d.diagnosis} (${d.mode ?? 'unknown'}, accepted: ${d.accepted ?? false})`)
    .join('\n');

  const medications = [...(context.current_medications || [])]
    .sort((a, b) => new Date(b.last_reviewed || 0).getTime() - new Date(a.last_reviewed || 0).getTime())
    .slice(0, 20)
    .map(
      (m) =>
        `- ${m.medication_name}${m.dose ? ` ${m.dose}${m.dose_unit ?? ''}` : ''} ${m.route ?? ''} ${m.frequency ?? ''}${m.indication ? ` (for ${m.indication})` : ''} [active: ${m.is_active !== false}]`
    )
    .join('\n');

  const allergiesList = sDesc(context.allergies || [])
    .slice(0, 12)
    .map(
      (a) =>
        `- ${a.allergen} (${a.category ?? 'unknown'}): ${a.reaction ?? 'unknown reaction'} - severity: ${a.severity ?? 'unknown'}, status: ${a.status ?? 'active'}`
    )
    .join('\n');

  const recentVitals = sDesc(context.vitals || [])
    .slice(0, 8)
    .map((v) => `- ${safeDate(v.recorded_at)}: ${v.type} = ${v.value}${v.unit ? ` ${v.unit}` : ''}${v.notes ? ` (${v.notes})` : ''}`)
    .join('\n');

  const recentLabs = sDesc(context.lab_results || [])
    .slice(0, 10)
    .map((l) => `- ${safeDate(l.recorded_at)}: ${l.test_name} = ${l.value ?? ''}${l.unit ? ` ${l.unit}` : ''}`)
    .join('\n');

  const pastNotes = sDesc((context.past_notes || []).filter((n) => scrubNonMedicalText(n.note)))
    .slice(0, 3)
    .map((n) => `- ${safeDate(n.recorded_at)} by ${n.entered_by ?? 'unknown'}: ${n.note.substring(0, 200)}${n.note.length > 200 ? '...' : ''}`)
    .join('\n');

  const familyHistory = context.family_history?.text || 'Not documented';

  const socialHistory =
    [
      context.social_history?.smoking_history ? `Smoking: ${context.social_history.smoking_history}` : null,
      context.social_history?.alcohol_use_history ? `Alcohol: ${context.social_history.alcohol_use_history}` : null,
      context.social_history?.drug_use_history ? `Drugs: ${context.social_history.drug_use_history}` : null,
      context.social_history?.activity_level ? `Activity: ${context.social_history.activity_level}` : null,
    ]
      .filter(Boolean)
      .join('; ') || 'Not documented';

  const preventiveCare = [...(context.preventive_care || [])]
    .sort((a, b) => {
      const dateA = new Date(a.last_date || a.next_due || 0).getTime();
      const dateB = new Date(b.last_date || b.next_due || 0).getTime();
      return dateB - dateA;
    })
    .slice(0, 15)
    .map(
      (pc) =>
        `- ${pc.item} (category: ${pc.category ?? 'unknown'}, status: ${pc.status ?? 'unknown'})${pc.last_date ? ` last: ${safeDate(pc.last_date)}` : ''}${pc.next_due ? ` next: ${safeDate(pc.next_due)}` : ''}${pc.notes ? ` [${pc.notes}]` : ''}`
    )
    .join('\n');

  const emrContext = `
[DEMOGRAPHICS]
${demoLine}

[ACTIVE_PROBLEMS]
${activeProblems || 'None documented'}

[INACTIVE_PROBLEMS]
${inactiveProblems || 'None'}

[RECENT_DIAGNOSES]
${recentDiagnoses || 'None'}

[CURRENT_MEDICATIONS]
${medications || 'None'}

[ALLERGIES]
${allergiesList || 'None'}

[RECENT_VITALS]
${recentVitals || 'None'}

[RECENT_LABS]
${recentLabs || 'None'}

[PAST_NOTES_SUMMARY]
${pastNotes || 'None'}

[FAMILY_HISTORY]
${familyHistory}

[SOCIAL_HISTORY]
${socialHistory}

[PREVENTIVE_CARE]
${preventiveCare || 'None documented'}
`.trim();

  const promptText = `You are an expert medical AI synthesizing patient information into a clinical SOAP note format.
CRITICAL PRIVACY RULE: Do not include any criminal history, employment/occupation details, or education history. If such content appears in transcript or notes, ignore it. Only include medically relevant information.

Your task is to synthesize the patient's medical record and today's transcript into a structured clinical note with SOAP format sections.

Output format: Return ONLY a JSON object with this structure:
{
  "subjective": {
    "chiefComplaint": string (patient's main concern in their own words from transcript, then paraphrased clearly),
    "hpi": string (history of present illness - narrative from today's conversation),
    "intervalHistory": string (smart delta from past notes - what changed since last visit. Format: "Since last visit X months ago: patient reports..." Include only NEW or CHANGED information, collapse unchanged items),
    "reviewOfSystems": Array<{ system: string, finding: string, status?: "stable" | "worse" | "improved" | "new" }> (positive findings from today + critical ongoing symptoms with status updates)
  },
  "pastMedicalHistory": {
    "activeProblems": Array<{ problem: string, status?: "current" | "active", control?: "controlled" | "uncontrolled", dxDate?: string (YYYY-MM-DD), newToday?: boolean }>
  },
  "medications": {
    "current": Array<{ name: string, dose?: string, route?: string, frequency?: string, change?: "new" | "increased" | "decreased" | "stopped" | "unchanged" }>
  },
  "allergies": Array<{ allergen: string, reaction?: string, severity?: "mild" | "moderate" | "severe" | "high" }>,
  "socialFamilyHistory": {
    "social": string (smoking, alcohol, drugs, activity level - concise narrative),
    "family": string (genetic conditions, family history - concise narrative)
  },
  "objective": {
    "vitals": { bloodPressure?: string, heartRate?: string, temperature?: string, weight?: string, bmi?: string, respiratoryRate?: string, oxygenSaturation?: string, lastUpdated?: string },
    "examFindings": Array<{ system: string (e.g., "Cardiovascular", "Respiratory"), finding: string, chronic?: boolean }> (findings from today's exam + carried-forward chronic findings if still relevant),
    "labsImaging": Array<{ name: string, value: string, unit?: string, date?: string (YYYY-MM-DD), status?: "normal" | "abnormal" | "critical" }> (ordered or resulted today)
  },
  "assessmentAndPlan": Array<{
    problem: string,
    priority?: number (1 = highest, today's chief complaint should be 1),
    narrative: string (brief summary combining old + new information, 2-5 lines),
    objectiveData?: string (supporting data like vitals, labs),
    plan: string (plan for this visit - tests, medications, referrals),
    followUp?: string (when to return, what to monitor)
  }> (list active problems in priority order, chief complaint first),
  "counseling": {
    "timeSpent"?: string (e.g., ">50% of visit spent in counseling/coordination of care"),
    "mdmLevel"?: string (e.g., "Straightforward", "Low", "Moderate", "High")
  },
  "disposition": string (e.g., "Return 1 week or sooner if chest pain worsens; otherwise 3 months with labs")
}

Clinical Guidelines:
1. SUBJECTIVE section:
   - chiefComplaint: Extract from transcript what patient said in their words, then paraphrase
   - intervalHistory: Compare with past_notes to identify what CHANGED since last visit (new symptoms, weight changes, medication changes patient made, new events). Only document deltas, not repeated information
   - reviewOfSystems: Include positive findings from today + critical ongoing symptoms with status update

2. PAST MEDICAL HISTORY:
   - Reconcile and date all active problems
   - Mark newToday=true for problems identified today
   - Use status "current" (preferred) or "active"
   - Include control level when applicable (controlled/uncontrolled)

3. MEDICATIONS:
   - Show changes with color coding: new/increased (green), decreased/stopped (red), unchanged (blue)
   - Include dose, route, frequency when available

4. ALLERGIES:
   - List all with reaction and severity
   - Display as alerts with appropriate visual emphasis

5. OBJECTIVE section:
   - vitals: Most recent vital signs
   - examFindings: Physical exam findings from today, plus carried-forward chronic findings (e.g., "Morbid obesity, decreased breath sounds at bases - chronic")
   - labsImaging: Labs/imaging ordered or resulted today

6. ASSESSMENT & PLAN:
   - List problems in priority order (chief complaint = priority 1)
   - Each problem gets: narrative summary, objective data supporting it, plan for this visit, follow-up instructions
   - Example format: "52M with DM, obesity, new 4-week history of exertional CP... Risk factors: former smoker, BMI 36. → Stress test scheduled 12/4, start aspirin 81 mg daily..."

7. COUNSELING:
   - Document time spent in counseling/coordination if >50% of visit
   - Suggest medical decision-making level

8. DISPOSITION:
   - Clear follow-up instructions and timeline

Rules:
- Use ONLY provided EMR context and transcript data
- Do NOT invent information not explicitly stated
- Keep narratives concise and clinically accurate
- All dates in ISO format (YYYY-MM-DD)
- Focus on clinical relevance and safety

--- PATIENT EMR DATA ---
${emrContext}

--- TODAY'S VISIT TRANSCRIPT ---
${filteredTranscript || 'Transcript redacted for non-medical content.'}

Output only the JSON object, no other text:`;

  console.log('Calling invokeLlama3 for Smart Synthesis Note');
  console.log('Context size:', emrContext.length, 'Transcript size:', transcript.length);

  try {
    const result = await invokeLlama3({
      prompt: promptText,
      maxTokens: 2000,
      temperature: 0.2,
      topP: 0.9,
    });

    const text = String(result || '').trim();
    // Return JSON string verbatim if parseable
    try {
      const parsed = JSON.parse(text);
      // Minimal validation - check for required top-level keys
      if (parsed && typeof parsed === 'object' && (parsed.subjective || parsed.pastMedicalHistory || parsed.medications || parsed.allergies)) {
        // Extract SOAP fields from the structured JSON for backward compatibility
        // Subjective: combine chiefComplaint and HPI
        let subjective = '';
        if (parsed.subjective) {
          const subj = parsed.subjective;
          if (subj.chiefComplaint) {
            subjective += `Chief Complaint: ${subj.chiefComplaint}\n`;
          }
          if (subj.hpi) {
            subjective += `History of Present Illness: ${subj.hpi}\n`;
          }
          if (subj.intervalHistory) {
            subjective += `Interval History: ${subj.intervalHistory}\n`;
          }
          if (subj.reviewOfSystems && Array.isArray(subj.reviewOfSystems) && subj.reviewOfSystems.length > 0) {
            subjective += 'Review of Systems:\n';
            for (const ros of subj.reviewOfSystems) {
              subjective += `  - ${ros.system}: ${ros.finding}${ros.status ? ` (${ros.status})` : ''}\n`;
            }
          }
        }

        // Objective: combine vitals and exam findings
        let objective = '';
        if (parsed.objective) {
          const obj = parsed.objective;
          if (obj.vitals && typeof obj.vitals === 'object') {
            const vitalsStr = Object.entries(obj.vitals)
              .filter(([_, v]) => v)
              .map(([k, v]) => `${k}: ${v}`)
              .join(', ');
            if (vitalsStr) {
              objective += `Vitals: ${vitalsStr}\n`;
            }
          }
          if (obj.examFindings && Array.isArray(obj.examFindings) && obj.examFindings.length > 0) {
            objective += 'Physical Exam:\n';
            for (const exam of obj.examFindings) {
              objective += `  - ${exam.system}: ${exam.finding}${exam.chronic ? ' (chronic)' : ''}\n`;
            }
          }
          if (obj.labsImaging && Array.isArray(obj.labsImaging) && obj.labsImaging.length > 0) {
            objective += 'Labs/Imaging:\n';
            for (const lab of obj.labsImaging) {
              objective += `  - ${lab.name}: ${lab.value}${lab.unit ? ` ${lab.unit}` : ''}${lab.status ? ` (${lab.status})` : ''}\n`;
            }
          }
        }

        // Assessment and Plan
        let assessment = '';
        let plan = '';
        if (parsed.assessmentAndPlan && Array.isArray(parsed.assessmentAndPlan) && parsed.assessmentAndPlan.length > 0) {
          assessment = 'Assessment:\n';
          plan = 'Plan:\n';
          for (const ap of parsed.assessmentAndPlan) {
            assessment += `  ${ap.priority ? `[${ap.priority}] ` : ''}- ${ap.problem}${ap.narrative ? `: ${ap.narrative}` : ''}\n`;
            if (ap.plan) {
              plan += `  - ${ap.problem}: ${ap.plan}${ap.followUp ? ` (Follow-up: ${ap.followUp})` : ''}\n`;
            }
          }
        }

        // Add disposition if present
        if (parsed.disposition) {
          plan += `\nDisposition: ${parsed.disposition}`;
        }

        // Build summary from the key sections
        let summary = '';
        if (parsed.subjective?.chiefComplaint) {
          summary += `Chief Complaint: ${parsed.subjective.chiefComplaint}\n`;
        }
        if (parsed.assessmentAndPlan && Array.isArray(parsed.assessmentAndPlan) && parsed.assessmentAndPlan.length > 0) {
          summary += `Assessment: ${parsed.assessmentAndPlan.map((ap: any) => ap.problem).join(', ')}\n`;
        }
        if (parsed.disposition) {
          summary += `Disposition: ${parsed.disposition}`;
        }

        return {
          summary: summary.trim() || JSON.stringify(parsed, null, 2),
          subjective: subjective.trim() || undefined,
          objective: objective.trim() || undefined,
          assessment: assessment.trim() || undefined,
          plan: plan.trim() || undefined,
          model,
          // Also include the full structured JSON for frontend consumption
          changes: JSON.stringify(parsed),
        };
      }
    } catch (e) {
      console.error('Failed to parse Smart Synthesis JSON response:', e);
    }

    // Fallback: return text as-is
    return {
      summary: text,
      model,
    };
  } catch (err: any) {
    console.error('Error generating smart synthesis note:', err);
    throw new Error(`Smart synthesis generation failed: ${err.message}`);
  }
}

// ============================================================================
// Pre-Chart Note Generation
// ============================================================================

/**
 * Generate Pre-Chart Note from patient medical history for clinical preparation
 */
export async function generatePreChartNote(
  context: PreChartContext
): Promise<BaseAIResult> {
  const patient = context.patient;
  const age = yearsFromDob(patient.dob);

  const demographicsText = `
Patient: ${patient.first_name || ''} ${patient.last_name || ''}
Age: ${age ? `${age} years` : 'Unknown'}
Sex: ${patient.sex || 'Unknown'}
MRN: ${patient.mrn || 'N/A'}
Preferred Language: ${patient.preferred_language || 'English'}
Reason for Visit: ${context.reason_for_visit || 'Not specified'}
`.trim();

  const chronicText =
    context.chronic_conditions.length > 0
      ? context.chronic_conditions
          .map((c) => `- ${c.condition_name}: ${c.status || 'active'} (${c.control_level || 'control unknown'})`)
          .join('\n')
      : 'None documented';

  const diagnosesText =
    context.diagnoses.length > 0
      ? context.diagnoses
          .slice(0, 10)
          .map((d) => `- ${d.diagnosis} (${safeDate(d.recorded_at)})`)
          .join('\n')
      : 'None documented';

  const medsText =
    context.current_medications.length > 0
      ? context.current_medications
          .map((m) => `- ${m.medication_name} ${m.dose || ''} ${m.dose_unit || ''} ${m.frequency || ''} - ${m.indication || ''}`.trim())
          .join('\n')
      : 'None documented';

  const allergiesText =
    context.allergies.length > 0
      ? context.allergies.map((a) => `- ${a.allergen}: ${a.reaction || 'reaction unknown'} (${a.severity || ''})`).join('\n')
      : 'NKDA';

  const vitalsText =
    context.vitals.length > 0
      ? context.vitals
          .slice(0, 5)
          .map((v) => `- ${v.type}: ${v.value} ${v.unit || ''} (${safeDate(v.recorded_at)})`)
          .join('\n')
      : 'None recent';

  const labsText =
    context.lab_results && context.lab_results.length > 0
      ? context.lab_results
          .slice(0, 8)
          .map((l) => `- ${l.test_name}: ${l.value} ${l.unit || ''} (${safeDate(l.recorded_at)})`)
          .join('\n')
      : 'None recent';

  const preventiveText =
    context.preventive_care && context.preventive_care.length > 0
      ? context.preventive_care.map((p) => `- ${p.item}: ${p.status || 'unknown'} (last: ${safeDate(p.last_date)})`).join('\n')
      : 'None documented';

  const immunizationsText =
    context.immunizations && context.immunizations.length > 0
      ? context.immunizations.map((i) => `- ${i.vaccine_name} (${safeDate(i.date)})`).join('\n')
      : 'None documented';

  const lastEncounterText = context.last_encounter
    ? `Date: ${safeDate(context.last_encounter.date)}\nProvider: ${context.last_encounter.provider || 'Unknown'}\nSummary: ${context.last_encounter.summary || 'No summary'}`
    : 'No previous encounter documented';

  const prompt = `You are a clinical AI assistant preparing a pre-chart note to help a physician prepare for an upcoming patient visit.

PATIENT INFORMATION:
${demographicsText}

CHRONIC CONDITIONS:
${chronicText}

RECENT DIAGNOSES:
${diagnosesText}

CURRENT MEDICATIONS:
${medsText}

ALLERGIES:
${allergiesText}

RECENT VITALS:
${vitalsText}

RECENT LABS:
${labsText}

PREVENTIVE CARE:
${preventiveText}

IMMUNIZATIONS:
${immunizationsText}

LAST ENCOUNTER:
${lastEncounterText}

TASK:
Create a concise pre-chart note that:
1. Summarizes the patient's key medical history
2. Highlights important conditions and medications
3. Notes any gaps in care or overdue preventive measures
4. Suggests potential topics to address during the visit
5. Flags any concerns or red flags

Return a JSON object:
{
  "summary": "The pre-chart preparation note (1-2 paragraphs, concise)",
  "key_conditions": ["list", "of", "key", "conditions"],
  "medications_to_review": ["meds", "needing", "attention"],
  "gaps_in_care": ["overdue", "items"],
  "suggested_topics": ["topics", "for", "visit"],
  "alerts": ["any", "red", "flags"]
}`;

  try {
    const result = await invokeLlama3({
      prompt,
      maxTokens: 2000,
      temperature: 0.3,
      topP: 0.9,
    });

    const parsed = extractJsonFromResponse(result);
    if (parsed) {
      // Build structured summary sections
      const summaryParts = [];

      // Main summary paragraph
      if (parsed.summary) {
        summaryParts.push(parsed.summary);
      }

      // Key Conditions section
      if (parsed.key_conditions && Array.isArray(parsed.key_conditions) && parsed.key_conditions.length > 0) {
        summaryParts.push(`\n\n**KEY CONDITIONS:**\n${parsed.key_conditions.map((c: string) => `• ${c}`).join('\n')}`);
      }

      // Medications to Review section
      if (parsed.medications_to_review && Array.isArray(parsed.medications_to_review) && parsed.medications_to_review.length > 0) {
        summaryParts.push(`\n\n**MEDICATIONS TO REVIEW:**\n${parsed.medications_to_review.map((m: string) => `• ${m}`).join('\n')}`);
      }

      // Alerts section (most important - show prominently)
      if (parsed.alerts && Array.isArray(parsed.alerts) && parsed.alerts.length > 0) {
        summaryParts.push(`\n\n**⚠️ ALERTS:**\n${parsed.alerts.map((a: string) => `• ${a}`).join('\n')}`);
      }

      // Gaps in Care section
      if (parsed.gaps_in_care && Array.isArray(parsed.gaps_in_care) && parsed.gaps_in_care.length > 0) {
        summaryParts.push(`\n\n**GAPS IN CARE:**\n${parsed.gaps_in_care.map((g: string) => `• ${g}`).join('\n')}`);
      }

      // Suggested Topics section
      if (parsed.suggested_topics && Array.isArray(parsed.suggested_topics) && parsed.suggested_topics.length > 0) {
        summaryParts.push(`\n\n**SUGGESTED TOPICS FOR VISIT:**\n${parsed.suggested_topics.map((t: string) => `• ${t}`).join('\n')}`);
      }

      return {
        summary: summaryParts.join(''),
        model,
        // Store the structured data for potential frontend use
        changes: JSON.stringify(parsed),
      };
    }

    return {
      summary: result.trim(),
      model,
    };
  } catch (err: any) {
    console.error('Error generating pre-chart note:', err);
    throw new Error(`Pre-chart note generation failed: ${err.message}`);
  }
}

// ============================================================================
// SOAP Note Generation from Scribe
// ============================================================================

/**
 * Generate SOAP notes from a scribed transcript
 * This is an alias for generateAIScribeNotes with SOAP-specific formatting
 */
export async function generateSOAPFromTranscript(
  transcriptText: string
): Promise<BaseAIResult> {
  return generateAIScribeNotes(transcriptText, 'llama');
}

// ============================================================================
// Scribed Summary Generation (from agentic notes)
// ============================================================================

/**
 * Generate a scribed summary from structured agentic notes
 */
export async function generateScribedSummary(
  agenticNotes: Array<{ section: string; entries: Array<{ text: string }> }>
): Promise<BaseAIResult> {
  // Flatten agentic notes into text
  const notesText = agenticNotes
    .map((section) => {
      const entries = section.entries.map((e) => `  - ${e.text}`).join('\n');
      return `${section.section}:\n${entries}`;
    })
    .join('\n\n');

  const prompt = `You are a medical scribe AI assistant. Convert the following structured clinical notes into a professional SOAP-formatted summary.

CLINICAL NOTES:
${notesText}

TASK:
Create a cohesive SOAP note from these structured notes.

Return a JSON object:
{
  "subjective": "Patient's reported symptoms and history",
  "objective": "Physical exam and objective findings",
  "assessment": "Clinical assessment and diagnoses",
  "plan": "Treatment plan and follow-up",
  "summary": "Brief 2-3 sentence summary"
}`;

  try {
    const result = await invokeLlama3({
      prompt,
      maxTokens: 2000,
      temperature: 0.3,
      topP: 0.9,
    });

    const parsed = extractJsonFromResponse(result);
    if (parsed) {
      return {
        subjective: parsed.subjective || '',
        objective: parsed.objective || '',
        assessment: parsed.assessment || '',
        plan: parsed.plan || '',
        summary: parsed.summary || '',
        model,
      };
    }

    return {
      summary: result.trim(),
      model,
    };
  } catch (err: any) {
    console.error('Error generating scribed summary:', err);
    throw new Error(`Scribed summary generation failed: ${err.message}`);
  }
}
