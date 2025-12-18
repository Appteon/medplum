// SPDX-License-Identifier: Apache-2.0

/**
 * Practice Fusion FHIR identifier systems
 * Used to track the source of imported resources for deduplication and updates
 */

export const PF_IDENTIFIER_SYSTEM = 'https://practicefusion.com/fhir';
export const PF_PATIENT_ID_SYSTEM = `${PF_IDENTIFIER_SYSTEM}/patient-id`;
export const PF_PRACTITIONER_ID_SYSTEM = `${PF_IDENTIFIER_SYSTEM}/practitioner-id`;
export const PF_ENCOUNTER_ID_SYSTEM = `${PF_IDENTIFIER_SYSTEM}/encounter-id`;
export const PF_CONDITION_ID_SYSTEM = `${PF_IDENTIFIER_SYSTEM}/condition-id`;
export const PF_OBSERVATION_ID_SYSTEM = `${PF_IDENTIFIER_SYSTEM}/observation-id`;
export const PF_MEDICATION_REQUEST_ID_SYSTEM = `${PF_IDENTIFIER_SYSTEM}/medication-request-id`;
export const PF_ALLERGY_ID_SYSTEM = `${PF_IDENTIFIER_SYSTEM}/allergy-id`;
export const PF_PROCEDURE_ID_SYSTEM = `${PF_IDENTIFIER_SYSTEM}/procedure-id`;
export const PF_IMMUNIZATION_ID_SYSTEM = `${PF_IDENTIFIER_SYSTEM}/immunization-id`;
export const PF_DIAGNOSTIC_REPORT_ID_SYSTEM = `${PF_IDENTIFIER_SYSTEM}/diagnostic-report-id`;
export const PF_DOCUMENT_REFERENCE_ID_SYSTEM = `${PF_IDENTIFIER_SYSTEM}/document-reference-id`;
export const PF_CARE_PLAN_ID_SYSTEM = `${PF_IDENTIFIER_SYSTEM}/care-plan-id`;
export const PF_CARE_TEAM_ID_SYSTEM = `${PF_IDENTIFIER_SYSTEM}/care-team-id`;
export const PF_GOAL_ID_SYSTEM = `${PF_IDENTIFIER_SYSTEM}/goal-id`;
export const PF_MEDICATION_ID_SYSTEM = `${PF_IDENTIFIER_SYSTEM}/medication-id`;
export const PF_MEDICATION_STATEMENT_ID_SYSTEM = `${PF_IDENTIFIER_SYSTEM}/medication-statement-id`;
export const PF_SERVICE_REQUEST_ID_SYSTEM = `${PF_IDENTIFIER_SYSTEM}/service-request-id`;
export const PF_BINARY_ID_SYSTEM = `${PF_IDENTIFIER_SYSTEM}/binary-id`;

/**
 * Map FHIR resource types to their Practice Fusion identifier systems
 */
export const PF_RESOURCE_ID_SYSTEMS: Record<string, string> = {
  Patient: PF_PATIENT_ID_SYSTEM,
  Practitioner: PF_PRACTITIONER_ID_SYSTEM,
  Encounter: PF_ENCOUNTER_ID_SYSTEM,
  Condition: PF_CONDITION_ID_SYSTEM,
  Observation: PF_OBSERVATION_ID_SYSTEM,
  MedicationRequest: PF_MEDICATION_REQUEST_ID_SYSTEM,
  Medication: PF_MEDICATION_ID_SYSTEM,
  MedicationStatement: PF_MEDICATION_STATEMENT_ID_SYSTEM,
  AllergyIntolerance: PF_ALLERGY_ID_SYSTEM,
  Procedure: PF_PROCEDURE_ID_SYSTEM,
  Immunization: PF_IMMUNIZATION_ID_SYSTEM,
  DiagnosticReport: PF_DIAGNOSTIC_REPORT_ID_SYSTEM,
  DocumentReference: PF_DOCUMENT_REFERENCE_ID_SYSTEM,
  CarePlan: PF_CARE_PLAN_ID_SYSTEM,
  CareTeam: PF_CARE_TEAM_ID_SYSTEM,
  Goal: PF_GOAL_ID_SYSTEM,
  ServiceRequest: PF_SERVICE_REQUEST_ID_SYSTEM,
  Binary: PF_BINARY_ID_SYSTEM,
};

/**
 * Default resource types to export from Practice Fusion
 * Based on US Core profiles supported by Practice Fusion
 */
export const DEFAULT_EXPORT_RESOURCE_TYPES = [
  'Patient',
  'Practitioner',
  'Encounter',
  'Condition',
  'Observation',
  'MedicationRequest',
  'Medication',
  'MedicationStatement',
  'AllergyIntolerance',
  'Procedure',
  'Immunization',
  'DiagnosticReport',
  'DocumentReference',
  'CarePlan',
  'CareTeam',
  'Goal',
  'ServiceRequest',
  'Binary',
];
