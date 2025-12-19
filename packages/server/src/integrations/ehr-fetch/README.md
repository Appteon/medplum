# EHR Bulk Data Sync Integration

Automatic synchronization of patient data from external EHRs (Epic, Cerner, Practice Fusion, etc.) into Medplum using the FHIR Bulk Data Export API.

## Overview

This integration enables **automatic, scheduled synchronization** of clinical data from any FHIR-compliant EHR into your Medplum database. It runs as a background service within the Medplum server and uses the standard FHIR Bulk Data Access specification.

## Features

- ✅ **EHR Agnostic**: Works with Epic, Cerner, Practice Fusion, and any FHIR-compliant EHR
- ✅ **Automatic Sync**: Runs on server startup and at configurable intervals
- ✅ **Incremental Updates**: Only fetches changed resources after initial sync
- ✅ **Conditional Upsert**: Prevents duplicates using identifier-based matching
- ✅ **Group & System Export**: Supports both group-based and system-level bulk export
- ✅ **Multi-Resource Support**: Syncs 18+ FHIR resource types
- ✅ **Error Resilience**: Continues on individual resource failures
- ✅ **OAuth2 Authentication**: Supports both client_secret and private_key JWT
- ✅ **SMART Backend Services**: Compliant with SMART on FHIR specification

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    EHR BULK DATA SYNC                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌─────────────────┐  │
│  │  Scheduler   │───▶│    Worker    │───▶│  Bulk Export    │  │
│  │  (Timer)     │    │  (Executor)  │    │    Client       │  │
│  └──────────────┘    └──────────────┘    └─────────────────┘  │
│         │                    │                     │            │
│         │                    │                     ▼            │
│         │                    │            ┌─────────────────┐  │
│         │                    │            │  SMART Auth     │  │
│         │                    │            │  Client         │  │
│         │                    │            └─────────────────┘  │
│         │                    │                     │            │
│         │                    ▼                     ▼            │
│         │           ┌──────────────────────────────────────┐  │
│         └──────────▶│   External EHR FHIR API              │  │
│                     │   (Epic, Cerner, Practice Fusion)    │  │
│                     └──────────────────────────────────────┘  │
│                                    │                            │
│                                    ▼                            │
│                     ┌──────────────────────────────────────┐  │
│                     │   Medplum Database (PostgreSQL)      │  │
│                     │   - Conditional Upsert               │  │
│                     │   - Identifier-based Deduplication   │  │
│                     └──────────────────────────────────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Quick Start

### Epic Sandbox Configuration

```yaml
# docker-compose.yml
environment:
  EHR_SYNC_ENABLED: 'true'
  EHR_SYNC_RUN_ON_STARTUP: 'true'
  EHR_FHIR_BASE_URL: 'https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4'
  EHR_CLIENT_ID: 'your-epic-client-id'
  EHR_GROUP_ID: 'your-epic-group-id'  # Required for Epic
  EHR_IDENTIFIER_SYSTEM: 'https://open.epic.com/fhir'
  EHR_PRIVATE_KEY: |
    -----BEGIN RSA PRIVATE KEY-----
    your-private-key-here
    -----END RSA PRIVATE KEY-----
  EHR_KEY_ID: 'your-key-id'  # From your JWKS
```

### Practice Fusion Configuration

