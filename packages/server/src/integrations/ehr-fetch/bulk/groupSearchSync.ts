// SPDX-License-Identifier: Apache-2.0

import type { Resource, Group, Bundle, BundleEntry } from '@medplum/fhirtypes';

/**
 * Configuration for Group-based search sync
 */
export interface GroupSearchSyncConfig {
  /** EHR FHIR base URL */
  fhirBaseUrl: string;
  /** Access token for authentication */
  accessToken: string;
  /** Group ID containing the patients to sync */
  groupId: string;
  /** Resource types to fetch for each patient */
  resourceTypes: string[];
  /** Only export resources modified since this date */
  since?: Date;
  /** Maximum number of patients to process (for testing/rate limiting) */
  maxPatients?: number;
}

/**
 * Alternative to bulk export that uses standard FHIR search operations.
 * This is useful when:
 * - The EHR doesn't support $export
 * - The client doesn't have bulk export permissions
 * - You want real-time data instead of async export
 *
 * Process:
 * 1. Read the Group resource to get member patient references
 * 2. For each patient, search for their clinical resources
 * 3. Aggregate all resources by type
 *
 * NOTE: This is slower than bulk export for large datasets,
 * but works with standard FHIR read/search scopes.
 */
export class GroupSearchSync {
  private config: GroupSearchSyncConfig;

  constructor(config: GroupSearchSyncConfig) {
    this.config = config;
  }

  /**
   * Execute the sync: fetch all resources for patients in the group
   */
  async execute(): Promise<{
    resources: Map<string, Resource[]>;
    patientCount: number;
    transactionTime: string;
  }> {
    const startTime = new Date();
    console.log('[GroupSearchSync] Starting group-based search sync...');
    console.log(`[GroupSearchSync] Group ID: ${this.config.groupId}`);
    console.log(`[GroupSearchSync] Resource types: ${this.config.resourceTypes.join(', ')}`);

    // Step 1: Get patient IDs from the Group resource
    const patientIds = await this.getGroupMemberPatients();
    console.log(`[GroupSearchSync] Found ${patientIds.length} patients in group`);

    if (patientIds.length === 0) {
      console.log('[GroupSearchSync] No patients found in group');
      return {
        resources: new Map(),
        patientCount: 0,
        transactionTime: startTime.toISOString(),
      };
    }

    // Apply max patients limit if configured
    const patientsToProcess = this.config.maxPatients
      ? patientIds.slice(0, this.config.maxPatients)
      : patientIds;

    if (this.config.maxPatients && patientIds.length > this.config.maxPatients) {
      console.log(`[GroupSearchSync] Limiting to ${this.config.maxPatients} patients (of ${patientIds.length} total)`);
    }

    // Step 2: Fetch resources for each patient
    const allResources = new Map<string, Resource[]>();

    for (let i = 0; i < patientsToProcess.length; i++) {
      const patientId = patientsToProcess[i];
      console.log(`[GroupSearchSync] Processing patient ${i + 1}/${patientsToProcess.length}: ${patientId}`);

      try {
        const patientResources = await this.fetchPatientResources(patientId);

        // Aggregate resources by type
        for (const [resourceType, resources] of patientResources) {
          const existing = allResources.get(resourceType) || [];
          allResources.set(resourceType, [...existing, ...resources]);
        }
      } catch (error) {
        console.error(`[GroupSearchSync] Error fetching resources for patient ${patientId}:`, error);
        // Continue with next patient
      }
    }

    // Log summary
    let totalResources = 0;
    for (const [type, resources] of allResources) {
      console.log(`[GroupSearchSync] ${type}: ${resources.length} resources`);
      totalResources += resources.length;
    }
    console.log(`[GroupSearchSync] Total: ${totalResources} resources from ${patientsToProcess.length} patients`);

    return {
      resources: allResources,
      patientCount: patientsToProcess.length,
      transactionTime: startTime.toISOString(),
    };
  }

