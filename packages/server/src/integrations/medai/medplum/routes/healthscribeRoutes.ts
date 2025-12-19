// SPDX-License-Identifier: Apache-2.0
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { AuthenticatedRequestContext } from '../../../../context.js';
import { requestContextStore } from '../../../../request-context-store.js';
import type { DocumentReference, Media } from '@medplum/fhirtypes';
import type { Binary } from '@medplum/fhirtypes';
import { getSystemRepo } from '../../../../fhir/repo.js';
import { generateAIScribeNotes } from '../../ai/index.js';
import { getBinaryStorage } from '../../../../storage/loader.js';
import { getRepoForPatient } from '../services/preChartWorker.js';

export const healthscribeRouter = Router();

// Upload audio directly, store as Binary + Media with healthscribe metadata
healthscribeRouter.post('/upload-audio', async (req, res): Promise<void> => {
	try {
		const contentType = req.header('content-type') || 'audio/webm';
		const patientId = req.header('x-patient-id');
		const durationStr = req.header('x-audio-duration');
		const duration = durationStr ? Number.parseFloat(durationStr) : undefined;

		if (!patientId) {
			res.status(400).json({ ok: false, error: 'Missing x-patient-id header' });
			return;
		}

		const jobName = `hs-${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`;

		console.log('Uploading audio with jobName:', jobName, 'patientId:', patientId, 'duration:', duration);

		const result = await requestContextStore.run(AuthenticatedRequestContext.system(), async () => {
			const { repo } = await getRepoForPatient(patientId);
			const storage = getBinaryStorage();
			
			// Read the audio data from the request stream
			const chunks: Buffer[] = [];
			for await (const chunk of req) {
				chunks.push(chunk);
			}
			const audioBuffer = Buffer.concat(chunks);
			
			console.log('Audio data size:', audioBuffer.length, 'bytes');

			// Create Binary resource first (without data - will be stored externally)
			// This supports files up to 500MB using getBinaryStorage()
			const binary = await repo.createResource<Binary>({
				resourceType: 'Binary',
				contentType,
				securityContext: { reference: `Patient/${patientId}` },
			});

			// Store audio data externally using binary storage system
			// This persists in configured storage (database/filesystem/S3) and supports large files
		const audioStream = Readable.from(audioBuffer);
		await storage.writeBinary(binary, undefined, contentType, audioStream);

		console.log('Binary uploaded to storage:', {
				size: audioBuffer.length,
			});

			// Create Media resource in database to reference the Binary and provide metadata
			const media: Media = await repo.createResource<Media>({
				resourceType: 'Media',
				status: 'completed',
				identifier: [
					{ system: 'http://medplum.com/fhir/healthscribe-job', value: jobName },
				],
				type: {
					coding: [
						{ system: 'http://terminology.hl7.org/CodeSystem/media-type', code: 'audio', display: 'Audio' },
					],
				},
				subject: { reference: `Patient/${patientId}` },
				createdDateTime: new Date().toISOString(),
				content: { contentType, url: `Binary/${binary.id}`, title: `Recording for ${jobName}` },
				extension: [
					{ url: 'http://medplum.com/fhir/StructureDefinition/healthscribe-job-name', valueString: jobName },
					{ url: 'http://medplum.com/fhir/StructureDefinition/healthscribe-binary-id', valueString: binary.id },
					...(duration !== undefined
						? [{
								url: 'http://medplum.com/fhir/StructureDefinition/audio-duration-seconds',
								valueDecimal: duration,
							}]
						: []),
				],
			});

			console.log('Media created:', {
				id: media.id,
				identifier: media.identifier,
				binaryId: binary.id,
			});

			return { binaryId: binary.id as string, mediaId: media.id as string };
		});

		console.log('Audio upload complete:', {
			jobName,
			mediaId: result.mediaId,
			binaryId: result.binaryId,
		});

		res.status(200).json({ ok: true, jobName, mediaId: result.mediaId, binaryId: result.binaryId });
		return;
	} catch (err: any) {
		res.status(500).json({ ok: false, error: err?.message ?? 'Server error' });
		return;
	}
});

