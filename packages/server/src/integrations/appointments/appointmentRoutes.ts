// SPDX-License-Identifier: Apache-2.0
import { Router } from 'express';
import type { Appointment, CodeableConcept } from '@medplum/fhirtypes';
import { AuthenticatedRequestContext, getRequestContext } from '../../context.js';
import { requestContextStore } from '../../request-context-store.js';
import { getSystemRepo } from '../../fhir/repo.js';

export const appointmentRouter = Router();

interface TSVAppointment {
  PatientPracticeGuid: string;
  AppointmentGuid: string;
  ProviderGuid: string;
  FacilityGuid: string;
  StartDateTime: string;
  EndDateTime: string;
  NoShowOrCancellationReason?: string;
  ChiefComplaint?: string;
  AppointmentType?: string;
  AppointmentStatus: string;
  RoomLocation?: string;
  EncounterGuid?: string;
  LastModifiedByProviderGuid?: string;
  LastModifiedDateTimeUtc?: string;
  InsuranceCoverageType?: string;
}

type AppointmentStatus = 'proposed' | 'pending' | 'booked' | 'arrived' | 'fulfilled' | 'cancelled' | 'noshow' | 'entered-in-error' | 'checked-in' | 'waitlist';

function parseDateTime(dateTimeStr: string | undefined): string | undefined {
  if (!dateTimeStr) {
    return undefined;
  }

  try {
    // If the string already has a timezone (Z or +/-), use it as is
    if (dateTimeStr.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(dateTimeStr)) {
      return new Date(dateTimeStr).toISOString();
    }

    // If no timezone, assume it's UTC and append Z
    const withZ = dateTimeStr + 'Z';
    return new Date(withZ).toISOString();
  } catch (err) {
    console.error(`Failed to parse date: ${dateTimeStr}`, err);
    return undefined;
  }
}

function mapStatusToFHIR(status: string): AppointmentStatus {
  const statusLower = status?.toLowerCase() || '';
  switch (statusLower) {
    case 'scheduled':
      return 'booked';
    case 'completed':
      return 'fulfilled';
    case 'cancelled':
      return 'cancelled';
    case 'no show':
    case 'noshow':
      return 'noshow';
    case 'arrived':
      return 'arrived';
    case 'checked-in':
    case 'checkedin':
      return 'checked-in';
    case 'pending':
      return 'pending';
    case 'booked':
      return 'booked';
    default:
      return 'proposed';
  }
}

function createAppointmentType(type?: string): CodeableConcept | undefined {
  if (!type) {
    return undefined;
  }
  return {
    coding: [
      {
        system: 'http://terminology.hl7.org/CodeSystem/v2-0276',
        code: type.replace(/\s+/g, '-').toUpperCase(),
        display: type,
      },
    ],
    text: type,
  };
}

function createReasonCode(chiefComplaint?: string): CodeableConcept[] | undefined {
  if (!chiefComplaint) {
    return undefined;
  }
  return [
    {
      text: chiefComplaint,
    },
  ];
}

function parseTSV(content: string): TSVAppointment[] {
  const lines = content.trim().split('\n');
  if (lines.length < 2) {
    throw new Error('TSV file must have at least a header row and one data row');
  }

  const headers = lines[0].split('\t').map((h) => h.trim());

  // Validate required headers
  const requiredHeaders = ['PatientPracticeGuid', 'AppointmentGuid', 'StartDateTime', 'AppointmentStatus'];
  for (const required of requiredHeaders) {
    if (!headers.includes(required)) {
      throw new Error(`Missing required header: ${required}`);
    }
  }

  const appointments: TSVAppointment[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) {
      continue;
    }

    const values = line.split('\t');
    const record: Record<string, string> = {};

    for (let j = 0; j < headers.length; j++) {
      record[headers[j]] = values[j]?.trim() || '';
    }

    appointments.push(record as unknown as TSVAppointment);
  }

  return appointments;
}

function tsvToFHIRAppointment(tsv: TSVAppointment): Appointment {
  const appointment: Appointment = {
    resourceType: 'Appointment',
    status: mapStatusToFHIR(tsv.AppointmentStatus),
    start: parseDateTime(tsv.StartDateTime),
    end: parseDateTime(tsv.EndDateTime),
    appointmentType: createAppointmentType(tsv.AppointmentType),
    reasonCode: createReasonCode(tsv.ChiefComplaint),
    description: tsv.RoomLocation ? `Room: ${tsv.RoomLocation}` : undefined,
    participant: [
      {
        actor: {
          reference: `Patient/${tsv.PatientPracticeGuid}`,
          display: `Patient ${tsv.PatientPracticeGuid.substring(0, 8)}`,
        },
        status: 'accepted',
        required: 'required',
      },
      {
        actor: {
          reference: `Practitioner/${tsv.ProviderGuid}`,
          display: `Provider ${tsv.ProviderGuid.substring(0, 8)}`,
        },
        status: 'accepted',
        required: 'required',
      },
    ],
    identifier: [
      {
        system: 'urn:ehr:appointment-guid',
        value: tsv.AppointmentGuid,
      },
    ],
    extension: [],
  };

  // Add cancellation reason if present
  if (tsv.NoShowOrCancellationReason) {
    appointment.cancelationReason = {
      text: tsv.NoShowOrCancellationReason,
    };
  }

  // Add facility as extension
  if (tsv.FacilityGuid) {
    appointment.extension?.push({
      url: 'http://medplum.com/fhir/StructureDefinition/facility-guid',
      valueString: tsv.FacilityGuid,
    });
  }

  // Add insurance coverage type as extension
  if (tsv.InsuranceCoverageType) {
    appointment.extension?.push({
      url: 'http://medplum.com/fhir/StructureDefinition/insurance-coverage-type',
      valueString: tsv.InsuranceCoverageType,
    });
  }

  // Add encounter reference if present
  if (tsv.EncounterGuid) {
    appointment.extension?.push({
      url: 'http://medplum.com/fhir/StructureDefinition/encounter-guid',
      valueString: tsv.EncounterGuid,
    });
  }

  // Add last modified info as extension
  if (tsv.LastModifiedDateTimeUtc) {
    const parsedDate = parseDateTime(tsv.LastModifiedDateTimeUtc);
    if (parsedDate) {
      appointment.extension?.push({
        url: 'http://medplum.com/fhir/StructureDefinition/last-modified-utc',
        valueDateTime: parsedDate,
      });
    }
  }

  if (tsv.LastModifiedByProviderGuid) {
    appointment.extension?.push({
      url: 'http://medplum.com/fhir/StructureDefinition/last-modified-by-provider',
      valueString: tsv.LastModifiedByProviderGuid,
    });
  }

  // Remove empty extension array
  if (appointment.extension?.length === 0) {
    delete appointment.extension;
  }

  return appointment;
}

