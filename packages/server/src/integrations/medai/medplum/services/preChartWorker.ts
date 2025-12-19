// SPDX-License-Identifier: Apache-2.0
import { requestContextStore } from '../../../../request-context-store.js';
import { AuthenticatedRequestContext } from '../../../../context.js';
import { getSystemRepo } from '../../../../fhir/repo.js';
import type {
  Appointment,
  DocumentReference,
  Patient,
  Condition,
  MedicationRequest,
  AllergyIntolerance,
  Observation,
  Immunization,
  Procedure,
  CarePlan,
  FamilyMemberHistory,
} from '@medplum/fhirtypes';
import { generatePreChartNote, type PreChartContext } from '../../ai/index.js';

interface UpcomingAppointment {
  appointment_id: string;
  patient_id: string;
  start: Date;
  reason?: string;
}

/**
 * Query for appointments within the next 1 hour
 * Uses FHIR Appointment resources with status=booked
 */
async function queryUpcomingAppointments(): Promise<UpcomingAppointment[]> {
  try {
    const now = new Date();
    const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);

    console.log(`[PreChartWorker] Querying appointments between ${now.toISOString()} and ${oneHourLater.toISOString()}`);

    const appointments = await requestContextStore.run(AuthenticatedRequestContext.system(), async () => {
      const repo = getSystemRepo();

      // Query appointments with status=booked and within 1-hour window
      const bundle = await repo.search({
        resourceType: 'Appointment',
        count: 1000,
        filters: [
          { code: 'status', operator: 'eq', value: 'booked' },
          { code: 'date', operator: 'ge', value: now.toISOString() },
          { code: 'date', operator: 'le', value: oneHourLater.toISOString() },
        ],
      });

      const appointments: UpcomingAppointment[] = [];
      const seenPatients = new Set<string>();

      // Parse FHIR Bundle response
      for (const entry of bundle.entry || []) {
        const appt = entry.resource as Appointment;
        if (!appt.id || !appt.start) continue;

        // Extract patient ID from appointment participants
        const patientParticipant = appt.participant?.find((p: any) =>
          p.actor?.reference?.startsWith('Patient/')
        );

        if (!patientParticipant?.actor?.reference) continue;

        const patientId = patientParticipant.actor.reference.split('/')[1];
        if (!patientId || seenPatients.has(patientId)) continue;

        // Extract reason text from appointment if available
        const reasonText = (appt.reasonCode?.[0] as any)?.text
          || (appt.reasonCode?.[0] as any)?.coding?.[0]?.display
          || appt.description
          || undefined;

        seenPatients.add(patientId);
        appointments.push({
          appointment_id: appt.id,
          patient_id: patientId,
          start: new Date(appt.start),
          reason: reasonText,
        });

        console.log(`[PreChartWorker] Found appointment: ID=${appt.id}, PatientID=${patientId}, Start=${appt.start}`);
      }

      return appointments;
    });

    return appointments;
  } catch (error) {
    console.error('[PreChartWorker] Failed to query upcoming appointments:', error);
    throw error;
  }
}

/**
 * Check if a pre-chart note already exists for this patient today
 * Queries DocumentReferences with pre-chart type created today
 */
async function hasPreChartNoteToday(patientId: string): Promise<boolean> {
  try {
    // Get today's date boundaries (local timezone)
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0);
    const todayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);

    const exists = await requestContextStore.run(AuthenticatedRequestContext.system(), async () => {
      const repo = getSystemRepo();

      // Query for all DocumentReference with pre-chart type for this patient
      const bundle = await repo.search({
        resourceType: 'DocumentReference',
        count: 100,
        filters: [
          { code: 'subject', operator: 'eq', value: `Patient/${patientId}` },
          { code: 'type', operator: 'eq', value: 'http://loinc.org|11492-6' },
        ],
        sortRules: [{ code: 'date', descending: true }],
      });

      const entries = bundle.entry || [];
      console.log(`[PreChartWorker] Deduplication: Found ${entries.length} pre-chart documents for patient ${patientId}`);

      // Check if any pre-chart notes were created today
      for (const entry of entries) {
        const doc = entry.resource as DocumentReference;
        if (doc.date) {
          const noteDate = new Date(doc.date);
          console.log(`[PreChartWorker] Deduplication: Checking note ${doc.id} with date ${doc.date}`);
          console.log(`[PreChartWorker] Deduplication: Today range: ${todayStart.toISOString()} to ${todayEnd.toISOString()}`);
          if (noteDate >= todayStart && noteDate <= todayEnd) {
            console.log(`[PreChartWorker] Found existing pre-chart note for patient ${patientId} from today (created at ${doc.date})`);
            return true;
          }
        }
      }

      console.log(`[PreChartWorker] No pre-chart notes found for patient ${patientId} from today`);
      return false;
    });

    return exists;
  } catch (error) {
    console.error(`[PreChartWorker] Error checking deduplication for patient ${patientId}:`, error);
    return false; // Assume no note exists on error
  }
}

