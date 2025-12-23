import { evaluateLabStatus, StatusPill } from '../helpers/normalRanges';
import { cn } from '../helpers/utils';
import type { PreChartParsedData } from './SynthesisColumn';
import { VitalSignsChart } from './VitalSignsChart';
import { isMissing, isEmpty } from '../helpers/dataHelpers';
import { useState } from 'react';
import {
  Activity,
  AlertCircle,
  Check,
  ChevronRight,
  FileText,
  FlaskConical,
  Heart,
  Lightbulb,
  Pill,
  Stethoscope,
  Syringe,
  User,
  Copy,
  Sparkles,
  Loader2,
} from 'lucide-react';

interface PreChartTabContentProps {
  preChartData: PreChartParsedData;
  copySection: (sectionId: string) => void;
  copiedSection: string | null;
  getLastTranscriptSummary: () => { date?: string; summary: string; provider?: string } | null;
  onGeneratePreChart?: () => Promise<void>;
  preChartLoading?: boolean;
}

export function PreChartTabContent({
  preChartData,
  copySection,
  copiedSection,
  getLastTranscriptSummary,
  onGeneratePreChart,
  preChartLoading = false,
}: PreChartTabContentProps) {
  const [expandedLabs, setExpandedLabs] = useState<Set<string>>(new Set());

  // Format date to "Jan 01, 2001" format
  const formatDateForChart = (dateStr: string): string => {
    if (!dateStr) return '';
    try {
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return dateStr;
      return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' });
    } catch {
      return dateStr;
    }
  };

  const toggleLabExpansion = (labName: string) => {
    setExpandedLabs(prev => {
      const next = new Set(prev);
      if (next.has(labName)) {
        next.delete(labName);
      } else {
        next.add(labName);
      }
      return next;
    });
  };

  // Function to render interval history with badges for tagged items
  const renderIntervalHistoryWithBadges = (text: string) => {
    // If no changes or first visit
    if (text === 'This is the first visit.' || text === 'No significant changes documented since last visit.') {
      return <p className="text-sm text-muted-foreground italic">{text}</p>;
    }

    // Define badge colors for different tag types
    const getBadgeClasses = (tag: string): string => {
      const baseClasses = 'emr-badge text-xs font-medium whitespace-nowrap';

      if (tag.includes('ALLERGY-NEW')) return cn(baseClasses, 'bg-red-100 text-red-700');
      if (tag.includes('ALLERGY-REMOVED')) return cn(baseClasses, 'bg-gray-100 text-gray-700');

      if (tag.includes('VITAL-CRITICAL')) return cn(baseClasses, 'bg-red-100 text-red-700');
      if (tag.includes('VITAL-ABNORMAL')) return cn(baseClasses, 'bg-amber-100 text-amber-700');
      if (tag.includes('VITAL-CHANGE')) return cn(baseClasses, 'bg-blue-100 text-blue-700');

      if (tag.includes('MED-NEW')) return cn(baseClasses, 'bg-green-100 text-green-700');
      if (tag.includes('MED-STOPPED')) return cn(baseClasses, 'bg-red-100 text-red-700');
      if (tag.includes('MED-CHANGED')) return cn(baseClasses, 'bg-amber-100 text-amber-700');

      if (tag.includes('CONDITION-NEW')) return cn(baseClasses, 'bg-purple-100 text-purple-700');
      if (tag.includes('CONDITION-RESOLVED')) return cn(baseClasses, 'bg-green-100 text-green-700');

      if (tag.includes('LAB-CRITICAL') || tag.includes('LAB-ABNORMAL')) return cn(baseClasses, 'bg-red-100 text-red-700');
      if (tag.includes('LAB-CHANGE')) return cn(baseClasses, 'bg-amber-100 text-amber-700');
      if (tag.includes('LAB-OVERDUE')) return cn(baseClasses, 'bg-orange-100 text-orange-700');

      if (tag.includes('PROCEDURE-NEW')) return cn(baseClasses, 'bg-indigo-100 text-indigo-700');
      if (tag.includes('IMMUNIZATION-NEW')) return cn(baseClasses, 'bg-teal-100 text-teal-700');
      if (tag.includes('IMMUNIZATION-DUE')) return cn(baseClasses, 'bg-orange-100 text-orange-700');

      return cn(baseClasses, 'bg-gray-100 text-gray-700');
    };

    // Helper to capitalize first letter of description
    const capitalizeFirst = (str: string): string => {
      if (!str) return str;
      return str.charAt(0).toUpperCase() + str.slice(1);
    };

    // Helper to format tag for display (capitalize words, remove hyphens)
    const formatTagLabel = (tag: string): string => {
      return tag
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
    };

    // Parse text for tags in format [TAG] Description
    const tagPattern = /\[([A-Z-]+)\]\s*([^\[]+?)(?=\[|$)/g;
    const matches = [...text.matchAll(tagPattern)];

    if (matches.length === 0) {
      // No tags found, render as plain text with capitalization
      return <p className="text-sm">{capitalizeFirst(text)}</p>;
    }

    // Render each tagged item as a separate line with badge on the right
    return (
      <>
        {matches.map((match, index) => {
          const tag = match[1];
          const description = capitalizeFirst(match[2].trim());

          return (
            <div
              key={index}
              className="flex items-start justify-between gap-4 py-2.5 px-3 bg-muted/30 rounded-md hover:bg-muted/50 transition-colors border border-border/50"
            >
              <span className="text-sm flex-1 leading-relaxed">{description}</span>
              <span className={getBadgeClasses(tag)}>
                {formatTagLabel(tag)}
              </span>
            </div>
          );
        })}
      </>
    );
  };

  return (
    <>
      {/* Header with Generate Button */}
      {onGeneratePreChart && (
        <div className="flex justify-end mb-4 -mt-2">
          <button
            onClick={() => onGeneratePreChart()}
            disabled={preChartLoading}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
          >
            {preChartLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                Generate new Pre-Chart notes
              </>
            )}
          </button>
        </div>
      )}

      {/* Patient Demographics Card */}
      <div className="emr-medical-card">
        <div className="emr-medical-card-header flex items-center gap-2">
          <div className="flex items-center gap-2">
            <User className="w-4 h-4" />
            Patient Demographics
          </div>
          <button onClick={() => copySection('demographics')} className="ml-auto flex items-center gap-2 px-2 py-1 text-xs bg-muted rounded-md hover:bg-muted/80">
            {copiedSection === 'demographics' ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-3 h-3" />}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div><span className="text-muted-foreground">Name:</span> {preChartData.patientDemographics?.name || 'N/A'}</div>
          <div><span className="text-muted-foreground">MRN:</span> {preChartData.patientDemographics?.mrn || 'N/A'}</div>
          <div><span className="text-muted-foreground">DOB:</span> {preChartData.patientDemographics?.dob || 'N/A'}</div>
          <div><span className="text-muted-foreground">Age:</span> {preChartData.patientDemographics?.age || 'N/A'}</div>
          <div><span className="text-muted-foreground">Gender:</span> {preChartData.patientDemographics?.gender ? (preChartData.patientDemographics.gender.charAt(0).toUpperCase() + preChartData.patientDemographics.gender.slice(1)) : 'N/A'}</div>
          <div><span className="text-muted-foreground">Language:</span> {preChartData.patientDemographics?.preferredLanguage || 'N/A'}</div>
          {(preChartData.patientDemographics?.phone || preChartData.patientDemographics?.email) && (
            <div className="col-span-2"><span className="text-muted-foreground">Contact:</span> {[preChartData.patientDemographics.phone, preChartData.patientDemographics.email].filter(Boolean).join(' | ')}</div>
          )}
          {preChartData.patientDemographics?.preferredPharmacy && (
            <div className="col-span-2"><span className="text-muted-foreground">Pharmacy:</span> {preChartData.patientDemographics.preferredPharmacy}</div>
          )}
        </div>
      </div>

      {/* Reason for Today's Visit Card */}
      <div className="emr-medical-card">
        <div className="emr-medical-card-header flex items-center gap-2">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4" />
            Reason for Today's Visit
          </div>
          <button onClick={() => copySection('reason')} className="ml-auto flex items-center gap-2 px-2 py-1 text-xs bg-muted rounded-md hover:bg-muted/80">
            {copiedSection === 'reason' ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-3 h-3" />}
          </button>
        </div>
        <p className="text-sm">{preChartData.reasonForVisit || 'Not specified'}</p>
      </div>

      {/* Last Encounter Summary Card */}
      <div className="emr-medical-card">
        <div className="emr-medical-card-header flex items-center gap-2">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4" />
            Last Encounter Summary
          </div>
          <button onClick={() => copySection('lastEncounter')} className="ml-auto flex items-center gap-2 px-2 py-1 text-xs bg-muted rounded-md hover:bg-muted/80">
            {copiedSection === 'lastEncounter' ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-3 h-3" />}
          </button>
        </div>
        {(() => {
          // Helper to check if a string is valid JSON
          const isValidJsonString = (str: string): boolean => {
            if (typeof str !== 'string') return false;
            const trimmed = str.trim();
            return (trimmed.startsWith('{') || trimmed.startsWith('['));
          };

          // Helper to validate summary is not JSON
          const isValidSummary = (summary: string | undefined): boolean => {
            if (!summary || typeof summary !== 'string') return false;
            return !isValidJsonString(summary);
          };

          // Use ONLY the most recent transcript summary. Discard any other sources.
          const fb = getLastTranscriptSummary();
          if (fb && fb.summary && isValidSummary(fb.summary)) {
            return (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between text-xs text-muted-foreground">
                  {fb.date && <span>{formatDateForChart(fb.date)}</span>}
                </div>
                <p className="text-justify">{fb.summary}</p>
              </div>
            );
          }

          // No previous encounter - this is the first visit
          return <p className="text-sm text-muted-foreground italic">This is the patient's first visit</p>;
        })()}
      </div>

      {/* Active Problem List Card */}
      <div className="emr-medical-card">
        <div className="emr-medical-card-header flex items-center gap-2">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4" />
            Active Problem List
          </div>
          <button onClick={() => copySection('activeProblemList')} className="ml-auto flex items-center gap-2 px-2 py-1 text-xs bg-muted rounded-md hover:bg-muted/80">
            {copiedSection === 'activeProblemList' ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-3 h-3" />}
          </button>
        </div>
        {isMissing(preChartData.activeProblemList) ? (
          <p className="text-sm text-muted-foreground">-</p>
        ) : isEmpty(preChartData.activeProblemList) ? (
          <p className="text-sm text-muted-foreground italic">No active problems documented</p>
        ) : (
          <div className="space-y-3">
            {preChartData.activeProblemList.map((problem, i) => (
              <div key={i} className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-sm">{problem.problem}</div>
                  <div className="text-xs text-muted-foreground">
                    {problem.onsetDate && <span>Onset: {problem.onsetDate}</span>}
                    {problem.lastUpdated && <span> • Updated: {problem.lastUpdated}</span>}
                  </div>
                </div>
                {problem.status && (
                  <span className={cn(
                    'emr-badge',
                    problem.status === 'active' || problem.status === 'current'
                      ? 'bg-green-100 text-green-700'
                      : problem.status === 'controlled'
                      ? 'bg-blue-100 text-blue-700'
                      : 'bg-amber-100 text-amber-700'
                  )}>
                    {(() => {
                      const raw = (problem.status || '').toString();
                      if (raw.toLowerCase() === 'unknown') return 'Unknown Status';
                      return raw.charAt(0).toUpperCase() + raw.slice(1).replace('-', ' ');
                    })()}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Medication Summary Card */}
      <div className="emr-medical-card">
        <div className="emr-medical-card-header flex items-center gap-2">
          <div className="flex items-center gap-2">
            <Pill className="w-4 h-4" />
            Medication Summary
          </div>
          <button onClick={() => copySection('medicationSummary')} className="ml-auto flex items-center gap-2 px-2 py-1 text-xs bg-muted rounded-md hover:bg-muted/80">
            {copiedSection === 'medicationSummary' ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-3 h-3" />}
          </button>
        </div>
        {isMissing(preChartData.medicationSummary) ? (
          <p className="text-sm text-muted-foreground">-</p>
        ) : isEmpty(preChartData.medicationSummary) ? (
          <p className="text-sm text-muted-foreground italic">No current medications</p>
        ) : (
          <div className="space-y-2">
            {preChartData.medicationSummary.map((med, i) => (
              <div key={i} className="p-2 bg-muted/50 rounded-md">
                <div className="font-medium text-sm">{med.name}</div>
                <div className="text-xs text-muted-foreground">
                  {med.dose && <span>{med.dose}</span>}
                  {med.route && <span> {med.route}</span>}
                  {med.frequency && <span> - {med.frequency}</span>}
                </div>
                {med.indication && (
                  <div className="text-xs text-muted-foreground mt-1">For: {med.indication}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Allergies & Intolerances Card */}
      <div className="emr-medical-card">
        <div className="emr-medical-card-header flex items-center gap-2">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4" />
            Allergies & Intolerances
          </div>
          <button onClick={() => copySection('allergies')} className="ml-auto flex items-center gap-2 px-2 py-1 text-xs bg-muted rounded-md hover:bg-muted/80">
            {copiedSection === 'allergies' ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-3 h-3" />}
          </button>
        </div>
        {isMissing(preChartData.allergiesIntolerances) || isEmpty(preChartData.allergiesIntolerances) ? (
          <p className="text-sm text-muted-foreground">-</p>
        ) : (
          <div className="space-y-3">
            {preChartData.allergiesIntolerances.map((allergy, i) => {
              const resolveSeverity = (a: any) => {
                const direct = (a.severity || '').toString().toLowerCase();
                if (direct) return direct;
                if (Array.isArray(a.reaction) && a.reaction.length > 0) {
                  const sevs = a.reaction.map((r: any) => (r.severity || '').toString().toLowerCase()).filter(Boolean);
                  if (sevs.length === 0) return '';
                  if (sevs.includes('severe') || sevs.includes('high')) return 'severe';
                  if (sevs.includes('moderate')) return 'moderate';
                  if (sevs.includes('mild') || sevs.includes('low')) return 'mild';
                  return sevs[0];
                }
                return '';
              };

              const raw = resolveSeverity(allergy);
              const displaySeverity = raw ? (raw.charAt(0).toUpperCase() + raw.slice(1)) : 'Unknown Severity';
              const severityClass = raw === 'severe' || raw === 'high'
                ? 'bg-red-100 text-red-700'
                : raw === 'moderate'
                ? 'bg-amber-100 text-amber-700'
                : raw === 'mild' || raw === 'low'
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-amber-100 text-amber-700';

              return (
                <div key={i} className="flex items-center justify-between">
                  <div>
                    <span className="font-medium text-sm">{allergy.allergen}</span>
                    <div className="text-xs text-muted-foreground">
                      {Array.isArray(allergy.reaction) ? (allergy.reaction.map((r:any)=>r.text || r.manifestation?.[0]?.text).filter(Boolean).join(', ')) : allergy.reaction}
                      {allergy.category && <span> ({allergy.category})</span>}
                    </div>
                  </div>
                  <span className={cn('emr-badge', severityClass)}>
                    {displaySeverity}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Vital Signs Trends Card */}
      <div className="emr-medical-card">
        <div className="emr-medical-card-header flex items-center gap-2">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4" />
            Vital Signs Trends
          </div>
          <button onClick={() => copySection('vitalSigns')} className="ml-auto flex items-center gap-2 px-2 py-1 text-xs bg-muted rounded-md hover:bg-muted/80">
            {copiedSection === 'vitalSigns' ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-3 h-3" />}
          </button>
        </div>

        {/* 2x2 Grid of Vital Charts */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Blood Pressure Chart */}
          <div className="border border-border rounded-lg p-3 pl-0 pb-1">
            <VitalSignsChart
              title="Blood Pressure"
              data={preChartData.vitalSignsTrends
                ?.filter((v) => v.bp)
                .map((v) => {
                  const [systolic, diastolic] = v.bp!.split('/').map((val) => parseInt(val) || 0);
                  return {
                    date: formatDateForChart(v.date || ''),
                    value: systolic,
                    value2: diastolic,
                  };
                }) || []}
              unit="mmHg"
              minRange={90}
              maxRange={120}
              minRange2={60}
              maxRange2={80}
              dataLabel="Systolic"
              dataLabel2="Diastolic"
              currentValue={preChartData.vitalSignsTrends?.find((v) => v.bp)?.bp || 'N/A'}
              compact={true}
            />
          </div>

          {/* Heart Rate Chart */}
          <div className="border border-border rounded-lg p-3 pl-0 pb-1">
            <VitalSignsChart
              title="Heart Rate"
              data={preChartData.vitalSignsTrends
                ?.filter((v) => v.hr)
                .map((v) => ({
                  date: formatDateForChart(v.date || ''),
                  value: parseInt(v.hr!) || 0,
                })) || []}
              unit="bpm"
              minRange={60}
              maxRange={100}
              currentValue={preChartData.vitalSignsTrends?.find((v) => v.hr)?.hr || 'N/A'}
              compact={true}
            />
          </div>

          {/* Weight Chart */}
          <div className="border border-border rounded-lg p-3 pl-0 pb-1">
            <VitalSignsChart
              title="Weight"
              data={preChartData.vitalSignsTrends
                ?.filter((v) => v.weight)
                .map((v) => ({
                  date: formatDateForChart(v.date || ''),
                  value: parseFloat(((parseFloat(v.weight!) || 0) * 2.20462).toFixed(1)),
                })) || []}
              unit="lbs"
              minRange={110}
              maxRange={265}
              currentValue={(() => {
                const w = preChartData.vitalSignsTrends?.find((v) => v.weight)?.weight;
                if (!w || w === 'N/A') return 'N/A';
                const val = parseFloat(w);
                return isNaN(val) ? w : `${(val * 2.20462).toFixed(1)}`;
              })()}
              compact={true}
            />
          </div>

          {/* SpO2 Chart */}
          <div className="border border-border rounded-lg p-3 pl-0 pb-1">
            <VitalSignsChart
              title="Oxygen Saturation"
              data={preChartData.vitalSignsTrends
                ?.filter((v) => v.spo2)
                .map((v) => ({
                  date: formatDateForChart(v.date || ''),
                  value: parseInt(v.spo2!) || 0,
                })) || []}
              unit="%"
              minRange={95}
              maxRange={100}
              currentValue={preChartData.vitalSignsTrends?.find((v) => v.spo2)?.spo2 || 'N/A'}
              compact={true}
            />
          </div>
        </div>
      </div>

      {/* Key Labs & Results Card */}
      <div className="emr-medical-card">
        <div className="emr-medical-card-header flex items-center gap-2">
          <div className="flex items-center gap-2">
            <FlaskConical className="w-4 h-4" />
            Recent Labs
          </div>
          <button onClick={() => copySection('keyLabs')} className="ml-auto flex items-center gap-2 px-2 py-1 text-xs bg-muted rounded-md hover:bg-muted/80">
            {copiedSection === 'keyLabs' ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-3 h-3" />}
          </button>
        </div>
        {isMissing(preChartData.keyLabsResults) ? (
          <p className="text-sm text-muted-foreground">-</p>
        ) : isEmpty(preChartData.keyLabsResults) ? (
          <p className="text-sm text-muted-foreground italic">No recent lab results</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 px-2 font-medium text-muted-foreground w-8"></th>
                  <th className="text-left py-2 px-2 font-medium text-muted-foreground">Test Name</th>
                  <th className="text-right py-2 px-2 font-medium text-muted-foreground">Value</th>
                  <th className="text-right py-2 px-2 font-medium text-muted-foreground">Range</th>
                  <th className="text-right py-2 px-2 font-medium text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  // Group labs by test name, collecting all results
                  const labsByName = new Map<string, typeof preChartData.keyLabsResults>();

                  preChartData.keyLabsResults.forEach((lab) => {
                    if (!labsByName.has(lab.name)) {
                      labsByName.set(lab.name, []);
                    }
                    labsByName.get(lab.name)!.push(lab);
                  });

                  // Sort each group by date (most recent first)
                  labsByName.forEach((labs, name) => {
                    labs.sort((a, b) => {
                      if (!a.date) return 1;
                      if (!b.date) return -1;
                      return new Date(b.date).getTime() - new Date(a.date).getTime();
                    });
                  });

                  // Convert to array and sort alphabetically by name
                  return Array.from(labsByName.entries())
                    .sort(([nameA], [nameB]) => nameA.localeCompare(nameB))
                    .flatMap(([labName, labs]) => {
                      const mostRecent = labs[0];
                      const historical = labs.slice(1);
                      const hasHistory = historical.length > 0;
                      const isExpanded = expandedLabs.has(labName);
                      const status = evaluateLabStatus(mostRecent.name, mostRecent.value);

                      const rows = [
                        <tr key={labName} className="border-b border-border hover:bg-muted/30">
                          <td className="py-2 px-2">
                            {hasHistory && (
                              <button
                                onClick={() => toggleLabExpansion(labName)}
                                className="p-0.5 hover:bg-muted rounded transition-transform"
                                aria-label={isExpanded ? 'Collapse history' : 'Expand history'}
                              >
                                <ChevronRight
                                  className={cn(
                                    'w-4 h-4 text-muted-foreground transition-transform',
                                    isExpanded && 'rotate-90'
                                  )}
                                />
                              </button>
                            )}
                          </td>
                          <td className="py-2 px-2 font-medium text-foreground">
                            {labName}
                            {mostRecent.date && (
                              <div className="text-xs text-muted-foreground font-normal">{mostRecent.date}</div>
                            )}
                          </td>
                          <td className="py-2 px-2 text-right font-medium text-foreground">
                            {mostRecent.value} {mostRecent.unit}
                          </td>
                          <td className="py-2 px-2 text-right text-muted-foreground">
                            {status?.helperText || '-'}
                          </td>
                          <td className="py-2 px-2 text-right">
                            {status && <StatusPill status={status} />}
                          </td>
                        </tr>
                      ];

                      // Add historical rows if expanded
                      if (isExpanded && hasHistory) {
                        historical.forEach((histLab, idx) => {
                          const histStatus = evaluateLabStatus(histLab.name, histLab.value);
                          rows.push(
                            <tr key={`${labName}-hist-${idx}`} className="border-b border-border bg-muted/20">
                              <td className="py-2 px-2"></td>
                              <td className="py-2 px-2 pl-8 text-muted-foreground">
                                {histLab.date && (
                                  <div className="text-xs">{histLab.date}</div>
                                )}
                              </td>
                              <td className="py-2 px-2 text-right text-foreground">
                                {histLab.value} {histLab.unit}
                              </td>
                              <td className="py-2 px-2 text-right text-muted-foreground">
                                {histStatus?.helperText || '-'}
                              </td>
                              <td className="py-2 px-2 text-right">
                                {histStatus && <StatusPill status={histStatus} />}
                              </td>
                            </tr>
                          );
                        });
                      }

                      return rows;
                    });
                })()}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Immunizations & Preventive Care Card */}
      <div className="emr-medical-card">
        <div className="emr-medical-card-header flex items-center gap-2">
          <div className="flex items-center gap-2">
            <Syringe className="w-4 h-4" />
            Immunizations & Preventive Care
          </div>
          <button onClick={() => copySection('immunizations')} className="ml-auto flex items-center gap-2 px-2 py-1 text-xs bg-muted rounded-md hover:bg-muted/80">
            {copiedSection === 'immunizations' ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-3 h-3" />}
          </button>
        </div>
        {isMissing(preChartData.immunizationsPreventiveCare) ? (
          <p className="text-sm text-muted-foreground">-</p>
        ) : (isMissing(preChartData.immunizationsPreventiveCare.immunizations) || isEmpty(preChartData.immunizationsPreventiveCare.immunizations)) &&
          (isMissing(preChartData.immunizationsPreventiveCare.preventiveCare) || isEmpty(preChartData.immunizationsPreventiveCare.preventiveCare)) ? (
          <p className="text-sm text-muted-foreground italic">No immunization or preventive care records</p>
        ) : (
          <div className="space-y-3">
            {/* Immunizations */}
            {preChartData.immunizationsPreventiveCare.immunizations && preChartData.immunizationsPreventiveCare.immunizations.length > 0 && (
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-2">Immunizations</div>
                <div className="space-y-3">
                  {preChartData.immunizationsPreventiveCare.immunizations.map((item, i) => (
                    <div key={i} className="flex items-center justify-between">
                      <div>
                        <div className="font-medium text-sm">{item.vaccine}</div>
                        <div className="text-xs text-muted-foreground">
                          {item.date && <span>{item.date}</span>}
                          {item.doseNumber && <span> • Dose {item.doseNumber}</span>}
                        </div>
                      </div>
                      {item.status && (
                        <span className={cn(
                          'emr-badge',
                          item.status === 'overdue' ? 'bg-red-100 text-red-700' :
                          item.status === 'due soon' ? 'bg-amber-100 text-amber-700' :
                          item.status === 'up to date' || item.status === 'completed' ? 'bg-green-100 text-green-700' :
                          'bg-blue-100 text-blue-700'
                        )}>
                          {item.status.charAt(0).toUpperCase() + item.status.slice(1).replace('-', ' ')}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {/* Preventive Care */}
            {preChartData.immunizationsPreventiveCare.preventiveCare && preChartData.immunizationsPreventiveCare.preventiveCare.length > 0 && (
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-2">Preventive Care</div>
                <div className="space-y-3">
                  {preChartData.immunizationsPreventiveCare.preventiveCare.map((item, i) => (
                    <div key={i} className="flex items-center justify-between">
                      <div>
                        <div className="font-medium text-sm">{item.item}</div>
                        <div className="text-xs text-muted-foreground">
                          {item.category && <span className="capitalize">{item.category}</span>}
                          {item.lastDate && <span> • Last: {item.lastDate}</span>}
                          {item.nextDue && <span> • Next: {item.nextDue}</span>}
                        </div>
                      </div>
                      {item.status && (
                        <span className={cn(
                          'emr-badge',
                          item.status === 'overdue' ? 'bg-red-100 text-red-700' :
                          item.status === 'due soon' ? 'bg-amber-100 text-amber-700' :
                          item.status === 'up to date' || item.status === 'completed' ? 'bg-green-100 text-green-700' :
                          'bg-blue-100 text-blue-700'
                        )}>
                          {item.status.charAt(0).toUpperCase() + item.status.slice(1).replace('-', ' ')}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Surgical / Procedure History Card */}
      <div className="emr-medical-card">
        <div className="emr-medical-card-header flex items-center gap-2">
          <div className="flex items-center gap-2">
            <Stethoscope className="w-4 h-4" />
            Past Surgical / Procedure History
          </div>
          <button onClick={() => copySection('surgicalHistory')} className="ml-auto flex items-center gap-2 px-2 py-1 text-xs bg-muted rounded-md hover:bg-muted/80">
            {copiedSection === 'surgicalHistory' ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-3 h-3" />}
          </button>
        </div>
        {isMissing(preChartData.surgicalProcedureHistory) ? (
          <p className="text-sm text-muted-foreground">-</p>
        ) : isEmpty(preChartData.surgicalProcedureHistory) ? (
          <p className="text-sm text-muted-foreground italic">No surgical or procedure history documented</p>
        ) : (
          <div className="space-y-2">
            {preChartData.surgicalProcedureHistory.map((proc, i) => (
              <div key={i} className="p-2 bg-muted/50 rounded-md">
                <div className="font-medium text-sm">{proc.procedure}</div>
                <div className="text-xs text-muted-foreground">
                  {proc.date && <span>{proc.date}</span>}
                  {proc.notes && <span> - {proc.notes}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Social & Family History Card */}
      <div className="emr-medical-card">
        <div className="emr-medical-card-header flex items-center gap-2">
          <div className="flex items-center gap-2">
            <Heart className="w-4 h-4" />
            Social & Family History
          </div>
          <button onClick={() => copySection('socialFamily')} className="ml-auto flex items-center gap-2 px-2 py-1 text-xs bg-muted rounded-md hover:bg-muted/80">
            {copiedSection === 'socialFamily' ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-3 h-3" />}
          </button>
        </div>
        <div className="space-y-2 text-sm">
          {preChartData.socialFamilyHistory?.social && (
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-1">Social History</div>
              <div className="space-y-1">
                {preChartData.socialFamilyHistory.social.smoking && (
                  <p><span className="text-muted-foreground">Smoking:</span> {preChartData.socialFamilyHistory.social.smoking}</p>
                )}
                {preChartData.socialFamilyHistory.social.alcohol && (
                  <p><span className="text-muted-foreground">Alcohol:</span> {preChartData.socialFamilyHistory.social.alcohol}</p>
                )}
                {preChartData.socialFamilyHistory.social.drugs && (
                  <p><span className="text-muted-foreground">Substances:</span> {preChartData.socialFamilyHistory.social.drugs}</p>
                )}
                {preChartData.socialFamilyHistory.social.activityLevel && (
                  <p><span className="text-muted-foreground">Activity:</span> {preChartData.socialFamilyHistory.social.activityLevel}</p>
                )}
              </div>
            </div>
          )}
          {preChartData.socialFamilyHistory?.family && preChartData.socialFamilyHistory.family.toString().trim() !== '' && preChartData.socialFamilyHistory.family.toString().trim() !== '-' ? (
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-1">Family History</div>
              <p>{preChartData.socialFamilyHistory.family}</p>
            </div>
          ) : null}
          {isMissing(preChartData.socialFamilyHistory) ||
          ((!preChartData.socialFamilyHistory?.social ||
            (!preChartData.socialFamilyHistory.social.smoking &&
             !preChartData.socialFamilyHistory.social.alcohol &&
             !preChartData.socialFamilyHistory.social.drugs &&
             !preChartData.socialFamilyHistory.social.activityLevel)) &&
           (!preChartData.socialFamilyHistory?.family || preChartData.socialFamilyHistory.family.toString().trim() === '' || preChartData.socialFamilyHistory.family.toString().trim() === '-')) ? (
            <p className="text-muted-foreground">-</p>
          ) : null}
        </div>
      </div>

      {/* Interval History Since Last Visit Card */}
      <div className="emr-medical-card">
        <div className="emr-medical-card-header flex items-center gap-2">
          <div className="flex items-center gap-2">
            <Lightbulb className="w-4 h-4" />
            Interval History Since Last Visit
          </div>
          <button onClick={() => copySection('intervalHistory')} className="ml-auto flex items-center gap-2 px-2 py-1 text-xs bg-muted rounded-md hover:bg-muted/80">
            {copiedSection === 'intervalHistory' ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-3 h-3" />}
          </button>
        </div>
        {/* Display the AI-generated interval history with badges */}
        <div className="space-y-2">
          {renderIntervalHistoryWithBadges(preChartData.intervalHistory || 'This is the first visit.')}
        </div>
      </div>

      {/* Alerts / Care Gaps Card */}
      <div className="emr-medical-card">
        <div className="emr-medical-card-header flex items-center gap-2">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4" />
            Alerts / Overdue Items / Care Gaps
          </div>
          <button onClick={() => copySection('alerts')} className="ml-auto flex items-center gap-2 px-2 py-1 text-xs bg-muted rounded-md hover:bg-muted/80">
            {copiedSection === 'alerts' ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-3 h-3" />}
          </button>
        </div>
        {isMissing(preChartData.alertsOverdueCareGaps) ? (
          <p className="text-sm text-muted-foreground">-</p>
        ) : (isMissing(preChartData.alertsOverdueCareGaps.alerts) || isEmpty(preChartData.alertsOverdueCareGaps.alerts)) &&
           (isMissing(preChartData.alertsOverdueCareGaps.overdueItems) || isEmpty(preChartData.alertsOverdueCareGaps.overdueItems)) &&
           (isMissing(preChartData.alertsOverdueCareGaps.careGaps) || isEmpty(preChartData.alertsOverdueCareGaps.careGaps)) ? (
          <p className="text-sm text-muted-foreground italic">No active alerts or care gaps</p>
        ) : (
          <div className="space-y-3">
            {/* Alerts */}
            {preChartData.alertsOverdueCareGaps.alerts && preChartData.alertsOverdueCareGaps.alerts.length > 0 && (
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-2">Alerts</div>
                <div className="space-y-1">
                  {preChartData.alertsOverdueCareGaps.alerts.map((alert, i) => (
                    <div key={i} className="p-2 rounded-md text-sm border border-border">
                      <span>{alert}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {/* Overdue Items */}
            {preChartData.alertsOverdueCareGaps.overdueItems && preChartData.alertsOverdueCareGaps.overdueItems.length > 0 && (
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-2">Overdue Items</div>
                <div className="space-y-1">
                  {preChartData.alertsOverdueCareGaps.overdueItems.map((item, i) => (
                    <div key={i} className="p-2 rounded-md text-sm border border-border">
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {/* Care Gaps */}
            {preChartData.alertsOverdueCareGaps.careGaps && preChartData.alertsOverdueCareGaps.careGaps.length > 0 && (
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-2">Care Gaps</div>
                <div className="space-y-1">
                  {preChartData.alertsOverdueCareGaps.careGaps.map((gap, i) => (
                    <div key={i} className="p-2 rounded-md text-sm border border-border">
                      <span>{gap}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Suggested Actions Card */}
      <div className="emr-medical-card">
        <div className="emr-medical-card-header flex items-center gap-2">
          <div className="flex items-center gap-2">
            <Lightbulb className="w-4 h-4" />
            Suggested Actions / Pre-Visit Orders
          </div>
          <button onClick={() => copySection('suggestedActions')} className="ml-auto flex items-center gap-2 px-2 py-1 text-xs bg-muted rounded-md hover:bg-muted/80">
            {copiedSection === 'suggestedActions' ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-3 h-3" />}
          </button>
        </div>
        {isMissing(preChartData.suggestedActions) ? (
          <p className="text-sm text-muted-foreground">-</p>
        ) : isEmpty(preChartData.suggestedActions) ? (
          <p className="text-sm text-muted-foreground italic">No suggested actions at this time</p>
        ) : (
          <div className="space-y-2">
            {preChartData.suggestedActions.map((action, i) => (
              <div key={i} className="p-2 rounded-md text-sm border border-border">
                {action}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
