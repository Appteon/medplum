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
  // Raw transcript content for AI to summarize into last_encounter_summary
  last_encounter_transcript?: {
    date?: string | null;
    content: string;
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
  context: PreChartContext,
  previousPreChartContent?: string | null
): Promise<BaseAIResult> {
  const patient = context.patient;
  const age = yearsFromDob(patient.dob);

  // Parse previous pre-chart data if available for comparison
  let previousData: any = null;
  if (previousPreChartContent) {
    try {
      previousData = JSON.parse(previousPreChartContent);
      console.log('[PreChartNote] Successfully parsed previous pre-chart data');
      console.log('[PreChartNote] Previous data keys:', Object.keys(previousData));
      console.log('[PreChartNote] Previous data preview:', previousPreChartContent.substring(0, 200));

      // Log key fields for comparison
      if (previousData.allergiesIntolerances) {
        console.log('[PreChartNote] Previous allergies count:', previousData.allergiesIntolerances.length);
        console.log('[PreChartNote] Previous allergies:', previousData.allergiesIntolerances.map((a: any) => a.allergen).join(', '));
      }
      if (previousData.vitalSignsTrends) {
        console.log('[PreChartNote] Previous vitals count:', previousData.vitalSignsTrends.length);
        if (previousData.vitalSignsTrends.length > 0) {
          const latest = previousData.vitalSignsTrends[0];
          console.log('[PreChartNote] Latest previous vitals:', JSON.stringify(latest));
        }
      }
    } catch (err) {
      console.warn('[PreChartNote] Could not parse previous pre-chart content:', err);
      console.warn('[PreChartNote] Content preview:', previousPreChartContent?.substring(0, 200));
    }
  } else {
    console.log('[PreChartNote] No previous pre-chart content provided - this is the first visit');
  }

  // Log current data for comparison
  console.log('[PreChartNote] Current allergies count:', context.allergies?.length || 0);
  if (context.allergies && context.allergies.length > 0) {
    console.log('[PreChartNote] Current allergies:', context.allergies.map((a) => a.allergen).join(', '));
  }
  console.log('[PreChartNote] Current vitals count:', context.vitals?.length || 0);
  if (context.vitals && context.vitals.length > 0) {
    console.log('[PreChartNote] Current vitals sample:', context.vitals.slice(0, 3).map((v) => `${v.type}: ${v.value}`).join(', '));
  }

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

  // Build allergies text with count for comparison
  const currentAllergyCount = context.allergies?.length || 0;
  const allergiesText =
    currentAllergyCount > 0
      ? `Total: ${currentAllergyCount}\n` + context.allergies.map((a) => `- ${a.allergen}: ${a.reaction || 'reaction unknown'} (${a.severity || ''})`).join('\n')
      : '-';

  // Group vitals by date for easier comparison with previous visit format
  const vitalsGroupedByDate = new Map<string, any>();
  context.vitals.forEach((v) => {
    const date = safeDate(v.recorded_at);
    if (!vitalsGroupedByDate.has(date)) {
      vitalsGroupedByDate.set(date, { date, readings: [], rawDate: v.recorded_at });
    }
    vitalsGroupedByDate.get(date)!.readings.push(v);
  });

  // Sort by date descending (most recent first)
  const sortedVitals = Array.from(vitalsGroupedByDate.values()).sort((a, b) => {
    const dateA = new Date(a.rawDate || a.date).getTime();
    const dateB = new Date(b.rawDate || b.date).getTime();
    return dateB - dateA;
  });

  const vitalsText =
    sortedVitals.length > 0
      ? sortedVitals
          .slice(0, 3) // Show up to 3 most recent dates
          .map((group, index) => {
            const readings: any = {};
            group.readings.forEach((v: any) => {
              const type = v.type.toLowerCase();
              if (type.includes('systolic')) readings.systolic = v.value;
              else if (type.includes('diastolic')) readings.diastolic = v.value;
              else if (type.includes('blood pressure')) readings.bp = v.value;
              else if (type.includes('heart rate') || type.includes('pulse')) readings.hr = v.value;
              else if (type.includes('temperature')) readings.temp = v.value;
              else if (type.includes('weight')) readings.weight = v.value;
              else if (type.includes('respiratory rate') || type.includes('respiration')) readings.rr = v.value;
              else if (type.includes('oxygen') || type.includes('spo2')) readings.spo2 = v.value;
            });

            // Format BP from systolic/diastolic if available
            if (readings.systolic && readings.diastolic) {
              readings.bp = `${readings.systolic}/${readings.diastolic}`;
            }

            const parts = [];
            if (readings.bp) parts.push(`BP: ${readings.bp}`);
            if (readings.hr) parts.push(`HR: ${readings.hr}`);
            if (readings.temp) parts.push(`Temp: ${readings.temp}`);
            if (readings.weight) parts.push(`Weight: ${readings.weight}`);
            if (readings.rr) parts.push(`RR: ${readings.rr}`);
            if (readings.spo2) parts.push(`SpO2: ${readings.spo2}%`);

            // Mark the most recent reading clearly
            const prefix = index === 0 ? '**MOST RECENT** ' : '';
            return `- ${prefix}${group.date}: ${parts.join(', ')}`;
          })
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

  // Include transcript content if available for AI to summarize
  const transcriptText = context.last_encounter_transcript
    ? `
LAST ENCOUNTER TRANSCRIPT (summarize in 3-6 sentences):
Date: ${context.last_encounter_transcript.date || 'Unknown'}
Provider: ${context.last_encounter_transcript.provider || 'Unknown'}
Transcript Content:
${context.last_encounter_transcript.content.substring(0, 4000)}${context.last_encounter_transcript.content.length > 4000 ? '\n... (transcript truncated)' : ''}
`
    : '';

  // Build previous data section for comparison if available
  let previousDataSection = '';
  let intervalHistoryInstructions = '';
  let intervalHistorySchemaDescription = '';

  if (previousData) {
    // Extract key clinical fields from previous pre-chart in readable format
    const prevConditions = previousData.activeProblemList || [];
    const prevMeds = previousData.medicationSummary || [];
    const prevAllergies = previousData.allergiesIntolerances || [];
    const prevVitals = previousData.vitalSignsTrends || [];
    const prevLabs = previousData.keyLabsResults || [];

    previousDataSection = `
PREVIOUS VISIT DATA (for comparison):
Date: ${previousData.lastEncounterSummary?.date || previousData.generatedAt || 'Unknown'}

[COUNTS FOR COMPARISON]
- Active Problems: ${prevConditions.length}
- Medications: ${prevMeds.length}
- Allergies: ${prevAllergies.length}
- Vitals Recorded: ${prevVitals.length}
- Lab Results: ${prevLabs.length}

[ACTIVE PROBLEMS AT LAST VISIT]
${prevConditions.length > 0 ? prevConditions.map((c: any) => `- ${c.problem} (${c.status || 'active'}, onset: ${c.onsetDate || 'unknown'})`).join('\n') : '- None documented'}

[MEDICATIONS AT LAST VISIT]
${prevMeds.length > 0 ? prevMeds.map((m: any) => `- ${m.name} ${m.dose || ''} ${m.frequency || ''} (indication: ${m.indication || 'not specified'})`).join('\n') : '- None documented'}

[ALLERGIES AT LAST VISIT] (Total: ${prevAllergies.length})
${prevAllergies.length > 0 ? prevAllergies.map((a: any) => `- ${a.allergen} (${a.severity || 'unknown severity'}, reaction: ${a.reaction || 'unknown'})`).join('\n') : '- None documented'}

[MOST RECENT VITALS FROM LAST VISIT]
${prevVitals.length > 0 ? prevVitals.slice(0, 3).map((v: any) => {
  const parts = [];
  if (v.bp) parts.push(`BP: ${v.bp}`);
  if (v.hr) parts.push(`HR: ${v.hr}`);
  if (v.temp) parts.push(`Temp: ${v.temp}`);
  if (v.weight) parts.push(`Weight: ${v.weight}`);
  if (v.rr) parts.push(`RR: ${v.rr}`);
  if (v.spo2) parts.push(`SpO2: ${v.spo2}%`);
  return `- ${v.date || 'Unknown date'}: ${parts.join(', ') || 'No vitals recorded'}`;
}).join('\n') : '- None documented'}

[RECENT LABS FROM LAST VISIT]
${prevLabs.length > 0 ? prevLabs.slice(0, 5).map((l: any) => `- ${l.name}: ${l.value} ${l.unit || ''} (date: ${l.date || 'unknown'}, status: ${l.status || 'unknown'})`).join('\n') : '- None documented'}

[PROCEDURES/IMMUNIZATIONS FROM LAST VISIT]
${previousData.immunizationsPreventiveCare?.immunizations?.length > 0 ? previousData.immunizationsPreventiveCare.immunizations.slice(0, 3).map((i: any) => `- ${i.vaccine} (${i.date || 'date unknown'})`).join('\n') : '- None recent'}
`;
    intervalHistoryInstructions = `
INTERVAL HISTORY SINCE LAST VISIT:
Compare the PREVIOUS VISIT DATA (from ${previousData.lastEncounterSummary?.date || previousData.generatedAt || 'last visit'}) with CURRENT data.

**CRITICAL: How to Compare Vitals:**
- In the CURRENT "RECENT VITALS" section, look for the line marked "**MOST RECENT**"
- Compare ONLY this most recent reading to the "Most Recent Vitals from Last Visit"
- Ignore older readings that appear in the current vitals list

**CRITICAL: How to Compare Allergies:**
- Look at "Allergies at Last Visit (Total: X)" vs "ALLERGIES" section with "Total: Y"
- If the totals are DIFFERENT, you MUST report ALL new allergies with their names
- Even ONE new allergy is clinically significant and MUST be reported

**Clinical Changes to Detect (CHECK ALL - REPORT EVERY CHANGE):**

1. **ALLERGIES:**
   - Compare: "Allergies at Last Visit (Total: ${prevAllergies.length})" vs current allergy count
   - Format: "[ALLERGY-NEW] Penicillin (high severity)" or "[ALLERGY-REMOVED] Sulfa"
   - If counts differ, list ALL new/removed allergens by name

2. **VITAL SIGNS - Compare MOST RECENT to previous:**
   - Heart Rate: Change >10 bpm OR >100 or <60 → "[VITAL-ABNORMAL] HR 120 (was 70, +50 bpm)"
   - Blood Pressure: Change >10 mmHg systolic or >5 diastolic → "[VITAL-CHANGE] BP 135/90 (was 120/80, +15/+10)"
   - Weight: Change >5 lbs → "[VITAL-CHANGE] Weight 185 lbs (was 180, +5 lbs gain)"
   - Temperature: Fever >100.4°F or change >1°F → "[VITAL-ABNORMAL] Temp 101.2°F (was 98.6°F)"
   - Respiratory Rate: Change >4 or >20 or <12 → "[VITAL-ABNORMAL] RR 24 (was 16)"
   - SpO2: <95% or decrease >2% → "[VITAL-CRITICAL] SpO2 92% (was 98%, -6%)"

3. **MEDICATIONS:**
   - New medications → "[MED-NEW] Lisinopril 10mg daily for hypertension"
   - Discontinued → "[MED-STOPPED] Atorvastatin 20mg (discontinued)"
   - Dose changes → "[MED-CHANGED] Metformin increased from 500mg to 1000mg BID"

4. **CONDITIONS:**
   - New diagnoses → "[CONDITION-NEW] Type 2 Diabetes Mellitus (diagnosed ${new Date().toISOString().split('T')[0]})"
   - Resolved conditions → "[CONDITION-RESOLVED] Acute sinusitis (resolved)"

5. **LAB RESULTS:**
   - New abnormal labs → "[LAB-ABNORMAL] HbA1c 7.8% (normal <5.7%)"
   - Significant changes → "[LAB-CHANGE] Glucose 180 mg/dL (was 110, +70)"
   - Missing/overdue labs → "[LAB-OVERDUE] HbA1c due (last done 6 months ago)"

6. **PROCEDURES:**
   - New procedures → "[PROCEDURE-NEW] Colonoscopy performed ${new Date().toISOString().split('T')[0]}"

7. **IMMUNIZATIONS:**
   - New vaccines → "[IMMUNIZATION-NEW] Influenza vaccine administered"
   - Overdue vaccines → "[IMMUNIZATION-DUE] Tdap booster overdue"

**EXAMPLES:**
- "[ALLERGY-NEW] Penicillin (high severity)"
- "[VITAL-ABNORMAL] HR 120 bpm (was 70 bpm, +50 bpm - tachycardic)"
- "[VITAL-CHANGE] Weight 185 lbs (was 180 lbs, +5 lbs)"
- "[MED-NEW] Lisinopril 10mg daily (started for hypertension)"
- "[MED-STOPPED] Atorvastatin 20mg (discontinued per patient request)"
- "[LAB-CHANGE] HbA1c 7.8% (was 6.5%, +1.3% - worsening glycemic control)"
- "[CONDITION-NEW] Type 2 Diabetes Mellitus"

**COMPREHENSIVE OUTPUT FORMAT:**
Use this EXACT structure with tags for EVERY change:

"[TAG] Description (previous value → new value, clinical context)"

Write ALL changes found, grouped by category:
1. Allergies (if any)
2. Critical vitals (if any)
3. Vital changes (if any)
4. Medications (if any)
5. Conditions (if any)
6. Labs (if any)
7. Procedures/Immunizations (if any)

If NOTHING changed: "No significant changes documented since last visit."

**CRITICAL RULES:**
- Use brackets [TAG] for EVERY item
- Include previous and new values in parentheses
- Add clinical context (e.g., "tachycardic", "worsening control", "improvement")
- Maximum 10 tagged items (prioritize most clinically significant)
- NEVER write "This is the first visit." - previous data IS provided above`;
    
    intervalHistorySchemaDescription = 'Tagged list of ALL changes since last visit using format: "[TAG] Description (previous → new, context)". Check: allergies, vitals, weight, medications, conditions, labs, procedures, immunizations. Use tags: ALLERGY-NEW, VITAL-ABNORMAL, VITAL-CHANGE, MED-NEW, MED-STOPPED, MED-CHANGED, CONDITION-NEW, CONDITION-RESOLVED, LAB-ABNORMAL, LAB-CHANGE, LAB-OVERDUE, PROCEDURE-NEW, IMMUNIZATION-NEW, IMMUNIZATION-DUE. If nothing changed: "No significant changes documented since last visit."';
    console.log('[PreChartNote] Using interval history comparison path (previous data present)');
  } else {
    intervalHistoryInstructions = `
INTERVAL HISTORY SINCE LAST VISIT:
Since this is the first pre-chart note for this patient, you MUST write exactly: "This is the first visit."`;
    
    intervalHistorySchemaDescription = 'This is the first visit.';
    console.log('[PreChartNote] Using first-visit interval history instructions (no previous data)');
  }

  const prompt = `You are a clinical AI assistant preparing a pre-chart note to help a physician prepare for an upcoming patient visit.

CURRENT PATIENT INFORMATION:
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
${transcriptText}
${previousDataSection}

IMPORTANT FORMATTING RULES:
1. If a section shows only a dash (-), it means no data is available - DO NOT mention that section in your summary
2. Do NOT write phrases like "Not on file", "Never Assessed", "Not documented", "None documented" - simply omit those items
3. Only include information that is actually present and meaningful
4. Be concise and focus only on clinically relevant data that exists

${intervalHistoryInstructions}

TASK:
Create a concise pre-chart note that:
1. Summarizes the patient's key medical history (only items with actual data)
2. Highlights important conditions and medications
3. Notes any gaps in care or overdue preventive measures
4. Suggests potential topics to address during the visit
5. Flags any concerns or red flags
6. Includes interval history based on comparison with previous visit (if available)

Return a JSON object:
{
  "summary": "The pre-chart preparation note (1-2 paragraphs, concise). Only mention items with actual data.",
  "last_encounter_summary": "If LAST ENCOUNTER TRANSCRIPT is provided above, summarize it in 3-6 sentences focusing on: chief complaint, key findings, diagnoses discussed, and treatment plan. If no transcript provided, use null.",
  "interval_history": "${intervalHistorySchemaDescription}",
  "key_conditions": ["list", "of", "key", "conditions"],
  "medications_to_review": ["meds", "needing", "attention"],
  "gaps_in_care": ["overdue", "items"],
  "suggested_topics": ["topics", "for", "visit"],
  "alerts": ["any", "red", "flags"]
}`;

  try {
    // Log key sections of the prompt for debugging
    console.log('[PreChartNote] ===== PROMPT DEBUG =====');
    console.log('[PreChartNote] Prompt includes previous data section:', previousDataSection.length > 0);
    if (previousDataSection.length > 0) {
      console.log('[PreChartNote] Previous data section preview:', previousDataSection.substring(0, 500));
    }
    console.log('[PreChartNote] Current allergies in prompt:', allergiesText.substring(0, 200));
    console.log('[PreChartNote] Current vitals in prompt:', vitalsText.substring(0, 300));
    console.log('[PreChartNote] Interval history instructions length:', intervalHistoryInstructions.length);
    console.log('[PreChartNote] ========================');

    const result = await invokeLlama3({
      prompt,
      maxTokens: 2000,
      temperature: 0.3,
      topP: 0.9,
    });

    console.log('[PreChartNote] LLM raw response preview:', result.substring(0, 200));

    const parsed = extractJsonFromResponse(result);
    if (parsed) {
      // Log what the AI returned for interval history
      console.log('[PreChartNote] AI returned interval_history:', parsed.interval_history || '(none)');
      console.log('[PreChartNote] Full AI response keys:', Object.keys(parsed).join(', '));

      // Build structured summary sections
      const summaryParts = [];

      // Main summary paragraph
      if (parsed.summary) {
        summaryParts.push(parsed.summary);
      }

      // Interval History section (show prominently after main summary)
      if (parsed.interval_history) {
        summaryParts.push(`\n\n**INTERVAL HISTORY SINCE LAST VISIT:**\n${parsed.interval_history}`);
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
