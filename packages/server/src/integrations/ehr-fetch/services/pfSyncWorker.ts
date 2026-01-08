// SPDX-License-Identifier: Apache-2.0

import type { Parameters, Project, Resource } from '@medplum/fhirtypes';
import { Operator } from '@medplum/core';
import { requestContextStore } from '../../../request-context-store.js';
import { AuthenticatedRequestContext } from '../../../context.js';
import { getSystemRepo, Repository } from '../../../fhir/repo.js';
import { SmartBackendClient, discoverSmartEndpoints } from '../auth/smartClient.js';
import { executeBulkExport } from '../bulk/bulkExportClient.js';
import { executeGroupSearchSync } from '../bulk/groupSearchSync.js';
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
const EHR_ALGORITHM = process.env.EHR_ALGORITHM as 'RS384' | 'RS256' | 'ES384' | undefined; // JWT signing algorithm
const EHR_JWKS_URL = process.env.EHR_JWKS_URL; // Optional: JWKS URL to include in JWT header (jku)
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
      algorithm: EHR_ALGORITHM,
      jwksUrl: EHR_JWKS_URL,
      scopes: EHR_SCOPES,
    });

    const accessToken = await smartClient.getAccessToken();
    console.log('[EHRSync] Successfully authenticated');

    // Execute bulk export (with fallback to group search sync if bulk export not available)
    console.log('[EHRSync] Starting data export...');
    let resources: Map<string, Resource[]>;
    let transactionTime: string | undefined;

    try {
      // Try bulk export first (more efficient for large datasets)
      console.log('[EHRSync] Attempting bulk data export ($export operation)...');
      const bulkResult = await executeBulkExport({
        fhirBaseUrl: EHR_FHIR_BASE_URL,
        accessToken,
        resourceTypes: EHR_RESOURCE_TYPES,
        groupId: EHR_GROUP_ID, // Uses group-based export if provided
        since: lastSyncTime || undefined,
      });
      resources = bulkResult.resources;
      transactionTime = bulkResult.transactionTime;
    } catch (bulkError: any) {
      // Check if bulk export failed due to permission issues (403)
      const errorMessage = bulkError?.message || '';
      if (errorMessage.includes('403') || errorMessage.includes('MSG_OP_NOT_ALLOWED') || errorMessage.includes('forbidden')) {
        console.log('[EHRSync] Bulk export not available (403 Forbidden)');
        console.log('[EHRSync] Falling back to group-based search sync...');

        if (!EHR_GROUP_ID) {
          throw new Error('Group-based search sync requires EHR_GROUP_ID to be configured');
        }

        // Fall back to group search sync (uses standard FHIR search operations)
        const searchResult = await executeGroupSearchSync({
          fhirBaseUrl: EHR_FHIR_BASE_URL,
          accessToken,
          groupId: EHR_GROUP_ID,
          resourceTypes: EHR_RESOURCE_TYPES,
          since: lastSyncTime || undefined,
        });
        resources = searchResult.resources;
        transactionTime = searchResult.transactionTime;
        console.log(`[EHRSync] Group search sync complete: ${searchResult.patientCount} patients processed`);
      } else {
        // Re-throw if it's not a permission issue
        throw bulkError;
      }
    }

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

  // Build reference map: EHR reference -> Local reference
  // This allows us to translate references in resources to point to local IDs
  const referenceMap = new Map<string, string>();

  // Define processing order - Patient and Practitioner first so we can build reference map
  const processingOrder = ['Patient', 'Practitioner', 'Medication'];
  const orderedTypes = [
    ...processingOrder.filter((t) => resourcesByType.has(t)),
    ...Array.from(resourcesByType.keys()).filter((t) => !processingOrder.includes(t)),
  ];

  for (const resourceType of orderedTypes) {
    const resources = resourcesByType.get(resourceType);
    if (!resources) continue;

    console.log(`[EHRSync] Processing ${resources.length} ${resourceType} resources...`);

    stats.byType[resourceType] = { created: 0, updated: 0, failed: 0 };

    const identifierSystem = getResourceIdentifierSystem(resourceType);

    // Process resources sequentially to avoid transaction conflicts
    // The repository uses transactions internally, and parallel execution causes
    // "ROLLBACK TO SAVEPOINT can only be used in transaction blocks" errors
    for (const resource of resources) {
      try {
        // Store original EHR ID for reference mapping
        const ehrId = resource.id;

        // Get the source identifier
        const sourceId = getSourceIdentifier(resource);

        // Check if a resource with any of the original EHR identifiers already exists
        const existingResource = await findExistingResource(repo, resourceType, resource, identifierSystem, sourceId, referenceMap);

        // Ensure the resource has our identifier system
        let resourceWithIdentifier = ensureEhrIdentifier(resource, sourceId, identifierSystem);

        // Translate references to local IDs (for non-Patient/Practitioner resources)
        resourceWithIdentifier = translateReferences(resourceWithIdentifier, referenceMap);

        let localId: string | undefined;

        if (existingResource) {
          // Update the existing resource by ID to avoid creating a duplicate
          const updatedResource = { ...resourceWithIdentifier, id: existingResource.id };
          await repo.updateResource(updatedResource);
          localId = existingResource.id;
          stats.updated++;
          stats.byType[resourceType].updated++;
        } else {
          // No existing resource found - use conditional update to upsert
          // This handles the case where the resource was previously synced with our identifier
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

          localId = result.resource.id;

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
        }

        // Add to reference map for Patient, Practitioner, and Medication
        // These are commonly referenced by other resources
        if (ehrId && localId && ['Patient', 'Practitioner', 'Medication'].includes(resourceType)) {
          const ehrRef = `${resourceType}/${ehrId}`;
          const localRef = `${resourceType}/${localId}`;
          referenceMap.set(ehrRef, localRef);
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

  console.log(`[EHRSync] Reference map built with ${referenceMap.size} entries`);
  return stats;
}

/**
 * Translate EHR references to local Medplum references
 * This ensures resources like Observation.subject point to local Patient IDs
 */
function translateReferences(resource: Resource, referenceMap: Map<string, string>): Resource {
  if (referenceMap.size === 0) {
    return resource;
  }

  const resourceCopy = JSON.parse(JSON.stringify(resource));

  // Common reference fields to translate
  const referenceFields = [
    'subject',
    'patient',
    'performer',
    'author',
    'asserter',
    'recorder',
    'requester',
    'prescriber',
    'medicationReference',
    'encounter',
  ];

  for (const field of referenceFields) {
    if (resourceCopy[field]?.reference) {
      const ehrRef = resourceCopy[field].reference;
      const localRef = referenceMap.get(ehrRef);
      if (localRef) {
        resourceCopy[field].reference = localRef;
      }
    }
  }

  // Handle array fields like participant, performer (when it's an array)
  const arrayReferenceFields = ['participant', 'performer', 'author', 'careTeam'];
  for (const field of arrayReferenceFields) {
    if (Array.isArray(resourceCopy[field])) {
      for (const item of resourceCopy[field]) {
        // Handle direct reference
        if (item?.reference) {
          const ehrRef = item.reference;
          const localRef = referenceMap.get(ehrRef);
          if (localRef) {
            item.reference = localRef;
          }
        }
        // Handle actor/member patterns
        if (item?.actor?.reference) {
          const ehrRef = item.actor.reference;
          const localRef = referenceMap.get(ehrRef);
          if (localRef) {
            item.actor.reference = localRef;
          }
        }
        if (item?.member?.reference) {
          const ehrRef = item.member.reference;
          const localRef = referenceMap.get(ehrRef);
          if (localRef) {
            item.member.reference = localRef;
          }
        }
      }
    }
  }

  return resourceCopy;
}

/**
 * Find an existing resource by checking all identifiers from the EHR resource
 * This handles deduplication for:
 * 1. Resources imported through other means (using original EHR identifiers)
 * 2. Resources previously synced by this integration (using our custom identifier)
 * 3. Resources without stable IDs (using semantic properties like subject+code+date)
 */
async function findExistingResource(
  repo: Repository,
  resourceType: string,
  resource: Resource,
  ehrIdentifierSystem: string,
  sourceId: string,
  referenceMap?: Map<string, string>
): Promise<Resource | undefined> {
  // First, check if we previously synced this resource using our custom identifier
  // This is the most reliable match for resources we've already processed
  try {
    const result = await repo.search({
      resourceType: resourceType as any,
      count: 1,
      filters: [
        {
          code: 'identifier',
          operator: Operator.EQUALS,
          value: `${ehrIdentifierSystem}|${sourceId}`,
        },
      ],
    });

    if (result.entry && result.entry.length > 0) {
      return result.entry[0].resource;
    }
  } catch {
    // Continue to check original identifiers
  }

  // Check original EHR identifiers for resources imported through other means
  const identifiers = (resource as any).identifier;
  if (Array.isArray(identifiers)) {
    for (const id of identifiers) {
      if (id.system && id.value) {
        try {
          const result = await repo.search({
            resourceType: resourceType as any,
            count: 1,
            filters: [
              {
                code: 'identifier',
                operator: Operator.EQUALS,
                value: `${id.system}|${id.value}`,
              },
            ],
          });

          if (result.entry && result.entry.length > 0) {
            return result.entry[0].resource;
          }
        } catch {
          // Continue to next identifier if search fails
        }
      }
    }
  }

  // For resources without stable identifiers (like Observations), try semantic matching
  const semanticMatch = await findBySemanticProperties(repo, resourceType, resource, referenceMap);
  if (semanticMatch) {
    return semanticMatch;
  }

  return undefined;
}

/**
 * Find existing resources by semantic properties when identifiers are not stable
 * This handles EHRs that generate new IDs for each bulk export
 * Also searches with translated references to find resources synced after reference translation was added
 */
async function findBySemanticProperties(
  repo: Repository,
  resourceType: string,
  resource: Resource,
  referenceMap?: Map<string, string>
): Promise<Resource | undefined> {
  const r = resource as any;

  // Helper to try search with both original and translated references
  async function trySearchWithBothReferences(
    searchResourceType: string,
    referenceField: string,
    originalRef: string,
    baseFilters: any[]
  ): Promise<Resource | undefined> {
    // Try with original EHR reference first (for old data)
    try {
      const result = await repo.search({
        resourceType: searchResourceType as any,
        count: 1,
        filters: [{ code: referenceField, operator: Operator.EQUALS, value: originalRef }, ...baseFilters],
      });
      if (result.entry && result.entry.length > 0) {
        return result.entry[0].resource;
      }
    } catch {
      // Continue
    }

    // Try with translated reference (for data synced after reference translation fix)
    const translatedRef = referenceMap?.get(originalRef);
    if (translatedRef) {
      try {
        const result = await repo.search({
          resourceType: searchResourceType as any,
          count: 1,
          filters: [{ code: referenceField, operator: Operator.EQUALS, value: translatedRef }, ...baseFilters],
        });
        if (result.entry && result.entry.length > 0) {
          return result.entry[0].resource;
        }
      } catch {
        // Continue
      }
    }

    return undefined;
  }

  // Observation: match by subject + code + effectiveDateTime
  if (resourceType === 'Observation' && r.subject?.reference && r.code?.coding?.[0]) {
    const codeFilter = { code: 'code', operator: Operator.EQUALS, value: r.code.coding[0].system + '|' + r.code.coding[0].code };
    const baseFilters: any[] = [codeFilter];

    // Add date filter if available
    if (r.effectiveDateTime) {
      baseFilters.push({ code: 'date', operator: Operator.EQUALS, value: r.effectiveDateTime });
    } else if (r.effectivePeriod?.start) {
      baseFilters.push({ code: 'date', operator: Operator.EQUALS, value: r.effectivePeriod.start });
    }

    const match = await trySearchWithBothReferences('Observation', 'subject', r.subject.reference, baseFilters);
    if (match) return match;
  }

  // Condition: match by subject + code + onsetDateTime
  if (resourceType === 'Condition' && r.subject?.reference && r.code?.coding?.[0]) {
    const codeFilter = { code: 'code', operator: Operator.EQUALS, value: r.code.coding[0].system + '|' + r.code.coding[0].code };
    const baseFilters: any[] = [codeFilter];

    if (r.onsetDateTime) {
      baseFilters.push({ code: 'onset-date', operator: Operator.EQUALS, value: r.onsetDateTime });
    }

    const match = await trySearchWithBothReferences('Condition', 'subject', r.subject.reference, baseFilters);
    if (match) return match;
  }

  // AllergyIntolerance: match by patient + code
  if (resourceType === 'AllergyIntolerance' && r.patient?.reference && r.code?.coding?.[0]) {
    const codeFilter = { code: 'code', operator: Operator.EQUALS, value: r.code.coding[0].system + '|' + r.code.coding[0].code };
    const match = await trySearchWithBothReferences('AllergyIntolerance', 'patient', r.patient.reference, [codeFilter]);
    if (match) return match;
  }

  // CarePlan: match by subject + category
  if (resourceType === 'CarePlan' && r.subject?.reference && r.category?.[0]?.coding?.[0]) {
    const categoryFilter = { code: 'category', operator: Operator.EQUALS, value: r.category[0].coding[0].system + '|' + r.category[0].coding[0].code };
    const match = await trySearchWithBothReferences('CarePlan', 'subject', r.subject.reference, [categoryFilter]);
    if (match) return match;
  }

  return undefined;
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
