// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { Patient } from '@medplum/fhirtypes';
import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { useMedplum, useMedplumProfile } from '@medplum/react';
import { MedplumPatientSidebar } from '../../appteonComponents/MedplumPatientSidebar';
import { MedplumPatientDetail } from '../../appteonComponents/MedplumPatientDetail';
import { RecordingProvider } from '../../appteonComponents/contexts/RecordingContext';

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

export function ReviewPage(): JSX.Element {
  const profile = useMedplumProfile();
  const medplum = useMedplum();

  const isPractitioner = profile?.resourceType === 'Practitioner';
  const isPractitionerRole = (profile as any)?.resourceType === 'PractitionerRole';
  const accessPolicyName = medplum.getAccessPolicy()?.name;
  const isFrontDeskUser = isFrontDesk(profile, accessPolicyName);

  // State for patients and sidebar
  const [patients, setPatients] = useState<Patient[]>([]);
  const [isLoadingPatients, setIsLoadingPatients] = useState(false);
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  // Fetch patients when user is logged in (only for front desk users)
  // For practitioners, the sidebar handles patient fetching via its fallback mechanism
  useEffect(() => {
    if (!profile) {
      return;
    }

    const fetchPatients = async (): Promise<void> => {
      // For practitioners: let the sidebar's fallback handle patient fetching
      // It has more comprehensive query logic and proper filtering
      if (!isFrontDeskUser && (isPractitioner || isPractitionerRole)) {
        setIsLoadingPatients(false);
        return;
      }

      // Front desk: Search all patients, sorted by last updated
      setIsLoadingPatients(true);
      try {
        const patientResources = await medplum.searchResources('Patient', '_sort=-_lastUpdated&_count=100');
        setPatients(patientResources);
        if (patientResources.length > 0 && !selectedPatientId) {
          setSelectedPatientId(patientResources[0].id ?? null);
        }
      } catch (error) {
        console.error('Failed to fetch patients:', error);
        setPatients([]);
      } finally {
        setIsLoadingPatients(false);
      }
    };

    fetchPatients();
  }, [profile, medplum, selectedPatientId, isFrontDeskUser, isPractitioner, isPractitionerRole]);

  if (!profile) {
    return <div>Loading...</div>;
  }

  // Show the patient sidebar and detail
  return (
    <RecordingProvider>
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
    </RecordingProvider>
  );
}
