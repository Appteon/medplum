# Practice Fusion EHR Integration

Automatic synchronization of patient data from Practice Fusion EHR into Medplum using the FHIR Bulk Data Export API.

## Overview

This integration enables **automatic, scheduled synchronization** of clinical data from Practice Fusion's sandbox/production environments into your Medplum database. It runs as a background service within the Medplum server and uses the standard FHIR Bulk Data Access specification.

## Features

- ✅ **Automatic Sync**: Runs on server startup and every 24 hours
- ✅ **Incremental Updates**: Only fetches changed resources after initial sync
- ✅ **Conditional Upsert**: Prevents duplicates using identifier-based matching
- ✅ **Multi-Resource Support**: Syncs 15+ FHIR resource types
- ✅ **Error Resilience**: Continues on individual resource failures
- ✅ **OAuth2 Authentication**: Supports both client_secret and private_key JWT
- ✅ **SMART Backend Services**: Compliant with SMART on FHIR specification
- ✅ **Configurable**: Control sync interval, resource types, and behavior

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    PRACTICE FUSION INTEGRATION                   │
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
│         └──────────▶│   Practice Fusion FHIR API           │  │
│                     │   (Bulk Data Export)                 │  │
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

## Configuration

### Environment Variables

Configure in `docker-compose.yml` or your environment:

```yaml
# Enable/Disable
PF_SYNC_ENABLED: 'true'                # Set to 'true' to enable sync

# Timing
PF_SYNC_INTERVAL_MS: '86400000'        # 24 hours (in milliseconds)
PF_SYNC_RUN_ON_STARTUP: 'true'         # Run initial sync on server start

# Practice Fusion Connection
PF_FHIR_BASE_URL: 'https://api-sandbox.practicefusion.com/fhir/r4/v1'
PF_CLIENT_ID: 'your-client-id'
PF_CLIENT_SECRET: 'your-client-secret' # For client_secret auth

# Optional: JWT Authentication (alternative to client_secret)
# PF_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----'
# PF_KEY_ID: 'your-key-id'

# Optional: Resource Types (comma-separated)
PF_RESOURCE_TYPES: 'Patient,Condition,Observation,MedicationRequest,...'
```

### Supported Resource Types

Default resources synced (configurable via `PF_RESOURCE_TYPES`):

- **Patient** - Demographics and identifiers
- **Practitioner** - Healthcare providers
- **Encounter** - Visits and appointments
- **Condition** - Problems and diagnoses
- **Observation** - Vitals, labs, social history
- **MedicationRequest** - Prescriptions
- **Medication** - Medication definitions
- **MedicationStatement** - Medication usage
- **AllergyIntolerance** - Allergies and sensitivities
- **Immunization** - Vaccinations
- **Procedure** - Procedures and surgeries
- **DiagnosticReport** - Lab and imaging reports
- **DocumentReference** - Clinical documents
- **CarePlan** - Care plans
- **ServiceRequest** - Orders and referrals
- **Binary** - Attached files

## How It Works

### 1. Server Startup

When the Medplum server starts (`docker-compose up -d`):

```typescript
// app.ts:179
initializePfSyncScheduler();
```

The scheduler:
1. ✅ Validates configuration (FHIR URL, credentials)
2. ✅ Runs initial sync if `PF_SYNC_RUN_ON_STARTUP=true`
3. ✅ Schedules recurring sync every `PF_SYNC_INTERVAL_MS`

### 2. Sync Workflow

#### Step 1: Authentication
```
POST https://api-sandbox.practicefusion.com/oauth/token
Authorization: Basic <base64(client_id:client_secret)>
Body: grant_type=client_credentials
      scope=system/Patient.read system/Condition.read ...

Response: { access_token: "eyJ...", expires_in: 3600 }
```

#### Step 2: Bulk Export Kick-off
```
GET https://api-sandbox.practicefusion.com/fhir/r4/v1/$export
    ?_type=Patient,Condition,Observation,...
    &_since=2024-12-18T10:00:00Z  (only for incremental syncs)
    &_outputFormat=application/fhir+ndjson
Authorization: Bearer eyJ...
Prefer: respond-async

Response: HTTP 202 Accepted
Content-Location: https://.../status/abc123
```

#### Step 3: Poll for Completion
```
GET https://.../status/abc123
Authorization: Bearer eyJ...

While HTTP 202: Still processing...
When HTTP 200: {
  "transactionTime": "2024-12-18T14:30:00Z",
  "output": [
    { "type": "Patient", "url": "https://.../patient.ndjson" },
    { "type": "Condition", "url": "https://.../condition.ndjson" },
    ...
  ]
}
```

#### Step 4: Download NDJSON Files
```
GET https://.../patient.ndjson
Authorization: Bearer eyJ...

Response (newline-delimited JSON):
{"resourceType":"Patient","id":"pf-123",...}
{"resourceType":"Patient","id":"pf-456",...}
{"resourceType":"Patient","id":"pf-789",...}
```

