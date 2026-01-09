// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

import type { Identifier, Patient, Practitioner } from '@medplum/fhirtypes';
import type { MedplumClient } from '@medplum/core';

// EHR identifier system - should match the server-side configuration
// This can be configured via environment variable on the server
export const EHR_IDENTIFIER_SYSTEM = 'https://external-ehr.com/fhir';
export const EHR_PRACTITIONER_ID_SYSTEM = `${EHR_IDENTIFIER_SYSTEM}/practitioner-id`;

// Appteon linking identifier - used to track which practitioners have been linked
export const APPTEON_LINKED_PRACTITIONER_SYSTEM = 'https://appteon.com/linked-practitioner';

/**
 * Get the EHR identifier from a practitioner's identifier array
 */
export function getEhrIdentifier(practitioner: Practitioner): Identifier | undefined {
  return practitioner.identifier?.find((id) => id.system === EHR_PRACTITIONER_ID_SYSTEM);
}

/**
 * Get the Appteon linked identifier from a practitioner's identifier array
 */
export function getAppteonLinkedIdentifier(practitioner: Practitioner): Identifier | undefined {
  return practitioner.identifier?.find((id) => id.system === APPTEON_LINKED_PRACTITIONER_SYSTEM);
}

/**
 * Get all Appteon linked identifiers from a practitioner's identifier array
 */
export function getAppteonLinkedIdentifiers(practitioner: Practitioner): Identifier[] {
  return (
    practitioner.identifier?.filter((id) => id.system === APPTEON_LINKED_PRACTITIONER_SYSTEM) || []
  );
}

/**
 * Check if a practitioner has an EHR identifier
 */
export function hasEhrIdentifier(practitioner: Practitioner): boolean {
  return getEhrIdentifier(practitioner) !== undefined;
}

/**
 * Check if a practitioner has been linked (has Appteon linked identifier)
 */
export function isLinked(practitioner: Practitioner): boolean {
  return getAppteonLinkedIdentifier(practitioner) !== undefined;
}

/**
 * Check if a practitioner has a ProjectMembership (can login to Medplum)
 */
export async function checkProjectMembership(
  medplum: MedplumClient,
  practitionerId: string
): Promise<boolean> {
  try {
    const memberships = await medplum.searchResources('ProjectMembership', {
      profile: `Practitioner/${practitionerId}`,
      _count: '1',
    });
    return memberships.length > 0;
  } catch {
    return false;
  }
}

/**
 * Categorized practitioner lists
 */
export interface CategorizedPractitioners {
  ehrPractitioners: Practitioner[]; // From EHR sync, no login capability
  medplumPractitioners: Practitioner[]; // Created in Medplum, can login
  linkedPractitioners: Practitioner[]; // Has both EHR identifier and login
}

/**
 * Check if a practitioner looks like it came from an external system
 * This is more flexible than checking for a specific EHR identifier system
 */
function looksLikeExternalPractitioner(practitioner: Practitioner): boolean {
  // If it has our Appteon linked identifier, it's already linked
  if (isLinked(practitioner)) {
    return false;
  }

  // Check if it has the specific EHR identifier we're looking for
  if (hasEhrIdentifier(practitioner)) {
    return true;
  }

  // Check for other common EHR identifier systems
  const hasExternalIdentifier = practitioner.identifier?.some((id) => {
    const system = id.system?.toLowerCase() || '';
    // Look for identifiers that suggest external systems
    return (
      system.includes('external') ||
      system.includes('/fhir') ||
      system.includes('epic') ||
      system.includes('cerner') ||
      system.includes('practicefusion') ||
      system.includes('allscripts')
    );
  });

  return !!hasExternalIdentifier;
}

/**
 * Categorize all practitioners into EHR-only, Medplum-only, and linked
 */
