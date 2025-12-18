'use client';
import { useState, useEffect } from 'react';
import { useMedplum } from '@medplum/react';
import { Loader } from '@mantine/core';
import type { Patient as FHIRPatient } from '@medplum/fhirtypes';
import { ScribeColumn } from './components/ScribeColumn'
import { SynthesisColumn } from './components/SynthesisColumn';

interface MedplumPatientDetailProps {
  selectedPatientId: string | null;
}

function calculateAge(birthDate?: string): string {
  if (!birthDate) return 'Unknown';
  const birth = new Date(birthDate);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  
  return age.toString();
}

function formatDOB(birthDate?: string): string {
  if (!birthDate) return 'Unknown';
  const d = new Date(birthDate);
  if (isNaN(d.getTime())) return 'Unknown';
  return d.toISOString().split('T')[0];
}

function formatPrettyDate(d?: string) {
  if (!d) return 'Unknown';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return 'Unknown';
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  const yyyy = dt.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

export function MedplumPatientDetail({ selectedPatientId }: MedplumPatientDetailProps) {
  const medplum = useMedplum();
  const [patient, setPatient] = useState<FHIRPatient | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextAppointmentLabel, setNextAppointmentLabel] = useState<string | null>(null);
  const [nextAppointmentTime, setNextAppointmentTime] = useState<string | null>(null);

  // Smart Synthesis Notes state
  const [smartLoading, setSmartLoading] = useState(false);
  const [smartNote, setSmartNote] = useState<any>(null);
  const [isSavingSmart, setIsSavingSmart] = useState(false);
  const [smartHistory, setSmartHistory] = useState<any[]>([]);

  // Pre-Chart Notes state
  const [preChartLoading, setPreChartLoading] = useState(false);
  const [preChartNote, setPreChartNote] = useState<any>(null);
  const [isSavingPreChart, setIsSavingPreChart] = useState(false);
  const [preChartHistory, setPreChartHistory] = useState<any[]>([]);

  const httpBase = `${process.env.MEDPLUM_BASE_URL || ''}`;

  useEffect(() => {
    if (!selectedPatientId) {
      setPatient(null);
      setError(null);
      setIsLoading(false);
      return;
    }

    const loadPatient = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const data = await medplum.readResource('Patient', selectedPatientId);
        setPatient(data);
      } catch (err) {
        console.error('Failed to load patient:', err);
        setError('Failed to load patient details.');
        setPatient(null);
      } finally {
        setIsLoading(false);
      }
    };

    loadPatient();
  }, [selectedPatientId, medplum]);

  // Fetch next appointment for header display
  useEffect(() => {
    let cancelled = false;
    if (!selectedPatientId || !medplum) {
      setNextAppointmentLabel(null);
      setNextAppointmentTime(null);
      return;
    }

    const loadNextAppointment = async () => {
      try {
        const raw: any = await medplum.searchResources('Appointment', `patient=Patient/${selectedPatientId}&_count=100`);
        const apps: any[] = Array.isArray(raw) ? raw : (raw?.entry ?? []).map((e: any) => e.resource).filter(Boolean);
        const appsWithStart = apps.filter(a => a?.start).map(a => ({ ...a, _start: new Date(a.start) }));
        const now = new Date();
        // Upcoming appointments (>= now)
        const upcoming = appsWithStart.filter(a => a._start >= now).sort((a, b) => a._start - b._start);
        // Only use an upcoming appointment as the "next". Do NOT fall back to past appointments.
        const next = upcoming.length ? upcoming[0] : null;

        if (cancelled) return;

        if (!next) {
          setNextAppointmentLabel(null);
          setNextAppointmentTime(null);
          return;
        }

        const s: Date = new Date(next.start);
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const startOfTomorrow = new Date(startOfToday);
        startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
        const endOfTomorrow = new Date(startOfTomorrow);
        endOfTomorrow.setDate(endOfTomorrow.getDate() + 1);
        const startOfWeekEnd = new Date(startOfToday);
        startOfWeekEnd.setDate(startOfWeekEnd.getDate() + 7);

        const isToday = s >= startOfToday && s < startOfTomorrow;
        const isTomorrow = s >= startOfTomorrow && s < endOfTomorrow;
        const isThisWeek = s >= startOfToday && s < startOfWeekEnd;

        const timeStr = s.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        const label = isToday ? 'Today' : isTomorrow ? 'Tomorrow' : isThisWeek ? 'This Week' : formatDOB(next.start);

        setNextAppointmentTime(timeStr);
        setNextAppointmentLabel(label);
      } catch (e) {
        console.error('Failed to fetch next appointment:', e);
        setNextAppointmentLabel(null);
        setNextAppointmentTime(null);
      }
    };

    loadNextAppointment();
    return () => { cancelled = true; };
  }, [selectedPatientId, medplum]);

  // Fetch Smart Synthesis Notes
  useEffect(() => {
    if (!selectedPatientId) return;
    
    const fetchSmartNotes = async () => {
      setSmartLoading(true);
      try {
        const url = `${httpBase}/api/medai/medplum/smart-synthesis/notes/${selectedPatientId}`;
        const response = await fetch(url, {
          method: 'GET',
          credentials: 'include',
        });

        if (!response.ok) {
          console.error('Failed to fetch Smart Synthesis notes:', response.status);
          setSmartNote(null);
          setSmartHistory([]);
          return;
        }

        const result = await response.json();
        
        if (result.ok && result.notes && result.notes.length > 0) {
          const latest = result.notes[0];
          setSmartNote(latest);
          // Store all except the latest as history
          setSmartHistory(result.notes.slice(1));
        } else {
          setSmartNote(null);
          setSmartHistory([]);
        }
      } catch (e: any) {
        console.error('Failed to fetch Smart Synthesis notes:', e);
        setSmartNote(null);
        setSmartHistory([]);
      } finally {
        setSmartLoading(false);
      }
    };

    fetchSmartNotes();
  }, [selectedPatientId, httpBase]);

  // Scribe Notes are now handled by ScribeColumn component

  // Fetch Pre-Chart Notes
  useEffect(() => {
    if (!selectedPatientId) return;
    
    const fetchPreChartNotes = async () => {
      setPreChartLoading(true);
      try {
        const url = `${httpBase}/api/medai/medplum/pre-chart-notes/notes/${selectedPatientId}`;
        const response = await fetch(url, {
          method: 'GET',
          credentials: 'include',
        });

        if (!response.ok) {
          console.error('Failed to fetch Pre-Chart notes:', response.status);
          setPreChartNote(null);
          setPreChartHistory([]);
          return;
        }

        const result = await response.json();
        
        if (result.ok && result.notes && result.notes.length > 0) {
          // Get the most recent note
          setPreChartNote(result.notes[0]);
          // Store all except the latest as history
          setPreChartHistory(result.notes.slice(1));
        } else {
          setPreChartNote(null);
          setPreChartHistory([]);
        }
      } catch (e: any) {
        console.error('Failed to fetch Pre-Chart notes:', e);
        setPreChartNote(null);
        setPreChartHistory([]);
      } finally {
        setPreChartLoading(false);
      }
    };

    fetchPreChartNotes();
  }, [selectedPatientId, httpBase]);

  // Generate Smart Synthesis note using latest transcript
  // Allow optional transcriptText + jobName so callers (like ScribeColumn) can generate synthesis
  // immediately without first creating/reading a DocumentReference.
  async function handleGenerateSmartNote(transcriptText?: string, jobName?: string) {
    if (!selectedPatientId) return;
    setSmartLoading(true);
    try {
      // If transcriptText and jobName are not provided, fall back to the original flow
      if (!transcriptText || !transcriptText.trim()) {
        // Find latest transcript DocumentReference via Medplum (existing behavior)
        let transcriptDoc: any | null = null;
        try {
          const docs: any[] = await medplum.searchResources(
            'DocumentReference',
            `subject=Patient/${selectedPatientId}&_count=100&_sort=-date`
          );
          const transcripts = (docs || []).filter((doc: any) => {
            const cats = Array.isArray(doc.category) ? doc.category : [];
            return cats.some((c: any) => Array.isArray(c.coding) && c.coding.some((cd: any) => cd.code === 'transcript'));
          });
          transcripts.sort((a: any, b: any) => {
            const aDate = new Date(a.date || a.meta?.lastUpdated || 0).getTime();
            const bDate = new Date(b.date || b.meta?.lastUpdated || 0).getTime();
            return bDate - aDate;
          });
          transcriptDoc = transcripts[0] || null;
        } catch (e) {
          console.error('Medplum transcript search failed:', e);
        }

        if (!transcriptDoc) {
          alert('No transcript found. Please record a visit first.');
          return;
        }

        if (transcriptDoc.content?.[0]?.attachment?.data) {
          try { transcriptText = atob(transcriptDoc.content[0].attachment.data); } catch {}
        } else if (transcriptDoc.content?.[0]?.attachment?.url) {
          try {
            const textResp = await fetch(transcriptDoc.content[0].attachment.url);
            if (textResp.ok) transcriptText = await textResp.text();
          } catch (e) { console.error('Failed to fetch transcript url', e); }
        }

        const jobNameExt = transcriptDoc.extension?.find((ext: any) => ext.url === 'http://medplum.com/fhir/StructureDefinition/healthscribe-job-name');
        jobName = jobNameExt?.valueString || `smart-${Date.now()}`;
      }

      if (!transcriptText || !transcriptText.trim()) {
        alert('Transcript is empty. Please record a visit first.');
        return;
      }

      const url = `${httpBase}/api/medai/medplum/smart-synthesis/notes/generate`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ patient_id: selectedPatientId, transcript_text: transcriptText, healthscribe_job_name: jobName })
      });
      if (!resp.ok) {
        const tx = await resp.text();
        throw new Error(`${resp.status}: ${tx}`);
      }
      const gen = await resp.json();
      if (!gen.ok) throw new Error(gen.error || 'Generate failed');

      // Refresh latest
      const listResp = await fetch(`${httpBase}/api/medai/medplum/smart-synthesis/notes/${selectedPatientId}`, { credentials: 'include' });
      if (listResp.ok) {
        const listJson = await listResp.json();
        if (listJson.ok && Array.isArray(listJson.notes) && listJson.notes.length) setSmartNote(listJson.notes[0]);
      }
    } catch (e: any) {
      console.error('Failed to generate Smart Synthesis note:', e);
      alert(`Failed to generate Smart Synthesis note: ${e.message}`);
    } finally {
      setSmartLoading(false);
    }
  }

  // Save Smart Synthesis note
  const handleSaveSmartNote = async (content: string) => {
    if (!selectedPatientId) return;
    setIsSavingSmart(true);
    try {
      const url = `${httpBase}/api/medai/medplum/smart-synthesis/notes/save`;
      const payload: any = { patient_id: selectedPatientId, content };
      if (smartNote?.id) payload.id = smartNote.id;
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        const tx = await resp.text();
        throw new Error(`${resp.status}: ${tx}`);
      }
      const result = await resp.json();
      if (!result.ok) throw new Error(result.error || 'Failed to save');
      setSmartNote(result.note);
    } catch (e: any) {
      console.error('Failed to save Smart Synthesis note:', e);
      alert(`Failed to save Smart Synthesis note: ${e.message}`);
    } finally {
      setIsSavingSmart(false);
    }
  };

  // Generate Pre-Chart note from patient medical history
  async function handleGeneratePreChartNote() {
    if (!selectedPatientId) return;
    setPreChartLoading(true);
    try {
      const url = `${httpBase}/api/medai/medplum/pre-chart-notes/notes/generate`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ patient_id: selectedPatientId }),
      });
      if (!resp.ok) {
        const tx = await resp.text();
        throw new Error(`${resp.status}: ${tx}`);
      }
      const result = await resp.json();
      if (!result.ok) throw new Error(result.error || 'Failed to generate');
      setPreChartNote(result.note);
    } catch (e: any) {
      console.error('Failed to generate Pre-Chart note:', e);
      alert(`Failed to generate Pre-Chart note: ${e.message}`);
    } finally {
      setPreChartLoading(false);
    }
  }

  // Save Pre-Chart note
  const handleSavePreChartNote = async (content: string) => {
    if (!selectedPatientId) return;
    setIsSavingPreChart(true);
    try {
      const url = `${httpBase}/api/medai/medplum/pre-chart-notes/notes/save`;
      const payload: any = { patient_id: selectedPatientId, content };
      if (preChartNote?.id) payload.id = preChartNote.id;
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        const tx = await resp.text();
        throw new Error(`${resp.status}: ${tx}`);
      }
      const result = await resp.json();
      if (!result.ok) throw new Error(result.error || 'Failed to save');
      setPreChartNote(result.note);
    } catch (e: any) {
      console.error('Failed to save Pre-Chart note:', e);
      alert(`Failed to save Pre-Chart note: ${e.message}`);
    } finally {
      setIsSavingPreChart(false);
    }
  };

  if (!selectedPatientId) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-gray-500 text-lg">Select a patient to view details</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader size="lg" />
      </div>
    );
  }

  if (error || !patient) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <p className="text-red-500 mb-2">{error || 'Patient not found'}</p>
        </div>
      </div>
    );
  }

  const name = `${patient.name?.[0]?.given?.join(' ') || 'Unknown'} ${patient.name?.[0]?.family || 'Patient'}`;
  const age = calculateAge(patient.birthDate);
  const dob = formatDOB(patient.birthDate);
  const gender = patient.gender
    ? patient.gender.charAt(0).toUpperCase() + patient.gender.slice(1)
    : 'Not recorded';

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Patient Header */}
      <div className="bg-card border-b border-border p-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xl font-bold">
              {name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">{name}</h1>
              <div className="flex items-center gap-4 text-sm text-muted-foreground mt-1">
                <span>DOB: <span className="text-foreground font-medium">{dob}</span></span>
                <span>Age: <span className="text-foreground font-medium">{age}</span></span>
                <span>Gender: <span className="text-foreground font-medium">{gender}</span></span>
              </div>
            </div>
          </div>
          <div className="text-sm">
            <div className="text-muted-foreground">Next Appointment</div>
            <div className="text-foreground font-semibold">
              {nextAppointmentTime && nextAppointmentLabel ? (
                <>{nextAppointmentTime} - {nextAppointmentLabel === 'This Week' ? 'This Week' : (nextAppointmentLabel === 'Today' || nextAppointmentLabel === 'Tomorrow' ? nextAppointmentLabel : formatPrettyDate(nextAppointmentLabel))}</>
              ) : (
                <span className="text-foreground font-semibold">-</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 2-Column Layout */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-4 p-4 overflow-hidden">
        {/* Left Column - Scribe */}
        <ScribeColumn 
          patientId={selectedPatientId} 
          onGenerateSynthesis={handleGenerateSmartNote}
        />

        {/* Right Column - Synthesis with Tabs */}
        <SynthesisColumn
          patientId={selectedPatientId}
          smartNote={smartNote}
          smartLoading={smartLoading}
          onGenerateSmart={handleGenerateSmartNote}
          onSaveSmart={handleSaveSmartNote}
          isSavingSmart={isSavingSmart}
          smartHistory={smartHistory}
          preChartNote={preChartNote}
          preChartLoading={preChartLoading}
          onGeneratePreChart={handleGeneratePreChartNote}
          onSavePreChart={handleSavePreChartNote}
          isSavingPreChart={isSavingPreChart}
          preChartHistory={preChartHistory}
        />
      </div>
    </div>
  );
}
