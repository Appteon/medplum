/**
 * Frontend Audit Logging Utility
 *
 * This utility creates FHIR AuditEvent resources for tracking user actions
 * in the frontend application. It follows Medplum's audit logging patterns
 * and FHIR R4 AuditEvent specifications.
 *
 * @see https://www.hl7.org/fhir/auditevent.html
 * @see packages/server/src/util/auditevent.ts
 */

import type { MedplumClient } from '@medplum/core';
import { createReference } from '@medplum/core';
import type { AuditEvent, AuditEventAgent, Coding, Patient, Reference, Resource } from '@medplum/fhirtypes';

/**
 * Code systems for audit events
 */
const DICOM_CODE_SYSTEM = 'http://dicom.nema.org/resources/ontology/DCM';
const AUDIT_EVENT_TYPE_SYSTEM = 'http://terminology.hl7.org/CodeSystem/audit-event-type';
const RESTFUL_ACTION_SYSTEM = 'http://hl7.org/fhir/restful-interaction';
const APPTEON_CODE_SYSTEM = 'https://appteon.ai/fhir/CodeSystem/audit-event-type';

/**
 * Standard audit event types
 */
export const AuditEventTypes = {
  /** User authentication events (login/logout) */
  UserAuthentication: {
    system: DICOM_CODE_SYSTEM,
    code: '110114',
    display: 'User Authentication',
  } as Coding,
  /** RESTful operation events */
  RestfulOperation: {
    system: AUDIT_EVENT_TYPE_SYSTEM,
    code: 'rest',
    display: 'Restful Operation',
  } as Coding,
  /** Application activity events */
  ApplicationActivity: {
    system: DICOM_CODE_SYSTEM,
    code: '110100',
    display: 'Application Activity',
  } as Coding,
  /** Patient record access events */
  PatientRecordAccess: {
    system: DICOM_CODE_SYSTEM,
    code: '110110',
    display: 'Patient Record',
  } as Coding,
};

/**
 * Custom audit event subtypes for Appteon-specific actions
 */
export const AuditEventSubtypes = {
  // Navigation events
  Navigation: { system: APPTEON_CODE_SYSTEM, code: 'navigation', display: 'Navigation' } as Coding,
  TileClick: { system: APPTEON_CODE_SYSTEM, code: 'tile-click', display: 'Tile Click' } as Coding,

  // Patient selection
  PatientSelect: { system: APPTEON_CODE_SYSTEM, code: 'patient-select', display: 'Patient Select' } as Coding,
  PatientView: { system: APPTEON_CODE_SYSTEM, code: 'patient-view', display: 'Patient View' } as Coding,
  PatientSearch: { system: APPTEON_CODE_SYSTEM, code: 'patient-search', display: 'Patient Search' } as Coding,

  // Recording events
  RecordingStart: { system: APPTEON_CODE_SYSTEM, code: 'recording-start', display: 'Recording Start' } as Coding,
  RecordingStop: { system: APPTEON_CODE_SYSTEM, code: 'recording-stop', display: 'Recording Stop' } as Coding,
  RecordingPause: { system: APPTEON_CODE_SYSTEM, code: 'recording-pause', display: 'Recording Pause' } as Coding,
  RecordingResume: { system: APPTEON_CODE_SYSTEM, code: 'recording-resume', display: 'Recording Resume' } as Coding,
  RecordingCancel: { system: APPTEON_CODE_SYSTEM, code: 'recording-cancel', display: 'Recording Cancel' } as Coding,
  RecordingDelete: { system: APPTEON_CODE_SYSTEM, code: 'recording-delete', display: 'Recording Delete' } as Coding,

  // Audio/Transcript events
  AudioPlay: { system: APPTEON_CODE_SYSTEM, code: 'audio-play', display: 'Audio Play' } as Coding,
  TranscriptView: { system: APPTEON_CODE_SYSTEM, code: 'transcript-view', display: 'Transcript View' } as Coding,
  TranscriptCopy: { system: APPTEON_CODE_SYSTEM, code: 'transcript-copy', display: 'Transcript Copy' } as Coding,

  // Note generation events
  ScribeGenerate: { system: APPTEON_CODE_SYSTEM, code: 'scribe-generate', display: 'Scribe Generate' } as Coding,
  SynthesisGenerate: {
    system: APPTEON_CODE_SYSTEM,
    code: 'synthesis-generate',
    display: 'Synthesis Generate',
  } as Coding,
  PreChartGenerate: {
    system: APPTEON_CODE_SYSTEM,
    code: 'pre-chart-generate',
    display: 'Pre-Chart Generate',
  } as Coding,

  // Note editing events
  NoteEdit: { system: APPTEON_CODE_SYSTEM, code: 'note-edit', display: 'Note Edit' } as Coding,
  NoteSave: { system: APPTEON_CODE_SYSTEM, code: 'note-save', display: 'Note Save' } as Coding,
  NoteCopy: { system: APPTEON_CODE_SYSTEM, code: 'note-copy', display: 'Note Copy' } as Coding,

  // Standard RESTful interactions
  Read: { system: RESTFUL_ACTION_SYSTEM, code: 'read', display: 'read' } as Coding,
  Create: { system: RESTFUL_ACTION_SYSTEM, code: 'create', display: 'create' } as Coding,
  Update: { system: RESTFUL_ACTION_SYSTEM, code: 'update', display: 'update' } as Coding,
  Delete: { system: RESTFUL_ACTION_SYSTEM, code: 'delete', display: 'delete' } as Coding,
  Search: { system: RESTFUL_ACTION_SYSTEM, code: 'search', display: 'search' } as Coding,
};