export async function categorizePractitioners(
  medplum: MedplumClient
): Promise<CategorizedPractitioners> {
  // Fetch all practitioners
  const allPractitioners = await medplum.searchResources('Practitioner', {
    _count: '1000',
  });

  console.log(`[PractitionerLinking] Found ${allPractitioners.length} total practitioners`);

  // Fetch all project memberships with Practitioner profiles in one batch
  const memberships = await medplum.searchResources('ProjectMembership', {
    'profile-type': 'Practitioner',
    _count: '1000',
  });

  console.log(`[PractitionerLinking] Found ${memberships.length} practitioner memberships`);

  // Build a set of practitioner IDs that have memberships
  const practitionerIdsWithMembership = new Set<string>();
  for (const membership of memberships) {
    const profileRef = membership.profile?.reference;
    if (profileRef?.startsWith('Practitioner/')) {
      practitionerIdsWithMembership.add(profileRef.replace('Practitioner/', ''));
    }
  }

  const ehrPractitioners: Practitioner[] = [];
  const medplumPractitioners: Practitioner[] = [];
  const linkedPractitioners: Practitioner[] = [];

  for (const p of allPractitioners) {
    const hasLinkedId = isLinked(p);
    const hasMembership = practitionerIdsWithMembership.has(p.id || '');
    const looksExternal = looksLikeExternalPractitioner(p);

    // Filter out admin and frontdesk roles (check for role identifier)
    const isAdminOrFrontDesk = p.identifier?.some(
      (id) => id.system === 'role' && (id.value === 'admin' || id.value === 'front-desk')
    );

    if (isAdminOrFrontDesk) {
      // Skip admin and frontdesk roles
      continue;
    }

    if (hasLinkedId && hasMembership) {
      // Linked Medplum practitioner (has both login and Appteon linked identifier)
      linkedPractitioners.push(p);
    } else if (hasLinkedId && !hasMembership) {
      // This is a linked EHR practitioner (has Appteon link but no login)
      // Don't show it anywhere - it's now hidden until unlinked
      continue;
    } else if (hasMembership) {
      // Medplum practitioner (has login, not linked yet)
      medplumPractitioners.push(p);
    } else if (looksExternal) {
      // EHR practitioner (looks like external system, no login, not linked)
      ehrPractitioners.push(p);
    } else {
      // Practitioner with no membership and no external identifier
      // Could be a practitioner created manually but not given login yet
      // Treat as potential EHR practitioner
      ehrPractitioners.push(p);
    }
  }

  console.log(`[PractitionerLinking] Categorized: ${ehrPractitioners.length} EHR, ${medplumPractitioners.length} Medplum, ${linkedPractitioners.length} linked`);

  return { ehrPractitioners, medplumPractitioners, linkedPractitioners };
}

/**
 * Link a Medplum practitioner to an EHR practitioner
 * This adds the EHR identifiers and Appteon linked identifier to the Medplum practitioner and reassigns all patients
 */
