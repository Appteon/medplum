// SPDX-License-Identifier: Apache-2.0
import { Router } from 'express';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

// Environment
const SONIOX_API_KEY = process.env.SONIOX_API_KEY || '';
const SONIOX_API_BASE_URL = 'https://api.soniox.com';
const s3Client = new S3Client({ region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION });

export const asyncTranscriptionRouter = Router();

interface TranscriptSegment {
	start: number;
	end: number;
	speaker: string;
	text: string;
}

async function downloadFromS3(bucket: string, key: string): Promise<Buffer> {
	const command = new GetObjectCommand({ Bucket: bucket, Key: key });
	const response = await s3Client.send(command);
	if (!response.Body) {
		throw new Error('No body in S3 response');
	}
	const chunks: Uint8Array[] = [];
	const stream = response.Body as any;
	for await (const chunk of stream) {
		chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
	}
	return Buffer.concat(chunks);
}

async function sonioxApiFetch(
	endpoint: string,
	options: { method?: string; body?: any; headers?: Record<string, string> } = {}
) {
	const { method = 'GET', body, headers = {} } = options;
	const res = await fetch(`${SONIOX_API_BASE_URL}${endpoint}`, {
		method,
		headers: {
			Authorization: `Bearer ${SONIOX_API_KEY}`,
			...headers,
		},
		body,
	} as any);

	if (!res.ok) {
		const errorText = await res.text();
		throw new Error(`Soniox API error ${res.status}: ${errorText}`);
	}
	return method !== 'DELETE' ? res.json() : null;
}

async function uploadAudioToSoniox(audioBuffer: Buffer, filename: string): Promise<string> {
	const form = new FormData();
	const blob = new Blob([new Uint8Array(audioBuffer)]);
	form.append('file', blob, filename);
	const result: any = await sonioxApiFetch('/v1/files', { method: 'POST', body: form as any });
	return result.id as string;
}

async function createTranscription(fileId: string): Promise<string> {
	const config = {
		model: 'stt-async-v3',
		language_hints: ['en'],
		enable_speaker_diarization: true,
		context: {
			general: [
				{ key: 'domain', value: 'Healthcare' },
				{ key: 'topic', value: 'Medical consultation' },
			],
			text:
				'Medical consultation between healthcare provider and patient discussing symptoms, diagnosis, treatment, medications, and follow-up care.',
		},
		file_id: fileId,
	};
	const result: any = await sonioxApiFetch('/v1/transcriptions', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(config),
	});
	return result.id as string;
}

async function waitForTranscription(transcriptionId: string): Promise<void> {
	const maxAttempts = 120;
	let attempts = 0;
	while (attempts < maxAttempts) {
		const result: any = await sonioxApiFetch(`/v1/transcriptions/${transcriptionId}`);
		if (result.status === 'completed') {
			return;
		}
		if (result.status === 'error') {
			throw new Error(`Transcription failed: ${result.error_message || 'Unknown error'}`);
		}
		await new Promise((r) => setTimeout(r, 1000));
		attempts++;
	}
	throw new Error('Transcription timeout');
}

async function getTranscription(transcriptionId: string): Promise<any> {
	return await sonioxApiFetch(`/v1/transcriptions/${transcriptionId}/transcript`);
}

async function cleanupSoniox(transcriptionId?: string, fileId?: string): Promise<void> {
	try {
		if (transcriptionId) {
			await sonioxApiFetch(`/v1/transcriptions/${transcriptionId}`, { method: 'DELETE' });
		}
		if (fileId) {
			await sonioxApiFetch(`/v1/files/${fileId}`, { method: 'DELETE' });
		}
	} catch (e) {
		// Swallow cleanup errors
	}
}

async function transcribeWithSoniox(audioBuffer: Buffer, filename: string): Promise<any> {
	let fileId: string | undefined;
	let transcriptionId: string | undefined;
	try {
		fileId = await uploadAudioToSoniox(audioBuffer, filename);
		transcriptionId = await createTranscription(fileId);
		await waitForTranscription(transcriptionId);
		const result = await getTranscription(transcriptionId);
		await cleanupSoniox(transcriptionId, fileId);
		return result;
	} catch (err) {
		await cleanupSoniox(transcriptionId, fileId);
		throw err;
	}
}

function groupTokensBySpeaker(tokens: any[]): TranscriptSegment[] {
	if (!tokens || tokens.length === 0) return [];
	const segments: TranscriptSegment[] = [];
	let currentSpeaker: string | null = null;
	let currentText = '';
	let currentStart = 0;
	let currentEnd = 0;

	for (const token of tokens) {
		const { text, speaker, start_ms, duration_ms } = token;
		if (!text) continue;
		const tokenSpeaker = speaker !== undefined ? `SPEAKER_${speaker}` : 'SPEAKER_0';
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
	return segments;
}

function segmentsToText(segments: TranscriptSegment[]): string {
	return segments
		.map((seg) => {
			const speakerLabel = seg.speaker === 'SPEAKER_0' ? 'Doctor' : seg.speaker === 'SPEAKER_1' ? 'Patient' : seg.speaker;
			return `[${speakerLabel}] ${seg.text}`;
		})
		.join('\n\n');
}

// POST /api/medai/soniox/async-transcription/transcribe
asyncTranscriptionRouter.post('/transcribe', async (req, res) => {
	try {
		const { bucket, key } = req.body as { bucket?: string; key?: string };

		if (!SONIOX_API_KEY) {
			return res.status(500).json({ ok: false, error: 'SONIOX_API_KEY is not configured' });
		}
		if (!bucket || !key) {
			return res.status(400).json({ ok: false, error: 'bucket and key are required' });
		}

		const audioBuffer = await downloadFromS3(bucket, key);
		const filename = key.split('/').pop() || 'audio.webm';
		const result = await transcribeWithSoniox(audioBuffer, filename);
		const tokens = Array.isArray(result?.tokens) ? result.tokens : [];
		if (tokens.length === 0) {
			return res.status(200).json({ ok: true, transcript: '', segments: [], token_count: 0 });
		}
		const segments = groupTokensBySpeaker(tokens);
		const transcriptText = segmentsToText(segments);
		return res.status(200).json({ ok: true, transcript: transcriptText, segments, token_count: tokens.length });
	} catch (err: any) {
		return res.status(500).json({ ok: false, error: err?.message || 'Transcription failed' });
	}
});
