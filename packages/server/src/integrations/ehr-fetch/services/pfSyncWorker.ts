// SPDX-License-Identifier: Apache-2.0

import type { Parameters, Project, Resource } from '@medplum/fhirtypes';
import { Operator } from '@medplum/core';
import { requestContextStore } from '../../../request-context-store.js';
import { AuthenticatedRequestContext } from '../../../context.js';
import { getSystemRepo, Repository } from '../../../fhir/repo.js';
import { SmartBackendClient, discoverSmartEndpoints } from '../auth/smartClient.js';
import { executeBulkExport } from '../bulk/bulkExportClient.js';
import { EHR_IDENTIFIER_SYSTEM, getResourceIdentifierSystem, DEFAULT_EXPORT_RESOURCE_TYPES } from '../constants.js';

// Configuration from environment variables
// Uses EHR_ prefix for generic naming, with PF_ fallback for backwards compatibility
const EHR_FHIR_BASE_URL = process.env.EHR_FHIR_BASE_URL || process.env.PF_FHIR_BASE_URL || '';
const EHR_CLIENT_ID = process.env.EHR_CLIENT_ID || process.env.PF_CLIENT_ID || '';
const EHR_CLIENT_SECRET = process.env.EHR_CLIENT_SECRET || process.env.PF_CLIENT_SECRET;
const EHR_PRIVATE_KEY = process.env.EHR_PRIVATE_KEY || process.env.PF_PRIVATE_KEY;
const EHR_KEY_ID = process.env.EHR_KEY_ID || process.env.PF_KEY_ID;
const EHR_GROUP_ID = process.env.EHR_GROUP_ID; // Optional: for group-based bulk export
const EHR_SCOPES = process.env.EHR_SCOPES; // Optional: custom OAuth scopes
const EHR_TARGET_PROJECT_ID = process.env.EHR_TARGET_PROJECT_ID; // Target Medplum project for synced resources
const EHR_RESOURCE_TYPES = (process.env.EHR_RESOURCE_TYPES || process.env.PF_RESOURCE_TYPES)
  ? (process.env.EHR_RESOURCE_TYPES || process.env.PF_RESOURCE_TYPES)!.split(',').map((t) => t.trim())
  : DEFAULT_EXPORT_RESOURCE_TYPES;

/**
 * Get a repository scoped to the target project (if configured) or system repo
 */
async function getTargetRepo(): Promise<Repository> {
  const systemRepo = getSystemRepo();
  
  if (!EHR_TARGET_PROJECT_ID) {
    console.log('[EHRSync] No target project configured, using system repo');
    return systemRepo;
  }

  try {
    // Verify the project exists
    const project = await systemRepo.readResource<Project>('Project', EHR_TARGET_PROJECT_ID);
    console.log(`[EHRSync] Using target project: ${project.name || project.id}`);
    
    // Create a repository scoped to this project
    return new Repository({
      projects: [project],
      superAdmin: true,
      strictMode: true,
      extendedMode: true,
      author: {
        reference: 'system',
      },
    });
  } catch (error) {
    console.error(`[EHRSync] Failed to load target project ${EHR_TARGET_PROJECT_ID}:`, error);
    console.log('[EHRSync] Falling back to system repo');
    return systemRepo;
  }
}

/**
 * Main sync function - fetches data from external EHR and upserts into Medplum
 * Works with any EHR that supports FHIR Bulk Data Export (Epic, Cerner, Practice Fusion, etc.)
 */