export async function linkPractitioners(
  medplum: MedplumClient,
  medplumPractitionerId: string,
  ehrPractitionerId: string
): Promise<{ patientsReassigned: number }> {
  // 1. Get both practitioners
  const [medplumPractitioner, ehrPractitioner] = await Promise.all([
    medplum.readResource('Practitioner', medplumPractitionerId),
    medplum.readResource('Practitioner', ehrPractitionerId),
  ]);

  // 2. Get all identifiers from the EHR practitioner (except role identifiers)
  const ehrIdentifiers =
    ehrPractitioner.identifier?.filter((id) => id.system !== 'role' && id.system !== APPTEON_LINKED_PRACTITIONER_SYSTEM) ||
    [];

  console.log(`[PractitionerLinking] Linking practitioners - found ${ehrIdentifiers.length} EHR identifiers`);

  // 3. Build merged identifiers with de-duplication (system+value key)
  const existingIds = medplumPractitioner.identifier || [];
  const byKey = new Map<string, Identifier>();

  const makeKey = (id?: Identifier): string => `${id?.system ?? ''}|${id?.value ?? ''}`;

  // Seed with existing identifiers
  for (const id of existingIds) {
    byKey.set(makeKey(id), id);
  }

  // Add EHR identifiers (excluding role and appteon-linked system which is added separately)
  for (const id of ehrIdentifiers) {
    const key = makeKey(id);
    if (!byKey.has(key)) {
      byKey.set(key, id);
    }
  }

  // 4. Ensure an Appteon linked identifier exists for this EHR practitioner
  // Always update to store the name in the type.text field
  const ehrName = getPractitionerDisplayName(ehrPractitioner);
  const appteonKey = `${APPTEON_LINKED_PRACTITIONER_SYSTEM}|${ehrPractitionerId}`;
  // Always set/update to ensure name is stored
  byKey.set(appteonKey, {
    system: APPTEON_LINKED_PRACTITIONER_SYSTEM,
    value: ehrPractitionerId,
    type: { text: ehrName }, // Store the name for display purposes
  });

  const updatedMedplumPractitioner: Practitioner = {
    ...medplumPractitioner,
    identifier: Array.from(byKey.values()),
  };
  await medplum.updateResource(updatedMedplumPractitioner);

  console.log(`[PractitionerLinking] Updated Medplum practitioner ${medplumPractitionerId} with ${ehrIdentifiers.length} identifiers`);

  // 5. Reassign all patients from EHR practitioner to Medplum practitioner
  const patientsReassigned = await reassignPatients(
    medplum,
    `Practitioner/${ehrPractitionerId}`,
    `Practitioner/${medplumPractitionerId}`
  );

  console.log(`[PractitionerLinking] Reassigned ${patientsReassigned} patients`);

  // 6. Mark the EHR practitioner as linked by adding the Appteon identifier to it as well
  // This way it won't show in the unlinked list, but can be unlinked later
  // Re-use the ehrName from earlier
  const updatedEhrPractitioner: Practitioner = {
    ...ehrPractitioner,
    identifier: [
      ...(ehrPractitioner.identifier || []),
      {
        system: APPTEON_LINKED_PRACTITIONER_SYSTEM,
        value: medplumPractitionerId, // Store the Medplum practitioner ID for reverse lookup
        type: { text: ehrName },
      },
    ],
  };
  await medplum.updateResource(updatedEhrPractitioner);

  console.log(`[PractitionerLinking] Marked EHR practitioner ${ehrPractitionerId} as linked`);

  return { patientsReassigned };
}

/**
 * Unlink a practitioner by removing its EHR identifier and Appteon linked identifier
 * Note: This does NOT restore the original EHR practitioner or reassign patients back
 */
export async function unlinkPractitioner(
  medplum: MedplumClient,
  practitionerId: string
): Promise<void> {
  const practitioner = await medplum.readResource('Practitioner', practitionerId);

  // Remove both the EHR identifier and Appteon linked identifier
  const updatedPractitioner: Practitioner = {
    ...practitioner,
    identifier: practitioner.identifier?.filter(
      (id) => id.system !== EHR_PRACTITIONER_ID_SYSTEM && id.system !== APPTEON_LINKED_PRACTITIONER_SYSTEM
    ),
  };

  await medplum.updateResource(updatedPractitioner);
}

/**
 * Unlink a specific EHR practitioner from a Medplum practitioner
 * Removes the Appteon linked identifier from both practitioners
 */
export async function unlinkSpecificEhrPractitioner(
  medplum: MedplumClient,
  medplumPractitionerId: string,
  ehrPractitionerId: string
): Promise<void> {
  // Remove from Medplum practitioner
  const medplumPractitioner = await medplum.readResource('Practitioner', medplumPractitionerId);
  const updatedMedplumPractitioner: Practitioner = {
    ...medplumPractitioner,
    identifier: medplumPractitioner.identifier?.filter(
      (id) => !(id.system === APPTEON_LINKED_PRACTITIONER_SYSTEM && id.value === ehrPractitionerId)
    ),
  };
  await medplum.updateResource(updatedMedplumPractitioner);

  // Remove from EHR practitioner to make it appear in unlinked list again
  try {
    const ehrPractitioner = await medplum.readResource('Practitioner', ehrPractitionerId);
    const updatedEhrPractitioner: Practitioner = {
      ...ehrPractitioner,
      identifier: ehrPractitioner.identifier?.filter(
        (id) => !(id.system === APPTEON_LINKED_PRACTITIONER_SYSTEM && id.value === medplumPractitionerId)
      ),
    };
    await medplum.updateResource(updatedEhrPractitioner);
  } catch (error) {
    // EHR practitioner might not exist if it was deleted in an older version of the code
    console.warn(`Could not unlink EHR practitioner ${ehrPractitionerId} (may have been deleted):`, error);
  }
}

