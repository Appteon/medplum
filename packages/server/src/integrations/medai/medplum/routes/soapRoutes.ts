// SPDX-License-Identifier: Apache-2.0
import { Router } from 'express';
import type { DocumentReference } from '@medplum/fhirtypes';
import { AuthenticatedRequestContext } from '../../../../context.js';
import { requestContextStore } from '../../../../request-context-store.js';
import { getSystemRepo } from '../../../../fhir/repo.js';
import { generateSOAPFromTranscript } from '../../ai/index.js';

export const soapRouter = Router();

// GET /medplum/soap-notes/:patientId
soapRouter.get('/soap-notes/:patientId', async (req, res): Promise<void> => {
	try {
		const { patientId } = req.params as { patientId: string };
		const bundle = await requestContextStore.run(AuthenticatedRequestContext.system(), async () => {
			const repo = getSystemRepo();
			return await repo.search({
				resourceType: 'DocumentReference',
				count: 50,
				filters: [
					{ code: 'subject', operator: 'eq', value: `Patient/${patientId}` },
					{ code: 'type', operator: 'eq', value: 'http://loinc.org|11506-3' },
				],
				sortRules: [{ code: 'date', descending: true }],
			});
		});

		const notes = (bundle.entry ?? []).map((e: any) => {
			const doc = e.resource;
			return {
				id: doc.id,
				patient_id: patientId,
				created_at: doc.date,
				summary_text: doc.description ?? '',
			};
		});
		res.json({ ok: true, notes });
		return;
	} catch (err: any) {
		res.status(500).json({ ok: false, error: err?.message ?? 'Server error' });
		return;
	}
});

// POST /medplum/soap-notes/generate -> Generate SOAP notes from transcript using AI
soapRouter.post('/soap-notes/generate', async (req, res): Promise<void> => {
	try {
		const { patient_id, transcript_text } = req.body as { patient_id?: string; transcript_text?: string };

		if (!patient_id) {
			res.status(400).json({ ok: false, error: 'patient_id is required' });
			return;
		}

		if (!transcript_text) {
			res.status(400).json({ ok: false, error: 'transcript_text is required for SOAP generation' });
			return;
		}

		// Generate SOAP notes from transcript
		const aiResult = await generateSOAPFromTranscript(transcript_text);

		// Store the generated SOAP note
		const noteId = await requestContextStore.run(AuthenticatedRequestContext.system(), async () => {
			const repo = getSystemRepo();
			const summary = `S: ${aiResult.subjective || 'Not documented'}\n\nO: ${aiResult.objective || 'Not documented'}\n\nA: ${aiResult.assessment || 'Not documented'}\n\nP: ${aiResult.plan || 'Not documented'}`;

			const doc = await repo.createResource<DocumentReference>({
				resourceType: 'DocumentReference',
				status: 'current',
				type: { coding: [{ system: 'http://loinc.org', code: '11506-3', display: 'Progress note' }] },
				category: [
					{ coding: [{ system: 'http://medplum.com/fhir/CodeSystem/document-category', code: 'soap-notes', display: 'SOAP Notes' }] },
				],
				subject: { reference: `Patient/${patient_id}` },
				date: new Date().toISOString(),
				description: summary.substring(0, 500) + (summary.length > 500 ? '...' : ''),
				content: [{ attachment: { contentType: 'text/plain', data: Buffer.from(summary).toString('base64') } }],
				extension: [
					{ url: 'http://medplum.com/fhir/StructureDefinition/soap-subjective', valueString: aiResult.subjective || 'Not documented' },
					{ url: 'http://medplum.com/fhir/StructureDefinition/soap-objective', valueString: aiResult.objective || 'Not documented' },
					{ url: 'http://medplum.com/fhir/StructureDefinition/soap-assessment', valueString: aiResult.assessment || 'Not documented' },
					{ url: 'http://medplum.com/fhir/StructureDefinition/soap-plan', valueString: aiResult.plan || 'Not documented' },
					{ url: 'http://medplum.com/fhir/StructureDefinition/ai-model', valueString: aiResult.model || 'llama3' },
				],
			});
			return doc.id as string;
		});

		res.json({
			ok: true,
			note_id: noteId,
			subjective: aiResult.subjective,
			objective: aiResult.objective,
			assessment: aiResult.assessment,
			plan: aiResult.plan,
			summary: aiResult.summary,
			model: aiResult.model,
		});
		return;
	} catch (err: any) {
		console.error('Error generating SOAP notes:', err);
		res.status(500).json({ ok: false, error: err?.message ?? 'Server error' });
		return;
	}
});

// POST /medplum/soap-notes/save (create/update DocumentReference with SOAP sections)
soapRouter.post('/soap-notes/save', async (req, res): Promise<void> => {
	try {
		const { patient_id, id, subjective, objective, assessment, plan } = req.body as {
			patient_id?: string;
			id?: string;
			subjective?: string;
			objective?: string;
			assessment?: string;
			plan?: string;
		};

		if (!patient_id) {
			res.status(400).json({ ok: false, error: 'patient_id is required' });
			return;
		}

		const summary = `S: ${subjective || 'Not documented'}\n\nO: ${objective || 'Not documented'}\n\nA: ${assessment || 'Not documented'}\n\nP: ${plan || 'Not documented'}`;

		const result = await requestContextStore.run(AuthenticatedRequestContext.system(), async () => {
			const repo = getSystemRepo();
			if (id) {
				const existing = (await repo.readResource('DocumentReference', id)) as DocumentReference;
				existing.description = summary;
				existing.extension = [
					{ url: 'http://medplum.com/fhir/StructureDefinition/soap-subjective', valueString: subjective || 'Not documented' },
					{ url: 'http://medplum.com/fhir/StructureDefinition/soap-objective', valueString: objective || 'Not documented' },
					{ url: 'http://medplum.com/fhir/StructureDefinition/soap-assessment', valueString: assessment || 'Not documented' },
					{ url: 'http://medplum.com/fhir/StructureDefinition/soap-plan', valueString: plan || 'Not documented' },
				];
				existing.content = [
					{ attachment: { contentType: 'text/plain', data: Buffer.from(summary).toString('base64') } },
				];
				const updated = await repo.updateResource(existing);
				return { id: updated.id, patient_id, created_at: (updated as any).date, subjective, objective, assessment, plan };
			} else {
				const created = await repo.createResource({
					resourceType: 'DocumentReference',
					status: 'current',
					type: { coding: [{ system: 'http://loinc.org', code: '11506-3', display: 'Progress note' }] },
					subject: { reference: `Patient/${patient_id}` },
					date: new Date().toISOString(),
					description: summary,
					content: [{ attachment: { contentType: 'text/plain', data: Buffer.from(summary).toString('base64') } }],
					extension: [
						{ url: 'http://medplum.com/fhir/StructureDefinition/soap-subjective', valueString: subjective || 'Not documented' },
						{ url: 'http://medplum.com/fhir/StructureDefinition/soap-objective', valueString: objective || 'Not documented' },
						{ url: 'http://medplum.com/fhir/StructureDefinition/soap-assessment', valueString: assessment || 'Not documented' },
						{ url: 'http://medplum.com/fhir/StructureDefinition/soap-plan', valueString: plan || 'Not documented' },
					],
				});
				return { id: (created as any).id, patient_id, created_at: (created as any).date, subjective, objective, assessment, plan };
			}
		});

		res.json({ ok: true, note: result });
		return;
	} catch (err: any) {
		res.status(500).json({ ok: false, error: err?.message ?? 'Server error' });
		return;
	}
});
