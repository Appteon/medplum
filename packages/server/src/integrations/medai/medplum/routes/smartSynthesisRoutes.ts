// SPDX-License-Identifier: Apache-2.0
import { Router } from 'express';
import type { DocumentReference, Patient, Condition, MedicationRequest, AllergyIntolerance, Observation } from '@medplum/fhirtypes';
import { AuthenticatedRequestContext } from '../../../../context.js';
import { requestContextStore } from '../../../../request-context-store.js';
import { getSystemRepo } from '../../../../fhir/repo.js';
import { generateSmartSynthesisNote, type SmartSynthesisContext } from '../../ai/index.js';

export const smartSynthesisRouter = Router();

// GET /smart-synthesis/notes/:patientId
smartSynthesisRouter.get('/notes/:patientId', async (req, res): Promise<void> => {
	try {
		const { patientId } = req.params as { patientId: string };
		const bundle = await requestContextStore.run(AuthenticatedRequestContext.system(), async () => {
			const repo = getSystemRepo();
			return await repo.search({
				resourceType: 'DocumentReference',
				count: 50,
				filters: [
					{ code: 'subject', operator: 'eq', value: `Patient/${patientId}` },
					{ code: 'type', operator: 'eq', value: 'http://loinc.org|34133-9' },
				],
				sortRules: [{ code: 'date', descending: true }],
			});
		});

		const notes = (bundle.entry ?? []).map((e: any) => {
			const doc = e.resource;
			const getExt = (url: string) => doc.extension?.find((x: any) => x.url === url)?.valueString ?? null;
			return {
				id: doc.id,
				patient_id: patientId,
				created_at: doc.date,
				summary_text: doc.description ?? '',
				content: getExt('http://medplum.com/fhir/StructureDefinition/smart-synthesis-content'),
				model: getExt('http://medplum.com/fhir/StructureDefinition/ai-model'),
			};
		});
		res.json({ ok: true, notes });
		return;
	} catch (err: any) {
		res.status(500).json({ ok: false, error: err?.message ?? 'Server error' });
		return;
	}
});