```yaml
# docker-compose.yml
environment:
  EHR_SYNC_ENABLED: 'true'
  EHR_SYNC_RUN_ON_STARTUP: 'true'
  EHR_FHIR_BASE_URL: 'https://api-sandbox.practicefusion.com/fhir/r4/v1'
  EHR_CLIENT_ID: 'your-practice-fusion-client-id'
  EHR_CLIENT_SECRET: 'your-practice-fusion-client-secret'
  EHR_IDENTIFIER_SYSTEM: 'https://practicefusion.com/fhir'
  # No EHR_GROUP_ID needed - uses system-level export
```

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `EHR_SYNC_ENABLED` | Yes | Set to `'true'` to enable sync |
| `EHR_FHIR_BASE_URL` | Yes | Base URL of the EHR FHIR API |
| `EHR_CLIENT_ID` | Yes | OAuth2 Client ID |
| `EHR_CLIENT_SECRET` | Maybe | Required if using client_secret auth |
| `EHR_PRIVATE_KEY` | Maybe | Required if using JWT auth (PEM format) |
| `EHR_KEY_ID` | No | Key ID for JWT signing (kid in JWKS) |
| `EHR_GROUP_ID` | Maybe | Required for Epic, optional for others |
| `EHR_IDENTIFIER_SYSTEM` | No | Base URL for tracking identifiers |
| `EHR_RESOURCE_TYPES` | No | Comma-separated resource types |
| `EHR_SCOPES` | No | Custom OAuth scopes |
| `EHR_SYNC_INTERVAL_MS` | No | Sync interval (default: 24 hours) |
| `EHR_SYNC_RUN_ON_STARTUP` | No | Run sync on server start |

### Backwards Compatibility

The `PF_` prefix is supported for backwards compatibility:
- `PF_SYNC_ENABLED` → `EHR_SYNC_ENABLED`
- `PF_FHIR_BASE_URL` → `EHR_FHIR_BASE_URL`
- etc.

## Export Types

### System-Level Export (`/$export`)

Used when `EHR_GROUP_ID` is not set. Exports all data the app has access to.

**Supported by**: Practice Fusion, most EHRs

```
GET https://fhir-server.example.com/$export
```

### Group-Level Export (`/Group/{id}/$export`)

Used when `EHR_GROUP_ID` is set. Exports data for a specific patient group.

**Required by**: Epic

```
GET https://fhir.epic.com/api/FHIR/R4/Group/abc123/$export
```

## EHR-Specific Notes

### Epic

**Authentication**: JWT-based (`private_key_jwt`)

**Requirements**:
- Private key (RSA or EC) in PEM format
- Public key published to JWKS URL (registered with Epic)
- Group ID for bulk export

**FHIR Base URL**:
- Sandbox: `https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4`
- Production: Varies by Epic instance

**Documentation**: https://fhir.epic.com/Documentation?docId=oauth2&section=BackendOAuth2Guide

### Practice Fusion

**Authentication**: Client secret (`client_credentials`)

**Requirements**:
- Client ID and Client Secret from Practice Fusion

**FHIR Base URL**:
- Sandbox: `https://api-sandbox.practicefusion.com/fhir/r4/v1`

**Documentation**: https://www.practicefusion.com/fhir/

### Cerner

**Authentication**: JWT-based (`private_key_jwt`)

Similar to Epic - requires private key and group ID.

**Documentation**: https://fhir.cerner.com/

## How It Works

### 1. Server Startup

When the Medplum server starts:

1. ✅ Validates configuration (FHIR URL, credentials)
2. ✅ Runs initial sync if `EHR_SYNC_RUN_ON_STARTUP=true`
3. ✅ Schedules recurring sync every `EHR_SYNC_INTERVAL_MS`

### 2. Sync Workflow

#### Step 1: Authentication

**For JWT auth (Epic)**:
```
POST /oauth/token
Body: grant_type=client_credentials
      client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer
      client_assertion=<signed-jwt>
      scope=system/Patient.read ...
```

**For client_secret auth (Practice Fusion)**:
```
POST /oauth/token
Authorization: Basic <base64(client_id:client_secret)>
Body: grant_type=client_credentials
      scope=system/Patient.read ...
```

#### Step 2: Bulk Export Kick-off

**System-level export**:
```
GET /$export?_type=Patient,Condition,...&_outputFormat=application/fhir+ndjson
```

**Group-level export** (Epic):
```
GET /Group/{group_id}/$export?_type=Patient,Condition,...
```

#### Step 3: Poll for Completion

```
GET {status-url}
Response: HTTP 202 (in progress) or HTTP 200 (complete)
```

