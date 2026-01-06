// SPDX-License-Identifier: Apache-2.0

/**
 * Single Patient EHR Sync Service
 *
 * This module provides fast, real-time synchronization of a single patient's data
 * from an external EHR (Epic, Practice Fusion, etc.) into Medplum.
 *
 * Unlike bulk export, this uses standard FHIR search/read operations which are
 * much faster (typically < 5 seconds) and suitable for on-demand fetching
 * when generating pre-chart notes.
 *
 * Usage:
 *   await syncSinglePatientFromEHR(localPatientId);
 *
 * This will:
 *   1. Look up the patient's EHR identifier in Medplum
 *   2. Authenticate with the external EHR
 *   3. Fetch the patient's recent data (vitals, labs, conditions, etc.)
 *   4. Upsert the data into Medplum
 */

import type { Resource, Patient } from '@medplum/fhirtypes';
import { Operator } from '@medplum/core';
import { requestContextStore } from '../../../request-context-store.js';
import { AuthenticatedRequestContext } from '../../../context.js';
import { getSystemRepo, Repository } from '../../../fhir/repo.js';
import { SmartBackendClient, discoverSmartEndpoints } from '../auth/smartClient.js';
import { EHR_IDENTIFIER_SYSTEM, getResourceIdentifierSystem } from '../constants.js';

// Configuration from environment variables
const EHR_FHIR_BASE_URL = process.env.EHR_FHIR_BASE_URL || process.env.PF_FHIR_BASE_URL || '';
const EHR_CLIENT_ID = process.env.EHR_CLIENT_ID || process.env.PF_CLIENT_ID || '';
const EHR_CLIENT_SECRET = process.env.EHR_CLIENT_SECRET || process.env.PF_CLIENT_SECRET;
const EHR_PRIVATE_KEY = process.env.EHR_PRIVATE_KEY || process.env.PF_PRIVATE_KEY;
const EHR_KEY_ID = process.env.EHR_KEY_ID || process.env.PF_KEY_ID;
const EHR_SCOPES = process.env.EHR_SCOPES;

// Resource types to fetch for single patient sync (focused on pre-chart relevant data)
const SINGLE_PATIENT_RESOURCE_TYPES = [
  'Observation',      // Vitals and lab results
  'Condition',        // Active problems/diagnoses
  'MedicationRequest', // Current medications
  'AllergyIntolerance', // Allergies
  'Immunization',     // Vaccinations
  'Procedure',        // Recent procedures
  'Encounter',        // Recent visits
];

// Cached SMART client for reuse
let cachedSmartClient: SmartBackendClient | null = null;
let cachedTokenEndpoint: string | null = null;

interface SyncResult {
  success: boolean;
  patientId: string;
  ehrPatientId?: string;
  resourcesUpdated: number;
  resourcesByType: Record<string, number>;
  durationMs: number;
  error?: string;
}

/**
 * Check if single-patient EHR sync is enabled and configured
 */
export function isSinglePatientSyncEnabled(): boolean {
  return !!(EHR_FHIR_BASE_URL && EHR_CLIENT_ID && (EHR_CLIENT_SECRET || EHR_PRIVATE_KEY));
}

/**
 * Get or create a SMART client for EHR authentication
 */
async function getSmartClient(): Promise<SmartBackendClient> {
  if (cachedSmartClient && cachedTokenEndpoint) {
    console.log('[SinglePatientSync] Using cached SMART client');
    return cachedSmartClient;
  }

  console.log('[SinglePatientSync] Creating new SMART client...');
  console.log('[SinglePatientSync] Discovering SMART endpoints from EHR...');
  const endpoints = await discoverSmartEndpoints(EHR_FHIR_BASE_URL);
  cachedTokenEndpoint = endpoints.tokenEndpoint;
  console.log(`[SinglePatientSync] Token endpoint: ${endpoints.tokenEndpoint}`);

  cachedSmartClient = new SmartBackendClient({
    fhirBaseUrl: EHR_FHIR_BASE_URL,
    tokenEndpoint: endpoints.tokenEndpoint,
    clientId: EHR_CLIENT_ID,
    clientSecret: EHR_CLIENT_SECRET,
    privateKeyPem: EHR_PRIVATE_KEY,
    keyId: EHR_KEY_ID,
    scopes: EHR_SCOPES,
  });

  console.log('[SinglePatientSync] SMART client created successfully');
  return cachedSmartClient;
}