// POST /smart-synthesis/notes/generate -> Generate AI synthesis from patient data + transcript
smartSynthesisRouter.post('/notes/generate', async (req, res): Promise<void> => {
	try {
		const { patient_id, transcript_text } = req.body as { patient_id?: string; transcript_text?: string };

		if (!patient_id) {
			res.status(400).json({ ok: false, error: 'patient_id is required' });
			return;
		}

		if (!transcript_text) {
			res.status(400).json({ ok: false, error: 'transcript_text is required for synthesis' });
			return;
		}

		// Non-medical condition patterns to filter out (SDOH, employment, education, housing, transportation, etc.)
		const NON_MEDICAL_CONDITION_PATTERNS = [
			/\b(housing|homeless|shelter|living situation|unsatisfactory housing|inadequate housing|housing instability)\b/i,
			/\b(transport|transportation|lack of access to transportation|transport problem|no transportation)\b/i,
			/\b(employment|employed|unemployed|full-time|part-time|job|occupation|work status|student|education|school|college|university)\b/i,
			/\b(social isolation|financial|income|poverty|food insecurity|food desert)\b/i,
			/\b(medication review due|review due|follow-up due|appointment)\b/i,
			/\b(criminal|arrest|prison|incarcerat|legal case|court|probation)\b/i,
		];

		const isNonMedicalCondition = (conditionName: string): boolean => {
			if (!conditionName) return false;
			return NON_MEDICAL_CONDITION_PATTERNS.some(pattern => pattern.test(conditionName));
		};

		// Fetch patient data to build context
		const context = await requestContextStore.run(AuthenticatedRequestContext.system(), async () => {
			const repo = getSystemRepo();

			// Fetch patient
			const patient = (await repo.readResource('Patient', patient_id)) as Patient;

			// Fetch conditions
			const conditionsBundle = await repo.search({
				resourceType: 'Condition',
				count: 50,
				filters: [{ code: 'subject', operator: 'eq', value: `Patient/${patient_id}` }],
			});
			const allConditions = (conditionsBundle.entry ?? []).map((e: any) => e.resource as Condition);

			// Separate chronic conditions from diagnoses, filtering out non-medical SDOH conditions
			const chronic_conditions: SmartSynthesisContext['chronic_conditions'] = [];
			const diagnoses: SmartSynthesisContext['diagnoses'] = [];

			for (const condition of allConditions) {
				const conditionName = condition.code?.text || condition.code?.coding?.[0]?.display || 'Unknown';

				// Skip non-medical conditions
				if (isNonMedicalCondition(conditionName)) {
					continue;
				}

				const isChronicOrPersistent = condition.category?.some((cat: any) =>
					cat.coding?.some((c: any) =>
						c.code === 'problem-list-item' || c.code === 'encounter-diagnosis'
					)
				);

				if (isChronicOrPersistent || condition.clinicalStatus?.coding?.[0]?.code === 'active') {
					chronic_conditions.push({
						condition_name: conditionName,
						status: condition.clinicalStatus?.coding?.[0]?.code || null,
						control_level: null,
						diagnosis_time: condition.onsetDateTime || condition.recordedDate || null,
						recorded_at: condition.recordedDate || null,
						notes: condition.note?.[0]?.text || null,
					});
				} else {
					diagnoses.push({
						diagnosis: conditionName,
						summary: condition.note?.[0]?.text || null,
						mode: condition.verificationStatus?.coding?.[0]?.code || null,
						recorded_at: condition.recordedDate || null,
						accepted: condition.verificationStatus?.coding?.[0]?.code === 'confirmed',
					});
				}
			}

			// Fetch medications
			const medsBundle = await repo.search({
				resourceType: 'MedicationRequest',
				count: 50,
				filters: [
					{ code: 'subject', operator: 'eq', value: `Patient/${patient_id}` },
					{ code: 'status', operator: 'eq', value: 'active' },
				],
			});
			const meds = (medsBundle.entry ?? []).map((e: any) => e.resource as MedicationRequest);

			// Fetch allergies
			const allergiesBundle = await repo.search({
				resourceType: 'AllergyIntolerance',
				count: 50,
				filters: [{ code: 'patient', operator: 'eq', value: `Patient/${patient_id}` }],
			});
			const allergies = (allergiesBundle.entry ?? []).map((e: any) => e.resource as AllergyIntolerance);

			// Fetch recent vitals
			const vitalsBundle = await repo.search({
				resourceType: 'Observation',
				count: 20,
				filters: [
					{ code: 'subject', operator: 'eq', value: `Patient/${patient_id}` },
					{ code: 'category', operator: 'eq', value: 'vital-signs' },
				],
				sortRules: [{ code: 'date', descending: true }],
			});
			const vitals = (vitalsBundle.entry ?? []).map((e: any) => e.resource as Observation);

			// Fetch recent labs
			const labsBundle = await repo.search({
				resourceType: 'Observation',
				count: 20,
				filters: [
					{ code: 'subject', operator: 'eq', value: `Patient/${patient_id}` },
					{ code: 'category', operator: 'eq', value: 'laboratory' },
				],
				sortRules: [{ code: 'date', descending: true }],
			});
			const labs = (labsBundle.entry ?? []).map((e: any) => e.resource as Observation);

			// Fetch past notes (recent DocumentReferences)
			const pastNotesBundle = await repo.search({
				resourceType: 'DocumentReference',
				count: 5,
				filters: [{ code: 'subject', operator: 'eq', value: `Patient/${patient_id}` }],
				sortRules: [{ code: 'date', descending: true }],
			});
			const pastNotes = (pastNotesBundle.entry ?? []).map((e: any) => {
				const doc = e.resource as DocumentReference;
				return {
					note: doc.description || doc.content?.[0]?.attachment?.title || 'Note',
					recorded_at: doc.date || null,
					entered_by: doc.author?.[0]?.display || null,
				};
			});

			// Fetch preventive care (CarePlans)
			const carePlansBundle = await repo.search({
				resourceType: 'CarePlan',
				count: 50,
				filters: [{ code: 'patient', operator: 'eq', value: `Patient/${patient_id}` }],
			});
			const preventiveCare = (carePlansBundle.entry ?? []).map((e: any) => {
				const carePlan = e.resource;
				const category = carePlan.category?.[0]?.coding?.[0]?.display ||
					carePlan.category?.[0]?.text ||
					'General Care';
				const item = carePlan.title ||
					carePlan.description ||
					carePlan.activity?.[0]?.detail?.code?.text ||
					'Preventive Care Item';
				const status = carePlan.status;

				let lastDate = carePlan.period?.start || null;
				let nextDue = carePlan.period?.end || null;

				if (carePlan.activity && carePlan.activity.length > 0) {
					const activity = carePlan.activity[0];
					if (activity.detail?.scheduledPeriod) {
						lastDate = lastDate || activity.detail.scheduledPeriod.start;
						nextDue = nextDue || activity.detail.scheduledPeriod.end;
					} else if (activity.detail?.scheduledTiming?.event?.[0]) {
						lastDate = lastDate || activity.detail.scheduledTiming.event[0];
					}
				}

				return {
					item,
					category,
					status,
					last_date: lastDate,
					next_due: nextDue,
					notes: carePlan.note?.[0]?.text || null,
				};
			});

			// Build SmartSynthesisContext
			const synthesisContext: SmartSynthesisContext = {
				patient: {
					patient_id,
					first_name: patient.name?.[0]?.given?.join(' ') || undefined,
					last_name: patient.name?.[0]?.family || undefined,
					dob: patient.birthDate || null,
					sex: patient.gender || null,
					blood_type: null,
				},
				chronic_conditions,
				diagnoses,
				current_medications: meds.map((m: MedicationRequest) => {
					const dosage = m.dosageInstruction?.[0];
					return {
						medication_name:
							(m.medicationCodeableConcept?.text ||
								m.medicationCodeableConcept?.coding?.[0]?.display) ??
							'Unknown',
						dose: dosage?.doseAndRate?.[0]?.doseQuantity?.value ?? null,
						dose_unit: dosage?.doseAndRate?.[0]?.doseQuantity?.unit ?? null,
						route: dosage?.route?.text || dosage?.route?.coding?.[0]?.display || null,
						frequency: dosage?.timing?.code?.text ?? null,
						indication: m.reasonCode?.[0]?.text || null,
						is_active: m.status === 'active',
						last_reviewed: m.authoredOn || null,
					};
				}),
				allergies: allergies.map((a: AllergyIntolerance) => {
					// Normalize severity/criticality
					const rawCriticality = a.criticality || a.reaction?.[0]?.severity || null;
					let severityNormalized: string | null = null;
					if (rawCriticality) {
						const rc = String(rawCriticality).toLowerCase();
						if (rc === 'high' || rc === 'severe' || rc === 'critical') severityNormalized = 'severe';
						else if (rc === 'moderate' || rc === 'medium') severityNormalized = 'moderate';
						else if (rc === 'low' || rc === 'mild') severityNormalized = 'mild';
						else severityNormalized = rc;
					}

					return {
						allergen: a.code?.text || a.code?.coding?.[0]?.display || 'Unknown',
						category: a.category?.[0] || null,
						reaction: a.reaction?.[0]?.manifestation?.[0]?.text || null,
						severity: severityNormalized,
						status: a.clinicalStatus?.coding?.[0]?.code || null,
						recorded_at: a.recordedDate || null,
					};
				}),
				vitals: vitals.map((v: Observation) => ({
					recorded_at: v.effectiveDateTime || null,
					type: v.code?.text || v.code?.coding?.[0]?.display || 'Unknown',
					value: String(v.valueQuantity?.value ?? v.valueString ?? ''),
					unit: v.valueQuantity?.unit || null,
					notes: v.note?.[0]?.text || null,
				})),
				lab_results: labs.map((l: Observation) => ({
					recorded_at: l.effectiveDateTime || null,
					test_name: l.code?.text || l.code?.coding?.[0]?.display || 'Unknown',
					value: l.valueQuantity?.value ?? l.valueString ?? null,
					unit: l.valueQuantity?.unit || null,
				})),
				past_notes: pastNotes,
				family_history: {},
				social_history: {},
				preventive_care: preventiveCare,
			};

			return synthesisContext;
		});

		// Log context summary for debugging
		console.log('Smart Synthesis - Context Summary:', {
			patient_id,
			transcript_length: transcript_text?.length || 0,
			chronic_conditions_count: context.chronic_conditions?.length || 0,
			diagnoses_count: context.diagnoses?.length || 0,
			medications_count: context.current_medications?.length || 0,
			allergies_count: context.allergies?.length || 0,
			vitals_count: context.vitals?.length || 0,
			labs_count: context.lab_results?.length || 0,
		});

		// Generate AI smart synthesis note
		const aiResult = await generateSmartSynthesisNote(context, transcript_text);

		console.log('Smart Synthesis - AI Result:', {
			has_summary: !!aiResult.summary,
			has_subjective: !!aiResult.subjective,
			has_objective: !!aiResult.objective,
			has_assessment: !!aiResult.assessment,
			has_plan: !!aiResult.plan,
			has_changes: !!aiResult.changes,
		});

		// Parse the structured AI response from changes field
		let parsedAIResponse: any = null;
		if (aiResult.changes) {
			try {
				parsedAIResponse = JSON.parse(aiResult.changes);
			} catch (e) {
				console.error('Failed to parse AI changes JSON:', e);
			}
		}

		// Build structured note data for frontend using AI response or fallback to context
		const structuredNote = {
			noteType: 'smart-synthesis',
			subjective: parsedAIResponse?.subjective ? {
				chiefComplaint: parsedAIResponse.subjective.chiefComplaint || 'Not documented',
				hpi: parsedAIResponse.subjective.hpi || 'Not documented',
				intervalHistory: parsedAIResponse.subjective.intervalHistory || 'No changes',
				reviewOfSystems: parsedAIResponse.subjective.reviewOfSystems || []
			} : {
				chiefComplaint: aiResult.subjective || 'Not documented',
				hpi: aiResult.subjective || 'Not documented',
				intervalHistory: 'No changes',
				reviewOfSystems: []
			},
			pastMedicalHistory: parsedAIResponse?.pastMedicalHistory ? {
				activeProblems: parsedAIResponse.pastMedicalHistory.activeProblems || context.chronic_conditions.map(c => ({
					problem: c.condition_name,
					status: c.status || 'active',
					dxDate: c.recorded_at
				}))
			} : {
				activeProblems: context.chronic_conditions.map(c => ({
					problem: c.condition_name,
					status: c.status || 'active',
					dxDate: c.recorded_at
				}))
			},
			medications: parsedAIResponse?.medications ? {
				current: parsedAIResponse.medications.current || context.current_medications.map(m => ({
					name: m.medication_name,
					dose: m.dose ? `${m.dose}${m.dose_unit || ''}` : undefined,
					route: m.route,
					frequency: m.frequency
				}))
			} : {
				current: context.current_medications.map(m => ({
					name: m.medication_name,
					dose: m.dose ? `${m.dose}${m.dose_unit || ''}` : undefined,
					route: m.route,
					frequency: m.frequency
				}))
			},
			allergies: parsedAIResponse?.allergies || context.allergies.map(a => ({
				allergen: a.allergen,
				category: a.category,
				reaction: a.reaction,
				severity: a.severity
			})),
			socialFamilyHistory: parsedAIResponse?.socialFamilyHistory || {
				social: context.social_history?.smoking_history || context.social_history?.alcohol_use_history || 'Not documented',
				family: context.family_history?.text || 'Not documented'
			},
			objective: parsedAIResponse?.objective ? {
				vitals: parsedAIResponse.objective.vitals || (context.vitals.length > 0 ? Object.fromEntries(
					context.vitals.slice(0, 5).map(v => [v.type.toLowerCase().replace(/\s+/g, '_'), `${v.value} ${v.unit || ''}`])
				) : {}),
				examFindings: parsedAIResponse.objective.examFindings || [],
				labsImaging: parsedAIResponse.objective.labsImaging || (context.lab_results || []).slice(0, 10).map(l => ({
					name: l.test_name,
					value: String(l.value ?? ''),
					unit: l.unit,
					date: l.recorded_at
				}))
			} : {
				vitals: context.vitals.length > 0 ? Object.fromEntries(
					context.vitals.slice(0, 5).map(v => [v.type.toLowerCase().replace(/\s+/g, '_'), `${v.value} ${v.unit || ''}`])
				) : {},
				examFindings: aiResult.objective ? [{ system: 'General', finding: aiResult.objective }] : [],
				labsImaging: (context.lab_results || []).slice(0, 10).map(l => ({
					name: l.test_name,
					value: String(l.value ?? ''),
					unit: l.unit,
					date: l.recorded_at
				}))
			},
			assessmentAndPlan: parsedAIResponse?.assessmentAndPlan || [{
				problem: aiResult.assessment || 'Not documented',
				plan: aiResult.plan || 'Not documented'
			}],
			counseling: parsedAIResponse?.counseling || {},
			disposition: parsedAIResponse?.disposition || '',
			summary: aiResult.summary
		};

		const structuredNoteJson = JSON.stringify(structuredNote);

		// Store the generated note
		const noteId = await requestContextStore.run(AuthenticatedRequestContext.system(), async () => {
			const repo = getSystemRepo();
			const doc = await repo.createResource<DocumentReference>({
				resourceType: 'DocumentReference',
				status: 'current',
				type: { coding: [{ system: 'http://loinc.org', code: '34133-9', display: 'Summarization of episode note' }] },
				category: [
					{ coding: [{ system: 'http://medplum.com/fhir/CodeSystem/document-category', code: 'smart-synthesis', display: 'Smart Synthesis Note' }] },
				],
				subject: { reference: `Patient/${patient_id}` },
				date: new Date().toISOString(),
				description: (aiResult.summary || '').substring(0, 500) + ((aiResult.summary?.length ?? 0) > 500 ? '...' : ''),
				content: [{ attachment: { contentType: 'application/json', data: Buffer.from(structuredNoteJson).toString('base64') } }],
				extension: [
					{ url: 'http://medplum.com/fhir/StructureDefinition/smart-synthesis-content', valueString: structuredNoteJson },
					{ url: 'http://medplum.com/fhir/StructureDefinition/ai-model', valueString: aiResult.model || 'llama3' },
					...(aiResult.subjective ? [{ url: 'http://medplum.com/fhir/StructureDefinition/soap-subjective', valueString: aiResult.subjective }] : []),
					...(aiResult.objective ? [{ url: 'http://medplum.com/fhir/StructureDefinition/soap-objective', valueString: aiResult.objective }] : []),
					...(aiResult.assessment ? [{ url: 'http://medplum.com/fhir/StructureDefinition/soap-assessment', valueString: aiResult.assessment }] : []),
					...(aiResult.plan ? [{ url: 'http://medplum.com/fhir/StructureDefinition/soap-plan', valueString: aiResult.plan }] : []),
				],
			});
			return doc.id as string;
		});

		res.json({
			ok: true,
			note_id: noteId,
			summary: aiResult.summary,
			subjective: aiResult.subjective,
			objective: aiResult.objective,
			assessment: aiResult.assessment,
			plan: aiResult.plan,
			model: aiResult.model,
			structuredNote: structuredNote,
		});
		return;
	} catch (err: any) {
		console.error('Error generating smart synthesis note:', err);
		res.status(500).json({ ok: false, error: err?.message ?? 'Server error' });
		return;
	}
});

