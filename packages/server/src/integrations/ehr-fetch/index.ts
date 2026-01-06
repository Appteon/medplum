// SPDX-License-Identifier: Apache-2.0

/**
 * Practice Fusion EHR Integration
 *
 * This module provides automatic synchronization of patient data from
 * Practice Fusion EHR into Medplum using the FHIR Bulk Data Export API.
 *
 * Configuration (environment variables):
 * - PF_SYNC_ENABLED: 'true' to enable the sync scheduler
 * - PF_SYNC_INTERVAL_MS: Sync interval in milliseconds (default: 86400000 = 24 hours)
 * - PF_SYNC_RUN_ON_STARTUP: 'true' to run sync immediately on server start
 * - PF_FHIR_BASE_URL: Practice Fusion FHIR server base URL
 * - PF_CLIENT_ID: OAuth2 client ID registered with Practice Fusion
 * - PF_PRIVATE_KEY: Private key (PEM format) for JWT signing
 * - PF_KEY_ID: Key ID (kid) for the signing key (optional)
 * - PF_RESOURCE_TYPES: Comma-separated list of resource types to sync (optional)
 *
 * Usage:
 * The scheduler is initialized in app.ts during server startup.
 * It will automatically sync data from Practice Fusion at the configured interval.
 *
 * @module integrations/practicefusion
 */

// Scheduler exports
export {
  initializePfSyncScheduler,
  shutdownPfSyncScheduler,
  getPfSyncHealth,
  triggerManualSync,
} from './services/pfSyncScheduler';

// Worker exports
export { syncFromPracticeFusion } from './services/pfSyncWorker';

// Single patient sync exports (for on-demand fetching)
export { syncSinglePatientFromEHR, isSinglePatientSyncEnabled } from './services/singlePatientSync';

// Auth exports
export { SmartBackendClient, discoverSmartEndpoints } from './auth/smartClient';
export type { SmartClientConfig, AccessTokenResponse } from './auth/smartClient';

// Bulk export exports
export { BulkExportClient, executeBulkExport } from './bulk/bulkExportClient';
export type { BulkExportConfig, BulkExportStatus, BulkExportOutput } from './bulk/bulkExportClient';

// Constants exports
export * from './constants';
