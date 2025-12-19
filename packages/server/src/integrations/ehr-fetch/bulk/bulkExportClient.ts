// SPDX-License-Identifier: Apache-2.0

import type { Resource } from '@medplum/fhirtypes';
import { DEFAULT_EXPORT_RESOURCE_TYPES } from '../constants.js';

/**
 * Configuration for the Bulk Data Export client
 */
export interface BulkExportConfig {
  /** EHR FHIR base URL */
  fhirBaseUrl: string;
  /** Access token for authentication */
  accessToken: string;
  /** Resource types to export (defaults to all supported types) */
  resourceTypes?: string[];
  /** Only export resources modified since this date */
  since?: Date;
  /** Group ID for group-based export (optional - if not provided, uses system-level export) */
  groupId?: string;
  /** Polling interval in milliseconds (default: 10000) */
  pollingIntervalMs?: number;
  /** Maximum polling attempts before timeout (default: 360 = 1 hour with 10s interval) */
  maxPollingAttempts?: number;
}

/**
 * Status of a bulk export job
 */
export interface BulkExportStatus {
  /** Whether the export is still in progress */
  inProgress: boolean;
  /** Progress percentage if available */
  progress?: number;
  /** Error message if the export failed */
  error?: string;
  /** Output files when complete */
  output?: BulkExportOutput[];
  /** Transaction time for the export */
  transactionTime?: string;
}

/**
 * Output file from a bulk export
 */
export interface BulkExportOutput {
  /** Resource type in this file */
  type: string;
  /** URL to download the NDJSON file */
  url: string;
  /** Number of resources in the file (if available) */
  count?: number;
}

/**
 * Parsed resource from NDJSON
 */
export interface ParsedResource {
  resource: Resource;
  sourceId: string;
}

/**
 * Client for FHIR Bulk Data Export operations
 * Implements the FHIR Bulk Data Access specification:
 * https://hl7.org/fhir/uv/bulkdata/
 *
 * Supports both:
 * - System-level export: GET /$export (all data)
 * - Group-level export: GET /Group/{id}/$export (specific patient group)
 */
export class BulkExportClient {
  private config: BulkExportConfig;

  constructor(config: BulkExportConfig) {
    this.config = {
      ...config,
      resourceTypes: config.resourceTypes || DEFAULT_EXPORT_RESOURCE_TYPES,
      pollingIntervalMs: config.pollingIntervalMs || 10000,
      maxPollingAttempts: config.maxPollingAttempts || 360,
    };
  }

