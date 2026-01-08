// SPDX-License-Identifier: Apache-2.0
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { spawn } from 'node:child_process';
import { AuthenticatedRequestContext } from '../../../../context.js';
import { requestContextStore } from '../../../../request-context-store.js';
import type { DiagnosticReport, DocumentReference, Media } from '@medplum/fhirtypes';
import type { Binary } from '@medplum/fhirtypes';
import { getSystemRepo } from '../../../../fhir/repo.js';
import { generateAIScribeNotes } from '../../ai/index.js';
import { getBinaryStorage } from '../../../../storage/loader.js';
import { getRepoForPatient } from '../services/preChartWorker.js';

// Convert webm audio to wav format using ffmpeg
// Includes timeout handling for large files
async function convertWebmToWav(inputBuffer: Buffer, timeoutMs: number = 300000): Promise<Buffer> {
	const inputSizeMB = (inputBuffer.length / (1024 * 1024)).toFixed(2);
	console.log(`Starting ffmpeg conversion for ${inputSizeMB} MB audio file...`);
	const startTime = Date.now();

	return new Promise((resolve, reject) => {
		let resolved = false;
		let timeoutId: NodeJS.Timeout | null = null;

		const ffmpeg = spawn('ffmpeg', [
			'-i', 'pipe:0',           // Read from stdin
			'-f', 'wav',              // Output format
			'-acodec', 'pcm_s16le',   // PCM 16-bit little-endian
			'-ar', '16000',           // 16kHz sample rate (good for speech)
			'-ac', '1',               // Mono
			'pipe:1'                  // Write to stdout
		]);

		const outputChunks: Buffer[] = [];
		let errorOutput = '';

		const cleanup = () => {
			if (timeoutId) {
				clearTimeout(timeoutId);
				timeoutId = null;
			}
			try {
				ffmpeg.kill('SIGKILL');
			} catch {}
		};

		// Set timeout for conversion (default 5 minutes)
		timeoutId = setTimeout(() => {
			if (!resolved) {
				resolved = true;
				cleanup();
				reject(new Error(`ffmpeg conversion timeout after ${timeoutMs / 1000} seconds for ${inputSizeMB} MB file`));
			}
		}, timeoutMs);

		ffmpeg.stdout.on('data', (chunk) => {
			outputChunks.push(chunk);
		});

		ffmpeg.stderr.on('data', (chunk) => {
			errorOutput += chunk.toString();
		});

		ffmpeg.on('close', (code) => {
			if (resolved) return;
			resolved = true;
			cleanup();

			const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
			if (code === 0) {
				const outputSizeMB = (Buffer.concat(outputChunks).length / (1024 * 1024)).toFixed(2);
				console.log(`ffmpeg conversion complete: ${inputSizeMB} MB -> ${outputSizeMB} MB in ${elapsedSec}s`);
				resolve(Buffer.concat(outputChunks));
			} else {
				console.error(`ffmpeg failed after ${elapsedSec}s: ${errorOutput.slice(-500)}`);
				reject(new Error(`ffmpeg exited with code ${code}: ${errorOutput.slice(-500)}`));
			}
		});

		ffmpeg.on('error', (err) => {
			if (resolved) return;
			resolved = true;
			cleanup();
			reject(new Error(`ffmpeg spawn error: ${err.message}`));
		});

		// Handle stdin errors (e.g., if ffmpeg closes stdin early)
		ffmpeg.stdin.on('error', (err) => {
			console.warn('ffmpeg stdin error (may be normal):', err.message);
		});

		// Write input buffer to ffmpeg stdin
		ffmpeg.stdin.write(inputBuffer);
		ffmpeg.stdin.end();
	});
}

export const healthscribeRouter = Router();

function formatBriefSummaryFromText(text: string, maxChars: number): string {
	const normalized = (text ?? '').toString().trim();
	if (!normalized) {
		return '';
	}
	const sentences = normalized
		.replace(/\s+/g, ' ')
		.split(/(?<=[.!?])\s+/)
		.filter((s) => s.trim().length > 0);
	const candidate = sentences.slice(0, 3).join(' ').trim();
	if (candidate.length > 0) {
		return candidate.length > maxChars ? candidate.slice(0, maxChars - 1).trimEnd() + '…' : candidate;
	}
	return normalized.length > maxChars ? normalized.slice(0, maxChars - 1).trimEnd() + '…' : normalized;
}