interface GeneratedNote {
  id: string;
  patient_id: string;
  created_at: string;
  summary_text: string;
  content: string;
  model?: string;
}

/**
 * Calculate age from date of birth string
 */
function calculateAge(dob: string | null | undefined): string {
  if (!dob) return 'N/A';
  const birthDate = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age.toString();
}

/**
 * Convert Date or string to ISO string, handling null/undefined
 */
function toIsoString(date: string | Date | null | undefined): string {
  if (!date) return '';
  if (typeof date === 'string') return date;
  return date.toISOString();
}

/**
 * Get a repository with the patient's project context
 * This ensures DocumentReferences are created in the correct project
 */
export async function getRepoForPatient(patientId: string) {
  const systemRepo = getSystemRepo();

  // Fetch patient to get project context
  const patient = (await systemRepo.readResource('Patient', patientId)) as Patient;

  // Get the patient's project from meta
  const projectId = (patient.meta?.project as string) || undefined;
  if (!projectId) {
    throw new Error(`Patient ${patientId} does not have a project associated`);
  }

  // Fetch the project
  const project = await systemRepo.readResource('Project', projectId);

  // Create a repository with the patient's project context
  const { Repository } = await import('../../../../fhir/repo.js');
  return {
    repo: new Repository({
      superAdmin: true,
      strictMode: true,
      extendedMode: true,
      author: {
        reference: 'system',
      },
      currentProject: project as any,
      projects: [project as any],
    }),
    patient,
  };
}

/**
 * Generate pre-chart note for a single patient
 * Fetches all patient medical data from Medplum and generates a comprehensive pre-chart note
 */