// Start a scribe job (DiagnosticReport placeholder to track job)
healthscribeRouter.post('/batch/start', async (req, res): Promise<void> => {
	try {
		const { jobName, patientId, mediaId, appointmentId } = req.body as {
			jobName?: string;
			patientId?: string;
			mediaId?: string;
			appointmentId?: string | number | null;
		};

		if (!jobName || !patientId) {
			res.status(400).json({ ok: false, error: 'jobName and patientId are required' });
			return;
		}

		const diagnosticReportId = await requestContextStore.run(AuthenticatedRequestContext.system(), async () => {
			const { repo } = await getRepoForPatient(patientId);
			const dr = await repo.createResource({
				resourceType: 'DiagnosticReport',
				status: 'registered',
				category: [
					{
						coding: [
							{
								system: 'http://medplum.com/fhir/CodeSystem/diagnostic-report-category',
								code: 'healthscribe',
								display: 'HealthScribe Transcription',
							},
						],
					},
				],
				code: { coding: [{ system: 'http://loinc.org', code: '11488-4', display: 'Consultation note' }] },
				subject: { reference: `Patient/${patientId}` },
				issued: new Date().toISOString(),
				extension: [
					{ url: 'http://medplum.com/fhir/StructureDefinition/healthscribe-job-name', valueString: jobName },
					...(mediaId
						? [{ url: 'http://medplum.com/fhir/StructureDefinition/healthscribe-media-id', valueString: mediaId }]
						: []),
					...(appointmentId != null
						? [
								{
									url: 'http://medplum.com/fhir/StructureDefinition/healthscribe-appointment-id',
									valueString: String(appointmentId),
								},
							]
						: []),
				],
			});
			return dr.id as string;
		});

		res.status(200).json({ ok: true, jobName, diagnosticReportId });
		return;
	} catch (err: any) {
		res.status(500).json({ ok: false, error: err?.message ?? 'Server error' });
		return;
	}
});