#### Step 5: Conditional Upsert to Medplum
```
POST /fhir/R4
{
  "resourceType": "Bundle",
  "type": "batch",
  "entry": [
    {
      "resource": { /* Patient from Practice Fusion */ },
      "request": {
        "method": "PUT",
        "url": "Patient?identifier=https://practicefusion.com/fhir/patient-id|pf-123"
      }
    }
  ]
}
```

**Conditional Update Logic:**
- If a Patient with `identifier=pf-123` exists → **UPDATE** (HTTP 200)
- If not → **CREATE** new Patient (HTTP 201)
- **No duplicates!**

#### Step 6: Save Sync State
```
Create/Update Parameters resource:
{
  "resourceType": "Parameters",
  "parameter": [
    { "name": "lastSyncTime", "valueDateTime": "2024-12-18T14:30:00Z" }
  ]
}
```

This timestamp is used for the next sync's `_since` parameter.

### 3. Incremental Sync (Subsequent Runs)

After the initial sync, subsequent syncs use the `_since` parameter:

```
GET /$export?_type=...&_since=2024-12-18T14:30:00Z
```

Practice Fusion only returns resources **modified after** the last sync:
- ⚡ Much faster
- 💾 Less data transfer
- 🔄 True incremental updates

## Data Storage

Each resource from Practice Fusion is stored in Medplum with:

1. **Original FHIR data** (preserved from Practice Fusion)
2. **Medplum-assigned ID** (UUID)
3. **Practice Fusion identifier** (for tracking):

```json
{
  "resourceType": "Patient",
  "id": "a1b2c3d4-...",  // Medplum ID
  "identifier": [
    {
      "system": "https://practicefusion.com/fhir/patient-id",
      "value": "pf-12345"  // Practice Fusion ID
    }
  ],
  "name": [...],
  "gender": "male",
  ...
}
```

This identifier ensures:
- ✅ No duplicates on re-sync
- ✅ Updates existing records
- ✅ Maintains link to source system

## Authentication Methods

### Method 1: Client Secret (Recommended for Sandbox)

Simple OAuth2 client credentials with client secret:

```yaml
PF_CLIENT_ID: '5d068de1-4cb1-45bf-b9ff-09fa51669ef8'
PF_CLIENT_SECRET: '4uRSYIg0f955uhwG480npbBiwk3argUkck5IKH+eC68='
```

**How it works:**
```
POST /token
Authorization: Basic <base64(client_id:client_secret)>
Body: grant_type=client_credentials
```

### Method 2: Private Key JWT (SMART Backend Services)

More secure, required for production:

```yaml
PF_CLIENT_ID: '5d068de1-4cb1-45bf-b9ff-09fa51669ef8'
PF_PRIVATE_KEY: |
  -----BEGIN PRIVATE KEY-----
  MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC...
  -----END PRIVATE KEY-----
PF_KEY_ID: 'my-key-id'
```

**How it works:**
1. Generate JWT signed with your private key
2. Send JWT as `client_assertion` in token request
3. Practice Fusion validates using your public key from JWKS URL

The code automatically detects which method to use based on configuration.

## Monitoring

### View Logs

```bash
docker-compose logs -f medplum-server | grep "\[PF"
```

### Expected Log Output

```
[PFSyncScheduler] Starting Practice Fusion sync service with 24 hour interval
[PFSyncScheduler] Running initial sync on startup...
[PFSyncWorker] Starting Practice Fusion sync...
[PFSyncWorker] Last sync time: never (initial sync)
[PFSyncWorker] Discovering SMART endpoints...
[PFSyncWorker] Token endpoint: https://.../token
[PFSmartClient] Requesting access token from Practice Fusion...
[PFSmartClient] Using client_secret authentication
[PFSmartClient] Successfully obtained access token
[PFBulkExport] Initiating bulk export: https://.../$export?_type=...
[PFBulkExport] Export initiated, status URL: https://.../status/abc123
[PFBulkExport] Export in progress (attempt 1/360)
[PFBulkExport] Export in progress (attempt 2/360), progress: 25%
[PFBulkExport] Export complete with 15 output files
[PFBulkExport] Downloading NDJSON file: https://.../patient.ndjson
[PFBulkExport] Parsed 150 resources from file
[PFSyncWorker] Processing 150 Patient resources...
[PFSyncWorker] Patient: 150 created, 0 updated, 0 failed
[PFSyncWorker] Processing 423 Condition resources...
[PFSyncWorker] Condition: 423 created, 0 updated, 0 failed
...
[PFSyncWorker] Updated sync state: 2024-12-18T14:35:00Z
[PFSyncWorker] Sync complete!
[PFSyncWorker] Stats: {"created":1250,"updated":0,"failed":0,...}
[PFSyncScheduler] Sync completed successfully at 2024-12-18T14:35:00Z
```

