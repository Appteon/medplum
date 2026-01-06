// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { Patient } from '@medplum/fhirtypes';
import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { useMedplum, useMedplumProfile } from '@medplum/react';
import { MedplumPatientSidebar } from '../../appteonComponents/MedplumPatientSidebar';
import { MedplumPatientDetail } from '../../appteonComponents/MedplumPatientDetail';

export function ReviewPage(): JSX.Element {
  const profile = useMedplumProfile();
  const medplum = useMedplum();

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
        // Search for all patients, sorted by last updated
        const patientResources = await medplum.searchResources(
          'Patient',
          '_sort=-_lastUpdated&_count=100'
        );

        setPatients(patientResources);

        // Auto-select first patient if available
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
  }, [profile, medplum, selectedPatientId]);

  if (!profile) {
    return <div>Loading...</div>;
  }

  // Show the patient sidebar and detail
  return (
    <div className="flex h-screen w-full overflow-hidden">
      <MedplumPatientSidebar
        patients={patients}
        onPatientSelect={setSelectedPatientId}
        isLoading={isLoadingPatients}
        isSidebarCollapsed={isSidebarCollapsed}
        toggleSidebar={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        sidebarTitle="Patients"
        initialSelectedPatientId={selectedPatientId}
        showBackButton={true}
      />
      <div className="flex-1 overflow-auto">
        <MedplumPatientDetail selectedPatientId={selectedPatientId} />
      </div>
    </div>
  );
}
