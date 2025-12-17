// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Title } from '@mantine/core';
import { getAppName, Logo, SignInForm, useMedplum, useMedplumProfile } from '@medplum/react';
import type { Patient } from '@medplum/fhirtypes';
import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { getConfig, isRegisterEnabled } from './utils/config';
import { MedplumPatientSidebar } from './appteonComponents/MedplumPatientSidebar';
import { MedplumPatientDetail } from './appteonComponents/MedplumPatientDetail';

export function RootPage(): JSX.Element {
  const profile = useMedplumProfile();
  const medplum = useMedplum();
  const navigate = useNavigate();
  const config = getConfig();

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

  // If user is not logged in, show the sign-in form
  if (!profile) {
    return (
      <SignInForm
        onSuccess={() => navigate('/')?.catch(console.error)}
        onForgotPassword={() => navigate('/resetpassword')?.catch(console.error)}
        onRegister={isRegisterEnabled() ? () => navigate('/register')?.catch(console.error) : undefined}
        googleClientId={config.googleClientId}
      >
        <Logo size={32} />
        <Title order={3} py="lg">
          Sign in to {getAppName()}
        </Title>
      </SignInForm>
    );
  }

  // If user is logged in, show the patient sidebar and detail
  return (
    <main className="flex h-[calc(100vh-64px)] w-full">
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
    </main>
  );
}
