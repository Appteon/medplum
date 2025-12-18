// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Router } from 'express';

// Placeholder routers. Replace with real route handlers when migrating code
import { healthscribeRouter } from './routes/healthscribeRoutes.js';
import { preChartNotesRouter } from './routes/preChartNotesRoutes.js';
import { smartSynthesisRouter } from './routes/smartSynthesisRoutes.js';
import { soapRouter } from './routes/soapRoutes.js';

export const medAiMedplumRouter = Router();

// Mount subroutes
medAiMedplumRouter.use('/healthscribe', healthscribeRouter);
medAiMedplumRouter.use('/pre-chart-notes', preChartNotesRouter);
medAiMedplumRouter.use('/smart-synthesis', smartSynthesisRouter);
medAiMedplumRouter.use('/soap', soapRouter);
