// SPDX-License-Identifier: Apache-2.0
import { createReference } from '@medplum/core';
import type {
  AccessPolicy,
  Practitioner,
  Project,
  ProjectMembership,
  User,
} from '@medplum/fhirtypes';
import { bcryptHashPassword } from '../auth/utils';
import { getSystemRepo } from '../fhir/repo';
import { globalLogger } from '../logger';

/**
 * Front Desk Access Policy
 * This policy allows front desk users to:
 * - Read and create Appointments
 * - Read Patients (limited access)
 * - Read Practitioners
 * - Read Locations
 */
export const FRONT_DESK_ACCESS_POLICY: Omit<AccessPolicy, 'id'> = {
  resourceType: 'AccessPolicy',
  name: 'Front Desk Access Policy',
  resource: [
    {
      resourceType: 'Appointment',
      // Full access to appointments
    },
    {
      resourceType: 'Patient',
      readonly: true,
      // Only read access to patients
    },
    {
      resourceType: 'Practitioner',
      readonly: true,
      // Only read access to practitioners
    },
    {
      resourceType: 'Location',
      readonly: true,
    },
    {
      resourceType: 'Schedule',
      readonly: true,
    },
    {
      resourceType: 'Slot',
      readonly: true,
    },
  ],
};

/**
 * Seeds the Front Desk user and Access Policy
 * Call this function to set up RBAC for front desk users
 */
export async function seedFrontDeskUser(projectId?: string): Promise<void> {
  const systemRepo = getSystemRepo();

  // Check if front desk user already exists
  const existingUser = await systemRepo.searchOne<User>({
    resourceType: 'User',
    filters: [{ code: 'email', operator: 'eq', value: 'frontdesk@example.com' }],
  });

  if (existingUser) {
    globalLogger.info('Front desk user already exists');
    return;
  }

  // Find or create a project to add the front desk user to
  let project: Project | undefined;
  if (projectId) {
    project = await systemRepo.readResource<Project>('Project', projectId);
  } else {
    // Find the first non-super-admin project, or use super admin project
    const projects = await systemRepo.searchResources<Project>({ resourceType: 'Project' });
    project = projects.find((p) => !p.superAdmin) || projects[0];
  }

  if (!project) {
    globalLogger.error('No project found to add front desk user to');
    return;
  }

  await systemRepo.withTransaction(async () => {
    // Create the Access Policy
    const accessPolicy = await systemRepo.createResource<AccessPolicy>({
      ...FRONT_DESK_ACCESS_POLICY,
      meta: {
        project: project.id,
      },
    });

    globalLogger.info('Created Front Desk Access Policy', { id: accessPolicy.id });

    // Create the front desk user
    const email = 'frontdesk@example.com';
    const password = 'password';
    const passwordHash = await bcryptHashPassword(password);

    const user = await systemRepo.createResource<User>({
      resourceType: 'User',
      firstName: 'Front',
      lastName: 'Desk',
      email,
      passwordHash,
    });

    globalLogger.info('Created Front Desk User', { id: user.id, email });

    // Create a Practitioner profile for the front desk user
    const practitioner = await systemRepo.createResource<Practitioner>({
      resourceType: 'Practitioner',
      meta: {
        project: project.id,
      },
      name: [
        {
          given: ['Front'],
          family: 'Desk',
        },
      ],
      telecom: [
        {
          system: 'email',
          use: 'work',
          value: email,
        },
      ],
      identifier: [
        {
          system: 'role',
          value: 'front-desk',
        },
      ],
    });

    globalLogger.info('Created Front Desk Practitioner profile', { id: practitioner.id });

    // Create the project membership with the access policy
    await systemRepo.createResource<ProjectMembership>({
      resourceType: 'ProjectMembership',
      meta: {
        project: project.id,
      },
      project: createReference(project),
      user: createReference(user),
      profile: createReference(practitioner),
      admin: false,
      accessPolicy: createReference(accessPolicy),
    });

    globalLogger.info('Created Front Desk Project Membership with Access Policy');
  });

  globalLogger.info('Front desk user seeding complete');
  globalLogger.info('Login credentials:');
  globalLogger.info('  Email: frontdesk@example.com');
  globalLogger.info('  Password: password');
}

/**
 * Creates a Doctor Access Policy
 * Doctors have full access to clinical resources
 */
export const DOCTOR_ACCESS_POLICY: Omit<AccessPolicy, 'id'> = {
  resourceType: 'AccessPolicy',
  name: 'Doctor Access Policy',
  resource: [
    {
      resourceType: 'Patient',
      // Full access to patients
    },
    {
      resourceType: 'Appointment',
      // Full access to appointments
    },
    {
      resourceType: 'Encounter',
      // Full access to encounters
    },
    {
      resourceType: 'Observation',
      // Full access to observations
    },
    {
      resourceType: 'Condition',
      // Full access to conditions
    },
    {
      resourceType: 'Procedure',
      // Full access to procedures
    },
    {
      resourceType: 'MedicationRequest',
      // Full access to medication requests
    },
    {
      resourceType: 'DocumentReference',
      // Full access to documents
    },
    {
      resourceType: 'DiagnosticReport',
      // Full access to diagnostic reports
    },
    {
      resourceType: 'Practitioner',
      readonly: true,
    },
    {
      resourceType: 'Location',
      readonly: true,
    },
    {
      resourceType: 'Schedule',
    },
    {
      resourceType: 'Slot',
    },
  ],
};
