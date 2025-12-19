// SPDX-License-Identifier: Apache-2.0

/**
 * EHR FHIR identifier systems
 * Used to track the source of imported resources for deduplication and updates
 *
 * The base identifier system is configurable via EHR_IDENTIFIER_SYSTEM env var
 * to support different EHR sources (Epic, Practice Fusion, Cerner, etc.)
 */

// Base identifier system - configurable per EHR
// Examples:
//   Epic: https://open.epic.com/fhir
//   Practice Fusion: https://practicefusion.com/fhir
//   Cerner: https://fhir.cerner.com
export const EHR_IDENTIFIER_SYSTEM = process.env.EHR_IDENTIFIER_SYSTEM || 'https://external-ehr.com/fhir';

/**
 * Build resource-specific identifier systems dynamically
 * @param resourceType - The FHIR resource type
 * @returns The identifier system URL for that resource type
 */
export function getResourceIdentifierSystem(resourceType: string): string {
  return `${EHR_IDENTIFIER_SYSTEM}/${resourceType.toLowerCase()}-id`;
}

/**
 * Default resource types to export from EHR
 * Based on US Core profiles commonly supported by EHRs
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

// Legacy exports for backwards compatibility
// @deprecated Use EHR_IDENTIFIER_SYSTEM and getResourceIdentifierSystem() instead
export const PF_IDENTIFIER_SYSTEM = EHR_IDENTIFIER_SYSTEM;
export const PF_RESOURCE_ID_SYSTEMS: Record<string, string> = new Proxy({} as Record<string, string>, {
  get: (_target, prop: string) => getResourceIdentifierSystem(prop),
});