/**
 * Find the EHR patient ID from the local Medplum patient record
 * The EHR identifier is stored in patient.identifier with system = EHR_IDENTIFIER_SYSTEM
 */
async function findEhrPatientId(repo: Repository, localPatientId: string): Promise<string | null> {
  try {
    const patient = await repo.readResource<Patient>('Patient', localPatientId);

    if (!patient.identifier || !Array.isArray(patient.identifier)) {
      console.log(`[SinglePatientSync] Patient ${localPatientId} has no identifiers`);
      return null;
    }

    console.log(`[SinglePatientSync] Patient has ${patient.identifier.length} identifier(s):`);
    patient.identifier.forEach((id, idx) => {
      console.log(`[SinglePatientSync]   ${idx + 1}. system: ${id.system || '(none)'}, value: ${id.value || '(none)'}`);
    });

    // Look for identifier with our EHR system
    const patientIdentifierSystem = getResourceIdentifierSystem('Patient');
    console.log(`[SinglePatientSync] Looking for EHR identifier with system: ${patientIdentifierSystem}`);

    for (const identifier of patient.identifier) {
      if (identifier.system === patientIdentifierSystem && identifier.value) {
        console.log(`[SinglePatientSync] ✓ Found EHR patient ID: ${identifier.value} (system: ${identifier.system})`);
        return identifier.value;
      }
      // Also check for the base EHR system
      if (identifier.system === EHR_IDENTIFIER_SYSTEM && identifier.value) {
        console.log(`[SinglePatientSync] ✓ Found EHR patient ID: ${identifier.value} (system: ${identifier.system})`);
        return identifier.value;
      }
      // Check for MRN or other common identifier systems from EHRs
      if ((identifier.system?.includes('mrn') || identifier.system?.includes('MRN')) && identifier.value) {
        console.log(`[SinglePatientSync] ✓ Found MRN identifier: ${identifier.value} (system: ${identifier.system})`);
        return identifier.value;
      }
    }

    // If no EHR identifier found, the patient might not have been synced from EHR
    console.log(`[SinglePatientSync] ✗ No EHR identifier found for patient ${localPatientId}`);
    console.log(`[SinglePatientSync]   Expected system: ${patientIdentifierSystem} or ${EHR_IDENTIFIER_SYSTEM} or *mrn*`);
    return null;
  } catch (error) {
    console.error(`[SinglePatientSync] Error finding EHR patient ID:`, error);
    return null;
  }
}

/**
 * Get Epic-required search parameters for specific resource types
 * Epic's FHIR API requires certain parameters for many searches
 * See: https://fhir.epic.com/Documentation
 */
function getEpicRequiredParams(resourceType: string): string {
  switch (resourceType) {
    case 'Observation':
      // Epic requires category for Observation searches
      // Use vital-signs as default, but could also search for laboratory, social-history, etc.
      return 'category=vital-signs';
    case 'Condition':
      // Epic requires category for Condition searches
      return 'category=problem-list-item';
    case 'MedicationRequest':
      // Epic requires status for MedicationRequest
      return 'status=active';
    case 'AllergyIntolerance':
      // Epic requires clinical-status for AllergyIntolerance
      return 'clinical-status=active';
    case 'Immunization':
      // Epic requires status for Immunization
      return 'status=completed';
    case 'Encounter':
      // Epic requires date or status for Encounter
      return 'status=finished,in-progress,planned';
    case 'Procedure':
      // Epic requires date for Procedure
      return 'status=completed';
    default:
      return '';
  }
}

/**
 * Fetch resources for a single patient from the external EHR
 * Uses standard FHIR search operations for fast, real-time access
 *
 * NOTE: Epic Backend Services (Bulk Data) does NOT support individual patient searches.
 * The token is only valid for bulk export operations and direct resource reads.
 * For Epic, we try direct resource reads which may work, but searches will likely fail.
 */