// POST /integrations/appointments/upload - Upload and parse TSV appointments
appointmentRouter.post('/upload', async (req, res): Promise<void> => {
  try {
    const { content, filename } = req.body as { content?: string; filename?: string };

    if (!content) {
      res.status(400).json({
        ok: false,
        error: 'Content is required',
        appointmentsCreated: 0,
      });
      return;
    }

    // Parse the TSV content
    let tsvAppointments: TSVAppointment[];
    try {
      tsvAppointments = parseTSV(content);
    } catch (parseError: any) {
      res.status(400).json({
        ok: false,
        error: `Failed to parse TSV: ${parseError.message}`,
        appointmentsCreated: 0,
      });
      return;
    }

    if (tsvAppointments.length === 0) {
      res.status(400).json({
        ok: false,
        error: 'No appointments found in the file',
        appointmentsCreated: 0,
      });
      return;
    }

    // Get the current user's request context
    const ctx = getRequestContext();
    if (!(ctx instanceof AuthenticatedRequestContext)) {
      res.status(401).json({
        ok: false,
        error: 'Authentication required',
        appointmentsCreated: 0,
      });
      return;
    }

    const repo = ctx.repo;
    const projectId = ctx.project.id;

    // Create FHIR appointments
    const errors: string[] = [];
    let appointmentsCreated = 0;

    for (let i = 0; i < tsvAppointments.length; i++) {
      const tsvAppointment = tsvAppointments[i];
      try {
        const fhirAppointment = tsvToFHIRAppointment(tsvAppointment);

        // Add project metadata
        fhirAppointment.meta = {
          ...fhirAppointment.meta,
          project: projectId,
        };

        // Validate that required fields are present
        if (!fhirAppointment.start || !fhirAppointment.end) {
          throw new Error(`Missing start or end date`);
        }

        // Check if appointment already exists by identifier
        const existing = await repo.search({
          resourceType: 'Appointment',
          filters: [
            { code: 'identifier', operator: 'eq', value: `urn:ehr:appointment-guid|${tsvAppointment.AppointmentGuid}` },
          ],
        });

        if (existing.entry && existing.entry.length > 0) {
          // Update existing appointment
          const existingAppointment = existing.entry[0].resource as Appointment;
          fhirAppointment.id = existingAppointment.id;
          await repo.updateResource({ ...fhirAppointment, id: existingAppointment.id });
          console.log(`Updated appointment ${fhirAppointment.id}`);
        } else {
          // Create new appointment
          const created = await repo.createResource(fhirAppointment);
          console.log(`Created appointment ${created.id}`);
        }

        appointmentsCreated++;
      } catch (err: any) {
        const errorMsg = `Row ${i + 2} (ID: ${tsvAppointment.AppointmentGuid.substring(0, 8)}): ${err.message}`;
        console.error(errorMsg, err);
        errors.push(errorMsg);
      }
    }

    res.json({
      ok: true,
      message: `Successfully processed ${appointmentsCreated} appointments`,
      appointmentsCreated,
      totalRows: tsvAppointments.length,
      errors: errors.length > 0 ? errors : undefined,
      filename,
    });
  } catch (err: any) {
    console.error('Error uploading appointments:', err);
    res.status(500).json({
      ok: false,
      error: err?.message ?? 'Server error',
      appointmentsCreated: 0,
    });
  }
});

// GET /integrations/appointments - List appointments (for testing)
appointmentRouter.get('/', async (req, res): Promise<void> => {
  try {
    const bundle = await requestContextStore.run(AuthenticatedRequestContext.system(), async () => {
      const repo = getSystemRepo();
      return await repo.search({
        resourceType: 'Appointment',
        count: 100,
        sortRules: [{ code: 'date', descending: true }],
      });
    });

    const appointments = (bundle.entry ?? []).map((e: any) => e.resource);
    res.json({ ok: true, appointments, count: appointments.length });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message ?? 'Server error' });
  }
});

// POST /integrations/appointments/seed-rbac - Seed front desk user and access policy
appointmentRouter.post('/seed-rbac', async (req, res): Promise<void> => {
  try {
    const { seedFrontDeskUser } = await import('../../seeds/rbac-seed.js');
    const { projectId } = req.body as { projectId?: string };

    await requestContextStore.run(AuthenticatedRequestContext.system(), async () => {
      await seedFrontDeskUser(projectId);
    });

    res.json({
      ok: true,
      message: 'Front desk user and access policy created successfully',
      credentials: {
        email: 'frontdesk@example.com',
        password: 'password',
      },
    });
  } catch (err: any) {
    console.error('Error seeding RBAC:', err);
    res.status(500).json({ ok: false, error: err?.message ?? 'Server error' });
  }
});