// Generate scribe notes from transcript: stores transcript and generates AI SOAP notes
healthscribeRouter.post('/scribe/generate', async (req, res): Promise<void> => {
	try {
		const { patient_id, job_name, transcript_text, generate_soap } = req.body as {
			patient_id?: string;
			job_name?: string;
			transcript_text?: string;
			appointment_id?: number | null;
			generate_soap?: boolean;
		};

		if (!patient_id || !transcript_text) {
			res.status(400).json({ ok: false, error: 'patient_id and transcript_text are required' });
			return;
		}

		const effectiveJobName =
			job_name || `transcript-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

		// Generate AI scribe notes from transcript
		let aiResult: Awaited<ReturnType<typeof generateAIScribeNotes>> | null = null;
		try {
			aiResult = await generateAIScribeNotes(transcript_text, 'llama');
		} catch (aiErr: any) {
			console.error('AI scribe generation failed (non-blocking):', aiErr?.message);
			// Continue without AI notes - they can be generated later
		}

		const result = await requestContextStore.run(AuthenticatedRequestContext.system(), async () => {
			const { repo } = await getRepoForPatient(patient_id);

			// Store the raw transcript
			const transcriptDoc = await repo.createResource<DocumentReference>({
				resourceType: 'DocumentReference',
				status: 'current',
				identifier: [{ system: 'http://medplum.com/fhir/healthscribe-job', value: effectiveJobName }],
				type: { coding: [{ system: 'http://loinc.org', code: '34109-9', display: 'Note' }] },
				category: [
					{ coding: [{ system: 'http://medplum.com/fhir/CodeSystem/document-category', code: 'transcript', display: 'Transcript' }] },
				],
				subject: { reference: `Patient/${patient_id}` },
				date: new Date().toISOString(),
				description: 'Clinical conversation transcript',
				content: [
					{ attachment: { contentType: 'text/plain', data: Buffer.from(transcript_text).toString('base64') } },
				],
				extension: [
					{ url: 'http://medplum.com/fhir/StructureDefinition/healthscribe-job-name', valueString: effectiveJobName },
				],
			});

			let scribeNotesId: string | null = null;
			let soapNotesId: string | null = null;

			// Store AI-generated scribe notes if available
			if (aiResult?.summary || aiResult?.subjective) {
				// Parse structured data from changes field if available
				let structuredData: any = null;
				if (aiResult.changes) {
					try {
						structuredData = JSON.parse(aiResult.changes);
					} catch (e) {
						console.error('Failed to parse scribe changes JSON:', e);
					}
				}

				const chiefComplaint = structuredData?.chiefComplaint || aiResult.summary || 'Not documented';
				const subjective = aiResult.subjective || 'Not documented';
				const objective = aiResult.objective || 'Not documented';
				const assessment = aiResult.assessment || 'Not documented';
				const plan = aiResult.plan || 'Not documented';

				// Build properly formatted summary for frontend parsing
				const summaryLines: string[] = [];
				summaryLines.push('CHIEF COMPLAINT');
				summaryLines.push(chiefComplaint);
				summaryLines.push('');
				
				summaryLines.push('KEY POINTS');
				// Extract key sentences from subjective and objective
				const extractSentences = (text: string, limit: number = 2): string[] => {
					if (!text || text.includes('Not documented')) return [];
					return text
						.split(/[.!?]\s+/)
						.filter((s) => s.trim().length > 15)
						.slice(0, limit)
						.map((s) => `- ${s.trim()}`);
				};
				const keyPoints = [
					...extractSentences(subjective, 2),
					...extractSentences(objective, 1),
				];
				summaryLines.push(keyPoints.length > 0 ? keyPoints.join('\n') : '- See assessment and plan below');
				summaryLines.push('');

				summaryLines.push('ASSESSMENT & PLAN');
				const apLines: string[] = [];
				if (!assessment.includes('Not documented')) {
					apLines.push(...extractSentences(assessment, 2).map((s) => s));
				}
				if (!plan.includes('Not documented')) {
					apLines.push(...extractSentences(plan, 3).map((s) => s));
				}
				summaryLines.push(apLines.length > 0 ? apLines.join('\n') : 'See subjective and objective above');

				const formattedSummary = summaryLines.join('\n');

				const scribeDoc = await repo.createResource<DocumentReference>({
					resourceType: 'DocumentReference',
					status: 'current',
					identifier: [{ system: 'http://medplum.com/fhir/healthscribe-job', value: `${effectiveJobName}-scribe` }],
					type: { coding: [{ system: 'http://loinc.org', code: '11506-3', display: 'Progress note' }] },
					category: [
						{ coding: [{ system: 'http://medplum.com/fhir/CodeSystem/document-category', code: 'scribe-notes', display: 'Scribe Notes' }] },
					],
					subject: { reference: `Patient/${patient_id}` },
					date: new Date().toISOString(),
					description: chiefComplaint,
					content: [
						{
							attachment: {
								contentType: 'text/plain',
								data: Buffer.from(formattedSummary).toString('base64'),
							},
						},
					],
					extension: [
						{ url: 'http://medplum.com/fhir/StructureDefinition/healthscribe-job-name', valueString: effectiveJobName },
						{ url: 'http://medplum.com/fhir/StructureDefinition/ai-model', valueString: aiResult.model || 'llama3' },
						{ url: 'http://medplum.com/fhir/StructureDefinition/chief-complaint', valueString: chiefComplaint },
						{ url: 'http://medplum.com/fhir/StructureDefinition/soap-subjective', valueString: subjective },
						{ url: 'http://medplum.com/fhir/StructureDefinition/soap-objective', valueString: objective },
						{ url: 'http://medplum.com/fhir/StructureDefinition/soap-assessment', valueString: assessment },
						{ url: 'http://medplum.com/fhir/StructureDefinition/soap-plan', valueString: plan },
					],
				});
				scribeNotesId = scribeDoc.id as string;
			}

			// Optionally generate separate SOAP notes document
			if (generate_soap && aiResult) {
				const soapDoc = await repo.createResource<DocumentReference>({
					resourceType: 'DocumentReference',
					status: 'current',
					identifier: [{ system: 'http://medplum.com/fhir/healthscribe-job', value: `${effectiveJobName}-soap` }],
					type: { coding: [{ system: 'http://loinc.org', code: '11506-3', display: 'Progress note' }] },
					category: [
						{ coding: [{ system: 'http://medplum.com/fhir/CodeSystem/document-category', code: 'soap-notes', display: 'SOAP Notes' }] },
					],
					subject: { reference: `Patient/${patient_id}` },
					date: new Date().toISOString(),
					description: 'SOAP Note',
					content: [
						{
							attachment: {
								contentType: 'application/json',
								data: Buffer.from(
									JSON.stringify({
										subjective: aiResult.subjective,
										objective: aiResult.objective,
										assessment: aiResult.assessment,
										plan: aiResult.plan,
									})
								).toString('base64'),
							},
						},
					],
					extension: [
						{ url: 'http://medplum.com/fhir/StructureDefinition/healthscribe-job-name', valueString: effectiveJobName },
						{ url: 'http://medplum.com/fhir/StructureDefinition/soap-subjective', valueString: aiResult.subjective || '' },
						{ url: 'http://medplum.com/fhir/StructureDefinition/soap-objective', valueString: aiResult.objective || '' },
						{ url: 'http://medplum.com/fhir/StructureDefinition/soap-assessment', valueString: aiResult.assessment || '' },
						{ url: 'http://medplum.com/fhir/StructureDefinition/soap-plan', valueString: aiResult.plan || '' },
					],
				});
				soapNotesId = soapDoc.id as string;
			}

			return {
				transcriptId: transcriptDoc.id as string,
				scribeNotesId,
				soapNotesId,
			};
		});

		res.status(200).json({
			ok: true,
			transcript_id: result.transcriptId,
			scribe_notes_id: result.scribeNotesId,
			soap_notes_id: result.soapNotesId,
			job_name: effectiveJobName,
			scribe_notes: aiResult
				? {
						subjective: aiResult.subjective,
						objective: aiResult.objective,
						assessment: aiResult.assessment,
						plan: aiResult.plan,
						summary: aiResult.summary,
						model: aiResult.model,
					}
				: null,
		});
		return;
	} catch (err: any) {
		res.status(500).json({ ok: false, error: err?.message ?? 'Server error' });
		return;
	}
});

// Get transcript for a specific job
healthscribeRouter.get('/transcript/:jobName', async (req, res): Promise<void> => {
	try {
		const { jobName } = req.params;

		const result = await requestContextStore.run(AuthenticatedRequestContext.system(), async () => {
			const repo = getSystemRepo();
			const searchResult = await repo.search({
				resourceType: 'DocumentReference',
				filters: [
					{
						code: 'identifier',
						operator: 'eq',
						value: `http://medplum.com/fhir/healthscribe-job|${jobName}`,
					},
					{
						code: 'category',
						operator: 'eq',
						value: 'transcript',
					},
				],
			});

			if (!searchResult.entry?.[0]) {
				return null;
			}

			const doc = searchResult.entry[0].resource as DocumentReference;
			const transcriptData = doc.content?.[0]?.attachment?.data;
			if (!transcriptData) {
				return null;
			}

			const transcript = Buffer.from(transcriptData, 'base64').toString('utf-8');
			return { transcript };
		});

		if (!result) {
			res.status(404).json({ ok: false, error: 'Transcript not found' });
			return;
		}

		res.status(200).json({ ok: true, ...result });
		return;
	} catch (err: any) {
		res.status(500).json({ ok: false, error: err?.message ?? 'Server error' });
		return;
	}
});