  /**
   * Kick off a bulk export and return the status polling URL
   * Uses group-based export if groupId is provided, otherwise system-level export
   */
  async kickOffExport(): Promise<string> {
    const baseUrl = this.config.fhirBaseUrl.replace(/\/$/, '');

    // Build export URL with parameters
    const params = new URLSearchParams();

    // Add resource types
    if (this.config.resourceTypes && this.config.resourceTypes.length > 0) {
      params.set('_type', this.config.resourceTypes.join(','));
    }

    // Add _since parameter for incremental exports
    // Use FHIR instant format without milliseconds (Epic requirement)
    if (this.config.since) {
      // Format: YYYY-MM-DDTHH:mm:ssZ (no milliseconds)
      const sinceDate = this.config.since.toISOString().replace(/\.\d{3}Z$/, 'Z');
      params.set('_since', sinceDate);
    }

    // Request NDJSON format
    params.set('_outputFormat', 'application/fhir+ndjson');

    // Determine export endpoint: group-based or system-level
    let exportPath: string;
    if (this.config.groupId) {
      // Group-based export: /Group/{id}/$export
      exportPath = `/Group/${encodeURIComponent(this.config.groupId)}/$export`;
      console.log(`[EHRBulkExport] Using group-based export for group: ${this.config.groupId}`);
    } else {
      // System-level export: /$export
      exportPath = '/$export';
      console.log('[EHRBulkExport] Using system-level export');
    }

    const exportUrl = `${baseUrl}${exportPath}?${params.toString()}`;

    console.log(`[EHRBulkExport] Initiating bulk export: ${exportUrl}`);

    const response = await fetch(exportUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.config.accessToken}`,
        Accept: 'application/fhir+json',
        Prefer: 'respond-async',
      },
    });

    // Check for accepted status (202)
    if (response.status !== 202) {
      const errorBody = await response.text();
      console.error('[EHRBulkExport] Export kick-off failed with status:', response.status);
      console.error('[EHRBulkExport] Response headers:', JSON.stringify(Object.fromEntries(response.headers.entries())));
      console.error('[EHRBulkExport] Response body:', errorBody);
      console.error('[EHRBulkExport] Request URL:', exportUrl);
      console.error('[EHRBulkExport] Access token (first 20 chars):', this.config.accessToken.substring(0, 20) + '...');

      // Try to parse as OperationOutcome if it's JSON
      try {
        const parsed = JSON.parse(errorBody);
        console.error('[EHRBulkExport] Parsed error response:', JSON.stringify(parsed, null, 2));
      } catch {
        // Not JSON, already logged as text
      }

      throw new Error(`Bulk export kick-off failed: ${response.status} ${errorBody}`);
    }

    // Get the Content-Location header for status polling
    const contentLocation = response.headers.get('Content-Location');
    if (!contentLocation) {
      throw new Error('Bulk export response missing Content-Location header');
    }

    console.log(`[EHRBulkExport] Export initiated, status URL: ${contentLocation}`);
    return contentLocation;
  }

  /**
   * Poll the export status URL until complete or error
   */
  async pollUntilComplete(statusUrl: string): Promise<BulkExportStatus> {
    let attempts = 0;

    while (attempts < this.config.maxPollingAttempts!) {
      attempts++;

      const status = await this.checkStatus(statusUrl);

      if (!status.inProgress) {
        return status;
      }

      console.log(
        `[EHRBulkExport] Export in progress (attempt ${attempts}/${this.config.maxPollingAttempts})` +
          (status.progress ? `, progress: ${status.progress}%` : '')
      );

      // Wait before next poll
      await this.sleep(this.config.pollingIntervalMs!);
    }

    throw new Error(`Bulk export timed out after ${attempts} polling attempts`);
  }

  /**
   * Check the status of a bulk export job
   */
  async checkStatus(statusUrl: string): Promise<BulkExportStatus> {
    const response = await fetch(statusUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.config.accessToken}`,
        Accept: 'application/json',
      },
    });

    // 202 = still in progress
    if (response.status === 202) {
      // Check for X-Progress header
      const progress = response.headers.get('X-Progress');
      return {
        inProgress: true,
        progress: progress ? parseInt(progress, 10) : undefined,
      };
    }

    // 200 = complete
    if (response.status === 200) {
      const body = (await response.json()) as {
        transactionTime: string;
        output: BulkExportOutput[];
        error?: { type: string; url: string }[];
      };

      console.log(`[EHRBulkExport] Export complete with ${body.output?.length || 0} output files`);

      return {
        inProgress: false,
        output: body.output,
        transactionTime: body.transactionTime,
      };
    }

    // Error status
    const errorBody = await response.text();
    console.error('[EHRBulkExport] Export status check failed:', response.status, errorBody);

    return {
      inProgress: false,
      error: `Export failed: ${response.status} ${errorBody}`,
    };
  }

  /**
   * Download and parse an NDJSON file from the export
   */
  async downloadNdjsonFile(fileUrl: string): Promise<Resource[]> {
    console.log(`[EHRBulkExport] Downloading NDJSON file: ${fileUrl}`);

    const response = await fetch(fileUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.config.accessToken}`,
        Accept: 'application/fhir+ndjson',
      },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Failed to download NDJSON file: ${response.status} ${errorBody}`);
    }

    const text = await response.text();
    const resources = this.parseNdjson(text);

    console.log(`[EHRBulkExport] Parsed ${resources.length} resources from file`);
    return resources;
  }

  /**
   * Parse NDJSON (Newline Delimited JSON) text into resources
   */
  private parseNdjson(text: string): Resource[] {
    const resources: Resource[] = [];
    const lines = text.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const resource = JSON.parse(trimmed) as Resource;
        resources.push(resource);
      } catch (error) {
        console.warn('[EHRBulkExport] Failed to parse NDJSON line:', error);
      }
    }

    return resources;
  }

  /**
   * Delete/cancel a bulk export job
   */
  async deleteExport(statusUrl: string): Promise<void> {
    console.log(`[EHRBulkExport] Cancelling export: ${statusUrl}`);

    const response = await fetch(statusUrl, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${this.config.accessToken}`,
      },
    });

    if (!response.ok && response.status !== 404) {
      console.warn(`[EHRBulkExport] Failed to delete export: ${response.status}`);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Execute a full bulk export workflow
 */
export async function executeBulkExport(config: BulkExportConfig): Promise<{
  resources: Map<string, Resource[]>;
  transactionTime?: string;
}> {
  const client = new BulkExportClient(config);

  // Kick off export
  const statusUrl = await client.kickOffExport();

  try {
    // Poll until complete
    const status = await client.pollUntilComplete(statusUrl);

    if (status.error) {
      throw new Error(status.error);
    }

    // Download all output files
    const resources = new Map<string, Resource[]>();

    for (const output of status.output || []) {
      const fileResources = await client.downloadNdjsonFile(output.url);
      const existing = resources.get(output.type) || [];
      resources.set(output.type, [...existing, ...fileResources]);
    }

    // Log summary
    let totalCount = 0;
    for (const [type, typeResources] of resources) {
      console.log(`[EHRBulkExport] Downloaded ${typeResources.length} ${type} resources`);
      totalCount += typeResources.length;
    }
    console.log(`[EHRBulkExport] Total resources downloaded: ${totalCount}`);

    return {
      resources,
      transactionTime: status.transactionTime,
    };
  } catch (error) {
    // Try to clean up the export job on error
    try {
      await client.deleteExport(statusUrl);
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }
}