  /**
   * Get patient IDs from the Group resource
   * Supports both member references and characteristic-based groups
   */
  private async getGroupMemberPatients(): Promise<string[]> {
    const baseUrl = this.config.fhirBaseUrl.replace(/\/$/, '');
    const groupUrl = `${baseUrl}/Group/${encodeURIComponent(this.config.groupId)}`;

    console.log(`[GroupSearchSync] Attempting to fetch group: ${groupUrl}`);

    try {
      const response = await fetch(groupUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.config.accessToken}`,
          Accept: 'application/fhir+json',
        },
      });

      if (!response.ok) {
        const errorBody = await response.text();
        console.log(`[GroupSearchSync] Group resource not accessible (${response.status}), falling back to patient search`);
        console.log(`[GroupSearchSync] Error: ${errorBody.substring(0, 200)}`);
        // Fall back to searching all patients instead of throwing
        return await this.searchPatientsInGroup();
      }

      const group = (await response.json()) as Group;
      const patientIds: string[] = [];

      // Extract patient IDs from group members
      if (group.member && Array.isArray(group.member)) {
        for (const member of group.member) {
          if (member.entity?.reference) {
            // Reference format: "Patient/123" or full URL
            const ref = member.entity.reference;
            const match = ref.match(/Patient\/([^/]+)$/);
            if (match) {
              patientIds.push(match[1]);
            }
          }
        }
      }

      // If no members found, try to search for patients in the group
      // Some EHRs use Group as a query definition rather than explicit membership
      if (patientIds.length === 0) {
        console.log('[GroupSearchSync] No explicit members in Group, trying Patient search...');
        const searchPatients = await this.searchPatientsInGroup();
        patientIds.push(...searchPatients);
      }

      return patientIds;
    } catch (error) {
      console.log('[GroupSearchSync] Error fetching Group, falling back to patient search:', error);
      return await this.searchPatientsInGroup();
    }
  }

  /**
   * Search for patients - fallback when Group doesn't have explicit members
   */
  private async searchPatientsInGroup(): Promise<string[]> {
    const baseUrl = this.config.fhirBaseUrl.replace(/\/$/, '');
    const patientIds: string[] = [];

    // Try to search for all patients (some EHRs support this)
    // Limit to reasonable count for performance
    let nextUrl: string | undefined = `${baseUrl}/Patient?_count=100`;

    while (nextUrl) {
      console.log(`[GroupSearchSync] Searching patients: ${nextUrl}`);

      const response = await fetch(nextUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.config.accessToken}`,
          Accept: 'application/fhir+json',
        },
      });

      if (!response.ok) {
        console.warn(`[GroupSearchSync] Patient search failed: ${response.status}`);
        break;
      }

      const bundle = (await response.json()) as Bundle;

      if (bundle.entry) {
        for (const entry of bundle.entry) {
          if (entry.resource?.resourceType === 'Patient' && entry.resource.id) {
            patientIds.push(entry.resource.id);
          }
        }
      }

      // Check for pagination
      const nextLink = bundle.link?.find((l) => l.relation === 'next');
      nextUrl = nextLink?.url;

      // Safety limit
      if (patientIds.length >= 1000) {
        console.log('[GroupSearchSync] Reached 1000 patient limit');
        break;
      }
    }

    return patientIds;
  }

  /**
   * Fetch all resources for a single patient
   */
  private async fetchPatientResources(patientId: string): Promise<Map<string, Resource[]>> {
    const baseUrl = this.config.fhirBaseUrl.replace(/\/$/, '');
    const resourcesByType = new Map<string, Resource[]>();

    // First, fetch the Patient resource itself
    try {
      const patientResource = await this.fetchResource(`${baseUrl}/Patient/${patientId}`);
      if (patientResource) {
        resourcesByType.set('Patient', [patientResource]);
      }
    } catch (error) {
      console.warn(`[GroupSearchSync] Could not fetch Patient/${patientId}:`, error);
    }

    // Then fetch each resource type for this patient
    for (const resourceType of this.config.resourceTypes) {
      if (resourceType === 'Patient') continue; // Already fetched

      try {
        const resources = await this.searchResourcesForPatient(resourceType, patientId);
        if (resources.length > 0) {
          resourcesByType.set(resourceType, resources);
        }
      } catch (error) {
        console.warn(`[GroupSearchSync] Could not fetch ${resourceType} for patient ${patientId}:`, error);
      }
    }

    return resourcesByType;
  }

  /**
   * Fetch a single resource by URL
   */
  private async fetchResource(url: string): Promise<Resource | null> {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.config.accessToken}`,
        Accept: 'application/fhir+json',
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      const errorBody = await response.text();
      throw new Error(`Failed to fetch resource: ${response.status} ${errorBody}`);
    }

    return (await response.json()) as Resource;
  }

  /**
   * Search for resources of a specific type for a patient
   */
  private async searchResourcesForPatient(resourceType: string, patientId: string): Promise<Resource[]> {
    const baseUrl = this.config.fhirBaseUrl.replace(/\/$/, '');
    const resources: Resource[] = [];

    // Build search URL
    // Different resource types use different patient reference parameters
    const patientParam = this.getPatientSearchParam(resourceType);
    let searchUrl = `${baseUrl}/${resourceType}?${patientParam}=Patient/${patientId}&_count=100`;

    // Add _lastUpdated filter if since is specified
    if (this.config.since) {
      const sinceStr = this.config.since.toISOString();
      searchUrl += `&_lastUpdated=ge${sinceStr}`;
    }

    // Paginate through results
    let nextUrl: string | undefined = searchUrl;
    let pageCount = 0;

    while (nextUrl && pageCount < 10) {
      // Safety limit on pages
      pageCount++;

      const response = await fetch(nextUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.config.accessToken}`,
          Accept: 'application/fhir+json',
        },
      });

      if (!response.ok) {
        // Don't throw - just log and continue
        // Some resource types may not support the search parameter
        if (response.status !== 400) {
          console.warn(`[GroupSearchSync] Search ${resourceType} failed: ${response.status}`);
        }
        break;
      }

      const bundle = (await response.json()) as Bundle;

      if (bundle.entry) {
        for (const entry of bundle.entry as BundleEntry[]) {
          if (entry.resource) {
            resources.push(entry.resource);
          }
        }
      }

      // Check for pagination
      const nextLink = bundle.link?.find((l) => l.relation === 'next');
      nextUrl = nextLink?.url;
    }

    return resources;
  }

  /**
   * Get the correct search parameter for patient reference
   * Most resources use 'patient' but some use 'subject'
   */
  private getPatientSearchParam(resourceType: string): string {
    const subjectResources = [
      'CarePlan',
      'CareTeam',
      'Composition',
      'Condition',
      'DiagnosticReport',
      'DocumentReference',
      'Encounter',
      'Goal',
      'MedicationRequest',
      'Observation',
      'Procedure',
      'ServiceRequest',
    ];

    // Resources that use 'patient' directly
    const patientResources = ['AllergyIntolerance', 'Immunization', 'MedicationStatement'];

    if (patientResources.includes(resourceType)) {
      return 'patient';
    }

    if (subjectResources.includes(resourceType)) {
      return 'subject';
    }

    // Default to 'patient' for unknown types
    return 'patient';
  }
}

/**
 * Execute a group-based search sync
 */
export async function executeGroupSearchSync(config: GroupSearchSyncConfig): Promise<{
  resources: Map<string, Resource[]>;
  patientCount: number;
  transactionTime: string;
}> {
  const client = new GroupSearchSync(config);
  return client.execute();
}