// Get audio file for a specific job
healthscribeRouter.get('/audio/:jobName', async (req, res): Promise<void> => {
	try {
		const { jobName } = req.params;

		console.log('Fetching audio for jobName:', jobName);

		const result = await requestContextStore.run(AuthenticatedRequestContext.system(), async () => {
			const repo = getSystemRepo();
			
			// Search for Media resource with the job name identifier
			const searchResult = await repo.search({
				resourceType: 'Media',
				filters: [
					{
						code: 'identifier',
						operator: 'eq',
						value: `http://medplum.com/fhir/healthscribe-job|${jobName}`,
					},
				],
			});

			console.log('Media search result:', {
				found: !!searchResult.entry?.[0],
				entryCount: searchResult.entry?.length || 0,
			});

			if (!searchResult.entry?.[0]) {
				console.error('No Media resource found for jobName:', jobName);
				return null;
			}

			const media = searchResult.entry[0].resource as Media;
			console.log('Found Media resource:', {
				id: media.id,
				contentUrl: media.content?.url,
				contentType: media.content?.contentType,
			});

			const binaryUrl = media.content?.url;
			if (!binaryUrl) {
				console.error('Media resource has no content URL:', media.id);
				return null;
			}

			// Extract Binary ID from URL (format: Binary/xxxxx)
			const binaryId = binaryUrl.replace('Binary/', '');
			console.log('Extracted Binary ID:', binaryId);

			// Get duration from extension if available
			let duration: number | undefined;
			const durationExt = media.extension?.find(
				(ext) => ext.url === 'http://medplum.com/fhir/StructureDefinition/audio-duration-seconds'
			);
			if (durationExt?.valueDecimal !== undefined) {
				duration = durationExt.valueDecimal;
			}

			// Read the binary data
			try {
				const binary = await repo.readResource<Binary>('Binary', binaryId);
				console.log('Successfully read Binary resource:', {
					id: binary.id,
					hasData: !!binary.data,
					contentType: binary.contentType,
				});
				return { binary, duration, contentType: media.content?.contentType || 'audio/webm' };
			} catch (err) {
				console.error('Failed to read Binary resource:', binaryId, err);
				throw err;
			}
		});

		if (!result) {
			console.error('Audio retrieval failed for jobName:', jobName);
			res.status(404).json({ ok: false, error: 'Audio not found' });
			return;
		}

		// If client wants JSON metadata (e.g. for duration), return that
		if (req.query.metadata === 'true' || req.get('Accept')?.includes('application/json')) {
			res.status(200).json({
				ok: true,
				duration: result.duration,
				contentType: result.contentType,
			});
			return;
		}

		// Otherwise stream the audio binary data directly
		res.set('Content-Type', result.contentType);
		if (result.duration) {
			res.set('X-Audio-Duration', result.duration.toString());
		}

		// Stream audio data from binary storage system
		const stream = await getBinaryStorage().readBinary(result.binary);
		stream.pipe(res);
		return;
	} catch (err: any) {
		res.status(500).json({ ok: false, error: err?.message ?? 'Server error' });
		return;
	}
});

