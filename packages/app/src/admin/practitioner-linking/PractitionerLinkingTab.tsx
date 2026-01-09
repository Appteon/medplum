// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

import {
  Alert,
  Button,
  Card,
  Grid,
  LoadingOverlay,
  Select,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import { showNotification } from '@mantine/notifications';
import { useMedplum } from '@medplum/react';
import { IconArrowLeft } from '@tabler/icons-react';
import type { JSX } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  type CategorizedPractitioners,
  categorizePractitioners,
  getAppteonLinkedIdentifiers,
  getPractitionerDisplayName,
  linkPractitioners,
  unlinkSpecificEhrPractitioner,
} from './utils';

export function PractitionerLinkingTab(): JSX.Element {
  const medplum = useMedplum();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [practitioners, setPractitioners] = useState<CategorizedPractitioners>({
    ehrPractitioners: [],
    medplumPractitioners: [],
    linkedPractitioners: [],
  });
  const [selectedLinks, setSelectedLinks] = useState<Record<string, string>>({});
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  // Patient counts removed from UI per request; simplify state

  const loadPractitioners = useCallback(async () => {
    setLoading(true);
    try {
      const categorized = await categorizePractitioners(medplum);
      setPractitioners(categorized);

      // Patient counts disabled; no additional fetch needed
    } catch (error) {
      console.error('Failed to load practitioners:', error);
      showNotification({
        title: 'Error',
        message: 'Failed to load practitioners',
        color: 'red',
      });
    } finally {
      setLoading(false);
    }
  }, [medplum]);

  useEffect(() => {
    loadPractitioners().catch(console.error);
  }, [loadPractitioners]);

  const handleLink = async (ehrPractitionerId: string): Promise<void> => {
    const medplumPractitionerId = selectedLinks[ehrPractitionerId];
    if (!medplumPractitionerId) {
      showNotification({
        title: 'Error',
        message: 'Please select a Medplum practitioner to link',
        color: 'red',
      });
      return;
    }

    setActionLoading(true);
    try {
      const result = await linkPractitioners(medplum, medplumPractitionerId, ehrPractitionerId);
      showNotification({
        title: 'Success',
        message: `Practitioners linked successfully. ${result.patientsReassigned} patients reassigned.`,
        color: 'green',
      });
      // Clear the selection and reload
      setSelectedLinks((prev) => {
        const next = { ...prev };
        delete next[ehrPractitionerId];
        return next;
      });
      await loadPractitioners();
    } catch (error) {
      console.error('Failed to link practitioners:', error);
      showNotification({
        title: 'Error',
        message: 'Failed to link practitioners',
        color: 'red',
      });
    } finally {
      setActionLoading(false);
    }
  };

  const handleUnlinkSpecificEhr = async (medplumPractitionerId: string, ehrPractitionerId: string): Promise<void> => {
    setActionLoading(true);
    try {
      await unlinkSpecificEhrPractitioner(medplum, medplumPractitionerId, ehrPractitionerId);
      showNotification({
        title: 'Success',
        message: 'EHR practitioner unlinked successfully',
        color: 'green',
      });
      await loadPractitioners();
    } catch (error) {
      console.error('Failed to unlink EHR practitioner:', error);
      showNotification({
        title: 'Error',
        message: 'Failed to unlink EHR practitioner',
        color: 'red',
      });
    } finally {
      setActionLoading(false);
    }
  };

  // Allow linking multiple EHR practitioners to the same Medplum practitioner
  // Build options from both unlinked and already linked Medplum practitioners (deduped by id)
  const medplumOptions = Array.from(
    new Map(
      [...practitioners.medplumPractitioners, ...practitioners.linkedPractitioners]
        .filter((p) => !!p.id)
        .map((p) => [p.id as string, { value: p.id as string, label: getPractitionerDisplayName(p) }])
    ).values()
  );

  // All Medplum practitioners with login (for display in right column), excluding admin/front-desk
  const allMedplumPractitionersForDisplay = Array.from(
    new Map(
      [...practitioners.medplumPractitioners, ...practitioners.linkedPractitioners]
        .filter((p) => {
          const isAdminOrFrontDesk = p.identifier?.some(
            (id) => id.system === 'role' && (id.value === 'admin' || id.value === 'front-desk')
          );
          return !!p.id && !isAdminOrFrontDesk;
        })
        .map((p) => [p.id as string, p])
    ).values()
  );

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

      <Alert color="blue" title="How Practitioner Linking Works">
        <Text size="sm">
          EHR practitioners are synced from your external EHR system. Medplum practitioners are created locally for
          login. Linking them ensures:
        </Text>
        <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
          <li>Medplum practitioners can see patients from the EHR</li>
          <li>Future EHR syncs update the linked practitioner</li>
          <li>Patients are automatically reassigned during linking</li>
        </ul>
      </Alert>

      <Grid>
        <Grid.Col span={6}>
          <Card shadow="sm" padding="lg" withBorder>
            <Title order={3} mb="md">
              EHR Practitioners
            </Title>
            <Text size="sm" c="dimmed" mb="md">
              Practitioners synced from EHR that need to be linked to Medplum accounts
            </Text>

            {practitioners.ehrPractitioners.length === 0 ? (
              <Text c="dimmed" ta="center" py="md">
                No unlinked EHR practitioners found
              </Text>
            ) : (
              <Table>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Name</Table.Th>
                    <Table.Th>Identifiers</Table.Th>
                    {/* Patients column removed */}
                    <Table.Th>Link To</Table.Th>
                    <Table.Th>Action</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {practitioners.ehrPractitioners.map((p) => {
                    const identifierCount = p.identifier?.length || 0;
                    const identifierSummary = p.identifier
                      ?.filter((id) => id.system !== 'role')
                      .map((id) => {
                        const system = id.system?.split('/').pop() || 'unknown';
                        return `${system}: ${id.value?.substring(0, 8)}...`;
                      })
                      .join(', ');

                    return (
                      <Table.Tr key={p.id}>
                        <Table.Td>{getPractitionerDisplayName(p)}</Table.Td>
                        <Table.Td>
                          <Text size="xs" c="dimmed" title={identifierSummary}>
                            {identifierCount} identifier{identifierCount !== 1 ? 's' : ''}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Select
                            placeholder="Select practitioner"
                            data={medplumOptions}
                            value={selectedLinks[p.id || ''] || null}
                            onChange={(value) =>
                              setSelectedLinks((prev) => ({
                                ...prev,
                                [p.id || '']: value || '',
                              }))
                            }
                            size="xs"
                            clearable
                          />
                        </Table.Td>
                        <Table.Td>
                          <Button
                            size="xs"
                            onClick={() => handleLink(p.id || '')}
                            disabled={!selectedLinks[p.id || '']}
                          >
                            Link
                          </Button>
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            )}
          </Card>
        </Grid.Col>

        <Grid.Col span={6}>
          <Card shadow="sm" padding="lg" withBorder>
            <Title order={3} mb="md">
              Medplum Practitioners
            </Title>
            <Text size="sm" c="dimmed" mb="md">
              All practitioners with login capability (available for linking)
            </Text>

            {allMedplumPractitionersForDisplay.length === 0 ? (
              <Text c="dimmed" ta="center" py="md">
                No Medplum practitioners found
              </Text>
            ) : (
              <Table>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Name</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {Array.from(allMedplumPractitionersForDisplay).map((p) => {
                    return (
                      <Table.Tr key={p.id}>
                        <Table.Td>{getPractitionerDisplayName(p)}</Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            )}
          </Card>
        </Grid.Col>
      </Grid>

      <Card shadow="sm" padding="lg" withBorder>
        <Title order={3} mb="md">
          Linked Practitioners
        </Title>
        <Text size="sm" c="dimmed" mb="md">
          Practitioners that have been linked and will receive EHR updates
        </Text>

        {practitioners.linkedPractitioners.length === 0 ? (
          <Text c="dimmed" ta="center" py="md">
            No linked practitioners yet
          </Text>
        ) : (
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Medplum Practitioner (Login)</Table.Th>
                <Table.Th>Linked EHR Practitioner</Table.Th>
                <Table.Th>Action</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {practitioners.linkedPractitioners.flatMap((p) => {
                const linkedIdentifiers = getAppteonLinkedIdentifiers(p);
                const linkedPractitioners = linkedIdentifiers
                  .map((id) => ({ 
                    ehrId: id.value || '', 
                    name: id.type?.text || (id.value ? `Practitioner ${id.value.substring(0, 8)}...` : 'Unknown')
                  }))
                  .filter((item) => item.ehrId);
                
                if (linkedPractitioners.length === 0) {
                  return [];
                }

                const isExpanded = expandedRows.has(p.id || '');
                const displayLimit = 3;
                const hasMore = linkedPractitioners.length > displayLimit;
                const displayedPractitioners = isExpanded 
                  ? linkedPractitioners 
                  : linkedPractitioners.slice(0, displayLimit);
                
                const rows = displayedPractitioners.map((linked, idx) => (
                  <Table.Tr key={`${p.id}-${linked.ehrId}`}>
                    {idx === 0 ? (
                      <Table.Td rowSpan={isExpanded ? linkedPractitioners.length + (hasMore ? 1 : 0) : displayedPractitioners.length + (hasMore ? 1 : 0)}>
                        <Text fw={500}>{getPractitionerDisplayName(p)}</Text>
                        {linkedPractitioners.length > 1 && (
                          <Text size="xs" c="dimmed" mt="xs">
                            {linkedPractitioners.length} linked practitioners
                          </Text>
                        )}
                      </Table.Td>
                    ) : null}
                    <Table.Td>
                      <Text size="sm">{linked.name}</Text>
                      <Text size="xs" c="dimmed">{linked.ehrId}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Button 
                        size="xs" 
                        color="red" 
                        variant="outline" 
                        onClick={() => handleUnlinkSpecificEhr(p.id || '', linked.ehrId)}
                      >
                        Unlink
                      </Button>
                    </Table.Td>
                  </Table.Tr>
                ));

                // Add expand/collapse row if there are more practitioners
                if (hasMore) {
                  rows.push(
                    <Table.Tr key={`${p.id}-expand`}>
                      <Table.Td colSpan={2}>
                        <Button
                          variant="subtle"
                          size="xs"
                          onClick={() => {
                            setExpandedRows((prev) => {
                              const next = new Set(prev);
                              if (next.has(p.id || '')) {
                                next.delete(p.id || '');
                              } else {
                                next.add(p.id || '');
                              }
                              return next;
                            });
                          }}
                        >
                          {isExpanded 
                            ? 'Show less' 
                            : `Show ${linkedPractitioners.length - displayLimit} more...`}
                        </Button>
                      </Table.Td>
                    </Table.Tr>
                  );
                }

                return rows;
              })}
            </Table.Tbody>
          </Table>
        )}
      </Card>
    </Stack>
  );
}