function formatBriefSummaryFromScribeNotes(scribeText: string): string {
	const lines = (scribeText ?? '')
		.toString()
		.split(/\r?\n/)
		.map((l) => l.trim());

	let chiefComplaint = '';
	let inChiefComplaint = false;
	let inKeyPoints = false;
	const keyPoints: string[] = [];

	for (const line of lines) {
		if (!line) {
			continue;
		}
		if (line.toUpperCase() === 'CHIEF COMPLAINT') {
			inChiefComplaint = true;
			inKeyPoints = false;
			continue;
		}
		if (line.toUpperCase() === 'KEY POINTS') {
			inKeyPoints = true;
			inChiefComplaint = false;
			continue;
		}
		if (line.toUpperCase() === 'ASSESSMENT & PLAN') {
			inKeyPoints = false;
			inChiefComplaint = false;
			continue;
		}

		if (inChiefComplaint && !chiefComplaint) {
			chiefComplaint = line;
			continue;
		}
		if (inKeyPoints && keyPoints.length < 2 && line.startsWith('-')) {
			keyPoints.push(line.replace(/^[-\s]+/, '').trim());
		}
	}

	const parts = [chiefComplaint, ...keyPoints].filter(Boolean);
	if (parts.length > 0) {
		return formatBriefSummaryFromText(parts.join(' '), 420);
	}
	return formatBriefSummaryFromText(scribeText, 420);
}

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

			// Get audio data from body (populated by raw() body parser for audio/* types)
			// The raw() body parser with limit: '500mb' handles large audio files
			let audioBuffer: Buffer;
			if (Buffer.isBuffer(req.body) && req.body.length > 0) {
				audioBuffer = req.body;
			} else {
				// Fallback: read from stream if body parser didn't handle it
				const chunks: Buffer[] = [];
				for await (const chunk of req) {
					chunks.push(chunk);
				}
				audioBuffer = Buffer.concat(chunks);
			}

			const sizeMB = (audioBuffer.length / (1024 * 1024)).toFixed(2);
			console.log(`Audio data received: ${sizeMB} MB (${audioBuffer.length} bytes)`);

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

