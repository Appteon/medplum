// SPDX-License-Identifier: Apache-2.0
import { processUpcomingAppointments } from './preChartWorker';

// Configuration
const SCHEDULER_INTERVAL_MS = parseInt(process.env.PRECHARTSCHEDULER_INTERVAL_MS || '1800000', 10); // 30 minutes default
const SCHEDULER_ENABLED = process.env.PRECHARTSCHEDULER_ENABLED || 'true'; // Enabled by default

// State
let schedulerInterval: NodeJS.Timeout | null = null;
let isShuttingDown = false;
let lastRunTime: Date | null = null;
let isHealthy = true;

/**
 * Initialize the pre-chart note scheduler
 * Runs immediately on startup, then every SCHEDULER_INTERVAL_MS milliseconds
 */
export function initializePreChartScheduler(): void {
  if (SCHEDULER_ENABLED !== 'true') {
    console.log('[PreChartScheduler] Scheduler disabled via PRECHARTSCHEDULER_ENABLED=false');
    return;
  }

  console.log(`[PreChartScheduler] Starting background service with ${SCHEDULER_INTERVAL_MS / 1000 / 60} minute interval`);

  // Run immediately on startup
  runScheduledTask();

  // Then run on interval
  schedulerInterval = setInterval(() => {
    runScheduledTask();
  }, SCHEDULER_INTERVAL_MS);
}

/**
 * Run the scheduled task (wrapped with error handling)
 */
async function runScheduledTask(): Promise<void> {
  if (isShuttingDown) {
    console.log('[PreChartScheduler] Skipping run, shutdown in progress');
    return;
  }

  console.log(`[PreChartScheduler] Running scheduled check at ${new Date().toISOString()}`);

  try {
    await processUpcomingAppointments();
    lastRunTime = new Date();
    isHealthy = true;
  } catch (error) {
    console.error('[PreChartScheduler] Error in scheduled task:', error);
    isHealthy = false;
    // Don't throw - let scheduler continue
  }
}

/**
 * Shutdown the scheduler gracefully
 */
export function shutdownPreChartScheduler(): void {
  console.log('[PreChartScheduler] Shutting down gracefully...');
  isShuttingDown = true;

  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }

  console.log('[PreChartScheduler] Shutdown complete');
}

/**
 * Get scheduler health status (for health check endpoint)
 */
export function getSchedulerHealth(): { healthy: boolean; lastRun: Date | null; enabled: boolean } {
  return {
    healthy: isHealthy,
    lastRun: lastRunTime,
    enabled: SCHEDULER_ENABLED === 'true',
  };
}