export async function generatePreChartNoteForPatient(patientId: string, appointmentReason?: string): Promise<GeneratedNote> {
  return await requestContextStore.run(AuthenticatedRequestContext.system(), async () => {
    // Get repository with patient's project context
    const { repo, patient } = await getRepoForPatient(patientId);

    // Build PreChartContext from Medplum FHIR resources
    const context: PreChartContext = {
      patient: {
        patient_id: patient.id || patientId,
        first_name: patient.name?.[0]?.given?.[0] || '',
        last_name: patient.name?.[0]?.family || '',
        dob: patient.birthDate || null,
        sex: patient.gender || null,
        blood_type: null,
      },
      reason_for_visit: appointmentReason ?? null,
      chronic_conditions: [],
      diagnoses: [],
      current_medications: [],
      completed_medications: [],
      allergies: [],
      vitals: [],
      lab_results: [],
      past_notes: [],
      family_history: {},
      social_history: {},
      procedures: [],
    };

    // If appointment reason was not provided, attempt to fetch upcoming appointment to extract reason
    if (!context.reason_for_visit) {
      try {
        const apptBundle = await repo.search({
          resourceType: 'Appointment',
          count: 1,
          filters: [
            { code: 'patient', operator: 'eq', value: `Patient/${patientId}` },
            { code: 'status', operator: 'eq', value: 'booked' },
          ],
          sortRules: [{ code: 'date', descending: true }],
        });

        const appt = apptBundle.entry?.[0]?.resource as Appointment | undefined;
        if (appt) {
          context.reason_for_visit = (appt.reasonCode?.[0] as any)?.text
            || (appt.reasonCode?.[0] as any)?.coding?.[0]?.display
            || appt.description
            || null;
        }
      } catch (e) {
        // Ignore failures
      }
    }

    // Fetch Conditions (chronic conditions & diagnoses)
    try {
      const conditionsBundle = await repo.search({
        resourceType: 'Condition',
        count: 100,
        filters: [{ code: 'subject', operator: 'eq', value: `Patient/${patientId}` }],
        sortRules: [{ code: 'recorded-date', descending: true }],
      });

      const conditions = (conditionsBundle.entry ?? []).map((e: any) => e.resource as Condition);
      console.log(`[PreChartWorker] Found ${conditions.length} condition(s) for patient ${patientId}`);

      for (const condition of conditions) {
        const conditionName = condition.code?.text || condition.code?.coding?.[0]?.display || 'Unknown';
        const isChronicOrActive = condition.category?.some((cat: any) =>
          cat.coding?.some((c: any) => c.code === 'problem-list-item' || c.code === 'encounter-diagnosis')
        ) || condition.clinicalStatus?.coding?.[0]?.code === 'active';

        console.log(`[PreChartWorker] Processing condition: "${conditionName}", isChronicOrActive: ${isChronicOrActive}`);

        if (isChronicOrActive) {
          context.chronic_conditions!.push({
            condition_name: conditionName,
            status: condition.clinicalStatus?.coding?.[0]?.code || null,
            control_level: null,
            diagnosis_time: condition.onsetDateTime || condition.recordedDate || null,
            recorded_at: condition.recordedDate || null,
            notes: condition.note?.[0]?.text || null,
          });
        } else {
          context.diagnoses!.push({
            diagnosis: conditionName,
            summary: condition.note?.[0]?.text || null,
            mode: condition.verificationStatus?.coding?.[0]?.code || null,
            recorded_at: condition.recordedDate || null,
            accepted: condition.verificationStatus?.coding?.[0]?.code === 'confirmed',
          });
        }
      }
    } catch (e) {
      console.error(`[PreChartWorker] Error fetching conditions for patient ${patientId}:`, e);
    }

    // Fetch MedicationRequests (current medications)
    try {
      const medsBundle = await repo.search({
        resourceType: 'MedicationRequest',
        count: 100,
        filters: [
          { code: 'subject', operator: 'eq', value: `Patient/${patientId}` },
          { code: 'status', operator: 'eq', value: 'active' },
        ],
      });

      const medications = (medsBundle.entry ?? []).map((e: any) => e.resource as MedicationRequest);
      console.log(`[PreChartWorker] Found ${medications.length} active medication(s) for patient ${patientId}`);

      for (const med of medications) {
        const medName = (med.medicationCodeableConcept?.text || med.medicationCodeableConcept?.coding?.[0]?.display || 'Unknown medication') as string;
        const dosage = med.dosageInstruction?.[0];

        context.current_medications!.push({
          medication_name: medName,
          dose: dosage?.doseAndRate?.[0]?.doseQuantity?.value || null,
          dose_unit: dosage?.doseAndRate?.[0]?.doseQuantity?.unit || null,
          route: dosage?.route?.text || dosage?.route?.coding?.[0]?.display || null,
          frequency: dosage?.timing?.code?.text || null,
          indication: (med.reasonCode?.[0] as any)?.text || null,
          is_active: med.status === 'active',
          last_reviewed: med.authoredOn || null,
        });
      }
    } catch (e) {
      console.error(`[PreChartWorker] Error fetching current medications for patient ${patientId}:`, e);
    }

    // Fetch completed/discontinued medications
    try {
      const completedMedsBundle = await repo.search({
        resourceType: 'MedicationRequest',
        count: 50,
        filters: [
          { code: 'subject', operator: 'eq', value: `Patient/${patientId}` },
          { code: 'status', operator: 'in', value: 'completed,stopped' },
        ],
      });

      const completedMeds = (completedMedsBundle.entry ?? []).map((e: any) => e.resource as MedicationRequest);

      for (const med of completedMeds) {
        const medName = (med.medicationCodeableConcept?.text || med.medicationCodeableConcept?.coding?.[0]?.display || 'Unknown medication') as string;

        context.completed_medications!.push({
          medication_name: medName,
          end_date: med.authoredOn || null,
          discontinued_reason: med.statusReason?.text || null,
        });
      }

      console.log(`[PreChartWorker] Fetched ${completedMeds.length} completed medications`);
    } catch (e) {
      console.error(`[PreChartWorker] Error fetching completed medications for patient ${patientId}:`, e);
    }

    // Fetch AllergyIntolerances
    try {
      const allergiesBundle = await repo.search({
        resourceType: 'AllergyIntolerance',
        count: 100,
        filters: [{ code: 'patient', operator: 'eq', value: patientId }],
      });

      const allergies = (allergiesBundle.entry ?? []).map((e: any) => e.resource as AllergyIntolerance);
      console.log(`[PreChartWorker] Found ${allergies.length} allergy/allergies for patient ${patientId}`);

      for (const allergy of allergies) {
        const allergyName = allergy.code?.text || allergy.code?.coding?.[0]?.display || 'Unknown';

        context.allergies!.push({
          allergen: allergyName,
          category: allergy.category?.[0] || null,
          reaction: allergy.reaction?.[0]?.manifestation?.[0]?.text || null,
          severity: allergy.criticality || allergy.reaction?.[0]?.severity || null,
          status: allergy.clinicalStatus?.coding?.[0]?.code || null,
          recorded_at: allergy.recordedDate || null,
        });
      }
    } catch (e) {
      console.error(`[PreChartWorker] Error fetching allergies for patient ${patientId}:`, e);
    }

    // Fetch Observations (vitals and labs)
    try {
      const obsBundle = await repo.search({
        resourceType: 'Observation',
        count: 200,
        filters: [{ code: 'subject', operator: 'eq', value: `Patient/${patientId}` }],
        sortRules: [{ code: 'date', descending: true }],
      });

      const observations = (obsBundle.entry ?? []).map((e: any) => e.resource as Observation);
      console.log(`[PreChartWorker] Found ${observations.length} observation(s) for patient ${patientId}`);

      for (const obs of observations) {
        const category = obs.category?.[0]?.coding?.[0]?.code;
        const obsName = obs.code?.text || obs.code?.coding?.[0]?.display || 'Unknown';
        const value = obs.valueQuantity?.value || obs.valueString || obs.valueCodeableConcept?.text || null;
        const unit = obs.valueQuantity?.unit || null;

        if (category === 'vital-signs') {
          // Check if observation has components (e.g., BP panel with systolic/diastolic)
          if (obs.component && Array.isArray(obs.component) && obs.component.length > 0) {
            // Extract each component as a separate vital sign
            for (const component of obs.component) {
              const componentName = component.code?.text || component.code?.coding?.[0]?.display || 'Unknown';
              const componentValue = component.valueQuantity?.value || component.valueString || component.valueCodeableConcept?.text || null;
              const componentUnit = component.valueQuantity?.unit || null;

              context.vitals!.push({
                recorded_at: obs.effectiveDateTime || obs.issued || null,
                type: componentName,
                value: String(componentValue || ''),
                unit: componentUnit,
                notes: obs.note?.[0]?.text || null,
              });
            }
          } else {
            // Single-value vital sign (no components)
            context.vitals!.push({
              recorded_at: obs.effectiveDateTime || obs.issued || null,
              type: obsName,
              value: String(value || ''),
              unit: unit,
              notes: obs.note?.[0]?.text || null,
            });
          }
        } else if (category === 'laboratory') {
          // Check if observation has components (e.g., metabolic panel with multiple tests)
          if (obs.component && Array.isArray(obs.component) && obs.component.length > 0) {
            // Extract each component as a separate lab result
            for (const component of obs.component) {
              const componentName = component.code?.text || component.code?.coding?.[0]?.display || 'Unknown';
              const componentValue = component.valueQuantity?.value || component.valueString || component.valueCodeableConcept?.text || null;
              const componentUnit = component.valueQuantity?.unit || null;

              context.lab_results!.push({
                recorded_at: obs.effectiveDateTime || obs.issued || null,
                test_name: componentName,
                value: componentValue,
                unit: componentUnit,
              });
            }
          } else {
            // Single-value lab result (no components)
            context.lab_results!.push({
              recorded_at: obs.effectiveDateTime || obs.issued || null,
              test_name: obsName,
              value: value,
              unit: unit,
            });
          }
        } else if (category === 'social-history') {
          // Handle social history observations
          const loincCode = obs.code?.coding?.find((c: any) => c.system === 'http://loinc.org')?.code;

          // Social history narrative (LOINC 29762-2)
          if (loincCode === '29762-2' && obs.valueString) {
            const socialText = obs.valueString;
            console.log(`[PreChartWorker] Parsing social history narrative: ${socialText.substring(0, 100)}...`);
            context.social_history = {
              smoking_history: socialText.includes('Never smoker') ? 'Never smoker' :
                socialText.includes('Former smoker') ? 'Former smoker' :
                  socialText.includes('Current smoker') ? 'Current smoker' : null,
              alcohol_use_history: socialText.match(/Drinks alcohol.*?(\d+-?\d*.*?(week|month|day))/i)?.[0] ||
                (socialText.includes('No alcohol') ? 'None' : null),
              drug_use_history: socialText.includes('No recreational drug') ? 'None' : null,
              activity_level: socialText.match(/Exercises.*?(\d+.*?(week|month|day))/i)?.[0] || null,
            };
          }
          // Tobacco smoking status (LOINC 72166-2)
          else if (loincCode === '72166-2') {
            const smokingStatus = obs.valueCodeableConcept?.text || obs.valueCodeableConcept?.coding?.[0]?.display || obs.valueString;
            if (smokingStatus) {
              if (!context.social_history) context.social_history = {};
              context.social_history.smoking_history = smokingStatus;
              console.log(`[PreChartWorker] Found tobacco status: ${smokingStatus}`);
            }
          }
          // Family history narrative (LOINC 10157-6)
          else if (loincCode === '10157-6' && obs.valueString) {
            console.log(`[PreChartWorker] Found family history observation: ${obs.valueString.substring(0, 100)}...`);
            context.family_history = { text: obs.valueString };
          }
        }
      }

      console.log(`[PreChartWorker] Fetched ${context.vitals!.length} vitals and ${context.lab_results!.length} lab results`);
    } catch (e) {
      console.error(`[PreChartWorker] Error fetching observations for patient ${patientId}:`, e);
    }

    // Fetch Immunizations
    try {
      const immunizationsBundle = await repo.search({
        resourceType: 'Immunization',
        count: 100,
        filters: [{ code: 'patient', operator: 'eq', value: patientId }],
        sortRules: [{ code: 'date', descending: true }],
      });

      const immunizations = (immunizationsBundle.entry ?? []).map((e: any) => e.resource as Immunization);
      console.log(`[PreChartWorker] Found ${immunizations.length} immunization(s) for patient ${patientId}`);

      context.immunizations = [];
      for (const imm of immunizations) {
        const vaccineName = imm.vaccineCode?.text || imm.vaccineCode?.coding?.[0]?.display || 'Unknown vaccine';

        context.immunizations.push({
          vaccine_name: vaccineName,
          date: imm.occurrenceDateTime || imm.occurrenceString || null,
          status: imm.status || 'completed',
          dose_number: null,
        });
      }
    } catch (e) {
      console.error(`[PreChartWorker] Error fetching immunizations for patient ${patientId}:`, e);
    }

    // Fetch Procedures (surgical history)
    try {
      const proceduresBundle = await repo.search({
        resourceType: 'Procedure',
        count: 50,
        filters: [{ code: 'subject', operator: 'eq', value: `Patient/${patientId}` }],
        sortRules: [{ code: 'date', descending: true }],
      });

      const procedures = (proceduresBundle.entry ?? []).map((e: any) => e.resource as Procedure);
      console.log(`[PreChartWorker] Fetched ${procedures.length} procedures`);

      context.procedures = [];
      for (const proc of procedures) {
        const procName = proc.code?.text || proc.code?.coding?.[0]?.display || 'Unknown procedure';

        context.procedures.push({
          procedure_name: procName,
          date: proc.performedDateTime || proc.performedPeriod?.start || null,
          notes: proc.note?.[0]?.text || null,
        });
      }
    } catch (e) {
      console.error(`[PreChartWorker] Error fetching procedures for patient ${patientId}:`, e);
    }

    // Fetch CarePlans (preventive care)
    try {
      const carePlansBundle = await repo.search({
        resourceType: 'CarePlan',
        count: 50,
        filters: [{ code: 'subject', operator: 'eq', value: `Patient/${patientId}` }],
      });

      const carePlans = (carePlansBundle.entry ?? []).map((e: any) => e.resource as CarePlan);

      context.preventive_care = [];
      for (const carePlan of carePlans) {
        const category = carePlan.category?.[0]?.coding?.[0]?.display ||
          carePlan.category?.[0]?.text ||
          'General Care';
        const item = carePlan.title ||
          carePlan.description ||
          carePlan.activity?.[0]?.detail?.code?.text ||
          'Preventive Care Item';

        let lastDate = carePlan.period?.start || null;
        let nextDue = carePlan.period?.end || null;

        if (carePlan.activity && carePlan.activity.length > 0) {
          const activity = carePlan.activity[0];
          if (activity.detail) {
            if (activity.detail.scheduledPeriod) {
              lastDate = lastDate || activity.detail.scheduledPeriod.start || null;
              nextDue = nextDue || activity.detail.scheduledPeriod.end || null;
            }
          }
        }

        context.preventive_care.push({
          item,
          category,
          status: carePlan.status || null,
          last_date: lastDate,
          next_due: nextDue,
          notes: carePlan.note?.[0]?.text || null,
        });
      }

      console.log(`[PreChartWorker] Fetched ${carePlans.length} care plans`);
    } catch (e) {
      console.error(`[PreChartWorker] Error fetching care plans for patient ${patientId}:`, e);
    }

    // Fetch FamilyMemberHistory resources
    try {
      const familyHistoryBundle = await repo.search({
        resourceType: 'FamilyMemberHistory',
        count: 50,
        filters: [{ code: 'patient', operator: 'eq', value: patientId }],
      });

      const familyHistoryResources = (familyHistoryBundle.entry ?? []).map((e: any) => e.resource as FamilyMemberHistory);
      console.log(`[PreChartWorker] Found ${familyHistoryResources.length} family member history record(s) for patient ${patientId}`);

      if (familyHistoryResources.length > 0) {
        // Build a family history narrative from FamilyMemberHistory resources
        const familyMembers: string[] = [];

        for (const fmh of familyHistoryResources) {
          const relationship = fmh.relationship?.text || fmh.relationship?.coding?.[0]?.display || 'Family member';

          if (fmh.condition && fmh.condition.length > 0) {
            for (const condition of fmh.condition) {
              const conditionName = condition.code?.text || condition.code?.coding?.[0]?.display || 'condition';
              const ageOnset = condition.onsetAge ? ` at age ${condition.onsetAge.value}` : '';
              familyMembers.push(`${relationship} with ${conditionName}${ageOnset}`);
            }
          }
        }

        if (familyMembers.length > 0) {
          const familyText = familyMembers.join('. ') + '.';
          console.log(`[PreChartWorker] Constructed family history: ${familyText}`);
          context.family_history = { text: familyText };
        }
      }
    } catch (e) {
      console.error(`[PreChartWorker] Error fetching family member history for patient ${patientId}:`, e);
    }

    // Fetch recent DocumentReferences (past notes) - limit to 20
    try {
      const docsBundle = await repo.search({
        resourceType: 'DocumentReference',
        count: 20,
        filters: [{ code: 'subject', operator: 'eq', value: `Patient/${patientId}` }],
        sortRules: [{ code: 'date', descending: true }],
      });

      const docs = (docsBundle.entry ?? []).map((e: any) => e.resource as DocumentReference);

      for (const doc of docs) {
        // Skip pre-chart notes to avoid circular reference
        const isPreChartNote = doc.type?.coding?.some((c: any) => c.code === '11492-6');
        if (isPreChartNote) continue;

        // Identify transcripts/healthscribe/scribed notes
        const hasCategoryCode = (code: string) =>
          Array.isArray(doc.category) && doc.category.some((cat: any) =>
            Array.isArray(cat.coding) && cat.coding.some((cd: any) => cd.code === code)
          );
        const isTranscript = hasCategoryCode('transcript');
        const isHealthScribe = hasCategoryCode('healthscribe');
        const isScribeNotes = hasCategoryCode('scribe-notes');

        let noteContent = doc.description || '';

        // Try to get content from extension or attachment
        const contentExt = doc.extension?.find((e: any) =>
          e.url === 'http://medplum.com/fhir/StructureDefinition/smart-synthesis-content' ||
          e.url === 'http://medplum.com/fhir/StructureDefinition/pre-chart-content'
        );
        if (contentExt?.valueString) {
          noteContent = contentExt.valueString;
        } else if (doc.content?.[0]?.attachment?.data) {
          try {
            noteContent = Buffer.from(doc.content[0].attachment.data, 'base64').toString('utf-8');
          } catch (e) {
            // Keep description as fallback
          }
        }

        if (noteContent) {
          context.past_notes!.push({
            note: noteContent || doc.content?.[0]?.attachment?.title || 'Note',
            recorded_at: doc.date || null,
            entered_by: doc.author?.[0]?.display || null,
            is_transcript: isTranscript || isHealthScribe || isScribeNotes,
          });
        }
      }

      console.log(`[PreChartWorker] Fetched ${context.past_notes!.length} past notes`);
    } catch (e) {
      console.error(`[PreChartWorker] Error fetching past notes for patient ${patientId}:`, e);
    }

    // Log context summary
    console.log('[PreChartWorker] Fetched EMR context for pre-chart note:', {
      conditions: context.chronic_conditions?.length || 0,
      diagnoses: context.diagnoses?.length || 0,
      medications: context.current_medications?.length || 0,
      completedMeds: context.completed_medications?.length || 0,
      allergies: context.allergies?.length || 0,
      vitals: context.vitals?.length || 0,
      labs: context.lab_results?.length || 0,
      pastNotes: context.past_notes?.length || 0,
      pastNotesBreakdown: {
        documentReferences: context.past_notes?.filter(n => !n.note.startsWith('[')).length || 0,
        observationNotes: context.past_notes?.filter(n => n.note.startsWith('[')).length || 0,
      },
      immunizations: context.immunizations?.length || 0,
      socialHistory: context.social_history ? 'Present' : 'None',
      familyHistory: context.family_history?.text ? 'Present' : 'None',
      preventiveCare: context.preventive_care?.length || 0,
      procedures: context.procedures?.length || 0,
    });

    // Generate Pre-Chart note using AI
    const { summary, model } = await generatePreChartNote(context);

    console.log(`[PreChartWorker] Generated pre-chart note for patient ${patientId}:`);
    console.log(`[PreChartWorker] Model: ${model}`);
    console.log(`[PreChartWorker] Summary length: ${summary?.length || 0}`);
    console.log(`[PreChartWorker] Summary preview: ${summary?.substring(0, 200) || '(empty)'}`);

    if (!summary || summary.trim().length === 0) {
      console.error(`[PreChartWorker] ERROR: Generated summary is empty for patient ${patientId}`);
      throw new Error(`Failed to generate pre-chart note content for patient ${patientId}`);
    }

    // Build structured JSON for frontend parsing
    const structuredNote = {
      noteType: 'pre-chart' as const,
      patientDemographics: {
        name: `${patient.name?.[0]?.given?.[0] || ''} ${patient.name?.[0]?.family || ''}`.trim(),
        dob: patient.birthDate || 'N/A',
        age: patient.birthDate ? calculateAge(patient.birthDate) : 'N/A',
        gender: patient.gender || 'N/A',
        mrn: patient.id || 'N/A',
        preferredLanguage: (patient.communication?.[0]?.language?.text || 'English') as string,
        phone: (patient.telecom?.find((t: any) => t.system === 'phone')?.value || '') as string,
        email: (patient.telecom?.find((t: any) => t.system === 'email')?.value || '') as string,
        address: patient.address?.[0]
          ? `${patient.address[0].line?.join(' ') || ''} ${patient.address[0].city || ''} ${patient.address[0].state || ''} ${patient.address[0].postalCode || ''}`.trim()
          : '',
        preferredPharmacy: '',
      },
      reasonForVisit: context.reason_for_visit || 'Not specified',
      activeProblemList: context.chronic_conditions?.map((c) => ({
        problem: c.condition_name,
        onsetDate: c.diagnosis_time || c.recorded_at || undefined,
        lastUpdated: c.recorded_at || undefined,
        status: c.status || undefined,
        control: c.control_level || undefined,
      })) || [],
      medicationSummary: context.current_medications?.map((m) => ({
        name: m.medication_name,
        dose: m.dose ? `${m.dose} ${m.dose_unit || ''}`.trim() : undefined,
        route: m.route || undefined,
        frequency: m.frequency || undefined,
        indication: m.indication || undefined,
        lastReviewed: m.last_reviewed || undefined,
      })) || [],
      allergiesIntolerances: context.allergies?.map((a) => ({
        allergen: a.allergen,
        category: a.category || undefined,
        reaction: a.reaction || undefined,
        severity: a.severity || undefined,
        status: a.status || undefined,
      })) || [],
      vitalSignsTrends: (() => {
        // Group vitals by date
        const vitalsByDate = new Map<string, any>();
        context.vitals?.forEach((v) => {
          const date = toIsoString(v.recorded_at);
          if (!vitalsByDate.has(date)) {
            vitalsByDate.set(date, { date });
          }
          const entry = vitalsByDate.get(date);
          const type = v.type.toLowerCase();

          if (type.includes('systolic')) {
            entry.bp = entry.bp ? `${v.value}/${entry.bp.split('/')[1]}` : `${v.value}/?`;
          } else if (type.includes('diastolic')) {
            entry.bp = entry.bp ? `${entry.bp.split('/')[0]}/${v.value}` : `?/${v.value}`;
          } else if (type.includes('blood pressure')) {
            entry.bp = v.value;
          } else if (type.includes('heart rate') || type.includes('pulse')) {
            entry.hr = v.value;
          } else if (type.includes('temperature')) {
            entry.temp = v.value;
          } else if (type.includes('weight')) {
            entry.weight = v.value;
          } else if (type.includes('bmi')) {
            entry.bmi = v.value;
          } else if (type.includes('respiratory rate') || type.includes('respiration')) {
            entry.rr = v.value;
          } else if (type.includes('oxygen') || type.includes('spo2')) {
            entry.spo2 = v.value;
          }
        });
        return Array.from(vitalsByDate.values());
      })(),
      keyLabsResults: context.lab_results?.map((l) => ({
        name: l.test_name,
        value: String(l.value),
        unit: l.unit || undefined,
        date: l.recorded_at || undefined,
        status: undefined,
        referenceRange: undefined,
      })) || [],
      immunizationsPreventiveCare: {
        immunizations: context.immunizations?.map((i) => ({
          vaccine: i.vaccine_name,
          date: i.date || undefined,
          status: i.status || undefined,
          doseNumber: i.dose_number ? String(i.dose_number) : undefined,
        })) || [],
        preventiveCare: context.preventive_care?.map((p) => ({
          item: p.item,
          category: p.category || undefined,
          lastDate: p.last_date || undefined,
          nextDue: p.next_due || undefined,
          status: p.status || undefined,
        })) || [],
      },
      surgicalProcedureHistory: context.procedures?.map((p) => ({
        procedure: p.procedure_name,
        date: p.date || undefined,
        notes: p.notes || undefined,
      })) || [],
      socialFamilyHistory: {
        social: {
          smoking: context.social_history?.smoking_history || '',
          alcohol: context.social_history?.alcohol_use_history || '',
          drugs: context.social_history?.drug_use_history || '',
          activityLevel: context.social_history?.activity_level || '',
        },
        family: context.family_history?.text || '',
      },
      intervalHistory: summary, // Use AI-generated summary as interval history
      alertsOverdueCareGaps: {
        alerts: [],
        overdueItems: [],
        careGaps: [],
      },
      lastEncounterSummary: context.past_notes?.[0] ? {
        date: context.past_notes[0].recorded_at || undefined,
        summary: context.past_notes[0].note,
        provider: context.past_notes[0].entered_by || undefined,
        keyTakeaways: [],
      } : null,
      suggestedActions: [],
    };

    // Convert structured note to JSON string for storage
    const contentJson = JSON.stringify(structuredNote);

    // Store as DocumentReference in Medplum
    const docRef: DocumentReference = {
      resourceType: 'DocumentReference',
      status: 'current',
      type: {
        coding: [
          {
            system: 'http://loinc.org',
            code: '11492-6',
            display: 'Provider-unspecified History and physical note',
          },
        ],
        text: 'Pre-Chart Note',
      },
      category: [
        {
          coding: [
            {
              system: 'http://medplum.com/fhir/CodeSystem/document-category',
              code: 'pre-chart',
              display: 'Pre-Chart Note',
            },
          ],
        },
      ],
      subject: {
        reference: `Patient/${patientId}`,
      },
      date: new Date().toISOString(),
      description: `Pre-Chart Note for ${structuredNote.patientDemographics.name}`,
      extension: [
        {
          url: 'http://medplum.com/fhir/StructureDefinition/pre-chart-content',
          valueString: contentJson,
        },
        {
          url: 'http://medplum.com/fhir/StructureDefinition/ai-model',
          valueString: model,
        },
        {
          url: 'http://medplum.com/fhir/StructureDefinition/ai-summary',
          valueString: summary,
        },
      ],
      content: [
        {
          attachment: {
            contentType: 'application/json',
            data: Buffer.from(contentJson).toString('base64'),
          },
        },
      ],
    };

    // Log the docRef before creating
    console.log(`[PreChartWorker] About to create DocumentReference with:`);
    console.log(`[PreChartWorker] Extension 0 URL: ${docRef.extension?.[0]?.url}`);
    console.log(`[PreChartWorker] Extension 0 valueString length: ${(docRef.extension?.[0] as any)?.valueString?.length || 0}`);

    const createdDoc = await repo.createResource<DocumentReference>(docRef);
    console.log(`[PreChartWorker] Created pre-chart note for patient ${patientId} (DocumentReference ID: ${createdDoc.id})`);

    // Return the created note data
    return {
      id: createdDoc.id || '',
      patient_id: patientId,
      created_at: createdDoc.date || new Date().toISOString(),
      summary_text: createdDoc.description || '',
      content: contentJson,
      model: model,
    };
  });
}