// Delete entire visit for a specific job (audio, transcript, scribe notes, synthesis notes)
healthscribeRouter.delete('/visit/:jobName', async (req, res): Promise<void> => {
	try {
		const { jobName } = req.params;

		console.log('Deleting entire visit for jobName:', jobName);

		await requestContextStore.run(AuthenticatedRequestContext.system(), async () => {
			const repo = getSystemRepo();

			// 1. Search for and delete Media resource (audio)
			const mediaSearch = await repo.search({
				resourceType: 'Media',
				filters: [
					{
						code: 'identifier',
						operator: 'eq',
						value: `http://medplum.com/fhir/healthscribe-job|${jobName}`,
					},
				],
			});

			if (mediaSearch.entry?.[0]) {
				const media = mediaSearch.entry[0].resource as Media;
				const binaryUrl = media.content?.url;
				const binaryId = binaryUrl ? binaryUrl.replace('Binary/', '') : null;

				// Delete the Binary resource if it exists
				if (binaryId) {
					try {
						await repo.deleteResource('Binary', binaryId);
						console.log('Deleted Binary resource:', binaryId);
					} catch (err: any) {
						console.warn('Failed to delete Binary resource:', binaryId, err?.message);
					}
				}

				// Delete the Media resource
				await repo.deleteResource('Media', media.id as string);
				console.log('Deleted Media resource:', media.id);
			}

			// 2. Search for and delete transcript DocumentReference
			const transcriptSearch = await repo.search({
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

			for (const entry of transcriptSearch.entry || []) {
				const doc = entry.resource as DocumentReference;
				await repo.deleteResource('DocumentReference', doc.id as string);
				console.log('Deleted transcript DocumentReference:', doc.id);
			}

			// 3. Search for and delete scribe notes DocumentReference
			const scribeSearch = await repo.search({
				resourceType: 'DocumentReference',
				filters: [
					{
						code: 'identifier',
						operator: 'eq',
						value: `http://medplum.com/fhir/healthscribe-job|${jobName}-scribe`,
					},
				],
			});

			for (const entry of scribeSearch.entry || []) {
				const doc = entry.resource as DocumentReference;
				await repo.deleteResource('DocumentReference', doc.id as string);
				console.log('Deleted scribe notes DocumentReference:', doc.id);
			}

			// 4. Search for and delete SOAP notes DocumentReference
			const soapSearch = await repo.search({
				resourceType: 'DocumentReference',
				filters: [
					{
						code: 'identifier',
						operator: 'eq',
						value: `http://medplum.com/fhir/healthscribe-job|${jobName}-soap`,
					},
				],
			});

			for (const entry of soapSearch.entry || []) {
				const doc = entry.resource as DocumentReference;
				await repo.deleteResource('DocumentReference', doc.id as string);
				console.log('Deleted SOAP notes DocumentReference:', doc.id);
			}

			// 5. Search for and delete DiagnosticReport (job record)
			const diagnosticSearch = await repo.search({
				resourceType: 'DiagnosticReport',
				filters: [
					{
						code: 'identifier',
						operator: 'contains',
						value: jobName,
					},
				],
			});

			for (const entry of diagnosticSearch.entry || []) {
				const dr = entry.resource as DiagnosticReport | undefined;
				if (!dr) continue;

				const jobExt = dr.extension?.find(
					(ext: any) => ext.url === 'http://medplum.com/fhir/StructureDefinition/healthscribe-job-name'
				);
				if (jobExt?.valueString === jobName) {
					await repo.deleteResource('DiagnosticReport', dr.id as string);
					console.log('Deleted DiagnosticReport:', dr.id);
				}
			}

			console.log('Successfully deleted entire visit for jobName:', jobName);
		});

		res.status(200).json({ ok: true, message: 'Visit deleted successfully' });
		return;
	} catch (err: any) {
		console.error('Error deleting visit:', err);
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

// Get the latest transcript summary for a patient (transcript-only; no other EMR context)
healthscribeRouter.get('/last-transcript-summary/:patientId', async (req, res): Promise<void> => {
	try {
		const { patientId } = req.params as { patientId: string };
		const lastTranscriptSummary = await requestContextStore.run(AuthenticatedRequestContext.system(), async () => {
			const repo = getSystemRepo();
			const transcriptSearch = await repo.search({
				resourceType: 'DocumentReference',
				count: 1,
				filters: [
					{ code: 'subject', operator: 'eq', value: `Patient/${patientId}` },
					{ code: 'category', operator: 'eq', value: 'transcript' },
				],
				sortRules: [{ code: 'date', descending: true }],
			});

			const transcriptEntry = transcriptSearch.entry?.[0];
			if (!transcriptEntry) {
				return null;
			}

			const transcriptDoc = transcriptEntry.resource as DocumentReference;
			const transcriptDate = transcriptDoc.date ?? undefined;
			const transcriptData = transcriptDoc.content?.[0]?.attachment?.data;
			const transcriptText = transcriptData ? Buffer.from(transcriptData, 'base64').toString('utf-8') : '';

			// Attempt to find matching scribe-notes generated from this transcript.
			const jobName =
				transcriptDoc.identifier?.find((i) => i.system === 'http://medplum.com/fhir/healthscribe-job')?.value ??
				(transcriptDoc.extension as any)?.find(
					(e: any) => e.url === 'http://medplum.com/fhir/StructureDefinition/healthscribe-job-name'
				)?.valueString ??
				'';

			let scribeText = '';
			if (jobName) {
				const scribeSearch = await repo.search({
					resourceType: 'DocumentReference',
					count: 1,
					filters: [
						{
							code: 'identifier',
							operator: 'eq',
							value: `http://medplum.com/fhir/healthscribe-job|${jobName}-scribe`,
						},
					],
				});
				const scribeEntry = scribeSearch.entry?.[0];
				if (scribeEntry) {
					const scribeDoc = scribeEntry.resource as DocumentReference;
					const scribeData = scribeDoc.content?.[0]?.attachment?.data;
					if (scribeData) {
						try {
							scribeText = Buffer.from(scribeData, 'base64').toString('utf-8');
						} catch {
							// ignore decode errors
						}
					}
				}
			}

			const summary = scribeText
				? formatBriefSummaryFromScribeNotes(scribeText)
				: formatBriefSummaryFromText(transcriptText, 420);

			return {
				date: transcriptDate,
				summary,
				provider: undefined,
			};
		});

		res.status(200).json({ ok: true, lastTranscriptSummary });
		return;
	} catch (err: any) {
		res.status(500).json({ ok: false, error: err?.message ?? 'Server error' });
		return;
	}
});

// Async transcription: transcribes audio from Binary storage using Soniox async API
healthscribeRouter.post('/async-transcribe/:jobName', async (req, res): Promise<void> => {
	try {
		const { jobName } = req.params;

		if (!jobName) {
			res.status(400).json({ ok: false, error: 'jobName is required' });
			return;
		}

		console.log('Starting async transcription for jobName:', jobName);

		const result = await requestContextStore.run(AuthenticatedRequestContext.system(), async () => {
			const repo = getSystemRepo();
			const storage = getBinaryStorage();

			// Small delay to ensure Media resource is indexed and searchable
			await new Promise((r) => setTimeout(r, 500));

			// Find the Media resource to get the Binary reference
			let mediaSearch = await repo.search({
				resourceType: 'Media',
				filters: [
					{
						code: 'identifier',
						operator: 'eq',
						value: `http://medplum.com/fhir/healthscribe-job|${jobName}`,
					},
				],
			});

			// Retry once if not found (race condition)
			if (!mediaSearch.entry?.[0]) {
				console.log('Media not found on first try, retrying after 1s...');
				await new Promise((r) => setTimeout(r, 1000));
				mediaSearch = await repo.search({
					resourceType: 'Media',
					filters: [
						{
							code: 'identifier',
							operator: 'eq',
							value: `http://medplum.com/fhir/healthscribe-job|${jobName}`,
						},
					],
				});
			}

			if (!mediaSearch.entry?.[0]) {
				throw new Error('Media resource not found for jobName: ' + jobName);
			}

			const media = mediaSearch.entry[0].resource as Media;
			const binaryUrl = media.content?.url;
			if (!binaryUrl) {
				throw new Error('Media resource has no content URL');
			}

			const binaryId = binaryUrl.replace('Binary/', '');
			const binary = await repo.readResource<Binary>('Binary', binaryId);

			// Read the audio data from binary storage
			const audioStream = await storage.readBinary(binary);
			const chunks: Buffer[] = [];
			for await (const chunk of audioStream) {
				chunks.push(Buffer.from(chunk));
			}
			const audioBuffer = Buffer.concat(chunks);

			console.log('Read audio from storage, size:', audioBuffer.length, 'bytes');

			// Try to convert webm to wav format for Soniox async API compatibility
			// If ffmpeg is not available, attempt to send webm directly
			let processedBuffer: Buffer = audioBuffer;
			let processedFilename = `${jobName}.webm`;
			let processedContentType = 'audio/webm';

			try {
				console.log('Attempting audio conversion from webm to wav...');
				processedBuffer = await convertWebmToWav(audioBuffer);
				processedFilename = `${jobName}.wav`;
				processedContentType = 'audio/wav';
				console.log('Audio converted to wav, size:', processedBuffer.length, 'bytes');
			} catch (convErr: any) {
				console.warn('Audio conversion failed, will try sending webm directly:', convErr.message);
				// Fall back to original webm buffer
				processedBuffer = audioBuffer;
				processedFilename = `${jobName}.webm`;
				processedContentType = 'audio/webm';
			}

			// Call Soniox async API
			const SONIOX_API_KEY = process.env.SONIOX_API_KEY || '';
			const SONIOX_API_BASE_URL = 'https://api.soniox.com';

			if (!SONIOX_API_KEY) {
				throw new Error('SONIOX_API_KEY is not configured');
			}

			// Helper function for Soniox API calls with timeout
			const sonioxApiFetch = async (
				endpoint: string,
				options: { method?: string; body?: any; headers?: Record<string, string>; timeoutMs?: number } = {}
			) => {
				const { method = 'GET', body, headers = {}, timeoutMs = 600000 } = options; // 10 min default timeout
				const controller = new AbortController();
				const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

				try {
					const fetchRes = await fetch(`${SONIOX_API_BASE_URL}${endpoint}`, {
						method,
						headers: {
							Authorization: `Bearer ${SONIOX_API_KEY}`,
							...headers,
						},
						body,
						signal: controller.signal,
					} as any);

					if (!fetchRes.ok) {
						const errorText = await fetchRes.text();
						throw new Error(`Soniox API error ${fetchRes.status}: ${errorText}`);
					}
					return method !== 'DELETE' ? fetchRes.json() : null;
				} finally {
					clearTimeout(timeoutId);
				}
			};

			// Upload processed audio to Soniox
			const fileSizeMB = (processedBuffer.length / (1024 * 1024)).toFixed(2);
			console.log(`Uploading ${fileSizeMB} MB audio to Soniox...`);
			const uploadStartTime = Date.now();

			const form = new FormData();
			const blob = new Blob([new Uint8Array(processedBuffer)], { type: processedContentType });
			form.append('file', blob, processedFilename);
			// Use longer timeout for file uploads (10 minutes for large files)
			const uploadResult: any = await sonioxApiFetch('/v1/files', { method: 'POST', body: form as any, timeoutMs: 600000 });
			const fileId = uploadResult.id as string;

			const uploadDuration = ((Date.now() - uploadStartTime) / 1000).toFixed(1);
			console.log(`Uploaded audio to Soniox in ${uploadDuration}s, fileId: ${fileId}`);

			// Create transcription job
			const config = {
				model: 'stt-async-v3',
				language_hints: ['en'],
				enable_speaker_diarization: true,
				context: {
					general: [
						{ key: 'domain', value: 'Healthcare' },
						{ key: 'topic', value: 'Medical consultation' },
					],
					text: 'Medical consultation between healthcare provider and patient discussing symptoms, diagnosis, treatment, medications, and follow-up care.',
				},
				file_id: fileId,
			};
			const createResult: any = await sonioxApiFetch('/v1/transcriptions', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(config),
			});
			const transcriptionId = createResult.id as string;

			console.log('Created transcription job, transcriptionId:', transcriptionId);

			// Wait for transcription to complete
			// For 2-hour recordings, Soniox can take 30-60 minutes to process
			// Poll every 3 seconds for up to 90 minutes (1800 attempts * 3 seconds = 5400 seconds = 90 minutes)
			const maxAttempts = 1800;
			const pollIntervalMs = 3000;
			let attempts = 0;
			while (attempts < maxAttempts) {
				const statusResult: any = await sonioxApiFetch(`/v1/transcriptions/${transcriptionId}`);
				if (statusResult.status === 'completed') {
					const elapsedSeconds = Math.round((attempts * pollIntervalMs) / 1000);
					const elapsedMinutes = Math.round(elapsedSeconds / 60);
					console.log(`Transcription completed after ${attempts} attempts (~${elapsedMinutes} minutes)`);
					break;
				}
				if (statusResult.status === 'error') {
					// Cleanup on error
					try {
						await sonioxApiFetch(`/v1/transcriptions/${transcriptionId}`, { method: 'DELETE' });
						await sonioxApiFetch(`/v1/files/${fileId}`, { method: 'DELETE' });
					} catch {}
					throw new Error(`Transcription failed: ${statusResult.error_message || 'Unknown error'}`);
				}
				// Log progress every minute (20 attempts at 3-second intervals)
				if (attempts > 0 && attempts % 20 === 0) {
					const elapsedSeconds = Math.round((attempts * pollIntervalMs) / 1000);
					const elapsedMinutes = Math.round(elapsedSeconds / 60);
					console.log(`Transcription in progress... status: ${statusResult.status}, elapsed: ${elapsedMinutes} minutes`);
				}
				await new Promise((r) => setTimeout(r, pollIntervalMs));
				attempts++;
			}

			if (attempts >= maxAttempts) {
				// Cleanup on timeout
				try {
					await sonioxApiFetch(`/v1/transcriptions/${transcriptionId}`, { method: 'DELETE' });
					await sonioxApiFetch(`/v1/files/${fileId}`, { method: 'DELETE' });
				} catch {}
				const timeoutMinutes = Math.round((maxAttempts * pollIntervalMs) / 1000 / 60);
				throw new Error(`Transcription timeout after ${timeoutMinutes} minutes`);
			}

			// Get the transcript
			const transcriptResult: any = await sonioxApiFetch(`/v1/transcriptions/${transcriptionId}/transcript`);

			// Cleanup Soniox resources
			try {
				await sonioxApiFetch(`/v1/transcriptions/${transcriptionId}`, { method: 'DELETE' });
				await sonioxApiFetch(`/v1/files/${fileId}`, { method: 'DELETE' });
			} catch {}

			// Process tokens into segments
			const tokens = Array.isArray(transcriptResult?.tokens) ? transcriptResult.tokens : [];
			if (tokens.length === 0) {
				return { transcript: '', segments: [], tokenCount: 0 };
			}

			// Group tokens by speaker
			interface TranscriptSegment {
				start: number;
				end: number;
				speaker: string;
				text: string;
			}

			const segments: TranscriptSegment[] = [];
			let currentSpeaker: string | null = null;
			let currentText = '';
			let currentStart = 0;
			let currentEnd = 0;

			for (const token of tokens) {
				const { text, speaker, start_ms, duration_ms } = token;
				if (!text) continue;
				// Soniox uses 1-indexed speakers (1, 2, 3...), not 0-indexed
				const tokenSpeaker = speaker !== undefined ? String(speaker) : '0';
				const tokenStart = (start_ms || 0) / 1000;
				const tokenDuration = (duration_ms || 0) / 1000;
				const tokenEnd = tokenStart + tokenDuration;

				if (currentSpeaker === null) {
					currentSpeaker = tokenSpeaker;
					currentText = text;
					currentStart = tokenStart;
					currentEnd = tokenEnd;
				} else if (tokenSpeaker === currentSpeaker) {
					currentText += text;
					currentEnd = tokenEnd;
				} else {
					if (currentText.trim()) {
						segments.push({ start: currentStart, end: currentEnd, speaker: currentSpeaker, text: currentText.trim() });
					}
					currentSpeaker = tokenSpeaker;
					currentText = text;
					currentStart = tokenStart;
					currentEnd = tokenEnd;
				}
			}

			if (currentText.trim() && currentSpeaker !== null) {
				segments.push({ start: currentStart, end: currentEnd, speaker: currentSpeaker, text: currentText.trim() });
			}

			// Convert segments to text
			// Match the same speaker labeling as real-time WebSocket: speaker 1 = Doctor, speaker 2 = Patient
			const transcriptText = segments
				.map((seg) => {
					const speakerLabel = seg.speaker === '1' ? 'Doctor' : seg.speaker === '2' ? 'Patient' : `Speaker ${seg.speaker}`;
					return `[${speakerLabel}] ${seg.text}`;
				})
				.join('\n\n');

			console.log('Async transcription complete, segments:', segments.length, 'text length:', transcriptText.length);

			return { transcript: transcriptText, segments, tokenCount: tokens.length };
		});

		res.status(200).json({ ok: true, ...result });
		return;
	} catch (err: any) {
		console.error('Async transcription error:', err);
		res.status(500).json({ ok: false, error: err?.message ?? 'Server error' });
		return;
	}
});

healthscribeRouter.post('/audit', (_req, res) =>
	res.status(200).json({ ok: true })
);