#### Step 4: Download NDJSON Files

```
GET {file-url}
Response: Newline-delimited JSON resources
```

#### Step 5: Conditional Upsert

Each resource is upserted using conditional update to prevent duplicates:

```typescript
repo.conditionalUpdate(resource, {
  resourceType: 'Patient',
  filters: [{
    code: 'identifier',
    value: 'https://open.epic.com/fhir/patient-id|epic-123'
  }]
});
```

### 3. Incremental Sync

After initial sync, the `_since` parameter is used to only fetch changed resources:

```
GET /$export?_since=2024-12-18T10:00:00Z
```

## Monitoring

### View Logs

```bash
docker-compose logs -f medplum-server | grep "\[EHR"
```

### Expected Log Output

```
[EHRSyncScheduler] Starting EHR sync service with 24 hour interval
[EHRSyncScheduler] FHIR Base URL: https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4
[EHRSyncScheduler] Auth method: JWT (private_key)
[EHRSyncScheduler] Group ID: abc123 (using group-based export)
[EHRSyncScheduler] Running initial sync on startup...
[EHRSync] Starting EHR data sync...
[EHRSmartClient] Requesting access token...
[EHRSmartClient] Using private_key_jwt authentication
[EHRSmartClient] Successfully obtained access token
[EHRBulkExport] Using group-based export for group: abc123
[EHRBulkExport] Initiating bulk export: https://...
[EHRBulkExport] Export complete with 15 output files
[EHRSync] Processing 150 Patient resources...
[EHRSync] Patient: 150 created, 0 updated, 0 failed
[EHRSync] Sync complete!
```

### Health Check

```typescript
import { getPfSyncHealth } from './integrations/practicefusion';

const health = getPfSyncHealth();
// {
//   enabled: true,
//   healthy: true,
//   lastRun: Date,
//   lastRunSuccess: true,
//   isRunning: false,
//   intervalMs: 86400000
// }
```

## Troubleshooting

### Authentication Failed

```
[EHRSmartClient] Token request failed: 401 Unauthorized
```

**Solutions**:
- Verify credentials are correct
- For JWT auth: Check private key format and key ID
- For Epic: Ensure public key is published to JWKS URL

### Missing Group ID (Epic)

```
[EHRBulkExport] Export kick-off failed: 400 Bad Request
```

**Solution**: Epic requires a group ID. Set `EHR_GROUP_ID` in your configuration.

### Export Timeout

```
[EHRBulkExport] Bulk export timed out after 360 polling attempts
```

**Solutions**:
- Reduce resource types in `EHR_RESOURCE_TYPES`
- Check EHR server status
- Contact EHR support

## File Structure

```
packages/server/src/integrations/practicefusion/
├── README.md                          # This file
├── index.ts                           # Public API exports
├── constants.ts                       # Identifier systems & resource types
├── auth/
│   └── smartClient.ts                 # OAuth2/SMART authentication
├── bulk/
│   └── bulkExportClient.ts            # FHIR Bulk Data Export client
└── services/
    ├── pfSyncScheduler.ts             # Background scheduler
    └── pfSyncWorker.ts                # Sync execution logic
```

## Supported Resource Types

Default resources synced (configurable via `EHR_RESOURCE_TYPES`):

- Patient, Practitioner, Encounter
- Condition, Observation, Procedure
- MedicationRequest, Medication, MedicationStatement
- AllergyIntolerance, Immunization
- DiagnosticReport, DocumentReference
- CarePlan, CareTeam, Goal
- ServiceRequest, Binary

## References

- [FHIR Bulk Data Access IG](https://hl7.org/fhir/uv/bulkdata/)
- [SMART Backend Services](https://hl7.org/fhir/smart-app-launch/backend-services.html)
- [Epic FHIR Documentation](https://fhir.epic.com/)
- [Practice Fusion FHIR API](https://www.practicefusion.com/fhir/)
- [US Core FHIR Profiles](https://www.hl7.org/fhir/us/core/)
