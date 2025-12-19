// SPDX-License-Identifier: Apache-2.0

import { syncFromPracticeFusion } from './pfSyncWorker.js';

// Configuration from environment variables
// Uses EHR_ prefix for generic naming, with PF_ fallback for backwards compatibility
const EHR_SYNC_ENABLED = process.env.EHR_SYNC_ENABLED || process.env.PF_SYNC_ENABLED || 'false';
const EHR_SYNC_INTERVAL_MS = parseInt(process.env.EHR_SYNC_INTERVAL_MS || process.env.PF_SYNC_INTERVAL_MS || '86400000', 10); // 24 hours default
const EHR_SYNC_RUN_ON_STARTUP = process.env.EHR_SYNC_RUN_ON_STARTUP || process.env.PF_SYNC_RUN_ON_STARTUP || 'false';

// State
let schedulerInterval: NodeJS.Timeout | null = null;
let isShuttingDown = false;
let lastRunTime: Date | null = null;
let lastRunSuccess = true;
let isRunning = false;

/**
 * Initialize the EHR sync scheduler
 * Runs on startup (optionally) and then every EHR_SYNC_INTERVAL_MS milliseconds
 *
 * Works with any EHR that supports FHIR Bulk Data Export:
 * - Epic
 * - Cerner
 * - Practice Fusion
 * - Others
 */
export function initializePfSyncScheduler(): void {
  if (EHR_SYNC_ENABLED !== 'true') {
    console.log('[EHRSyncScheduler] Scheduler disabled via EHR_SYNC_ENABLED=false');
    return;
  }

  // Validate required configuration (check both new and legacy env vars)
  const fhirBaseUrl = process.env.EHR_FHIR_BASE_URL || process.env.PF_FHIR_BASE_URL;
  const clientId = process.env.EHR_CLIENT_ID || process.env.PF_CLIENT_ID;
  const clientSecret = process.env.EHR_CLIENT_SECRET || process.env.PF_CLIENT_SECRET;
  const privateKey = process.env.EHR_PRIVATE_KEY || process.env.PF_PRIVATE_KEY;

  if (!fhirBaseUrl) {
    console.error('[EHRSyncScheduler] EHR_FHIR_BASE_URL is required but not set');
    return;
  }
  if (!clientId) {
    console.error('[EHRSyncScheduler] EHR_CLIENT_ID is required but not set');
    return;
  }
  // Either client_secret OR private_key must be provided
  if (!clientSecret && !privateKey) {
    console.error('[EHRSyncScheduler] Either EHR_CLIENT_SECRET or EHR_PRIVATE_KEY must be set');
    return;
  }

  const intervalHours = EHR_SYNC_INTERVAL_MS / 1000 / 60 / 60;
  console.log(`[EHRSyncScheduler] Starting EHR sync service with ${intervalHours} hour interval`);
  console.log(`[EHRSyncScheduler] FHIR Base URL: ${fhirBaseUrl}`);
  console.log(`[EHRSyncScheduler] Auth method: ${privateKey ? 'JWT (private_key)' : 'client_secret'}`);

  const groupId = process.env.EHR_GROUP_ID;
  if (groupId) {
    console.log(`[EHRSyncScheduler] Group ID: ${groupId} (using group-based export)`);
  } else {
    console.log('[EHRSyncScheduler] No group ID set (using system-level export)');
  }

  // Optionally run immediately on startup
  if (EHR_SYNC_RUN_ON_STARTUP === 'true') {
    console.log('[EHRSyncScheduler] Running initial sync on startup...');
    runScheduledSync();
  } else {
    console.log('[EHRSyncScheduler] Skipping startup sync, waiting for scheduled interval');
  }

  // Then run on interval
  schedulerInterval = setInterval(() => {
    runScheduledSync();
  }, EHR_SYNC_INTERVAL_MS);
}

/**
 * Run the sync task with error handling and state management
 */
async function runScheduledSync(): Promise<void> {
  if (isShuttingDown) {
    console.log('[EHRSyncScheduler] Skipping sync, shutdown in progress');
    return;
  }

  if (isRunning) {
    console.log('[EHRSyncScheduler] Skipping sync, previous sync still in progress');
    return;
  }

  isRunning = true;
  console.log(`[EHRSyncScheduler] Starting scheduled sync at ${new Date().toISOString()}`);

  try {
    await syncFromPracticeFusion();
    lastRunTime = new Date();
    lastRunSuccess = true;
    console.log(`[EHRSyncScheduler] Sync completed successfully at ${lastRunTime.toISOString()}`);
  } catch (error) {
    console.error('[EHRSyncScheduler] Error during sync:', error);
    lastRunSuccess = false;
    // Don't throw - let scheduler continue for next interval
  } finally {
    isRunning = false;
  }
}

/**
 * Shutdown the scheduler gracefully
 */
export function shutdownPfSyncScheduler(): void {
  console.log('[EHRSyncScheduler] Shutting down gracefully...');
  isShuttingDown = true;

  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }

  console.log('[EHRSyncScheduler] Shutdown complete');
}

/**
 * Get scheduler health status (for health check endpoint)
 */
export function getPfSyncHealth(): {
  enabled: boolean;
  healthy: boolean;
  lastRun: Date | null;
  lastRunSuccess: boolean;
  isRunning: boolean;
  intervalMs: number;
} {
  return {
    enabled: EHR_SYNC_ENABLED === 'true',
    healthy: lastRunSuccess,
    lastRun: lastRunTime,
    lastRunSuccess,
    isRunning,
    intervalMs: EHR_SYNC_INTERVAL_MS,
  };
}

/**
 * Manually trigger a sync (for testing or admin purposes)
 */
export async function triggerManualSync(): Promise<{ success: boolean; error?: string }> {
  if (EHR_SYNC_ENABLED !== 'true') {
    return { success: false, error: 'EHR sync is not enabled' };
  }

  if (isRunning) {
    return { success: false, error: 'Sync already in progress' };
  }

  try {
    await runScheduledSync();
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