// POST /smart-synthesis/notes/save (create/update DocumentReference)
smartSynthesisRouter.post('/notes/save', async (req, res): Promise<void> => {
	try {
		const { patient_id, id, content } = req.body as { patient_id?: string; id?: string; content?: string };
		if (!patient_id || !content) {
			res.status(400).json({ ok: false, error: 'patient_id and content are required' });
			return;
		}

		const note = await requestContextStore.run(AuthenticatedRequestContext.system(), async () => {
			const repo = getSystemRepo();
			if (id) {
				const existing = (await repo.readResource('DocumentReference', id)) as DocumentReference;
				existing.description = content.substring(0, 500) + (content.length > 500 ? '...' : '');
				const ext = existing.extension ?? [];
				const val = ext.find((e: any) => e.url === 'http://medplum.com/fhir/StructureDefinition/smart-synthesis-content');
				if (val) val.valueString = content; else ext.push({ url: 'http://medplum.com/fhir/StructureDefinition/smart-synthesis-content', valueString: content });
				existing.extension = ext;
				existing.content = [
					{ attachment: { contentType: 'text/plain', data: Buffer.from(content).toString('base64') } },
				];
				const updated = await repo.updateResource(existing);
				return { id: updated.id, patient_id, content, created_at: (updated as any).date };
			} else {
				const created = await repo.createResource({
					resourceType: 'DocumentReference',
					status: 'current',
					type: { coding: [{ system: 'http://loinc.org', code: '34133-9', display: 'Summarization of episode note' }] },
					category: [
						{ coding: [{ system: 'http://medplum.com/fhir/CodeSystem/document-category', code: 'smart-synthesis', display: 'Smart Synthesis Note' }] },
					],
					subject: { reference: `Patient/${patient_id}` },
					date: new Date().toISOString(),
					description: content.substring(0, 500) + (content.length > 500 ? '...' : ''),
					extension: [
						{ url: 'http://medplum.com/fhir/StructureDefinition/smart-synthesis-content', valueString: content },
					],
					content: [{ attachment: { contentType: 'text/plain', data: Buffer.from(content).toString('base64') } }],
				});
				return { id: (created as any).id, patient_id, content, created_at: (created as any).date };
			}
		});

		res.json({ ok: true, note });
		return;
	} catch (err: any) {
		res.status(500).json({ ok: false, error: err?.message ?? 'Server error' });
		return;
	}
});