/**
 * Action codes for audit events
 * @see https://www.hl7.org/fhir/valueset-audit-event-action.html
 */
export const AuditEventAction = {
  Create: 'C',
  Read: 'R',
  Update: 'U',
  Delete: 'D',
  Execute: 'E',
} as const;

export type AuditEventActionType = (typeof AuditEventAction)[keyof typeof AuditEventAction];

/**
 * Outcome codes for audit events
 * @see https://www.hl7.org/fhir/valueset-audit-event-outcome.html
 */
export const AuditEventOutcome = {
  Success: '0',
  MinorFailure: '4',
  SeriousFailure: '8',
  MajorFailure: '12',
} as const;

export type AuditEventOutcomeType = (typeof AuditEventOutcome)[keyof typeof AuditEventOutcome];

/**
 * Maps subtype codes to action codes
 */
const subtypeToAction: Record<string, AuditEventActionType | undefined> = {
  // Read actions
  'patient-select': 'R',
  'patient-view': 'R',
  'patient-search': 'R',
  'audio-play': 'R',
  'transcript-view': 'R',
  navigation: 'R',
  'tile-click': 'R',
  read: 'R',
  search: 'R',

  // Create actions
  'recording-start': 'C',
  'scribe-generate': 'C',
  'synthesis-generate': 'C',
  'pre-chart-generate': 'C',
  create: 'C',

  // Update actions
  'recording-stop': 'U',
  'recording-pause': 'U',
  'recording-resume': 'U',
  'note-edit': 'U',
  'note-save': 'U',
  update: 'U',

  // Delete actions
  'recording-cancel': 'D',
  'recording-delete': 'D',
  delete: 'D',

  // Execute actions
  'transcript-copy': 'E',
  'note-copy': 'E',
};

/**
 * Options for creating an audit event
 */
export interface AuditLogOptions {
  /** The type of audit event (defaults to ApplicationActivity) */
  type?: Coding;
  /** The subtype/interaction of the event */
  subtype: Coding;
  /** Outcome of the action */
  outcome?: AuditEventOutcomeType;
  /** Description of the outcome */
  outcomeDesc?: string;
  /** The resource being accessed/modified */
  resource?: Resource | Reference;
  /** Patient context for the action */
  patient?: Patient | Reference<Patient> | string;
  /** Additional description/context */
  description?: string;
  /** Search query if applicable */
  searchQuery?: string;
}

/**
 * AuditLogger class for creating and logging audit events
 */
export class AuditLogger {
  private medplum: MedplumClient;
  private enabled: boolean;

  constructor(medplum: MedplumClient, enabled = true) {
    this.medplum = medplum;
    this.enabled = enabled;
  }

  /**
   * Log an audit event
   */
  async log(options: AuditLogOptions): Promise<AuditEvent | undefined> {
    if (!this.enabled) {
      return undefined;
    }

    try {
      const auditEvent = this.createAuditEvent(options);
      const result = await this.medplum.createResource(auditEvent);
      return result;
    } catch (error) {
      // Don't let audit logging failures disrupt the application
      console.error('[AuditLogger] Failed to log audit event:', error);
      return undefined;
    }
  }