/**
 * Main worker function: Process all upcoming appointments
 * Checks for appointments within 1 hour and generates pre-chart notes
 */
export async function processUpcomingAppointments(): Promise<void> {
  console.log('[PreChartWorker] Starting pre-chart note generation check...');

  try {
    const appointments = await queryUpcomingAppointments();
    console.log(`[PreChartWorker] Found ${appointments.length} upcoming appointment(s)`);

    if (appointments.length === 0) {
      console.log('[PreChartWorker] No upcoming appointments, skipping generation');
      return;
    }

    let successCount = 0;
    let skipCount = 0;
    let failCount = 0;

    for (const appt of appointments) {
      try {
        // Check if pre-chart note already exists for today
        console.log(`[PreChartWorker] Checking for existing pre-chart note for patient ${appt.patient_id}...`);
        const alreadyGenerated = await hasPreChartNoteToday(appt.patient_id);
        console.log(`[PreChartWorker] Deduplication check result for patient ${appt.patient_id}: ${alreadyGenerated}`);

        if (alreadyGenerated) {
          console.log(`[PreChartWorker] Pre-chart note already exists for patient ${appt.patient_id}, skipping`);
          skipCount++;
          continue;
        }

        // Generate pre-chart note
        console.log(`[PreChartWorker] Generating pre-chart note for patient ${appt.patient_id}...`);
        await generatePreChartNoteForPatient(appt.patient_id, appt.reason);
        console.log(`[PreChartWorker] Successfully generated pre-chart note for patient ${appt.patient_id}`);
        successCount++;
      } catch (error) {
        console.error(`[PreChartWorker] Failed to generate pre-chart note for patient ${appt.patient_id}:`, error);
        failCount++;
        // Continue processing other patients
      }
    }

    console.log(`[PreChartWorker] Completed: ${successCount} generated, ${skipCount} skipped, ${failCount} failed`);
  } catch (error) {
    console.error('[PreChartWorker] Fatal error in processUpcomingAppointments:', error);
    throw error;
  }
}
