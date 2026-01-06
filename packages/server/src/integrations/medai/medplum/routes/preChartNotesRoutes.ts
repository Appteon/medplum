// SPDX-License-Identifier: Apache-2.0
import { Router } from 'express';
import { AuthenticatedRequestContext } from '../../../../context.js';
import { requestContextStore } from '../../../../request-context-store.js';
import { getSystemRepo } from '../../../../fhir/repo.js';
import type { DocumentReference } from '@medplum/fhirtypes';
import { generatePreChartNoteForPatient } from '../services/preChartWorker';
import { syncSinglePatientFromEHR, isSinglePatientSyncEnabled } from '../../../ehr-fetch/index.js';

export const preChartNotesRouter = Router();

// GET /pre-chart-notes/notes/:patientId
preChartNotesRouter.get('/notes/:patientId', async (req, res): Promise<void> => {
	try {
		const { patientId } = req.params as { patientId: string };
		const bundle = await requestContextStore.run(AuthenticatedRequestContext.system(), async () => {
			const repo = getSystemRepo();
			return await repo.search({
				resourceType: 'DocumentReference',
				count: 50,
				filters: [
					{ code: 'subject', operator: 'eq', value: `Patient/${patientId}` },
					{ code: 'type', operator: 'eq', value: 'http://loinc.org|11492-6' },
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
				content: getExt('http://medplum.com/fhir/StructureDefinition/pre-chart-content'),
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

// POST /pre-chart-notes/notes/generate -> Generate AI pre-chart note from patient data
// This endpoint now performs a 2-step process:
// 1. Sync latest data from external EHR (if configured)
// 2. Generate the pre-chart note from the updated data
preChartNotesRouter.post('/notes/generate', async (req, res): Promise<void> => {
	try {
		const { patient_id, reason_for_visit, skip_ehr_sync } = req.body as {
			patient_id?: string;
			reason_for_visit?: string;
			skip_ehr_sync?: boolean;
		};

		if (!patient_id) {
			res.status(400).json({ ok: false, error: 'patient_id is required' });
			return;
		}

		console.log(`[PreChartRoutes] /notes/generate requested for patient=${patient_id}, reason=${reason_for_visit ?? '(none)'}`);

		// Step 1: Sync latest data from external EHR (if configured and not skipped)
		let ehrSyncResult: { success: boolean; resourcesUpdated: number; durationMs: number; error?: string } | null = null;

		if (!skip_ehr_sync && isSinglePatientSyncEnabled()) {
			console.log(`[PreChartRoutes] Step 1: Syncing latest data from EHR for patient ${patient_id}...`);
			try {
				// Sync data from the last 24 hours
				const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
				ehrSyncResult = await syncSinglePatientFromEHR(patient_id, since);
				console.log(`[PreChartRoutes] EHR sync completed: ${ehrSyncResult.resourcesUpdated} resources updated in ${ehrSyncResult.durationMs}ms`);
			} catch (syncError: any) {
				// Log but don't fail - we can still generate from existing data
				console.warn(`[PreChartRoutes] EHR sync failed (continuing with existing data):`, syncError?.message);
				ehrSyncResult = {
					success: false,
					resourcesUpdated: 0,
					durationMs: 0,
					error: syncError?.message,
				};
			}
		} else if (!isSinglePatientSyncEnabled()) {
			console.log(`[PreChartRoutes] EHR sync skipped (not configured)`);
		} else {
			console.log(`[PreChartRoutes] EHR sync skipped (skip_ehr_sync=true)`);
		}

		// Step 2: Generate the pre-chart note
		console.log(`[PreChartRoutes] Step 2: Generating pre-chart note for patient ${patient_id}...`);
		const result = await generatePreChartNoteForPatient(patient_id, reason_for_visit);

		res.json({
			ok: true,
			note_id: result.id,
			summary: result.content,
			model: result.model,
			ehr_sync: ehrSyncResult ? {
				success: ehrSyncResult.success,
				resources_updated: ehrSyncResult.resourcesUpdated,
				duration_ms: ehrSyncResult.durationMs,
				error: ehrSyncResult.error,
			} : null,
		});
		return;
	} catch (err: any) {
		console.error('Error generating pre-chart note:', err);
		res.status(500).json({ ok: false, error: err?.message ?? 'Server error' });
		return;
	}
});

// POST /pre-chart-notes/ehr-sync/:patientId -> Sync patient data from external EHR only
// This endpoint is useful for triggering EHR sync separately from note generation
preChartNotesRouter.post('/ehr-sync/:patientId', async (req, res): Promise<void> => {
	try {
		const { patientId } = req.params as { patientId: string };

		if (!isSinglePatientSyncEnabled()) {
			res.json({
				ok: true,
				enabled: false,
				message: 'EHR sync is not configured',
			});
			return;
		}

		console.log(`[PreChartRoutes] EHR sync requested for patient ${patientId}`);

		// Sync data from the last 24 hours
		const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
		const result = await syncSinglePatientFromEHR(patientId, since);

		res.json({
			ok: true,
			enabled: true,
			success: result.success,
			resources_updated: result.resourcesUpdated,
			resources_by_type: result.resourcesByType,
			duration_ms: result.durationMs,
			ehr_patient_id: result.ehrPatientId,
			error: result.error,
		});
		return;
	} catch (err: any) {
		console.error('Error syncing from EHR:', err);
		res.status(500).json({ ok: false, error: err?.message ?? 'Server error' });
		return;
	}
});

// POST /pre-chart-notes/notes/save
preChartNotesRouter.post('/notes/save', async (req, res): Promise<void> => {
	try {
		const { patient_id, content, id } = req.body as { patient_id?: string; content?: string; id?: string };
		if (!patient_id || !content) {
			res.status(400).json({ ok: false, error: 'patient_id and content are required' });
			return;
		}

		const note = await requestContextStore.run(AuthenticatedRequestContext.system(), async () => {
			const repo = getSystemRepo();
			if (id) {
				const existing = (await repo.readResource('DocumentReference', id)) as DocumentReference;
				const ext = existing.extension ?? [];
				const contentExt = ext.find((e: any) => e.url === 'http://medplum.com/fhir/StructureDefinition/pre-chart-content');
				if (contentExt) {
					contentExt.valueString = content;
				} else {
					ext.push({ url: 'http://medplum.com/fhir/StructureDefinition/pre-chart-content', valueString: content });
				}
				// Try to parse content to extract a better description
				let description = content.substring(0, 200) + (content.length > 200 ? '...' : '');
				try {
					const parsed = JSON.parse(content);
					if (parsed.noteType === 'pre-chart' && parsed.patientDemographics?.name) {
						description = `Pre-Chart Note for ${parsed.patientDemographics.name}`;
					}
				} catch {
					// Not JSON, use substring
				}
				existing.description = description;
				existing.extension = ext;
				existing.content = [
					{ attachment: { contentType: 'application/json', data: Buffer.from(content).toString('base64') } },
				];
				const updated = (await repo.updateResource(existing)) as DocumentReference;
				return {
					id: updated.id,
					patient_id,
					created_at: updated.date,
					summary_text: updated.description,
					content,
					model: updated.extension?.find((e: any) => e.url === 'http://medplum.com/fhir/StructureDefinition/ai-model')?.valueString ?? null,
				};
			} else {
				// Try to parse content to extract a better description
				let description = content.substring(0, 200) + (content.length > 200 ? '...' : '');
				try {
					const parsed = JSON.parse(content);
					if (parsed.noteType === 'pre-chart' && parsed.patientDemographics?.name) {
						description = `Pre-Chart Note for ${parsed.patientDemographics.name}`;
					}
				} catch {
					// Not JSON, use substring
				}

				const created = (await repo.createResource({
					resourceType: 'DocumentReference',
					status: 'current',
					type: { coding: [{ system: 'http://loinc.org', code: '11492-6', display: 'Provider-unspecified History and physical note' }] },
					category: [
						{ coding: [{ system: 'http://medplum.com/fhir/CodeSystem/document-category', code: 'pre-chart', display: 'Pre-Chart Note' }] },
					],
					subject: { reference: `Patient/${patient_id}` },
					date: new Date().toISOString(),
					description,
					extension: [{ url: 'http://medplum.com/fhir/StructureDefinition/pre-chart-content', valueString: content }],
					content: [{ attachment: { contentType: 'application/json', data: Buffer.from(content).toString('base64') } }],
				})) as DocumentReference;
				return {
					id: created.id,
					patient_id,
					created_at: created.date,
					summary_text: created.description,
					content,
					model: null,
				};
			}
		});

		res.json({ ok: true, note });
		return;
	} catch (err: any) {
		res.status(500).json({ ok: false, error: err?.message ?? 'Server error' });
		return;
	}
});
