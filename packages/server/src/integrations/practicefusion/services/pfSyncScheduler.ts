// SPDX-License-Identifier: Apache-2.0

import { syncFromPracticeFusion } from './pfSyncWorker.js';

// Configuration from environment variables
const PF_SYNC_ENABLED = process.env.PF_SYNC_ENABLED || 'false';
const PF_SYNC_INTERVAL_MS = parseInt(process.env.PF_SYNC_INTERVAL_MS || '86400000', 10); // 24 hours default
const PF_SYNC_RUN_ON_STARTUP = process.env.PF_SYNC_RUN_ON_STARTUP || 'false';

// State
let schedulerInterval: NodeJS.Timeout | null = null;
let isShuttingDown = false;
let lastRunTime: Date | null = null;
let lastRunSuccess = true;
let isRunning = false;

/**
 * Initialize the Practice Fusion sync scheduler
 * Runs on startup (optionally) and then every PF_SYNC_INTERVAL_MS milliseconds
 */
export function initializePfSyncScheduler(): void {
  if (PF_SYNC_ENABLED !== 'true') {
    console.log('[PFSyncScheduler] Scheduler disabled via PF_SYNC_ENABLED=false');
    return;
  }

  // Validate required configuration
  if (!process.env.PF_FHIR_BASE_URL) {
    console.error('[PFSyncScheduler] PF_FHIR_BASE_URL is required but not set');
    return;
  }
  if (!process.env.PF_CLIENT_ID) {
    console.error('[PFSyncScheduler] PF_CLIENT_ID is required but not set');
    return;
  }
  // Either client_secret OR private_key must be provided
  if (!process.env.PF_CLIENT_SECRET && !process.env.PF_PRIVATE_KEY) {
    console.error('[PFSyncScheduler] Either PF_CLIENT_SECRET or PF_PRIVATE_KEY must be set');
    return;
  }

  const intervalHours = PF_SYNC_INTERVAL_MS / 1000 / 60 / 60;
  console.log(`[PFSyncScheduler] Starting Practice Fusion sync service with ${intervalHours} hour interval`);

  // Optionally run immediately on startup
  if (PF_SYNC_RUN_ON_STARTUP === 'true') {
    console.log('[PFSyncScheduler] Running initial sync on startup...');
    runScheduledSync();
  } else {
    console.log('[PFSyncScheduler] Skipping startup sync, waiting for scheduled interval');
  }

  // Then run on interval
  schedulerInterval = setInterval(() => {
    runScheduledSync();
  }, PF_SYNC_INTERVAL_MS);
}

/**
 * Run the sync task with error handling and state management
 */
async function runScheduledSync(): Promise<void> {
  if (isShuttingDown) {
    console.log('[PFSyncScheduler] Skipping sync, shutdown in progress');
    return;
  }

  if (isRunning) {
    console.log('[PFSyncScheduler] Skipping sync, previous sync still in progress');
    return;
  }

  isRunning = true;
  console.log(`[PFSyncScheduler] Starting scheduled sync at ${new Date().toISOString()}`);

  try {
    await syncFromPracticeFusion();
    lastRunTime = new Date();
    lastRunSuccess = true;
    console.log(`[PFSyncScheduler] Sync completed successfully at ${lastRunTime.toISOString()}`);
  } catch (error) {
    console.error('[PFSyncScheduler] Error during sync:', error);
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
  console.log('[PFSyncScheduler] Shutting down gracefully...');
  isShuttingDown = true;

  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }

  console.log('[PFSyncScheduler] Shutdown complete');
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
    enabled: PF_SYNC_ENABLED === 'true',
    healthy: lastRunSuccess,
    lastRun: lastRunTime,
    lastRunSuccess,
    isRunning,
    intervalMs: PF_SYNC_INTERVAL_MS,
  };
}

/**
 * Manually trigger a sync (for testing or admin purposes)
 */
export async function triggerManualSync(): Promise<{ success: boolean; error?: string }> {
  if (PF_SYNC_ENABLED !== 'true') {
    return { success: false, error: 'Practice Fusion sync is not enabled' };
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
