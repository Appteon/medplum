// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { Patient } from '@medplum/fhirtypes';
import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { useMedplum, useMedplumProfile } from '@medplum/react';
import { MedplumPatientSidebar } from '../../appteonComponents/MedplumPatientSidebar';
import { MedplumPatientDetail } from '../../appteonComponents/MedplumPatientDetail';

function isFrontDesk(profile: any, accessPolicyName?: string): boolean {
  if (accessPolicyName?.toLowerCase().includes('front desk') || accessPolicyName?.toLowerCase().includes('frontdesk')) {
    return true;
  }
  if (profile?.identifier) {
    for (const id of profile.identifier) {
      if (id.system === 'role' && id.value === 'front-desk') {
        return true;
      }
    }
  }
  return false;
}

function appointmentHasPractitioner(appointment: any, profile: any): boolean {
  const refs = (appointment?.participant ?? []).map((p: any) => p?.actor?.reference).filter(Boolean);
  if (profile?.resourceType === 'Practitioner' && profile.id) {
    return refs.includes(`Practitioner/${profile.id}`);
  }
  if (profile?.resourceType === 'PractitionerRole' && profile.id) {
    const roleRef = `PractitionerRole/${profile.id}`;
    const practitionerRef = profile.practitioner?.reference;
    return refs.includes(roleRef) || (practitionerRef ? refs.includes(practitionerRef) : false);
  }
  return true;
}

export function ReviewPage(): JSX.Element {
  const profile = useMedplumProfile();
  const medplum = useMedplum();

  const isPractitioner = profile?.resourceType === 'Practitioner';
  const isPractitionerRole = (profile as any)?.resourceType === 'PractitionerRole';
  const roleProfile = profile as any;
  const accessPolicyName = medplum.getAccessPolicy()?.name;
  const isFrontDeskUser = isFrontDesk(profile, accessPolicyName);

  // State for patients and sidebar
  const [patients, setPatients] = useState<Patient[]>([]);
  const [isLoadingPatients, setIsLoadingPatients] = useState(false);
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  // Fetch patients when user is logged in
  useEffect(() => {
    if (!profile) {
      return;
    }

    const fetchPatients = async (): Promise<void> => {
      setIsLoadingPatients(true);
      try {
        // If signed in as a doctor, only show that doctor's patients (derived from appointments)
        if (!isFrontDeskUser && (isPractitioner || isPractitionerRole) && profile?.id) {
          const actors: string[] = [];
          if (isPractitioner && profile.id) {
            actors.push(`Practitioner/${profile.id}`);
          }
          if (isPractitionerRole && profile.id) {
            actors.push(`PractitionerRole/${profile.id}`);
            if (roleProfile?.practitioner?.reference) {
              actors.push(roleProfile.practitioner.reference);
            }
          }

          const appts = await medplum.searchResources('Appointment', {
            actor: actors.join(','),
            _count: '1000',
            _sort: '-date',
          });

          const ownAppts = appts.filter((apt: any) => appointmentHasPractitioner(apt, profile));

          const patientIds = Array.from(
            new Set(
              ownAppts
                .map((apt: any) => apt?.participant)
                .flat()
                .map((p: any) => p?.actor?.reference)
                .filter((ref: any) => typeof ref === 'string' && ref.startsWith('Patient/'))
                .map((ref: string) => ref.split('/')[1])
                .filter(Boolean)
            )
          );

          const patientResources = patientIds.length
            ? await medplum.searchResources('Patient', { _id: patientIds.join(',') })
            : [];

          setPatients(patientResources);

          if (patientResources.length > 0 && !selectedPatientId) {
            setSelectedPatientId(patientResources[0].id ?? null);
          }
        }

        // Default or front desk: Search all patients, sorted by last updated
        if (isFrontDeskUser || !(isPractitioner || isPractitionerRole)) {
          const patientResources = await medplum.searchResources('Patient', '_sort=-_lastUpdated&_count=100');
          setPatients(patientResources);
          if (patientResources.length > 0 && !selectedPatientId) {
            setSelectedPatientId(patientResources[0].id ?? null);
          }
        }
      } catch (error) {
        console.error('Failed to fetch patients:', error);
        setPatients([]);
      } finally {
        setIsLoadingPatients(false);
      }
    };

    fetchPatients();
  }, [profile, medplum, selectedPatientId]);

  if (!profile) {
    return <div>Loading...</div>;
  }

  // Show the patient sidebar and detail
  return (
    <div className="flex h-[calc(100vh-60px)] w-full overflow-hidden">
      <MedplumPatientSidebar
        patients={patients}
        onPatientSelect={setSelectedPatientId}
        isLoading={isLoadingPatients}
        isSidebarCollapsed={isSidebarCollapsed}
        toggleSidebar={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        sidebarTitle="Patients"
        initialSelectedPatientId={selectedPatientId}
      />
      <div className="flex-1 overflow-auto">
        <MedplumPatientDetail selectedPatientId={selectedPatientId} />
      </div>
    </div>
  );
}
