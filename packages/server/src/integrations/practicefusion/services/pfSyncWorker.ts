// SPDX-License-Identifier: Apache-2.0

import type { Parameters, Resource } from '@medplum/fhirtypes';
import { Operator } from '@medplum/core';
import { requestContextStore } from '../../../request-context-store.js';
import { AuthenticatedRequestContext } from '../../../context.js';
import { getSystemRepo } from '../../../fhir/repo.js';
import type { Repository } from '../../../fhir/repo.js';
import { SmartBackendClient, discoverSmartEndpoints } from '../auth/smartClient';
import { executeBulkExport } from '../bulk/bulkExportClient';
import { PF_IDENTIFIER_SYSTEM, PF_RESOURCE_ID_SYSTEMS, DEFAULT_EXPORT_RESOURCE_TYPES } from '../constants';

// Configuration from environment variables
const PF_FHIR_BASE_URL = process.env.PF_FHIR_BASE_URL || '';
const PF_CLIENT_ID = process.env.PF_CLIENT_ID || '';
const PF_CLIENT_SECRET = process.env.PF_CLIENT_SECRET; // Optional: for client_secret auth
const PF_PRIVATE_KEY = process.env.PF_PRIVATE_KEY; // Optional: for JWT auth
const PF_KEY_ID = process.env.PF_KEY_ID;
const PF_RESOURCE_TYPES = process.env.PF_RESOURCE_TYPES
  ? process.env.PF_RESOURCE_TYPES.split(',').map((t) => t.trim())
  : DEFAULT_EXPORT_RESOURCE_TYPES;

/**
 * Main sync function - fetches data from Practice Fusion and upserts into Medplum
 */
export async function syncFromPracticeFusion(): Promise<void> {
  console.log('[PFSyncWorker] Starting Practice Fusion sync...');

  await requestContextStore.run(AuthenticatedRequestContext.system(), async () => {
    const repo = getSystemRepo();

    // Get the last sync timestamp
    const lastSyncTime = await getLastSyncTime(repo);
    console.log(`[PFSyncWorker] Last sync time: ${lastSyncTime?.toISOString() || 'never (initial sync)'}`);

    // Discover OAuth endpoints
    console.log('[PFSyncWorker] Discovering SMART endpoints...');
    const endpoints = await discoverSmartEndpoints(PF_FHIR_BASE_URL);
    console.log(`[PFSyncWorker] Token endpoint: ${endpoints.tokenEndpoint}`);

    // Get access token
    console.log('[PFSyncWorker] Authenticating with Practice Fusion...');
    const smartClient = new SmartBackendClient({
      fhirBaseUrl: PF_FHIR_BASE_URL,
      tokenEndpoint: endpoints.tokenEndpoint,
      clientId: PF_CLIENT_ID,
      clientSecret: PF_CLIENT_SECRET, // Will use this if provided
      privateKeyPem: PF_PRIVATE_KEY, // Falls back to JWT if client_secret not provided
      keyId: PF_KEY_ID,
    });

    const accessToken = await smartClient.getAccessToken();
    console.log('[PFSyncWorker] Successfully authenticated');

    // Execute bulk export
    console.log('[PFSyncWorker] Starting bulk data export...');
    const { resources, transactionTime } = await executeBulkExport({
      fhirBaseUrl: PF_FHIR_BASE_URL,
      accessToken,
      resourceTypes: PF_RESOURCE_TYPES,
      since: lastSyncTime || undefined,
    });

    // Process and upsert resources
    console.log('[PFSyncWorker] Processing and upserting resources...');
    const stats = await upsertResources(repo, resources);

    // Update the last sync time
    const newSyncTime = transactionTime ? new Date(transactionTime) : new Date();
    await updateLastSyncTime(repo, newSyncTime);

    console.log('[PFSyncWorker] Sync complete!');
    console.log(`[PFSyncWorker] Stats: ${JSON.stringify(stats)}`);
  });
}

/**
 * Upsert resources into Medplum using conditional updates
 * This handles both initial import and incremental updates
 */
