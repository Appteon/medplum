'use client';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw, Search, X, Users, Menu, Calendar, CalendarDays, CalendarRange, AlertCircle } from 'lucide-react';
import { useMedplum } from '@medplum/react';
import type { Patient as FHIRPatient } from '@medplum/fhirtypes';
import { useRecordingContext } from './contexts/RecordingContext';

interface MedplumPatientSidebarProps {
  patients: FHIRPatient[];
  onPatientSelect: (patientId: string) => void;
  isSidebarCollapsed?: boolean;
  toggleSidebar?: () => void;
  isLoading: boolean;
  sidebarTitle?: string;
  showRefreshButton?: boolean;
  onRefresh?: () => Promise<void> | void;
  initialSelectedPatientId?: string | null;
}

function useDebouncedValue<T>(value: T, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
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
  
  return `${age}y`;
}

function formatDate(d?: string) {
  if (!d) return 'Unknown';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return 'Unknown';
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  const yyyy = dt.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

function getInitials(patient?: FHIRPatient) {
  if (!patient) return '';
  const name = patient.name?.[0];
  const given = name?.given?.[0] || '';
  const family = name?.family || '';
  const parts = `${given} ${family}`.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '??';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function MedplumPatientSidebar({
  patients,
  onPatientSelect,
  isSidebarCollapsed = false,
  toggleSidebar = () => {},
  isLoading,
  sidebarTitle = 'Patients',
  showRefreshButton = false,
  onRefresh,
  initialSelectedPatientId = null,
}: MedplumPatientSidebarProps) {
  const medplum = useMedplum();
  const { isRecording } = useRecordingContext();
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(initialSelectedPatientId);
  const [currentPage, setCurrentPage] = useState(1);
  const [activeFilter, setActiveFilter] = useState<'all' | 'today' | 'tomorrow' | 'thisWeek'>('all');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search.trim().toLowerCase(), 250);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [appointmentsMap, setAppointmentsMap] = useState<Record<string, any[]>>({});
  const [appointmentsLoaded, setAppointmentsLoaded] = useState(false);
  const [fallbackPatients, setFallbackPatients] = useState<FHIRPatient[]>([]);
  const effectivePatients = useMemo(() => (patients && patients.length > 0 ? patients : fallbackPatients), [patients, fallbackPatients]);

  // Determine the logged-in practitioner's reference (e.g., "Practitioner/123")
  const practitionerMeta = useMemo(() => {
    try {
      const profile: any = medplum?.getProfile?.();
      if (!profile) return null;
      if (profile.resourceType === 'Practitioner' && profile.id) {
        return { id: profile.id as string, ref: `Practitioner/${profile.id}` };
      }
      if (profile.resourceType === 'PractitionerRole' && profile.practitioner) {
        const ref: string | undefined = profile.practitioner.reference || (profile.practitioner as any)?.reference;
        if (ref && ref.startsWith('Practitioner/')) {
          const id = ref.split('/')[1];
          return { id, ref };
        }
      }
    } catch {
      // ignore
    }
    return null;
  }, [medplum]);
  const practitionerRef = practitionerMeta?.ref ?? null;
  const practitionerId = practitionerMeta?.id ?? null;

  // Use all effective patients (already filtered during fetch)
  // No need for additional client-side filtering since the fetch logic
  // already handles getting the right patients for this practitioner
  const scopedPatients = useMemo(() => {
    return effectivePatients;
  }, [effectivePatients]);
  // Resolve at runtime so the bundler cannot fold the placeholder before the Docker entrypoint replaces it
  const showApptFiltersFlag = (typeof globalThis !== 'undefined' && (globalThis as any).__MEDPLUM_SHOW_APPT_FILTERS__) ?? '__MEDPLUM_SHOW_APPT_FILTERS__';
  const showApptFilters = showApptFiltersFlag !== 'false';
  const filters = useMemo(() => (
    [
      { key: 'today' as const, label: 'Today', icon: <Calendar className="w-3 h-3" /> },
      { key: 'tomorrow' as const, label: 'Tomorrow', icon: <CalendarDays className="w-3 h-3" /> },
      { key: 'thisWeek' as const, label: 'This Week', icon: <CalendarRange className="w-3 h-3" /> },
    ]
  ), []);

  const itemsPerPage = 10;
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    if (isRefreshing) return;
    try {
      setIsRefreshing(true);
      if (onRefresh) await onRefresh();
      setLastRefreshed(new Date());
    } catch (e) {
      console.error('Refresh failed', e);
    } finally {
      setIsRefreshing(false);
    }
  }, [onRefresh, isRefreshing]);

  const handleFilterSelect = (filterKey: 'today' | 'tomorrow' | 'thisWeek') => {
    setActiveFilter((prev) => (prev === filterKey ? 'all' : filterKey));
    setCurrentPage(1);
  };

  // Filter patients by search + appointment filter and sort by next appointment
  const filteredPatients = useMemo(() => {
    // Preserve original order for stable fallback
    const originalIndex = new Map<string, number>();
    scopedPatients.forEach((p, i) => { if (p.id) originalIndex.set(p.id, i); });

    let base = scopedPatients.filter(p => {
      if (!debouncedSearch) return true;
      const name = `${p.name?.[0]?.given?.join(' ')} ${p.name?.[0]?.family}`.toLowerCase();
      const id = (p.id || '').toLowerCase();
      return name.includes(debouncedSearch) || id.includes(debouncedSearch);
    });

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfTomorrow = new Date(startOfToday);
    startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
    const startOfWeekEnd = new Date(startOfToday);
    startOfWeekEnd.setDate(startOfWeekEnd.getDate() + 7);

    // Helper that returns the next appointment (on or after startOfToday) for a patient, or null
    const getNextAppointment = (p: typeof scopedPatients[number]) => {
      const apps = appointmentsMap[p.id || ''] ?? [];
      // appointmentsMap is stored sorted ascending by start, so find the first strictly in the future (>= now)
      return apps.find((a: any) => {
        if (!a?.start) return false;
        const s = new Date(a.start);
        return s >= now;
      }) || null;
    };

    // If a filter is active, try to narrow to patients with matching appointments.
    // Fallback: if there are zero matches, keep the current (search-only) list so users still see patients.
    if (activeFilter !== 'all') {
      if (appointmentsLoaded) {
        const filteredByAppt = base.filter((p) => {
          const apps = appointmentsMap[p.id || ''] ?? [];
          return apps.some((a: any) => {
            if (!a?.start) return false;
            const s = new Date(a.start);
            if (activeFilter === 'today') {
              return s >= now && s < startOfTomorrow;
            }
            if (activeFilter === 'tomorrow') {
              const endOfTomorrow = new Date(startOfTomorrow);
              endOfTomorrow.setDate(endOfTomorrow.getDate() + 1);
              return s >= startOfTomorrow && s < endOfTomorrow;
            }
            if (activeFilter === 'thisWeek') {
              return s >= now && s < startOfWeekEnd;
            }
            return false;
          });
        });

        if (filteredByAppt.length > 0) {
          base = filteredByAppt;
        }
        // else leave `base` as-is (search-only list)
      }
      // If appointments aren't loaded yet, also leave `base` unchanged.
    }

    // Sort base so that patients with upcoming appointments come first,
    // ordered by day distance from today (0 = today, 1 = tomorrow, ...) and then by time.
    // Patients without upcoming appointments keep their original relative order.
    const DAY_MS = 24 * 60 * 60 * 1000;
    const sortKey = (p: typeof scopedPatients[number]) => {
      const next = getNextAppointment(p);
      if (!next) return null;
      const s = new Date(next.start);
      const sDateOnly = new Date(s.getFullYear(), s.getMonth(), s.getDate());
      const dayDiff = Math.floor((sDateOnly.getTime() - startOfToday.getTime()) / DAY_MS);
      return { dayDiff, time: s.getTime(), raw: next };
    };

    base.sort((a, b) => {
      const aKey = sortKey(a);
      const bKey = sortKey(b);

      if (aKey && bKey) {
        if (aKey.dayDiff !== bKey.dayDiff) return aKey.dayDiff - bKey.dayDiff;
        return aKey.time - bKey.time;
      }
      if (aKey && !bKey) return -1; // a has appointment, b doesn't -> a first
      if (!aKey && bKey) return 1;  // b has appointment, a doesn't -> b first

      // Neither have upcoming appointments: preserve original order
      const ai = a.id ? (originalIndex.get(a.id) ?? 0) : 0;
      const bi = b.id ? (originalIndex.get(b.id) ?? 0) : 0;
      return ai - bi;
    });

    return base;
  }, [scopedPatients, debouncedSearch, activeFilter, appointmentsMap, appointmentsLoaded]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredPatients.length / itemsPerPage));
  const startIndex = (Math.min(currentPage, totalPages) - 1) * itemsPerPage;
  const paginatedPatients = filteredPatients.slice(startIndex, startIndex + itemsPerPage);

  // Auto-select the top patient from the filtered & sorted list once on initial load.
  // Use a ref so this runs only once (page reload) and doesn't interfere with clicks or pagination.
  // Wait for appointments to load so the list is properly sorted before selecting.
  const didAutoSelectRef = useRef(false);
  useEffect(() => {
    if (didAutoSelectRef.current) return;
    if (!appointmentsLoaded) return; // Wait for appointments to load first
    // If there's already a selected patient (e.g., initialSelectedPatientId provided), don't override.
    if (selectedPatientId) {
      didAutoSelectRef.current = true;
      return;
    }
    if (filteredPatients.length === 0) return;
    const first = filteredPatients[0];
    if (first?.id) {
      setSelectedPatientId(first.id);
      onPatientSelect(first.id);
    }
    didAutoSelectRef.current = true;
  }, [filteredPatients, selectedPatientId, onPatientSelect, appointmentsLoaded]);

  // Fetch appointments for patients so we can show badges and enable filters
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!medplum || !scopedPatients || scopedPatients.length === 0) return;
      try {
        const map: Record<string, any[]> = {};
        await Promise.all(scopedPatients.map(async (p) => {
          const pid = p.id;
          if (!pid) return;
          try {
            const raw: any = await medplum.searchResources('Appointment', `patient=Patient/${pid}&_count=100`);
            const apps: any[] = Array.isArray(raw)
              ? raw
              : (raw?.entry ?? []).map((e: any) => e.resource).filter(Boolean);
            const sortedApps = apps
              .filter((a) => a?.start)
              .sort((a: any, b: any) => new Date(a.start).getTime() - new Date(b.start).getTime());
            if (sortedApps.length > 0) {
              console.log(`✓ Found ${sortedApps.length} appointments for patient ${pid}`);
            }
            map[pid] = sortedApps;
          } catch (e) {
            console.error(`✗ Error fetching appointments for patient ${pid}:`, e);
            map[pid] = [];
          }
        }));
        if (!cancelled) {
          const totalAppts = Object.values(map).reduce((sum, arr) => sum + arr.length, 0);
          console.log(`📅 Loaded ${totalAppts} total appointments for ${Object.keys(map).length} patients`);
          setAppointmentsMap(map);
          setAppointmentsLoaded(true);
        }
      } catch (e) {
        console.error('Failed to load appointments', e);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [scopedPatients, medplum]);

  // Fetch ALL patients and filter client-side by generalPractitioner
  useEffect(() => {
    let cancelled = false;
    const loadPatients = async () => {
      if (!medplum) return;
      if (patients && patients.length > 0) return; // Parent already provided patients
      if (!practitionerRef || !practitionerId) {
        console.log('[Sidebar] No practitioner ID found, skipping patient fetch');
        return;
      }

      try {
        console.log('[Sidebar] Fetching all patients for practitioner:', practitionerId);

        // Fetch ALL patients from the database
        const allPatients: FHIRPatient[] = [];
        let offset = 0;
        const pageSize = 200;

        while (!cancelled) {
          const raw: any = await medplum.searchResources('Patient', `_count=${pageSize}&_offset=${offset}&_sort=-_lastUpdated`);
          const batch: FHIRPatient[] = Array.isArray(raw)
            ? raw
            : (raw?.entry ?? []).map((e: any) => e.resource).filter(Boolean);

          if (!batch || batch.length === 0) break;
          allPatients.push(...batch);
          offset += batch.length;

          // Stop if we got fewer results than requested (last page)
          if (batch.length < pageSize) break;
        }

        console.log(`[Sidebar] Fetched ${allPatients.length} total patients from database`);

        // Filter client-side by generalPractitioner field
        const myPatients = allPatients.filter((patient) => {
          const gps = patient.generalPractitioner ?? [];
          return gps.some((gp: any) => {
            const ref = gp?.reference;
            if (!ref) return false;

            // Match: "Practitioner/{id}" or just "{id}"
            if (ref === practitionerRef) return true;
            if (ref === practitionerId) return true;
            if (ref.endsWith(`/${practitionerId}`)) return true;

            return false;
          });
        });

        console.log(`[Sidebar] Filtered to ${myPatients.length} patients assigned to this practitioner`);

        if (!cancelled) {
          setFallbackPatients(myPatients);
        }
      } catch (e) {
        console.error('[Sidebar] Failed to load patients:', e);
        if (!cancelled) {
          setFallbackPatients([]);
        }
      }
    };
    loadPatients();
    return () => { cancelled = true; };
  }, [patients, medplum, practitionerRef, practitionerId]);

  const handleSelectPatient : any = (patientId: string) => {
    // Prevent patient selection while recording is in progress
    if (isRecording) {
      return;
    }
    setSelectedPatientId(patientId);
    onPatientSelect(patientId);
  };

  const handlePreviousPage = () => {
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1);
      scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleNextPage = () => {
    if (currentPage < totalPages) {
      setCurrentPage(currentPage + 1);
      scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  if (isLoading) {
    return (
      <div className={`shadow-sm border-r border-transparent flex flex-col ${isSidebarCollapsed ? 'w-20 h-full' : 'w-96 h-full'} bg-[#071428] overflow-hidden`}>
        {!isSidebarCollapsed && (
          <div className="flex items-center justify-center flex-1">
            <div className="flex flex-col items-center">
              <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-blue-400 border-solid"></div>
              <p className="mt-3 text-sm font-medium text-gray-200">Loading Patients...</p>
            </div>
          </div>
          )}

          {isSidebarCollapsed && (
            <div className="flex-1 flex flex-col pt-12 min-h-0 items-center">
              <div className="mp-scrollbar flex flex-col gap-3 overflow-y-auto py-4 px-2 w-full items-center">
                {filteredPatients.map((patient) => {
                  const initials = getInitials(patient);
                  return (
                    <button
                      key={patient.id}
                      onClick={() => patient.id && handleSelectPatient(patient.id)}
                      title={patient.name?.[0]?.family || patient.id}
                      className={`w-10 h-10 rounded-full flex items-center justify-center ${selectedPatientId === patient.id ? 'bg-red-600' : 'bg-[#0b2130]'} text-white font-semibold`}
                    >
                      <span className="text-sm">{initials}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
      </div>
    );
  }

  return (
    <div className={`pb-0 shadow-sm border-r border-transparent transition-all duration-300 flex flex-col relative ${isSidebarCollapsed ? 'w-20 h-full' : 'w-96 h-full'} bg-[#071428] text-white overflow-hidden overflow-x-hidden min-h-0`}>
      {showRefreshButton && (
        <button
          onClick={refresh}
          className="absolute top-5 right-14 w-9 h-9 bg-[#0e2130] border border-transparent rounded-lg hover:bg-[#122834] transition-all duration-200 flex items-center justify-center z-10 shadow-sm"
          title={lastRefreshed ? `Refresh (Last: ${lastRefreshed.toLocaleTimeString()})` : 'Refresh'}
          disabled={isRefreshing}
        >
          <RefreshCw className={`h-4 w-4 text-gray-600 ${isRefreshing ? 'animate-spin' : ''}`} />
        </button>
      )}

      <button
        onClick={toggleSidebar}
        className={`absolute top-5 ${isSidebarCollapsed ? 'left-0 right-0 mx-auto' : 'right-2'} w-9 h-9 bg-[#082532] border border-transparent rounded-lg hover:bg-[#123a4a] transition-all duration-200 flex items-center justify-center z-10 shadow-sm`}
        title={isSidebarCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
      >
        {isSidebarCollapsed ? <Menu className="h-4 w-4 text-white" /> : <X className="h-4 w-4 text-white" />}
      </button>

      <style>{`
        .mp-scrollbar::-webkit-scrollbar { width: 10px; }
        .mp-scrollbar::-webkit-scrollbar-track { background: #071428; }
        .mp-scrollbar::-webkit-scrollbar-thumb { background: #123a4a; border-radius: 9999px; }
        .mp-scrollbar { scrollbar-color: #123a4a #071428; scrollbar-width: thin; }
      `}</style>

      {!isSidebarCollapsed && (
        <div className="flex-1 flex flex-col pt-12 min-h-0">
          <div className="px-4 mb-4">
            <div className="flex items-center gap-2">
              <h2 className="text-2xl font-semibold text-white">{sidebarTitle}</h2>
            </div>
          </div>

          {/* Recording Warning Banner */}
          {isRecording && (
            <div className="mx-4 mb-3 px-3 py-2 bg-amber-500/20 border border-amber-500/30 rounded-lg flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-amber-400 flex-shrink-0" />
              <span className="text-xs text-amber-200">Recording in progress - patient selection disabled</span>
            </div>
          )}

          {/* Search */}
          <div className="px-4 mb-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setCurrentPage(1); }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') { setSearch(''); setCurrentPage(1); }
                }}
                placeholder="Search patients..."
                className="w-full h-10 pl-9 pr-9 rounded-lg bg-[#0b1b2a] border border-transparent text-sm text-gray-200 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
              />
              {search && (
                <button
                  onClick={() => { setSearch(''); setCurrentPage(1); }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-[#0f2736] transition-colors"
                  title="Clear"
                >
                  <X className="h-4 w-4 text-gray-300" />
                </button>
              )}
            </div>
            {showApptFilters && (
              <div className="mt-3 flex gap-2">
                {filters.map((filter) => (
                  <button
                    key={filter.key}
                    onClick={() => handleFilterSelect(filter.key)}
                    className={`emr-filter-btn flex items-center gap-1.5 ${activeFilter === filter.key ? 'active' : ''}`}
                  >
                    {filter.icon}
                    <span>{filter.label}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="mt-2 text-xs text-gray-300 font-medium">
              {filteredPatients.length} patient{filteredPatients.length === 1 ? '' : 's'}
            </div>
          </div>

            <div ref={scrollContainerRef} className="mp-scrollbar flex-1 space-y-1.5 overflow-y-auto overflow-x-hidden overscroll-contain px-4 pb-2 min-h-0">
            {paginatedPatients.map((patient) => {
              const given = patient.name?.[0]?.given?.join(' ') || '';
              const family = patient.name?.[0]?.family || '';
              const name = `${given} ${family}`.trim() || 'Unknown Patient';
              const age = calculateAge(patient.birthDate);
              const genderRaw = (patient.gender || 'unknown');
              const gender = genderRaw ? (String(genderRaw).charAt(0).toUpperCase() + String(genderRaw).slice(1)) : 'Unknown';
              const dob = formatDate(patient.birthDate);
              const initials = getInitials(patient);

              // Determine next appointment (upcoming) for this patient
              const apps = appointmentsMap[patient.id || ''] ?? [];
              const now = new Date();
              // Find the next upcoming appointment (today or future)
              const nextApp = apps.find((a: any) => {
                if (!a?.start) return false;
                const appointmentDate = new Date(a.start);
                return appointmentDate >= now;
              });

              const classifyAppointment = (appointment: any) => {
                if (!appointment || !appointment.start) return null;
                const s = new Date(appointment.start);
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
                return { isToday, isTomorrow, isThisWeek, dateLabel: formatDate(appointment.start), timeStr: s.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) };
              };

              const renderAppointmentBadge = (appointment: any) => {
                if (!appointment || !appointment.start) return null;
                const classification = classifyAppointment(appointment);
                if (!classification) return null;
                const { isToday, isTomorrow, isThisWeek, dateLabel, timeStr } = classification;
                const badgeClass = isToday ? 'emr-badge emr-badge-today' : 'emr-badge emr-badge-upcoming';
                const label = isToday ? 'Today' : isTomorrow ? 'Tomorrow' : isThisWeek ? 'This Week' : dateLabel;
                return (
                  <span className={badgeClass}>
                    {timeStr} {label}
                  </span>
                );
              };

              return (
                <button
                  key={patient.id}
                  onClick={() => patient.id && handleSelectPatient(patient.id)}
                  disabled={isRecording && selectedPatientId !== patient.id}
                  className={`emr-patient-row w-full text-left ${selectedPatientId === patient.id ? 'active' : ''} ${isRecording && selectedPatientId !== patient.id ? 'opacity-50 cursor-not-allowed' : ''}`}
                  title={isRecording && selectedPatientId !== patient.id ? 'Cannot switch patients while recording' : undefined}
                >
                  <div className="w-10 h-10 rounded-full bg-sidebar-accent flex items-center justify-center text-sm font-semibold flex-shrink-0">
                    {initials}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-base truncate">{name}</div>
                    <div className="text-sm text-sidebar-foreground/70 truncate">
                      {dob} • {age} • {gender}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      {renderAppointmentBadge(nextApp)}
                    </div>
                  </div>
                </button>
              );
            })}

            {paginatedPatients.length === 0 && (
              <div className="text-sm text-gray-300 px-2 py-8 text-center">
                <Users className="h-12 w-12 mx-auto mb-3 text-gray-500" />
                <p className="font-medium text-gray-200 mb-1">
                  {debouncedSearch ? 'No matches found' : 'No patients found'}
                </p>
                {debouncedSearch && (
                  <p className="text-xs text-gray-400">Try a different search term</p>
                )}
              </div>
            )}
          </div>
          
          <div className="px-4 flex justify-between items-center border-t border-[#123a4a] pt-3 pb-3 sticky bottom-0 left-0 right-0 bg-[#082532] z-30 shadow-md">
            <button
              onClick={handlePreviousPage}
              disabled={currentPage === 1}
              className="flex items-center gap-1 px-3 py-2 bg-[#123a4a] border border-transparent text-white rounded-lg hover:bg-[#1b5566] disabled:bg-[#07202a] disabled:text-gray-500 transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              <ChevronLeft className="h-4 w-4" />
              <span className="text-sm font-medium">Previous</span>
            </button>
            <span className="text-sm text-gray-100 font-medium px-3 py-1 bg-[#0b3946] rounded-full">Page {currentPage} of {totalPages}</span>
            <button
              onClick={handleNextPage}
              disabled={currentPage === totalPages}
              className="flex items-center gap-1 px-3 py-2 bg-[#123a4a] border border-transparent text-white rounded-lg hover:bg-[#1b5566] disabled:bg-[#07202a] disabled:text-gray-500 transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              <span className="text-sm font-medium">Next</span>
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {isSidebarCollapsed && (
        <div className="flex-1 flex flex-col pt-12 min-h-0 items-center">
          <div className="mp-scrollbar flex flex-col gap-2 overflow-y-auto overflow-x-hidden py-4 px-3 w-full items-center">
            {filteredPatients.map((patient) => {
              const initials = getInitials(patient);
              const isDisabled = isRecording && selectedPatientId !== patient.id;
              return (
                <button
                  key={patient.id}
                  onClick={() => patient.id && handleSelectPatient(patient.id)}
                  disabled={isDisabled}
                  title={isDisabled ? 'Cannot switch patients while recording' : (patient.name?.[0]?.family || patient.id)}
                  className={`flex-none w-12 h-12 rounded-full overflow-hidden flex items-center justify-center ${selectedPatientId === patient.id ? 'bg-red-600 shadow-lg' : 'bg-[#123a4a] hover:bg-[#1b5566]'} text-white font-semibold border border-[#071428] ${isDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <span className="text-sm">{initials}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}