  /**
   * Log an audit event without awaiting (fire-and-forget)
   */
  logAsync(options: AuditLogOptions): void {
    if (!this.enabled) {
      return;
    }

    this.log(options).catch((error) => {
      console.error('[AuditLogger] Failed to log audit event (async):', error);
    });
  }

  /**
   * Create an AuditEvent resource
   */
  private createAuditEvent(options: AuditLogOptions): AuditEvent {
    const profile = this.medplum.getProfile();
    const type = options.type ?? AuditEventTypes.ApplicationActivity;
    const action = subtypeToAction[options.subtype.code ?? ''];

    // Build entity array
    const entity: AuditEvent['entity'] = [];

    if (options.resource) {
      const what =
        'resourceType' in options.resource ? createReference(options.resource as Resource) : options.resource;
      entity.push({ what: what as Reference });
    }

    if (options.patient) {
      let patientRef: Reference<Patient>;
      if (typeof options.patient === 'string') {
        patientRef = { reference: `Patient/${options.patient}` };
      } else if ('resourceType' in options.patient && options.patient.resourceType === 'Patient') {
        patientRef = createReference(options.patient) as Reference<Patient>;
      } else {
        patientRef = options.patient as Reference<Patient>;
      }
      // Only add if not already in entity
      if (!entity.some((e) => e.what?.reference === patientRef.reference)) {
        entity.push({ what: patientRef, role: { system: 'http://terminology.hl7.org/CodeSystem/object-role', code: '1', display: 'Patient' } });
      }
    }

    if (options.searchQuery) {
      entity.push({ query: options.searchQuery });
    }

    const auditEvent: AuditEvent = {
      resourceType: 'AuditEvent',
      type,
      subtype: [options.subtype],
      action,
      recorded: new Date().toISOString(),
      outcome: options.outcome ?? AuditEventOutcome.Success,
      outcomeDesc: options.outcomeDesc ?? options.description,
      agent: [
        {
          who: profile ? (createReference(profile) as AuditEventAgent['who']) : undefined,
          requestor: true,
        },
      ],
      source: {
        observer: {
          identifier: { value: typeof window !== 'undefined' ? window.location.origin : 'unknown' },
        },
      },
      entity: entity.length > 0 ? entity : undefined,
    };

    return auditEvent;
  }