/**
 * Reassign patients from one practitioner to another
 */
export async function reassignPatients(
  medplum: MedplumClient,
  fromPractitionerRef: string,
  toPractitionerRef: string
): Promise<number> {
  // Find all patients with generalPractitioner pointing to old practitioner
  const patients = await medplum.searchResources('Patient', {
    'general-practitioner': fromPractitionerRef,
    _count: '1000',
  });

  let updated = 0;
  for (const patient of patients) {
    // Update generalPractitioner reference
    const updatedPatient: Patient = {
      ...patient,
      generalPractitioner: patient.generalPractitioner?.map((gp) =>
        gp.reference === fromPractitionerRef ? { ...gp, reference: toPractitionerRef } : gp
      ),
    };

    await medplum.updateResource(updatedPatient);
    updated++;
  }

  return updated;
}

/**
 * Fetch practitioners with login capability (ProjectMembership)
 * Filters out admin and frontdesk roles
 */
export async function fetchPractitionersWithLogin(medplum: MedplumClient): Promise<Practitioner[]> {
  // Fetch all practitioners
  const allPractitioners = await medplum.searchResources('Practitioner', {
    _count: '1000',
  });

  // Fetch all project memberships with Practitioner profiles
  const memberships = await medplum.searchResources('ProjectMembership', {
    'profile-type': 'Practitioner',
    _count: '1000',
  });

  // Build a set of practitioner IDs that have memberships
  const practitionerIdsWithMembership = new Set<string>();
  for (const membership of memberships) {
    const profileRef = membership.profile?.reference;
    if (profileRef?.startsWith('Practitioner/')) {
      practitionerIdsWithMembership.add(profileRef.replace('Practitioner/', ''));
    }
  }

  // Filter practitioners with login and exclude admin/frontdesk
  return allPractitioners.filter((p) => {
    const hasMembership = practitionerIdsWithMembership.has(p.id || '');
    const isAdminOrFrontDesk = p.identifier?.some(
      (id) => id.system === 'role' && (id.value === 'admin' || id.value === 'front-desk')
    );
    return hasMembership && !isAdminOrFrontDesk;
  });
}

/**
 * Fetch patients with no generalPractitioner assigned
 */
export async function fetchUnassignedPatients(medplum: MedplumClient): Promise<Patient[]> {
  const patients = await medplum.searchResources('Patient', {
    'general-practitioner:missing': 'true',
    _count: '1000',
  });

  // Additional client-side filtering to ensure truly unassigned patients
  // The FHIR :missing modifier might not work correctly with array fields in all implementations
  return patients.filter((patient) => {
    const gp = patient.generalPractitioner;
    // Check if generalPractitioner is undefined, null, empty array, or has only empty/null references
    if (!gp || gp.length === 0) {
      return true;
    }
    // Consider a patient "assigned" only if there is at least one valid Practitioner reference
    // Some implementations may include Organization references in generalPractitioner; those should not count
    const hasPractitionerRef = gp.some((ref) => !!ref?.reference && ref.reference.startsWith('Practitioner/'));
    return !hasPractitionerRef;
  });
}

/**
 * Assign a patient to a practitioner
 */
export async function assignPatientToPractitioner(
  medplum: MedplumClient,
  patientId: string,
  practitionerId: string
): Promise<void> {
  const patient = await medplum.readResource('Patient', patientId);

  const updatedPatient: Patient = {
    ...patient,
    generalPractitioner: [{ reference: `Practitioner/${practitionerId}` }],
  };

  await medplum.updateResource(updatedPatient);
}

/**
 * Assign multiple patients to a practitioner (bulk operation)
 */
