// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Group,
  LoadingOverlay,
  SegmentedControl,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { showNotification } from '@mantine/notifications';
import { useMedplum } from '@medplum/react';
import { IconArrowLeft, IconSearch } from '@tabler/icons-react';
import type { Patient, Practitioner } from '@medplum/fhirtypes';
import type { JSX } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  assignPatientToPractitioner,
  bulkAssignPatients,
  fetchPractitionersWithLogin,
  fetchUnassignedPatients,
  getPatientDisplayName,
  getPractitionerDisplayName,
} from './utils';

export function UnassignedPatientsTab(): JSX.Element {
  const medplum = useMedplum();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [practitioners, setPractitioners] = useState<Practitioner[]>([]);
  const [selectedAssignments, setSelectedAssignments] = useState<Record<string, string>>({});
  const [selectedPatients, setSelectedPatients] = useState<Set<string>>(new Set());
  const [bulkPractitionerId, setBulkPractitionerId] = useState<string>('');
  const [showAllPatients, setShowAllPatients] = useState(false);
  const [searchTerm, setSearchTerm] = useState<string>('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      let patientsData: Patient[];
      if (showAllPatients) {
        // Fetch all patients
        patientsData = await medplum.searchResources('Patient', { _count: '1000' });
      } else {
        // Fetch only unassigned patients
        patientsData = await fetchUnassignedPatients(medplum);
      }

      const practitionersWithLogin = await fetchPractitionersWithLogin(medplum);

      setPatients(patientsData);
      setPractitioners(practitionersWithLogin);
      setSelectedPatients(new Set()); // Clear selection on reload

      // In "All Patients" view, auto-select the currently assigned practitioner when present in options
      if (showAllPatients) {
        const practitionerIdSet = new Set(practitionersWithLogin.map((p) => p.id || ''));
        const defaults: Record<string, string> = {};
        for (const patient of patientsData) {
          const gpId = (patient.generalPractitioner ?? [])
            .map((gp) => gp.reference)
            .find((ref) => ref?.startsWith('Practitioner/'))
            ?.replace('Practitioner/', '');
          if (gpId && practitionerIdSet.has(gpId) && patient.id) {
            defaults[patient.id] = gpId;
          }
        }
        setSelectedAssignments(defaults);
      } else {
        // In unassigned view, clear any preselected assignments
        setSelectedAssignments({});
      }
    } catch (error) {
      console.error('Failed to load data:', error);
      showNotification({
        title: 'Error',
        message: 'Failed to load patients and practitioners',
        color: 'red',
      });
    } finally {
      setLoading(false);
    }
  }, [medplum, showAllPatients]);

  useEffect(() => {
    loadData().catch(console.error);
  }, [loadData]);

  const handleAssign = async (patientId: string): Promise<void> => {
    const practitionerId = selectedAssignments[patientId];
    if (!practitionerId) {
      showNotification({
        title: 'Error',
        message: 'Please select a practitioner',
        color: 'red',
      });
      return;
    }

    setActionLoading(true);
    try {
      await assignPatientToPractitioner(medplum, patientId, practitionerId);
      showNotification({
        title: 'Success',
        message: 'Patient assigned successfully',
        color: 'green',
      });
      // Clear the selection and reload
      setSelectedAssignments((prev) => {
        const next = { ...prev };
        delete next[patientId];
        return next;
      });
      await loadData();
    } catch (error) {
      console.error('Failed to assign patient:', error);
      showNotification({
        title: 'Error',
        message: 'Failed to assign patient',
        color: 'red',
      });
    } finally {
      setActionLoading(false);
    }
  };

  const handleBulkAssign = async (): Promise<void> => {
    if (selectedPatients.size === 0) {
      showNotification({
        title: 'Error',
        message: 'Please select at least one patient',
        color: 'red',
      });
      return;
    }

    if (!bulkPractitionerId) {
      showNotification({
        title: 'Error',
        message: 'Please select a practitioner for bulk assignment',
        color: 'red',
      });
      return;
    }

    setActionLoading(true);
    try {
      const result = await bulkAssignPatients(medplum, Array.from(selectedPatients), bulkPractitionerId);
      showNotification({
        title: 'Success',
        message: `Assigned ${result.success} patient(s) successfully${result.failed > 0 ? `, ${result.failed} failed` : ''}`,
        color: result.failed > 0 ? 'yellow' : 'green',
      });
      setBulkPractitionerId('');
      await loadData();
    } catch (error) {
      console.error('Failed to bulk assign patients:', error);
      showNotification({
        title: 'Error',
        message: 'Failed to bulk assign patients',
        color: 'red',
      });
    } finally {
      setActionLoading(false);
    }
  };

  const togglePatientSelection = (patientId: string): void => {
    setSelectedPatients((prev) => {
      const next = new Set(prev);
      if (next.has(patientId)) {
        next.delete(patientId);
      } else {
        next.add(patientId);
      }
      return next;
    });
  };

  const toggleSelectAll = (): void => {
    if (selectedPatients.size === filteredPatients.length && filteredPatients.length > 0) {
      setSelectedPatients(new Set());
    } else {
      setSelectedPatients(new Set(filteredPatients.map((p) => p.id || '')));
    }
  };

  const practitionerOptions = practitioners.map((p) => ({
    value: p.id || '',
    label: getPractitionerDisplayName(p),
  }));

  const formatBirthDate = (date: string | undefined): string => {
    if (!date) return 'Unknown';
    try {
      return new Date(date).toLocaleDateString();
    } catch {
      return date;
    }
  };

  // Filter patients based on search term
  const filteredPatients = patients.filter((patient) => {
    if (!searchTerm) return true;
    const displayName = getPatientDisplayName(patient).toLowerCase();
    return displayName.includes(searchTerm.toLowerCase());
  });

  return (
    <Stack gap="lg" pos="relative">
      <LoadingOverlay visible={loading || actionLoading} />

      <Button
        variant="subtle"
        leftSection={<IconArrowLeft size={16} />}
        onClick={() => navigate('/')}
        style={{ alignSelf: 'flex-start' }}
      >
        Back to Dashboard
      </Button>

      <Alert color="blue" title="Patient Assignment">
        <Text size="sm">
          {showAllPatients
            ? 'Viewing all patients. You can reassign patients to different practitioners as needed.'
            : 'These patients do not have a general practitioner assigned. Assigning a practitioner allows them to see and manage these patients in their portal.'}
        </Text>
      </Alert>

      <Card shadow="sm" padding="lg" withBorder>
        <Group justify="space-between" mb="md">
          <Title order={3}>Patient Management</Title>
          <SegmentedControl
            value={showAllPatients ? 'all' : 'unassigned'}
            onChange={(value) => setShowAllPatients(value === 'all')}
            data={[
              { label: 'Unassigned Only', value: 'unassigned' },
              { label: 'All Patients', value: 'all' },
            ]}
          />
        </Group>

        {patients.length === 0 ? (
          <Text c="dimmed" ta="center" py="xl">
            {showAllPatients ? 'No patients found.' : 'No unassigned patients found. All patients have a general practitioner assigned.'}
          </Text>
        ) : (
          <>
            <Group justify="space-between" mb="md">
              <Text size="sm" c="dimmed">
                {showAllPatients
                  ? `Showing ${filteredPatients.length} of ${patients.length} patient${patients.length !== 1 ? 's' : ''}`
                  : `Found ${filteredPatients.length} patient${filteredPatients.length !== 1 ? 's' : ''} without a general practitioner`}
                {selectedPatients.size > 0 && ` (${selectedPatients.size} selected)`}
              </Text>
              <TextInput
                placeholder="Search patients by name..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.currentTarget.value)}
                leftSection={<IconSearch size={16} />}
                style={{ width: 300 }}
                size="xs"
              />
            </Group>

            <Card withBorder p="md" mb="md" bg="gray.0">
              <Group>
                <Text size="sm" fw={500}>
                  Bulk Actions:
                </Text>
                <Select
                  placeholder="Select practitioner"
                  data={practitionerOptions}
                  value={bulkPractitionerId}
                  onChange={(value) => setBulkPractitionerId(value || '')}
                  size="xs"
                  clearable
                  searchable
                  style={{ flex: 1, maxWidth: 300 }}
                />
                <Button
                  size="xs"
                  onClick={handleBulkAssign}
                  disabled={selectedPatients.size === 0 || !bulkPractitionerId}
                >
                  Assign Selected ({selectedPatients.size})
                </Button>
              </Group>
            </Card>

            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>
                    <Checkbox
                      checked={selectedPatients.size === filteredPatients.length && filteredPatients.length > 0}
                      indeterminate={selectedPatients.size > 0 && selectedPatients.size < filteredPatients.length}
                      onChange={toggleSelectAll}
                    />
                  </Table.Th>
                  <Table.Th>Patient Name</Table.Th>
                  <Table.Th>Date of Birth</Table.Th>
                  {showAllPatients && <Table.Th>Current GP</Table.Th>}
                  <Table.Th>Assign To</Table.Th>
                  <Table.Th>Action</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {filteredPatients.map((patient) => {
                  const hasPractitionerGP = (patient.generalPractitioner ?? []).some(
                    (gp) => gp.reference?.startsWith('Practitioner/')
                  );

                  return (
                    <Table.Tr key={patient.id}>
                      <Table.Td>
                        <Checkbox
                          checked={selectedPatients.has(patient.id || '')}
                          onChange={() => togglePatientSelection(patient.id || '')}
                        />
                      </Table.Td>
                      <Table.Td>{getPatientDisplayName(patient)}</Table.Td>
                      <Table.Td>
                        <Text size="sm" c="dimmed">
                          {formatBirthDate(patient.birthDate)}
                        </Text>
                      </Table.Td>
                      {showAllPatients && (
                        <Table.Td>
                          {hasPractitionerGP ? (
                            <Badge size="sm" color="green">
                              Assigned
                            </Badge>
                          ) : (
                            <Badge size="sm" color="gray">
                              Unassigned
                            </Badge>
                          )}
                        </Table.Td>
                      )}
                      <Table.Td>
                        <Select
                          placeholder="Select practitioner"
                          data={practitionerOptions}
                          value={selectedAssignments[patient.id || ''] || null}
                          onChange={(value) =>
                            setSelectedAssignments((prev) => ({
                              ...prev,
                              [patient.id || '']: value || '',
                            }))
                          }
                          size="xs"
                          clearable
                          searchable
                        />
                      </Table.Td>
                      <Table.Td>
                        <Button
                          size="xs"
                          onClick={() => handleAssign(patient.id || '')}
                          disabled={!selectedAssignments[patient.id || '']}
                        >
                          {hasPractitionerGP ? 'Reassign' : 'Assign'}
                        </Button>
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </>
        )}
      </Card>
    </Stack>
  );
}