async function upsertResources(
  repo: Repository,
  resourcesByType: Map<string, Resource[]>
): Promise<{ created: number; updated: number; failed: number; byType: Record<string, { created: number; updated: number; failed: number }> }> {
  const stats = {
    created: 0,
    updated: 0,
    failed: 0,
    byType: {} as Record<string, { created: number; updated: number; failed: number }>,
  };

  for (const [resourceType, resources] of resourcesByType) {
    console.log(`[PFSyncWorker] Processing ${resources.length} ${resourceType} resources...`);

    stats.byType[resourceType] = { created: 0, updated: 0, failed: 0 };

    const identifierSystem = PF_RESOURCE_ID_SYSTEMS[resourceType] || `${PF_IDENTIFIER_SYSTEM}/${resourceType.toLowerCase()}-id`;

    // Process in batches to avoid overwhelming the database
    const batchSize = 50;
    for (let i = 0; i < resources.length; i += batchSize) {
      const batch = resources.slice(i, i + batchSize);

      // Process batch in parallel using Promise.allSettled
      const results = await Promise.allSettled(
        batch.map(async (resource) => {
          // Get the source identifier
          const sourceId = getSourceIdentifier(resource);

          // Ensure the resource has our identifier system
          const resourceWithIdentifier = ensurePfIdentifier(resource, sourceId, identifierSystem);

          // Use conditional update to upsert
          const result = await repo.conditionalUpdate(
            resourceWithIdentifier,
            {
              resourceType: resourceType as any,
              filters: [
                {
                  code: 'identifier',
                  operator: Operator.EQUALS,
                  value: `${identifierSystem}|${sourceId}`,
                },
              ],
            }
          );

          return result;
        })
      );

      // Count results
      for (const result of results) {
        if (result.status === 'fulfilled') {
          const outcome = result.value.outcome;
          const status = outcome.issue?.[0]?.code || '';
          if (status === 'informational' || outcome.id?.includes('created')) {
            stats.created++;
            stats.byType[resourceType].created++;
          } else {
            stats.updated++;
            stats.byType[resourceType].updated++;
          }
        } else {
          stats.failed++;
          stats.byType[resourceType].failed++;
          console.warn(`[PFSyncWorker] Failed to upsert resource:`, result.reason);
        }
      }
    }

    console.log(
      `[PFSyncWorker] ${resourceType}: ${stats.byType[resourceType].created} created, ` +
        `${stats.byType[resourceType].updated} updated, ${stats.byType[resourceType].failed} failed`
    );
  }

  return stats;
}

/**
 * Get the source identifier from a Practice Fusion resource
 * Tries to find an existing identifier or falls back to the resource id
 */
function getSourceIdentifier(resource: Resource): string {
  // Check for existing Practice Fusion identifier
  const identifiers = (resource as any).identifier;
  if (Array.isArray(identifiers)) {
    for (const id of identifiers) {
      if (id.system?.includes('practicefusion')) {
        return id.value;
      }
    }
  }

  // Fall back to resource id
  if (resource.id) {
    return resource.id;
  }

  // Generate a unique identifier if none exists
  return `pf-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Ensure the resource has our Practice Fusion identifier
 */
function ensurePfIdentifier(resource: Resource, sourceId: string, identifierSystem: string): Resource {
  const resourceCopy = { ...resource } as any;

  // Remove the original id to let Medplum assign one
  delete resourceCopy.id;

  // Ensure identifier array exists
  if (!resourceCopy.identifier) {
    resourceCopy.identifier = [];
  }

  // Check if our identifier already exists
  const existingIdx = resourceCopy.identifier.findIndex((id: any) => id.system === identifierSystem);

  if (existingIdx >= 0) {
    // Update existing
    resourceCopy.identifier[existingIdx].value = sourceId;
  } else {
    // Add new
    resourceCopy.identifier.push({
      system: identifierSystem,
      value: sourceId,
    });
  }

  return resourceCopy;
}

/**
 * Get the last sync timestamp from storage
 */
async function getLastSyncTime(repo: Repository): Promise<Date | null> {
  try {
    const result = await repo.search({
      resourceType: 'Parameters',
      count: 1,
      filters: [{ code: 'name', operator: Operator.EQUALS, value: 'pf-sync-state' }],
    });

    const params = result.entry?.[0]?.resource as Parameters | undefined;
    if (!params?.parameter) {
      return null;
    }

    const lastSyncParam = params.parameter.find((p) => p.name === 'lastSyncTime');
    if (lastSyncParam?.valueDateTime) {
      return new Date(lastSyncParam.valueDateTime);
    }

    return null;
  } catch (error) {
    console.warn('[PFSyncWorker] Error getting last sync time:', error);
    return null;
  }
}

/**
 * Update the last sync timestamp in storage
 */
async function updateLastSyncTime(repo: Repository, syncTime: Date): Promise<void> {
  try {
    // Try to find existing sync state
    const result = await repo.search({
      resourceType: 'Parameters',
      count: 1,
      filters: [{ code: 'name', operator: Operator.EQUALS, value: 'pf-sync-state' }],
    });

    const existingParams = result.entry?.[0]?.resource as Parameters | undefined;

    const params: Parameters = {
      resourceType: 'Parameters',
      id: existingParams?.id,
      meta: {
        tag: [{ system: PF_IDENTIFIER_SYSTEM, code: 'sync-state' }],
      },
      parameter: [
        { name: 'name', valueString: 'pf-sync-state' },
        { name: 'lastSyncTime', valueDateTime: syncTime.toISOString() },
        { name: 'fhirBaseUrl', valueString: PF_FHIR_BASE_URL },
      ],
    };

    if (existingParams?.id) {
      await repo.updateResource(params);
      console.log(`[PFSyncWorker] Updated sync state: ${syncTime.toISOString()}`);
    } else {
      await repo.createResource(params);
      console.log(`[PFSyncWorker] Created sync state: ${syncTime.toISOString()}`);
    }
  } catch (error) {
    console.error('[PFSyncWorker] Error updating last sync time:', error);
    // Don't throw - sync was successful, just state tracking failed
  }
}