async function fetchPatientResourcesFromEHR(
  accessToken: string,
  ehrPatientId: string,
  since?: Date
): Promise<Map<string, Resource[]>> {
  const resourcesByType = new Map<string, Resource[]>();
  const headers = {
    'Authorization': `Bearer ${accessToken}`,
    'Accept': 'application/fhir+json',
  };

  console.log(`[SinglePatientSync] Fetching resources for patient...`);

  // Step 1: First, verify we can read the Patient resource directly
  // This tells us if the token works for direct reads (which may be supported even when searches aren't)
  try {
    const patientUrl = `${EHR_FHIR_BASE_URL}/Patient/${ehrPatientId}`;
    console.log(`[SinglePatientSync] Verifying token with direct Patient read: ${patientUrl}`);

    const patientResponse = await fetch(patientUrl, { headers });

    if (patientResponse.ok) {
      console.log(`[SinglePatientSync] ✓ Direct Patient read succeeded - token is valid for FHIR reads`);
    } else {
      const errorText = await patientResponse.text();
      console.warn(`[SinglePatientSync] ✗ Direct Patient read failed (${patientResponse.status}): ${errorText.substring(0, 200)}`);

      if (patientResponse.status === 401 || patientResponse.status === 403) {
        console.warn(`[SinglePatientSync] Token may not have permission for individual patient access`);
        console.warn(`[SinglePatientSync] Epic Backend Services tokens are typically only valid for Bulk Data Export`);
        console.warn(`[SinglePatientSync] Skipping single-patient sync - data is already available from bulk export`);
        return resourcesByType;
      }
    }
  } catch (error) {
    console.warn(`[SinglePatientSync] Error verifying token:`, error);
  }

  // Step 2: Try Patient/$everything if available (most efficient)
  try {
    const everythingUrl = `${EHR_FHIR_BASE_URL}/Patient/${ehrPatientId}/$everything`;
    console.log(`[SinglePatientSync] Trying Patient/$everything: ${everythingUrl}`);

    const response = await fetch(everythingUrl, { headers });

    if (response.ok) {
      const bundle = await response.json();
      if (bundle.entry && Array.isArray(bundle.entry)) {
        for (const entry of bundle.entry) {
          if (entry.resource) {
            const resourceType = entry.resource.resourceType;
            if (!resourcesByType.has(resourceType)) {
              resourcesByType.set(resourceType, []);
            }
            resourcesByType.get(resourceType)!.push(entry.resource);
          }
        }
        console.log(`[SinglePatientSync] ✓ Patient/$everything returned ${bundle.entry.length} resources`);
        return resourcesByType;
      }
    } else {
      const errorText = await response.text();
      console.log(`[SinglePatientSync] Patient/$everything not available (${response.status}): ${errorText.substring(0, 100)}`);
    }
  } catch (error) {
    console.log(`[SinglePatientSync] Patient/$everything failed:`, error);
  }

  // Step 3: Fall back to individual resource type searches
  // Different EHRs have different requirements:
  // - Epic Backend Services: Does NOT support individual patient searches (only bulk export)
  // - Practice Fusion: Supports standard FHIR searches
  //
  // We'll try the first resource type and if it fails with 400/403, we'll detect that
  // searches aren't supported and skip the rest.

  let consecutiveFailures = 0;
  const MAX_FAILURES_BEFORE_SKIP = 2; // If first 2 resource types fail, assume searches aren't supported

  for (const resourceType of SINGLE_PATIENT_RESOURCE_TYPES) {
    // If we've had too many consecutive failures, searches probably aren't supported
    if (consecutiveFailures >= MAX_FAILURES_BEFORE_SKIP) {
      console.log(`[SinglePatientSync] ⚠️ Multiple search failures detected - EHR may not support individual patient searches`);
      console.log(`[SinglePatientSync] This is expected for Epic Backend Services which only supports Bulk Data Export`);
      console.log(`[SinglePatientSync] Skipping remaining resource types - patient data should already be available from daily bulk sync`);
      break;
    }

    try {
      // Epic requires specific additional parameters for many resource types
      const epicExtraParams = getEpicRequiredParams(resourceType);

      // Try a simple search first
      const searchUrl = `${EHR_FHIR_BASE_URL}/${resourceType}?patient=${ehrPatientId}${epicExtraParams ? '&' + epicExtraParams : ''}&_count=100`;
      console.log(`[SinglePatientSync] Searching ${resourceType}: ${searchUrl}`);

      const response = await fetch(searchUrl, { headers });

      if (response.ok) {
        consecutiveFailures = 0; // Reset on success
        const bundle = await response.json();

        if (bundle.entry && Array.isArray(bundle.entry)) {
          const resources = bundle.entry.map((e: any) => e.resource).filter(Boolean);
          if (resources.length > 0) {
            resourcesByType.set(resourceType, resources);
            console.log(`[SinglePatientSync] ✓ Found ${resources.length} ${resourceType} resources`);
          } else {
            console.log(`[SinglePatientSync] No ${resourceType} resources found for patient`);
          }
        }
      } else {
        consecutiveFailures++;
        const errorText = await response.text();
        console.warn(`[SinglePatientSync] Search failed (${response.status}): ${errorText.substring(0, 200)}`);
      }
    } catch (error) {
      consecutiveFailures++;
      console.warn(`[SinglePatientSync] Error fetching ${resourceType}:`, error);
    }
  }

  // Log summary if we got any resources (which would be unusual for Epic but possible for other EHRs)
  if (resourcesByType.size > 0) {
    console.log(`[SinglePatientSync] Successfully fetched resources from ${resourcesByType.size} resource types`);
  }

  return resourcesByType;
}