// Get list of scribe notes for a patient
healthscribeRouter.get('/scribe-notes/:patientId', async (req, res): Promise<void> => {
	try {
		const { patientId } = req.params;

		const result = await requestContextStore.run(AuthenticatedRequestContext.system(), async () => {
			const repo = getSystemRepo();
			const searchResult = await repo.search({
				resourceType: 'DocumentReference',
				filters: [
					{
						code: 'subject',
						operator: 'eq',
						value: `Patient/${patientId}`,
					},
					{
						code: 'category',
						operator: 'eq',
						value: 'scribe-notes',
					},
				],
				sortRules: [{ code: 'date', descending: true }],
			});

			if (!searchResult.entry || searchResult.entry.length === 0) {
				return [];
			}

			const notes = searchResult.entry.map((entry) => {
				const doc = entry.resource as DocumentReference;
				const jobNameExt = doc.extension?.find(
					(ext) => ext.url === 'http://medplum.com/fhir/StructureDefinition/healthscribe-job-name'
				);
				const modelExt = doc.extension?.find(
					(ext) => ext.url === 'http://medplum.com/fhir/StructureDefinition/ai-model'
				);

				// Get the summary from the content attachment (which is already properly formatted)
				const contentData = doc.content?.[0]?.attachment?.data;
				let summary = 'No summary available';
				if (contentData) {
					try {
						summary = Buffer.from(contentData, 'base64').toString('utf-8');
					} catch (e) {
						console.error('Failed to decode content:', e);
					}
				}

				return {
					id: doc.id,
					patient_id: patientId,
					job_name: jobNameExt?.valueString || '',
					model: modelExt?.valueString || 'llama3',
					summary: summary,
					created_at: doc.date,
					visit_date: doc.date,
					date: doc.date,
				};
			});

			return notes;
		});

		res.status(200).json({ ok: true, notes: result });
		return;
	} catch (err: any) {
		res.status(500).json({ ok: false, error: err?.message ?? 'Server error' });
		return;
	}
});

healthscribeRouter.post('/audit', (_req, res) =>
	res.status(200).json({ ok: true })
);