### Health Check

Get sync status programmatically:

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

### Manual Trigger

Trigger a sync manually (e.g., for testing):

```typescript
import { triggerManualSync } from './integrations/practicefusion';

const result = await triggerManualSync();
// { success: true } or { success: false, error: "..." }
```

## Error Handling

### Common Issues

#### 1. Authentication Failed
```
[PFSmartClient] Token request failed: 401 Unauthorized
```

**Solutions:**
- Verify `PF_CLIENT_ID` and `PF_CLIENT_SECRET` are correct
- Check if credentials are expired
- Ensure Practice Fusion app is authorized

#### 2. Bulk Export Timeout
```
[PFBulkExport] Bulk export timed out after 360 polling attempts
```

**Solutions:**
- Increase `maxPollingAttempts` in `bulkExportClient.ts`
- Reduce number of resource types in `PF_RESOURCE_TYPES`
- Contact Practice Fusion support

#### 3. Resource Upsert Failures
```
[PFSyncWorker] Failed to upsert resource: 422 Unprocessable Entity
```

**Solutions:**
- Check resource validation errors in logs
- Verify FHIR resource structure from Practice Fusion
- Check for required fields in resource

### Resilience Features

- **Continue on Failure**: Individual resource failures don't stop the sync
- **Batch Processing**: Processes 100 resources at a time to avoid overwhelming DB
- **Retry Logic**: Token requests have built-in retry
- **Graceful Shutdown**: Properly stops scheduler on server shutdown

## Development

### Testing the Integration

1. **Enable in docker-compose.yml:**
   ```yaml
   PF_SYNC_ENABLED: 'true'
   PF_SYNC_RUN_ON_STARTUP: 'true'  # For immediate testing
   ```

2. **Build and restart:**
   ```bash
   cd /home/ubuntu/medplum
   npm run build
   docker-compose down
   docker-compose up -d
   ```

3. **Watch logs:**
   ```bash
   docker-compose logs -f medplum-server | grep PF
   ```

### Code Organization

- **Scheduler** (`pfSyncScheduler.ts`): Timer-based execution
- **Worker** (`pfSyncWorker.ts`): Core sync logic
- **Auth Client** (`smartClient.ts`): OAuth2/SMART authentication
- **Bulk Export** (`bulkExportClient.ts`): FHIR Bulk Data API
- **Constants** (`constants.ts`): Identifier systems

### Extending the Integration

#### Add More Resource Types

1. Update `constants.ts`:
   ```typescript
   export const PF_MY_RESOURCE_ID_SYSTEM =
     `${PF_IDENTIFIER_SYSTEM}/my-resource-id`;

   export const PF_RESOURCE_ID_SYSTEMS = {
     ...
     MyResource: PF_MY_RESOURCE_ID_SYSTEM,
   };
   ```

2. Update scopes in `smartClient.ts`:
   ```typescript
   const scopes = [
     ...
     'system/MyResource.read',
   ].join(' ');
   ```

3. Add to `docker-compose.yml`:
   ```yaml
   PF_RESOURCE_TYPES: '...,MyResource'
   ```

#### Change Sync Interval

```yaml
PF_SYNC_INTERVAL_MS: '3600000'  # 1 hour
# or
PF_SYNC_INTERVAL_MS: '604800000'  # 7 days
```

## Security Considerations

1. **Credentials**: Never commit credentials to version control
2. **HTTPS**: Always use HTTPS for Practice Fusion endpoints
3. **Access Tokens**: Tokens are cached and auto-refreshed
4. **Scopes**: Request minimal necessary scopes
5. **Audit**: All syncs are logged with timestamps

## Production Checklist

Before going to production:

- [ ] Switch to Production FHIR URL
- [ ] Use production credentials
- [ ] Consider using Private Key JWT instead of client secret
- [ ] Set appropriate `PF_SYNC_INTERVAL_MS` (e.g., daily)
- [ ] Set `PF_SYNC_RUN_ON_STARTUP: 'false'` to avoid startup delays
- [ ] Monitor logs for errors
- [ ] Set up alerting for sync failures
- [ ] Test incremental sync behavior
- [ ] Verify data quality in Medplum

## References

- [FHIR Bulk Data Access IG](https://hl7.org/fhir/uv/bulkdata/)
- [SMART Backend Services](https://hl7.org/fhir/smart-app-launch/backend-services.html)
- [Practice Fusion FHIR API](https://www.practicefusion.com/fhir/)
- [US Core FHIR Profiles](https://www.hl7.org/fhir/us/core/)

## Support

For issues or questions:
- Check logs: `docker-compose logs -f medplum-server | grep PF`
- Review this README
- Check Practice Fusion developer documentation
- Contact Medplum support: hello@medplum.com
