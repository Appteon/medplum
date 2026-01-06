// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Button, Table, Badge, TextInput, Select, Group, Paper, LoadingOverlay } from '@mantine/core';
import { useMedplum, useMedplumProfile } from '@medplum/react';
import type { Appointment } from '@medplum/fhirtypes';
import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { IconSearch, IconArrowLeft, IconRefresh } from '@tabler/icons-react';

function getStatusBadgeColor(status: string): string {
  switch (status?.toLowerCase()) {
    case 'booked':
    case 'scheduled':
      return 'blue';
    case 'arrived':
    case 'checked-in':
      return 'cyan';
    case 'fulfilled':
    case 'completed':
      return 'green';
    case 'cancelled':
      return 'red';
    case 'noshow':
    case 'no show':
      return 'orange';
    case 'pending':
      return 'yellow';
    default:
      return 'gray';
  }
}

function formatDateTime(dateTimeStr: string | undefined): string {
  if (!dateTimeStr) {
    return '--';
  }
  try {
    const date = new Date(dateTimeStr);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateTimeStr;
  }
}

function getPatientName(appointment: Appointment): string {
  // Find the patient participant
  const patientParticipant = appointment.participant?.find(
    (p) => p.actor?.reference?.startsWith('Patient/')
  );
  return patientParticipant?.actor?.display || 'Unknown Patient';
}

function getPractitionerName(appointment: Appointment): string {
  // Find the practitioner participant
  const practitionerParticipant = appointment.participant?.find(
    (p) => p.actor?.reference?.startsWith('Practitioner/')
  );
  return practitionerParticipant?.actor?.display || 'Unknown Provider';
}

function getAppointmentType(appointment: Appointment): string {
  return appointment.appointmentType?.text ||
         appointment.appointmentType?.coding?.[0]?.display ||
         '--';
}

function getChiefComplaint(appointment: Appointment): string {
  // Chief complaint is often stored in reasonCode or description
  if (appointment.reasonCode?.[0]?.text) {
    return appointment.reasonCode[0].text;
  }
  if (appointment.reasonCode?.[0]?.coding?.[0]?.display) {
    return appointment.reasonCode[0].coding[0].display;
  }
  return appointment.description || '--';
}

export function ViewAppointmentsPage(): JSX.Element {
  const profile = useMedplumProfile();
  const medplum = useMedplum();
  const navigate = useNavigate();

  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | null>(null);

  const fetchAppointments = async (): Promise<void> => {
    setLoading(true);
    try {
      const results = await medplum.searchResources('Appointment', {
        _sort: '-date',
        _count: '100',
      });
      setAppointments(results);
    } catch (error) {
      console.error('Failed to fetch appointments:', error);
      setAppointments([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (profile) {
      fetchAppointments();
    }
  }, [profile, medplum]);

  // Filter appointments
  const filteredAppointments = appointments.filter((apt) => {
    // Status filter
    if (statusFilter && apt.status?.toLowerCase() !== statusFilter.toLowerCase()) {
      return false;
    }
    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const patientName = getPatientName(apt).toLowerCase();
      const practitionerName = getPractitionerName(apt).toLowerCase();
      const type = getAppointmentType(apt).toLowerCase();
      const complaint = getChiefComplaint(apt).toLowerCase();
      return (
        patientName.includes(query) ||
        practitionerName.includes(query) ||
        type.includes(query) ||
        complaint.includes(query)
      );
    }
    return true;
  });

  if (!profile) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>Please sign in to view appointments.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Button
              variant="subtle"
              leftSection={<IconArrowLeft size={16} />}
              onClick={() => navigate('/')?.catch(console.error)}
            >
              Back
            </Button>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Appointments</h1>
              <p className="text-muted-foreground">View and manage patient appointments</p>
            </div>
          </div>
          <Button
            leftSection={<IconRefresh size={16} />}
            onClick={() => fetchAppointments()}
            loading={loading}
          >
            Refresh
          </Button>
        </div>

        {/* Filters */}
        <Paper className="emr-card p-4 mb-6">
          <Group>
            <TextInput
              placeholder="Search by patient, provider, type..."
              leftSection={<IconSearch size={16} />}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.currentTarget.value)}
              style={{ flex: 1, maxWidth: 400 }}
            />
            <Select
              placeholder="Filter by status"
              data={[
                { value: '', label: 'All Statuses' },
                { value: 'scheduled', label: 'Scheduled' },
                { value: 'booked', label: 'Booked' },
                { value: 'arrived', label: 'Arrived' },
                { value: 'fulfilled', label: 'Fulfilled' },
                { value: 'cancelled', label: 'Cancelled' },
                { value: 'noshow', label: 'No Show' },
              ]}
              value={statusFilter}
              onChange={setStatusFilter}
              clearable
              style={{ width: 200 }}
            />
          </Group>
        </Paper>

        {/* Appointments Table */}
        <Paper className="emr-card" pos="relative">
          <LoadingOverlay visible={loading} />
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Date/Time</Table.Th>
                <Table.Th>Patient</Table.Th>
                <Table.Th>Provider</Table.Th>
                <Table.Th>Type</Table.Th>
                <Table.Th>Chief Complaint</Table.Th>
                <Table.Th>Status</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {filteredAppointments.length === 0 ? (
                <Table.Tr>
                  <Table.Td colSpan={6} className="text-center py-8 text-muted-foreground">
                    {loading ? 'Loading appointments...' : 'No appointments found'}
                  </Table.Td>
                </Table.Tr>
              ) : (
                filteredAppointments.map((appointment) => (
                  <Table.Tr
                    key={appointment.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/Appointment/${appointment.id}`)?.catch(console.error)}
                  >
                    <Table.Td>{formatDateTime(appointment.start)}</Table.Td>
                    <Table.Td>{getPatientName(appointment)}</Table.Td>
                    <Table.Td>{getPractitionerName(appointment)}</Table.Td>
                    <Table.Td>{getAppointmentType(appointment)}</Table.Td>
                    <Table.Td>{getChiefComplaint(appointment)}</Table.Td>
                    <Table.Td>
                      <Badge color={getStatusBadgeColor(appointment.status || '')}>
                        {appointment.status || 'Unknown'}
                      </Badge>
                    </Table.Td>
                  </Table.Tr>
                ))
              )}
            </Table.Tbody>
          </Table>
        </Paper>

        {/* Summary */}
        <div className="mt-4 text-sm text-muted-foreground">
          Showing {filteredAppointments.length} of {appointments.length} appointments
        </div>
      </div>
    </div>
  );
}
