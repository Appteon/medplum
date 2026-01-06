// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Button, Table, Badge, TextInput, Select, Group, Paper, LoadingOverlay, Pagination } from '@mantine/core';
import { useMedplum, useMedplumProfile } from '@medplum/react';
import { getDisplayString } from '@medplum/core';
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

function getPatientRef(appointment: Appointment): string | undefined {
  return appointment.participant?.find((p) => p.actor?.reference?.startsWith('Patient/'))?.actor?.reference;
}

function getPractitionerRef(appointment: Appointment): string | undefined {
  return appointment.participant?.find((p) => p.actor?.reference?.startsWith('Practitioner/'))?.actor?.reference;
}

function appointmentHasPractitioner(appointment: Appointment, profile: any): boolean {
  const refs = appointment.participant?.map((p) => p.actor?.reference).filter(Boolean) ?? [];
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

  const isPractitioner = profile?.resourceType === 'Practitioner';
  const isPractitionerRole = (profile as any)?.resourceType === 'PractitionerRole';
  const roleProfile = profile as any;

  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [nameCache, setNameCache] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const getTodayDateString = (): string => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const startOfToday = (): Date => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  };

  const fetchAppointments = async (): Promise<void> => {
    setLoading(true);
    try {
      const searchParams: Record<string, string> = {
        // Only upcoming (today and future), ascending by date
        date: `ge${getTodayDateString()}`,
        _sort: 'date',
        _count: '500',
      };
      // If signed in as a doctor, only show their appointments (practitioner or practitioner role)
      if ((isPractitioner || isPractitionerRole) && profile?.id) {
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
        if (actors.length > 0) {
          searchParams.actor = actors.join(',');
        }
      }
      const results = await medplum.searchResources('Appointment', searchParams);
      setAppointments(results);
      // Prefetch and cache patient/practitioner display names
      await prefetchNames(results);
      setPage(1);
    } catch (error) {
      console.error('Failed to fetch appointments:', error);
      setAppointments([]);
    } finally {
      setLoading(false);
    }
  };

  const prefetchNames = async (list: Appointment[]): Promise<void> => {
    const patientIds: Set<string> = new Set();
    const practitionerIds: Set<string> = new Set();

    for (const apt of list) {
      const pRef = getPatientRef(apt);
      if (pRef) {
        const [, id] = pRef.split('/');
        if (id) patientIds.add(id);
      }
      const prRef = getPractitionerRef(apt);
      if (prRef) {
        const [, id] = prRef.split('/');
        if (id) practitionerIds.add(id);
      }
    }

    try {
      const [patients, practitioners] = await Promise.all([
        patientIds.size
          ? medplum.searchResources('Patient', { _id: Array.from(patientIds).join(',') })
          : Promise.resolve([]),
        practitionerIds.size
          ? medplum.searchResources('Practitioner', { _id: Array.from(practitionerIds).join(',') })
          : Promise.resolve([]),
      ]);

      const newCache: Record<string, string> = {};
      for (const p of patients as any[]) {
        if (p?.id) newCache[`Patient/${p.id}`] = getDisplayString(p as any);
      }
      for (const pr of practitioners as any[]) {
        if (pr?.id) newCache[`Practitioner/${pr.id}`] = getDisplayString(pr as any);
      }
      if (Object.keys(newCache).length > 0) {
        setNameCache((prev) => ({ ...prev, ...newCache }));
      }
    } catch (err) {
      console.error('Failed to prefetch names:', err);
    }
  };

  useEffect(() => {
    if (profile) {
      fetchAppointments();
    }
  }, [profile, medplum]);

  // Reset to first page on filter/search changes
  useEffect(() => {
    setPage(1);
  }, [searchQuery, statusFilter]);

  // Filter to today and future, then apply status/search filters
  const startToday = startOfToday().getTime();
  const filteredAppointments = appointments.filter((apt) => {
    const t = apt.start ? new Date(apt.start).getTime() : 0;
    if (t < startToday) {
      return false;
    }
    // Ensure appointment belongs to signed-in practitioner/role
    if ((isPractitioner || isPractitionerRole) && !appointmentHasPractitioner(apt, profile)) {
      return false;
    }
    // Status filter
    if (statusFilter && apt.status?.toLowerCase() !== statusFilter.toLowerCase()) {
      return false;
    }
    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const patientName = (nameCache[getPatientRef(apt) ?? ''] ?? '').toLowerCase();
      const practitionerName = (nameCache[getPractitionerRef(apt) ?? ''] ?? '').toLowerCase();
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

  // Sort ascending by start time (today first, then future)
  const sortedAppointments = [...filteredAppointments].sort((a, b) => {
    const ta = a.start ? new Date(a.start).getTime() : 0;
    const tb = b.start ? new Date(b.start).getTime() : 0;
    return ta - tb;
  });

  // Pagination
  const totalPages = Math.max(1, Math.ceil(sortedAppointments.length / pageSize));
  const startIndex = (page - 1) * pageSize;
  const endIndex = Math.min(sortedAppointments.length, startIndex + pageSize);
  const pageAppointments = sortedAppointments.slice(startIndex, endIndex);

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
              {sortedAppointments.length === 0 ? (
                <Table.Tr>
                  <Table.Td colSpan={6} className="text-center py-8 text-muted-foreground">
                    {loading ? 'Loading appointments...' : 'No appointments found'}
                  </Table.Td>
                </Table.Tr>
              ) : (
                pageAppointments.map((appointment) => (
                  <Table.Tr key={appointment.id}>
                    <Table.Td>{formatDateTime(appointment.start)}</Table.Td>
                    <Table.Td>
                      {nameCache[getPatientRef(appointment) ?? ''] || 'Unknown Patient'}
                    </Table.Td>
                    <Table.Td>
                      {nameCache[getPractitionerRef(appointment) ?? ''] || 'Unknown Provider'}
                    </Table.Td>
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

        {/* Pagination Controls + Summary */}
        <div className="mt-4 flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            Showing {sortedAppointments.length === 0 ? 0 : startIndex + 1}-{endIndex} of {sortedAppointments.length} appointments
          </div>
          <Pagination total={totalPages} value={page} onChange={setPage} disabled={loading} size="sm" />
        </div>
      </div>
    </div>
  );
}
