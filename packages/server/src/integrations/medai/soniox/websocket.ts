// SPDX-License-Identifier: Apache-2.0
import type { IncomingMessage } from 'node:http';
import type { WebSocket } from 'ws';
import { WebSocket as WsClient } from 'ws';

const SONIOX_API_KEY = process.env.SONIOX_API_KEY || '';
const SONIOX_WEBSOCKET_URL = 'wss://stt-rt.soniox.com/transcribe-websocket';

interface TranscriptSegment {
  start: number;
  end: number;
  speaker: string;
  text: string;
}

interface SonioxToken {
  text: string;
  is_final: boolean;
  speaker?: string;
  start_ms?: number;
  end_ms?: number;
}

function getSonioxConfig() {
  return {
    api_key: SONIOX_API_KEY,
    model: 'stt-rt-v3',
    audio_format: 'auto',
    enable_speaker_diarization: true,
    enable_endpoint_detection: false,
    enable_language_identification: false,
    language_hints: ['en'],
    context: {
      general: [
        { key: 'domain', value: 'Healthcare' },
        { key: 'topic', value: 'Medical consultation' },
      ],
      text:
        'Medical consultation between healthcare provider and patient discussing symptoms, diagnosis, treatment, medications, and follow-up care.',
    },
  };
}

function groupTokensBySpeaker(tokens: SonioxToken[]): TranscriptSegment[] {
  if (!tokens || tokens.length === 0) return [];
  const segments: TranscriptSegment[] = [];
  let currentSpeaker = '';
  let currentText = '';
  let currentStart = 0;
  let currentEnd = 0;

  for (const token of tokens) {
    if (!token.text) continue;
    const tokenSpeaker = token.speaker || 'SPEAKER_0';
    const tokenText = token.text;
    const tokenStart = (token.start_ms || 0) / 1000;
    const tokenEnd = (token.end_ms || 0) / 1000;

    if (!currentSpeaker) {
      currentSpeaker = tokenSpeaker;
      currentText = tokenText;
      currentStart = tokenStart;
      currentEnd = tokenEnd;
    } else if (tokenSpeaker === currentSpeaker) {
      currentText += tokenText;
      currentEnd = tokenEnd;
    } else {
      if (currentText.trim()) {
        segments.push({ start: currentStart, end: currentEnd, speaker: currentSpeaker, text: currentText.trim() });
      }
      currentSpeaker = tokenSpeaker;
      currentText = tokenText;
      currentStart = tokenStart;
      currentEnd = tokenEnd;
    }
  }

  if (currentText.trim()) {
    segments.push({ start: currentStart, end: currentEnd, speaker: currentSpeaker, text: currentText.trim() });
  }
  return segments;
}

export async function handleSonioxTranscriptionConnection(socket: WebSocket, req: IncomingMessage): Promise<void> {
  if (!SONIOX_API_KEY) {
    socket.send(
      JSON.stringify({ status: 'error', error: 'SONIOX_API_KEY is not configured on the server' })
    );
    socket.close();
    return;
  }

  let sonioxWs: WsClient | null = null;
  let isProcessing = false;
  const finalTokens: SonioxToken[] = [];
  let finishTimeout: NodeJS.Timeout | null = null;
  let finishedReceived = false;

  try {
    socket.send(JSON.stringify({ status: 'connected', message: 'Ready to receive audio' }));

    sonioxWs = new WsClient(SONIOX_WEBSOCKET_URL);

    sonioxWs.on('open', () => {
      const config = getSonioxConfig();
      sonioxWs!.send(JSON.stringify(config));
      socket.send(JSON.stringify({ status: 'ready', message: 'Transcription service ready' }));
    });

    sonioxWs.on('message', (msg: Buffer) => {
      try {
        const response = JSON.parse(msg.toString());

        if (response.error_code) {
          socket.send(JSON.stringify({ status: 'error', error: `Transcription error: ${response.error_message}` }));
          if (finishTimeout) clearTimeout(finishTimeout);
          return;
        }

        let nonFinalTokens: SonioxToken[] = [];
        if (response.tokens && response.tokens.length > 0) {
          for (const token of response.tokens as SonioxToken[]) {
            if (token.text) {
              if (token.is_final) {
                finalTokens.push(token);
              } else {
                nonFinalTokens.push(token);
              }
            }
          }

          if (nonFinalTokens.length > 0) {
            const segments = groupTokensBySpeaker([...finalTokens, ...nonFinalTokens]);
            const latest = segments[segments.length - 1];
            if (latest) {
              socket.send(
                JSON.stringify({
                  status: 'partial',
                  text: latest.text,
                  speaker: latest.speaker,
                  start: latest.start,
                  end: latest.end,
                })
              );
            }
          }
        }

        if (response.finished) {
          finishedReceived = true;
          if (finishTimeout) clearTimeout(finishTimeout);
          const allSegments = groupTokensBySpeaker(finalTokens);
          socket.send(JSON.stringify({ status: 'complete', segments: allSegments }));
        }
      } catch (err) {
        socket.send(JSON.stringify({ status: 'error', error: 'Failed to process transcription message' }));
      }
    });

    sonioxWs.on('error', () => {
      socket.send(JSON.stringify({ status: 'error', error: 'Connection to transcription service failed' }));
    });

    sonioxWs.on('close', () => {
      // no-op
    });

    socket.on('message', async (message: any) => {
      try {
        if (Buffer.isBuffer(message)) {
          if (sonioxWs && sonioxWs.readyState === WsClient.OPEN && !isProcessing) {
            sonioxWs.send(message);
          }
        } else if (typeof message === 'string') {
          const data = JSON.parse(message);
          if (data.action === 'complete') {
            isProcessing = true;
            if (sonioxWs && sonioxWs.readyState === WsClient.OPEN) {
              sonioxWs.send('');
            }
            finishTimeout = setTimeout(() => {
              if (!finishedReceived) {
                socket.send(
                  JSON.stringify({ status: 'error', error: 'Transcription error: Request timeout from Soniox.' })
                );
                try {
                  if (sonioxWs) sonioxWs.close();
                } catch {}
                try {
                  socket.close();
                } catch {}
              }
            }, 15000);
          }
        }
      } catch (err) {
        socket.send(
          JSON.stringify({ status: 'error', error: `Message handling error: ${(err as Error)?.message ?? 'Unknown'}` })
        );
      }
    });

    socket.on('close', () => {
      try {
        if (sonioxWs && sonioxWs.readyState === WsClient.OPEN) {
          sonioxWs.close();
        }
      } catch {}
    });

    socket.on('error', () => {
      // no-op; outer error handling registered by server
    });
  } catch (error) {
    socket.send(
      JSON.stringify({ status: 'error', error: `Connection error: ${(error as Error)?.message ?? 'Unknown error'}` })
    );
    socket.close();
  }
}