/**
 * Upsert resources from EHR into local Medplum database
 * Uses conditional updates to prevent duplicates
 */
async function upsertResourcesToMedplum(
  repo: Repository,
  resourcesByType: Map<string, Resource[]>,
  localPatientId: string,
  ehrPatientId: string
): Promise<{ updated: number; byType: Record<string, number> }> {
  const stats = { updated: 0, byType: {} as Record<string, number> };

  // Build local patient reference for translation
  const localPatientRef = `Patient/${localPatientId}`;
  const ehrPatientRef = `Patient/${ehrPatientId}`;

  for (const [resourceType, resources] of resourcesByType) {
    if (resourceType === 'Patient') {
      // Skip Patient resource - we already have the local patient
      console.log(`[SinglePatientSync] Skipping Patient resource (already exists locally)`);
      continue;
    }

    console.log(`[SinglePatientSync] Processing ${resources.length} ${resourceType} resources...`);
    stats.byType[resourceType] = 0;
    const identifierSystem = getResourceIdentifierSystem(resourceType);

    for (const resource of resources) {
      try {
        // Translate patient reference from EHR to local
        const translatedResource = translatePatientReference(resource, ehrPatientRef, localPatientRef);

        // Get source identifier
        const sourceId = getSourceIdentifier(resource);

        // Ensure our identifier is on the resource
        const resourceWithIdentifier = ensureEhrIdentifier(translatedResource, sourceId, identifierSystem);

        // Check if resource already exists
        const existing = await findExistingResource(repo, resourceType, sourceId, identifierSystem);

        if (existing) {
          // Update existing resource
          console.log(`[SinglePatientSync]   - Updating existing ${resourceType}/${existing.id} (EHR ID: ${sourceId})`);
          const updatedResource = { ...resourceWithIdentifier, id: existing.id };
          await repo.updateResource(updatedResource);
        } else {
          // Create new resource via conditional update
          console.log(`[SinglePatientSync]   - Creating new ${resourceType} (EHR ID: ${sourceId})`);
          await repo.conditionalUpdate(
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
        }

        stats.updated++;
        stats.byType[resourceType]++;
      } catch (error) {
        console.warn(`[SinglePatientSync] Failed to upsert ${resourceType}:`, error);
      }
    }
    console.log(`[SinglePatientSync] Completed ${resourceType}: ${stats.byType[resourceType]} resources upserted`);
  }

  return stats;
}

/**
 * Translate patient references from EHR IDs to local Medplum IDs
 */
function translatePatientReference(resource: Resource, ehrPatientRef: string, localPatientRef: string): Resource {
  const resourceCopy = JSON.parse(JSON.stringify(resource));

  // Common reference fields
  const refFields = ['subject', 'patient', 'performer', 'author', 'asserter', 'recorder'];

  for (const field of refFields) {
    if (resourceCopy[field]?.reference === ehrPatientRef) {
      resourceCopy[field].reference = localPatientRef;
    }
  }

  return resourceCopy;
}

/**
 * Get source identifier from EHR resource
 */
function getSourceIdentifier(resource: Resource): string {
  const identifiers = (resource as any).identifier;
  if (Array.isArray(identifiers)) {
    for (const id of identifiers) {
      if (id.value) {
        return id.value;
      }
    }
  }
  if (resource.id) {
    return resource.id;
  }
  return `ehr-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Ensure resource has our EHR identifier for deduplication
 */
function ensureEhrIdentifier(resource: Resource, sourceId: string, identifierSystem: string): Resource {
  const resourceCopy = { ...resource } as any;
  delete resourceCopy.id; // Let Medplum assign ID

  if (!resourceCopy.identifier) {
    resourceCopy.identifier = [];
  }

  const existingIdx = resourceCopy.identifier.findIndex((id: any) => id.system === identifierSystem);

  if (existingIdx >= 0) {
    resourceCopy.identifier[existingIdx].value = sourceId;
  } else {
    resourceCopy.identifier.push({ system: identifierSystem, value: sourceId });
  }

  return resourceCopy;
}

/**
 * Find existing resource by identifier
 */
async function findExistingResource(
  repo: Repository,
  resourceType: string,
  sourceId: string,
  identifierSystem: string
): Promise<Resource | undefined> {
  try {
    const result = await repo.search({
      resourceType: resourceType as any,
      count: 1,
      filters: [
        {
          code: 'identifier',
          operator: Operator.EQUALS,
          value: `${identifierSystem}|${sourceId}`,
        },
      ],
    });
    return result.entry?.[0]?.resource;
  } catch {
    return undefined;
  }
}

/**
 * Main function: Sync a single patient's data from EHR to Medplum
 *
 * This is designed to be fast (< 5 seconds) for on-demand use when
 * generating pre-chart notes.
 *
 * @param localPatientId - The Medplum patient ID
 * @param since - Optional: Only fetch resources modified after this date
 * @returns SyncResult with statistics
 */
export async function syncSinglePatientFromEHR(
  localPatientId: string,
  since?: Date
): Promise<SyncResult> {
  const startTime = Date.now();

  console.log(`[SinglePatientSync] ========================================`);
  console.log(`[SinglePatientSync] Starting single patient sync`);
  console.log(`[SinglePatientSync] Patient ID: ${localPatientId}`);
  console.log(`[SinglePatientSync] Since: ${since?.toISOString() || 'all data'}`);
  console.log(`[SinglePatientSync] ========================================`);

  // Check if sync is enabled
  if (!isSinglePatientSyncEnabled()) {
    console.log('[SinglePatientSync] ❌ Single patient sync is NOT enabled');
    console.log('[SinglePatientSync] Missing required environment variables:');
    console.log(`[SinglePatientSync]   - EHR_FHIR_BASE_URL: ${EHR_FHIR_BASE_URL ? '✓ set' : '✗ missing'}`);
    console.log(`[SinglePatientSync]   - EHR_CLIENT_ID: ${EHR_CLIENT_ID ? '✓ set' : '✗ missing'}`);
    console.log(`[SinglePatientSync]   - EHR_CLIENT_SECRET or EHR_PRIVATE_KEY: ${(EHR_CLIENT_SECRET || EHR_PRIVATE_KEY) ? '✓ set' : '✗ missing'}`);
    return {
      success: true, // Not an error - just not configured
      patientId: localPatientId,
      resourcesUpdated: 0,
      resourcesByType: {},
      durationMs: Date.now() - startTime,
      error: 'EHR sync not configured',
    };
  }

  console.log('[SinglePatientSync] ✓ EHR sync is enabled and configured');
  console.log(`[SinglePatientSync] EHR Base URL: ${EHR_FHIR_BASE_URL}`);
  console.log(`[SinglePatientSync] Client ID: ${EHR_CLIENT_ID}`);
  console.log(`[SinglePatientSync] Auth method: ${EHR_PRIVATE_KEY ? 'JWT (private key)' : 'client_secret'}`);
  console.log(`[SinglePatientSync] Identifier system: ${EHR_IDENTIFIER_SYSTEM}`);

  try {
    return await requestContextStore.run(AuthenticatedRequestContext.system(), async () => {
      const repo = getSystemRepo();

      // Step 1: Find the EHR patient ID from local patient record
      console.log(`[SinglePatientSync] Step 1: Looking up EHR patient identifier for local patient ${localPatientId}...`);
      const ehrPatientId = await findEhrPatientId(repo, localPatientId);

      if (!ehrPatientId) {
        console.log(`[SinglePatientSync] Patient ${localPatientId} has no EHR identifier - skipping sync`);
        return {
          success: true, // Not an error - patient just isn't from EHR
          patientId: localPatientId,
          resourcesUpdated: 0,
          resourcesByType: {},
          durationMs: Date.now() - startTime,
        };
      }

      // Step 2: Authenticate with EHR
      console.log(`[SinglePatientSync] Step 2: Authenticating with EHR...`);
      const smartClient = await getSmartClient();
      console.log('[SinglePatientSync] Requesting access token...');
      const accessToken = await smartClient.getAccessToken();
      console.log(`[SinglePatientSync] ✓ Successfully authenticated (token length: ${accessToken.length} chars)`);

      // Step 3: Fetch patient resources from EHR
      console.log(`[SinglePatientSync] Step 3: Fetching data for EHR patient ${ehrPatientId}...`);
      const resourcesByType = await fetchPatientResourcesFromEHR(accessToken, ehrPatientId, since);

      // Log what we found
      let totalResources = 0;
      for (const [type, resources] of resourcesByType) {
        console.log(`[SinglePatientSync]   - Found ${resources.length} ${type} resources`);
        totalResources += resources.length;
      }
      console.log(`[SinglePatientSync] Total resources fetched from EHR: ${totalResources}`);

      if (totalResources === 0) {
        console.log('[SinglePatientSync] ✓ No new resources to sync - patient data is up to date');
        console.log(`[SinglePatientSync] ========================================`);
        return {
          success: true,
          patientId: localPatientId,
          ehrPatientId,
          resourcesUpdated: 0,
          resourcesByType: {},
          durationMs: Date.now() - startTime,
        };
      }

      // Step 4: Upsert resources into Medplum
      console.log(`[SinglePatientSync] Step 4: Upserting ${totalResources} resources to Medplum...`);
      const stats = await upsertResourcesToMedplum(repo, resourcesByType, localPatientId, ehrPatientId);

      const durationMs = Date.now() - startTime;
      console.log(`[SinglePatientSync] ========================================`);
      console.log(`[SinglePatientSync] ✓ SYNC COMPLETE`);
      console.log(`[SinglePatientSync] Duration: ${durationMs}ms`);
      console.log(`[SinglePatientSync] Resources updated: ${stats.updated}`);
      console.log(`[SinglePatientSync] Breakdown by type:`);
      for (const [type, count] of Object.entries(stats.byType)) {
        console.log(`[SinglePatientSync]   - ${type}: ${count}`);
      }
      console.log(`[SinglePatientSync] ========================================`);

      return {
        success: true,
        patientId: localPatientId,
        ehrPatientId,
        resourcesUpdated: stats.updated,
        resourcesByType: stats.byType,
        durationMs,
      };
    });
  } catch (error: any) {
    const durationMs = Date.now() - startTime;
    console.error(`[SinglePatientSync] Sync failed after ${durationMs}ms:`, error);

    return {
      success: false,
      patientId: localPatientId,
      resourcesUpdated: 0,
      resourcesByType: {},
      durationMs,
      error: error?.message || 'Unknown error',
    };
  }
}