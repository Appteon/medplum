// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Router } from 'express';
import { asyncTranscriptionRouter } from './routes/asyncTranscription.js';
import { transcriptionWebSocketRouter } from './routes/transcriptionWebSocket.js';

export const medAiSonioxRouter = Router();

medAiSonioxRouter.use('/async-transcription', asyncTranscriptionRouter);
medAiSonioxRouter.use('/transcription-websocket', transcriptionWebSocketRouter);