export async function syncFromPracticeFusion(): Promise<void> {
  console.log('[EHRSync] Starting EHR data sync...');
  console.log(`[EHRSync] FHIR Base URL: ${EHR_FHIR_BASE_URL}`);
  console.log(`[EHRSync] Resource types: ${EHR_RESOURCE_TYPES.join(', ')}`);
  if (EHR_GROUP_ID) {
    console.log(`[EHRSync] Group ID: ${EHR_GROUP_ID}`);
  }
  if (EHR_TARGET_PROJECT_ID) {
    console.log(`[EHRSync] Target Project ID: ${EHR_TARGET_PROJECT_ID}`);
  }

  await requestContextStore.run(AuthenticatedRequestContext.system(), async () => {
    // Get the appropriate repository (project-scoped or system)
    const repo = await getTargetRepo();

    // Get the last sync timestamp
    const lastSyncTime = await getLastSyncTime(repo);
    console.log(`[EHRSync] Last sync time: ${lastSyncTime?.toISOString() || 'never (initial sync)'}`);

    // Discover OAuth endpoints
    console.log('[EHRSync] Discovering SMART endpoints...');
    const endpoints = await discoverSmartEndpoints(EHR_FHIR_BASE_URL);
    console.log(`[EHRSync] Token endpoint: ${endpoints.tokenEndpoint}`);

    // Get access token
    console.log('[EHRSync] Authenticating with EHR...');
    const smartClient = new SmartBackendClient({
      fhirBaseUrl: EHR_FHIR_BASE_URL,
      tokenEndpoint: endpoints.tokenEndpoint,
      clientId: EHR_CLIENT_ID,
      clientSecret: EHR_CLIENT_SECRET,
      privateKeyPem: EHR_PRIVATE_KEY,
      keyId: EHR_KEY_ID,
      scopes: EHR_SCOPES,
    });

    const accessToken = await smartClient.getAccessToken();
    console.log('[EHRSync] Successfully authenticated');

    // Execute bulk export
    console.log('[EHRSync] Starting bulk data export...');
    const { resources, transactionTime } = await executeBulkExport({
      fhirBaseUrl: EHR_FHIR_BASE_URL,
      accessToken,
      resourceTypes: EHR_RESOURCE_TYPES,
      groupId: EHR_GROUP_ID, // Uses group-based export if provided
      since: lastSyncTime || undefined,
    });

    // Process and upsert resources
    console.log('[EHRSync] Processing and upserting resources...');
    const stats = await upsertResources(repo, resources);

    // Update the last sync time
    const newSyncTime = transactionTime ? new Date(transactionTime) : new Date();
    await updateLastSyncTime(repo, newSyncTime);

    console.log('[EHRSync] Sync complete!');
    console.log(`[EHRSync] Stats: ${JSON.stringify(stats)}`);
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
    console.log(`[EHRSync] Processing ${resources.length} ${resourceType} resources...`);

    stats.byType[resourceType] = { created: 0, updated: 0, failed: 0 };

    const identifierSystem = getResourceIdentifierSystem(resourceType);

    // Process resources sequentially to avoid transaction conflicts
    // The repository uses transactions internally, and parallel execution causes
    // "ROLLBACK TO SAVEPOINT can only be used in transaction blocks" errors
    for (const resource of resources) {
      try {
        // Get the source identifier
        const sourceId = getSourceIdentifier(resource);

        // Ensure the resource has our identifier system
        const resourceWithIdentifier = ensureEhrIdentifier(resource, sourceId, identifierSystem);

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

        // Check outcome to determine if created or updated
        const outcome = result.outcome;
        const status = outcome.issue?.[0]?.code || '';
        if (status === 'informational' || outcome.id?.includes('created')) {
          stats.created++;
          stats.byType[resourceType].created++;
        } else {
          stats.updated++;
          stats.byType[resourceType].updated++;
        }
      } catch (error) {
        stats.failed++;
        stats.byType[resourceType].failed++;
        console.warn(`[EHRSync] Failed to upsert ${resourceType} resource:`, error);
      }
    }

    console.log(
      `[EHRSync] ${resourceType}: ${stats.byType[resourceType].created} created, ` +
        `${stats.byType[resourceType].updated} updated, ${stats.byType[resourceType].failed} failed`
    );
  }

  return stats;
}

/**
 * Get the source identifier from an EHR resource
 * Tries to find an existing identifier or falls back to the resource id
 */
function getSourceIdentifier(resource: Resource): string {
  // Check for existing identifiers
  const identifiers = (resource as any).identifier;
  if (Array.isArray(identifiers)) {
    // Return first identifier with a value
    for (const id of identifiers) {
      if (id.value) {
        return id.value;
      }
    }
  }

  // Fall back to resource id
  if (resource.id) {
    return resource.id;
  }

  // Generate a unique identifier if none exists
  return `ehr-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Ensure the resource has our EHR identifier for deduplication
 */
function ensureEhrIdentifier(resource: Resource, sourceId: string, identifierSystem: string): Resource {
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
    // Search by tag instead of name parameter (Parameters doesn't support name search)
    const result = await repo.search({
      resourceType: 'Parameters',
      count: 1,
      filters: [
        { code: '_tag', operator: Operator.EQUALS, value: `${EHR_IDENTIFIER_SYSTEM}|sync-state` }
      ],
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
    console.warn('[EHRSync] Error getting last sync time:', error);
    return null;
  }
}

/**
 * Update the last sync timestamp in storage
 */
async function updateLastSyncTime(repo: Repository, syncTime: Date): Promise<void> {
  try {
    // Try to find existing sync state using tag search
    const result = await repo.search({
      resourceType: 'Parameters',
      count: 1,
      filters: [
        { code: '_tag', operator: Operator.EQUALS, value: `${EHR_IDENTIFIER_SYSTEM}|sync-state` }
      ],
    });

    const existingParams = result.entry?.[0]?.resource as Parameters | undefined;

    const params: Parameters = {
      resourceType: 'Parameters',
      id: existingParams?.id,
      meta: {
        tag: [{ system: EHR_IDENTIFIER_SYSTEM, code: 'sync-state' }],
      },
      parameter: [
        { name: 'name', valueString: 'ehr-sync-state' },
        { name: 'lastSyncTime', valueDateTime: syncTime.toISOString() },
        { name: 'fhirBaseUrl', valueString: EHR_FHIR_BASE_URL },
        { name: 'groupId', valueString: EHR_GROUP_ID || '' },
      ],
    };

    if (existingParams?.id) {
      await repo.updateResource(params);
      console.log(`[EHRSync] Updated sync state: ${syncTime.toISOString()}`);
    } else {
      await repo.createResource(params);
      console.log(`[EHRSync] Created sync state: ${syncTime.toISOString()}`);
    }
  } catch (error) {
    console.error('[EHRSync] Error updating last sync time:', error);
    // Don't throw - sync was successful, just state tracking failed
  }
}