export async function bulkAssignPatients(
  medplum: MedplumClient,
  patientIds: string[],
  practitionerId: string
): Promise<{ success: number; failed: number }> {
  let success = 0;
  let failed = 0;

  for (const patientId of patientIds) {
    try {
      await assignPatientToPractitioner(medplum, patientId, practitionerId);
      success++;
    } catch (error) {
      console.error(`Failed to assign patient ${patientId}:`, error);
      failed++;
    }
  }

  return { success, failed };
}

/**
 * Get display name for a practitioner
 */
export function getPractitionerDisplayName(practitioner: Practitioner): string {
  const name = practitioner.name?.[0];
  if (name) {
    const given = name.given?.join(' ') || '';
    const family = name.family || '';
    const prefix = name.prefix?.join(' ') || '';
    return [prefix, given, family].filter(Boolean).join(' ').trim() || 'Unknown';
  }
  return 'Unknown';
}

/**
 * Get display name for a patient
 */
export function getPatientDisplayName(patient: Patient): string {
  const name = patient.name?.[0];
  if (name) {
    const given = name.given?.join(' ') || '';
    const family = name.family || '';
    return [given, family].filter(Boolean).join(' ').trim() || 'Unknown';
  }
  return 'Unknown';
}

/**
 * Get patient count for a practitioner
 */
export async function getPatientCount(medplum: MedplumClient, practitionerId: string): Promise<number> {
  try {
    const patients = await medplum.searchResources('Patient', {
      'general-practitioner': `Practitioner/${practitionerId}`,
      _count: '0',
      _summary: 'count',
    });
    return patients.length;
  } catch (error) {
    console.error(`Failed to get patient count for practitioner ${practitionerId}:`, error);
    return 0;
  }
}

/**
 * Get patient counts for multiple practitioners
 */
export async function getPatientCounts(
  medplum: MedplumClient,
  practitionerIds: string[]
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();

  // Fetch counts in parallel
  await Promise.all(
    practitionerIds.map(async (id) => {
      const count = await getPatientCount(medplum, id);
      counts.set(id, count);
    })
  );

  return counts;
}

/**
 * Repair linked practitioners by fetching names from patient references
 * This is useful for practitioners that were linked before name storage was implemented
 */
export async function repairLinkedPractitionerNames(
  medplum: MedplumClient,
  medplumPractitionerId: string
): Promise<number> {
  const medplumPractitioner = await medplum.readResource('Practitioner', medplumPractitionerId);
  const linkedIds = getAppteonLinkedIdentifiers(medplumPractitioner);
  
  let updated = 0;
  const updatedIdentifiers = [...(medplumPractitioner.identifier || [])];
  
  for (const linkedId of linkedIds) {
    // If it already has a name, skip it
    if (linkedId.type?.text) {
      continue;
    }
    
    const ehrPractitionerId = linkedId.value;
    if (!ehrPractitionerId) {
      continue;
    }
    
    // Try to find the name from a patient's generalPractitioner reference
    // Since the EHR practitioner was deleted, we need to check if we stored it anywhere
    // For now, we'll try to fetch from the identifier value itself if it looks like a FHIR resource
    try {
      // Check if there's a patient that references this old practitioner ID
      // Note: The EHR practitioner was deleted, so we can't fetch its name directly
      // For existing links without names, we'll use a shortened ID format
      
      // Update the identifier in place
      const index = updatedIdentifiers.findIndex(
        (id) => id.system === APPTEON_LINKED_PRACTITIONER_SYSTEM && id.value === ehrPractitionerId
      );
      
      if (index !== -1) {
        // Use a shortened ID format as placeholder
        updatedIdentifiers[index] = {
          ...updatedIdentifiers[index],
          type: { text: `Practitioner ${ehrPractitionerId.substring(0, 8)}...` },
        };
        updated++;
      }
    } catch (error) {
      console.error(`Failed to repair name for ${ehrPractitionerId}:`, error);
    }
  }
  
  if (updated > 0) {
    await medplum.updateResource({
      ...medplumPractitioner,
      identifier: updatedIdentifiers,
    });
  }
  
  return updated;
}