  /**
   * Enable or disable audit logging
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Check if audit logging is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }
}

// Singleton instance holder
let auditLoggerInstance: AuditLogger | null = null;

/**
 * Get or create the AuditLogger instance
 */
export function getAuditLogger(medplum: MedplumClient): AuditLogger {
  if (!auditLoggerInstance) {
    auditLoggerInstance = new AuditLogger(medplum);
  }
  return auditLoggerInstance;
}

/**
 * Convenience function for quick audit logging
 */
export function logAuditEvent(medplum: MedplumClient, options: AuditLogOptions): void {
  getAuditLogger(medplum).logAsync(options);
}

/**
 * Pre-built audit logging functions for common actions
 */
export const AuditActions = {
  /** Log patient selection */
  patientSelect: (medplum: MedplumClient, patientId: string, patientName?: string) => {
    logAuditEvent(medplum, {
      subtype: AuditEventSubtypes.PatientSelect,
      patient: patientId,
      description: patientName ? `Selected patient: ${patientName}` : `Selected patient: ${patientId}`,
    });
  },

  /** Log patient view */
  patientView: (medplum: MedplumClient, patientId: string, patientName?: string) => {
    logAuditEvent(medplum, {
      type: AuditEventTypes.PatientRecordAccess,
      subtype: AuditEventSubtypes.PatientView,
      patient: patientId,
      description: patientName ? `Viewed patient: ${patientName}` : `Viewed patient: ${patientId}`,
    });
  },

  /** Log navigation to a tile/section */
  tileNavigation: (medplum: MedplumClient, tileName: string, href: string) => {
    logAuditEvent(medplum, {
      subtype: AuditEventSubtypes.TileClick,
      description: `Navigated to ${tileName} (${href})`,
    });
  },

  /** Log recording start */
  recordingStart: (medplum: MedplumClient, patientId: string) => {
    logAuditEvent(medplum, {
      subtype: AuditEventSubtypes.RecordingStart,
      patient: patientId,
      description: 'Started audio recording for visit',
    });
  },

  /** Log recording stop */
  recordingStop: (medplum: MedplumClient, patientId: string, durationSeconds?: number) => {
    logAuditEvent(medplum, {
      subtype: AuditEventSubtypes.RecordingStop,
      patient: patientId,
      description: durationSeconds
        ? `Stopped audio recording after ${Math.round(durationSeconds / 60)} minutes`
        : 'Stopped audio recording',
    });
  },

  /** Log recording pause */
  recordingPause: (medplum: MedplumClient, patientId: string) => {
    logAuditEvent(medplum, {
      subtype: AuditEventSubtypes.RecordingPause,
      patient: patientId,
      description: 'Paused audio recording',
    });
  },

  /** Log recording resume */
  recordingResume: (medplum: MedplumClient, patientId: string) => {
    logAuditEvent(medplum, {
      subtype: AuditEventSubtypes.RecordingResume,
      patient: patientId,
      description: 'Resumed audio recording',
    });
  },

  /** Log recording cancel */
  recordingCancel: (medplum: MedplumClient, patientId: string) => {
    logAuditEvent(medplum, {
      subtype: AuditEventSubtypes.RecordingCancel,
      patient: patientId,
      description: 'Cancelled audio recording',
    });
  },

  /** Log recording delete */
  recordingDelete: (medplum: MedplumClient, patientId: string, jobName?: string) => {
    logAuditEvent(medplum, {
      subtype: AuditEventSubtypes.RecordingDelete,
      patient: patientId,
      description: jobName ? `Deleted recording: ${jobName}` : 'Deleted audio recording',
    });
  },

  /** Log audio playback */
  audioPlay: (medplum: MedplumClient, patientId: string, jobName?: string) => {
    logAuditEvent(medplum, {
      subtype: AuditEventSubtypes.AudioPlay,
      patient: patientId,
      description: jobName ? `Played recording: ${jobName}` : 'Played audio recording',
    });
  },

  /** Log transcript view */
  transcriptView: (medplum: MedplumClient, patientId: string, jobName?: string) => {
    logAuditEvent(medplum, {
      subtype: AuditEventSubtypes.TranscriptView,
      patient: patientId,
      description: jobName ? `Viewed transcript: ${jobName}` : 'Viewed visit transcript',
    });
  },

  /** Log transcript copy */
  transcriptCopy: (medplum: MedplumClient, patientId?: string) => {
    logAuditEvent(medplum, {
      subtype: AuditEventSubtypes.TranscriptCopy,
      patient: patientId,
      description: 'Copied transcript to clipboard',
    });
  },

  /** Log scribe note generation */
  scribeGenerate: (medplum: MedplumClient, patientId: string, jobName?: string) => {
    logAuditEvent(medplum, {
      subtype: AuditEventSubtypes.ScribeGenerate,
      patient: patientId,
      description: jobName ? `Generated scribe notes for job: ${jobName}` : 'Generated scribe notes',
    });
  },

  /** Log smart synthesis generation */
  synthesisGenerate: (medplum: MedplumClient, patientId: string) => {
    logAuditEvent(medplum, {
      subtype: AuditEventSubtypes.SynthesisGenerate,
      patient: patientId,
      description: 'Generated smart synthesis notes',
    });
  },

  /** Log pre-chart note generation */
  preChartGenerate: (medplum: MedplumClient, patientId: string) => {
    logAuditEvent(medplum, {
      subtype: AuditEventSubtypes.PreChartGenerate,
      patient: patientId,
      description: 'Generated pre-chart notes',
    });
  },

  /** Log note save */
  noteSave: (medplum: MedplumClient, patientId: string, noteType: 'scribe' | 'synthesis' | 'pre-chart') => {
    logAuditEvent(medplum, {
      subtype: AuditEventSubtypes.NoteSave,
      patient: patientId,
      description: `Saved ${noteType} notes`,
    });
  },

  /** Log note copy */
  noteCopy: (medplum: MedplumClient, patientId?: string, section?: string) => {
    logAuditEvent(medplum, {
      subtype: AuditEventSubtypes.NoteCopy,
      patient: patientId,
      description: section ? `Copied ${section} section to clipboard` : 'Copied notes to clipboard',
    });
  },

  /** Log patient search */
  patientSearch: (medplum: MedplumClient, searchTerm: string) => {
    logAuditEvent(medplum, {
      subtype: AuditEventSubtypes.PatientSearch,
      searchQuery: searchTerm,
      description: `Searched patients: "${searchTerm}"`,
    });
  },
};
