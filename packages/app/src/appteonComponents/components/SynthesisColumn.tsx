'use client';
import { useState, useEffect } from 'react';

// DropdownNote component for previous notes
interface DropdownNoteProps {
  date: string;
  preview: string;
  content?: string;
  parsed: any;
  noteType: 'synthesis' | 'pre-chart';
  getLastTranscriptSummary?: () => any;
}

const DropdownNote = ({ date, preview, content, parsed, noteType, getLastTranscriptSummary }: DropdownNoteProps) => {
  const [open, setOpen] = useState(false);

  const renderParsedContent = () => {
    if (!parsed) {
      return <p className="text-sm text-muted-foreground">No structured data available</p>;
    }

    const data = parsed;

    // For pre-chart notes, use the PreChartTabContent component to render full content
    if (noteType === 'pre-chart') {
      return (
        <PreChartTabContent
          preChartData={data}
          copySection={() => {}}
          copiedSection={null}
          getLastTranscriptSummary={getLastTranscriptSummary || (() => null)}
        />
      );
    }

    // For synthesis notes, render the full SOAP format
    return (
      <div className="space-y-4">
        {/* Subjective Section */}
        {data.subjective && (
          <div className="emr-medical-card">
            <div className="emr-medical-card-header flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Subjective
            </div>
            <div className="space-y-3">
              {(data.subjective.chiefComplaint || data.subjective.hpi) && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Chief Complaint & HPI</p>
                  {data.subjective.chiefComplaint && (
                    <p className="text-sm text-foreground whitespace-pre-wrap">{data.subjective.chiefComplaint}</p>
                  )}
                  {data.subjective.hpi && data.subjective.hpi !== 'Not documented' && (
                    <p className="text-sm text-foreground mt-1 whitespace-pre-wrap">{data.subjective.hpi}</p>
                  )}
                </div>
              )}

              {data.subjective.intervalHistory && data.subjective.intervalHistory !== 'No changes' && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Interval History</p>
                  <p className="text-sm text-foreground whitespace-pre-wrap">{data.subjective.intervalHistory}</p>
                </div>
              )}

              {data.subjective.reviewOfSystems && data.subjective.reviewOfSystems.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Review of Systems</p>
                  <div className="space-y-1">
                    {data.subjective.reviewOfSystems.map((ros: any, index: number) => {
                      const raw = (ros.status || '').toString().toLowerCase();
                      const statusClass = raw === 'new' || raw.includes('new')
                        ? 'bg-emerald-100 text-emerald-700'
                        : raw === 'worse' || raw === 'worsening' || raw === 'worse-severity'
                        ? 'bg-amber-100 text-amber-700'
                        : raw === 'improved' || raw === 'resolved' || raw === 'better'
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-gray-100 text-gray-700';

                      return (
                        <div key={index} className="flex items-start gap-2 text-sm">
                          <span className="text-primary mt-0.5">•</span>
                          <span className="flex-1">
                            <span className="font-medium">{ros.system}:</span> {ros.finding}
                            {ros.status && (
                              <span className={cn("ml-2 px-1.5 py-0.5 rounded text-xs font-medium", statusClass)}>
                                {ros.status}
                              </span>
                            )}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Past Medical History Section */}
        {data.pastMedicalHistory?.activeProblems && data.pastMedicalHistory.activeProblems.length > 0 && (
          <div className="emr-medical-card">
            <div className="emr-medical-card-header flex items-center gap-2">
              <Heart className="w-4 h-4" />
              Past Medical History
            </div>
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Active Problems</p>
              <div className="space-y-1">
                {data.pastMedicalHistory.activeProblems.map((p: any, idx: number) => (
                  <div key={idx} className="flex items-start gap-2 text-sm">
                    <span className="text-primary mt-0.5">•</span>
                    <span className="flex-1">
                      {p.problem}
                      {p.dxDate && <span className="text-muted-foreground ml-2">({p.dxDate})</span>}
                      {p.status && <span className="ml-2 text-xs text-muted-foreground">- {p.status}</span>}
                      {p.control && <span className="ml-2 text-xs text-muted-foreground">({p.control})</span>}
                      {p.newToday && <span className="ml-2 px-1.5 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-700">New</span>}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Medications Section */}
        {data.medications?.current && data.medications.current.length > 0 && (
          <div className="emr-medical-card">
            <div className="emr-medical-card-header flex items-center gap-2">
              <Pill className="w-4 h-4" />
              Medications
            </div>
            <div className="space-y-1">
              {data.medications.current.map((m: any, idx: number) => (
                <div key={idx} className="flex items-start gap-2 text-sm">
                  <span className="text-primary mt-0.5">•</span>
                  <span className="flex-1">
                    <span className="font-medium">{m.name}</span>
                    {m.dose && <span className="ml-2">{m.dose}</span>}
                    {m.route && <span className="ml-1">{m.route}</span>}
                    {m.frequency && <span className="ml-2 text-muted-foreground">- {m.frequency}</span>}
                    {m.change && m.change !== 'unchanged' && (
                      <span className={cn(
                        "ml-2 px-1.5 py-0.5 rounded text-xs font-medium",
                        m.change === 'new' ? 'bg-emerald-100 text-emerald-700' :
                        m.change === 'stopped' ? 'bg-red-100 text-red-700' :
                        m.change === 'increased' ? 'bg-blue-100 text-blue-700' :
                        m.change === 'decreased' ? 'bg-amber-100 text-amber-700' :
                        'bg-gray-100 text-gray-700'
                      )}>
                        {m.change}
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Allergies Section */}
        {data.allergies && data.allergies.length > 0 && (
          <div className="emr-medical-card">
            <div className="emr-medical-card-header flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              Allergies
            </div>
            <div className="space-y-1">
              {data.allergies.map((a: any, idx: number) => (
                <div key={idx} className="flex items-start gap-2 text-sm">
                  <span className="text-primary mt-0.5">•</span>
                  <span className="flex-1">
                    <span className="font-medium">{a.allergen}</span>
                    {a.reaction && <span className="ml-2 text-muted-foreground">- {a.reaction}</span>}
                    {a.severity && (
                      <span className={cn(
                        "ml-2 px-1.5 py-0.5 rounded text-xs font-medium",
                        a.severity.toLowerCase() === 'severe' ? 'bg-red-100 text-red-700' :
                        a.severity.toLowerCase() === 'moderate' ? 'bg-amber-100 text-amber-700' :
                        'bg-yellow-100 text-yellow-700'
                      )}>
                        {a.severity}
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Social/Family History Section */}
        {(data.socialFamilyHistory?.social || data.socialFamilyHistory?.family) && (
          <div className="emr-medical-card">
            <div className="emr-medical-card-header flex items-center gap-2">
              <Users className="w-4 h-4" />
              Social & Family History
            </div>
            <div className="space-y-3">
              {data.socialFamilyHistory.social && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Social History</p>
                  <p className="text-sm text-foreground whitespace-pre-wrap">{data.socialFamilyHistory.social}</p>
                </div>
              )}
              {data.socialFamilyHistory.family && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Family History</p>
                  <p className="text-sm text-foreground whitespace-pre-wrap">{data.socialFamilyHistory.family}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Objective Section */}
        {data.objective && (
          <div className="emr-medical-card">
            <div className="emr-medical-card-header flex items-center gap-2">
              <Activity className="w-4 h-4" />
              Objective
            </div>
            <div className="space-y-3">
              {/* Vitals */}
              {data.objective.vitals && Object.keys(data.objective.vitals).filter(k => k !== 'lastUpdated' && data.objective.vitals[k]).length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Vital Signs</p>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    {data.objective.vitals.bloodPressure && (
                      <div className="flex gap-2">
                        <span className="text-muted-foreground">BP:</span>
                        <span className="font-medium">{data.objective.vitals.bloodPressure}</span>
                      </div>
                    )}
                    {data.objective.vitals.heartRate && (
                      <div className="flex gap-2">
                        <span className="text-muted-foreground">HR:</span>
                        <span className="font-medium">{data.objective.vitals.heartRate}</span>
                      </div>
                    )}
                    {data.objective.vitals.temperature && (
                      <div className="flex gap-2">
                        <span className="text-muted-foreground">Temp:</span>
                        <span className="font-medium">{data.objective.vitals.temperature}</span>
                      </div>
                    )}
                    {data.objective.vitals.weight && (
                      <div className="flex gap-2">
                        <span className="text-muted-foreground">Weight:</span>
                        <span className="font-medium">{data.objective.vitals.weight}</span>
                      </div>
                    )}
                    {data.objective.vitals.bmi && (
                      <div className="flex gap-2">
                        <span className="text-muted-foreground">BMI:</span>
                        <span className="font-medium">{data.objective.vitals.bmi}</span>
                      </div>
                    )}
                    {data.objective.vitals.respiratoryRate && (
                      <div className="flex gap-2">
                        <span className="text-muted-foreground">RR:</span>
                        <span className="font-medium">{data.objective.vitals.respiratoryRate}</span>
                      </div>
                    )}
                    {data.objective.vitals.oxygenSaturation && (
                      <div className="flex gap-2">
                        <span className="text-muted-foreground">SpO2:</span>
                        <span className="font-medium">{data.objective.vitals.oxygenSaturation}</span>
                      </div>
                    )}
                  </div>
                  {data.objective.vitals.lastUpdated && (
                    <p className="text-xs text-muted-foreground mt-1">Last updated: {data.objective.vitals.lastUpdated}</p>
                  )}
                </div>
              )}

              {/* Exam Findings */}
              {data.objective.examFindings && data.objective.examFindings.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Exam Findings</p>
                  <div className="space-y-1">
                    {data.objective.examFindings.map((exam: any, index: number) => (
                      <div key={index} className="flex items-start gap-2 text-sm">
                        <span className="text-primary mt-0.5">•</span>
                        <span className="flex-1">
                          <span className="font-medium">{exam.system}:</span> {exam.finding}
                          {exam.chronic && <span className="ml-2 px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700">Chronic</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Labs/Imaging */}
              {data.objective.labsImaging && data.objective.labsImaging.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Labs & Imaging</p>
                  <div className="space-y-1">
                    {data.objective.labsImaging.map((lab: any, index: number) => (
                      <div key={index} className="flex items-start gap-2 text-sm">
                        <span className="text-primary mt-0.5">•</span>
                        <span className="flex-1">
                          <span className="font-medium">{lab.name}:</span> {lab.value}
                          {lab.unit && <span className="ml-1">{lab.unit}</span>}
                          {lab.date && <span className="text-muted-foreground ml-2">({lab.date})</span>}
                          {lab.status && lab.status !== 'normal' && (
                            <span className={cn(
                              "ml-2 px-1.5 py-0.5 rounded text-xs font-medium",
                              lab.status === 'high' || lab.status === 'critical-high' ? 'bg-red-100 text-red-700' :
                              lab.status === 'low' || lab.status === 'critical-low' ? 'bg-amber-100 text-amber-700' :
                              'bg-gray-100 text-gray-700'
                            )}>
                              {lab.status}
                            </span>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Assessment & Plan Section */}
        {data.assessmentAndPlan && data.assessmentAndPlan.length > 0 && (
          <div className="emr-medical-card">
            <div className="emr-medical-card-header flex items-center gap-2">
              <Stethoscope className="w-4 h-4" />
              Assessment & Plan
            </div>
            <div className="space-y-4">
              {data.assessmentAndPlan.map((item: any, index: number) => (
                <div key={index} className="space-y-2">
                  <div className="flex items-start gap-2">
                    <span className="font-semibold text-sm text-foreground">
                      {item.priority ? `${item.priority}. ` : ''}{item.problem}
                    </span>
                  </div>

                  {item.narrative && (
                    <div className="pl-4 text-sm text-foreground whitespace-pre-wrap">
                      {item.narrative}
                    </div>
                  )}

                  {item.objectiveData && (
                    <div className="pl-4">
                      <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Objective Data</p>
                      <p className="text-sm text-foreground whitespace-pre-wrap">{item.objectiveData}</p>
                    </div>
                  )}

                  {item.plan && (
                    <div className="pl-4">
                      <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Plan</p>
                      <p className="text-sm text-foreground whitespace-pre-wrap">{item.plan}</p>
                    </div>
                  )}

                  {item.followUp && (
                    <div className="pl-4">
                      <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Follow-up</p>
                      <p className="text-sm text-foreground">{item.followUp}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Counseling & MDM */}
        {data.counseling && (
          <div className="emr-medical-card">
            <div className="emr-medical-card-header flex items-center gap-2">
              <Lightbulb className="w-4 h-4" />
              Counseling & Medical Decision Making
            </div>
            <div className="space-y-2 text-sm">
              {data.counseling.timeSpent && (
                <div className="flex gap-2">
                  <span className="text-muted-foreground">Time Spent:</span>
                  <span className="font-medium">{data.counseling.timeSpent}</span>
                </div>
              )}
              {data.counseling.mdmLevel && (
                <div className="flex gap-2">
                  <span className="text-muted-foreground">MDM Level:</span>
                  <span className="font-medium">{data.counseling.mdmLevel}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Disposition */}
        {data.disposition && (
          <div className="emr-medical-card">
            <div className="emr-medical-card-header flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Disposition
            </div>
            <p className="text-sm text-foreground whitespace-pre-wrap">{data.disposition}</p>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="border border-border rounded-md overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between p-2 bg-muted hover:bg-muted/80 transition-colors"
      >
        <div className="flex items-center gap-2">
          {open ? (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          )}
          <span className="text-sm font-medium">Visit on {date}</span>
        </div>
      </button>
      {open && (
        <div className="p-3 bg-card space-y-3">
          {renderParsedContent()}
        </div>
      )}
    </div>
  );
};
import { 
  Sparkles, ClipboardList, Activity, Pill, AlertTriangle, Users, Heart, ChevronDown, ChevronRight, 
  Clock, Copy, Check, Pencil, X, Loader2, Lightbulb, Stethoscope, FileText, FileSearch 
} from 'lucide-react';
import { cn } from '../helpers/utils';
import { evaluateLabStatus, evaluateVitalStatus, StatusPill } from '../helpers/normalRanges';
import { PreChartTabContent } from './PreChartTabContent';
import { isMissing, isEmpty } from '../helpers/dataHelpers';

// Chrome-style tab component
const ChromeTab = ({ 
  active, 
  onClick, 
  icon: Icon, 
  label 
}: { 
  active: boolean; 
  onClick: () => void; 
  icon: React.ElementType; 
  label: string;
}) => (
  <button
    onClick={onClick}
    className={cn(
      "relative flex items-center gap-2 px-4 py-2 text-sm font-medium transition-all duration-150 rounded-t-lg min-w-[120px]",
      active
        ? "bg-white text-foreground z-10"
        : "bg-muted/60 text-foreground/80 hover:bg-muted/80 hover:text-foreground"
    )}
  >
    <Icon className="w-4 h-4" />
    <span>{label}</span>
  </button>
);

interface SynthesisColumnProps {
  patientId: string | null;
  // Smart Synthesis data
  smartNote: { id?: string; content?: string; created_at?: string } | null;
  smartLoading: boolean;
  onGenerateSmart: () => Promise<void>;
  onSaveSmart: (content: string) => Promise<void>;
  isSavingSmart: boolean;
  smartHistory?: Array<{ id?: string; content?: string; created_at?: string }>;
  // Pre-Chart data
  preChartNote: { id?: string; content?: string; created_at?: string } | null;
  preChartLoading: boolean;
  onGeneratePreChart: () => Promise<void>;
  onSavePreChart: (content: string) => Promise<void>;
  isSavingPreChart: boolean;
  preChartHistory?: Array<{ id?: string; content?: string; created_at?: string }>;
}

// Synthesis note structure - Clinical SOAP note format
interface ParsedData {
  subjective: {
    chiefComplaint: string;
    hpi: string;
    intervalHistory: string;
    reviewOfSystems: Array<{ system: string; finding: string; status?: string }>;
  };
  pastMedicalHistory: {
    activeProblems: Array<{ problem: string; status?: string; control?: string; dxDate?: string; newToday?: boolean }>;
  };
  medications: {
    current: Array<{ name: string; dose?: string; route?: string; frequency?: string; change?: 'new' | 'increased' | 'decreased' | 'stopped' | 'unchanged' }>;
  };
  allergies: Array<{ allergen: string; reaction?: string; severity?: string }>;
  socialFamilyHistory: { social: string; family: string };
  objective: {
    vitals: { bloodPressure?: string; heartRate?: string; temperature?: string; weight?: string; bmi?: string; respiratoryRate?: string; oxygenSaturation?: string; lastUpdated?: string };
    examFindings: Array<{ system: string; finding: string; chronic?: boolean }>;
    labsImaging: Array<{ name: string; value: string; unit?: string; date?: string; status?: string }>;
  };
  assessmentAndPlan: Array<{
    problem: string;
    priority?: number;
    narrative: string;
    objectiveData?: string;
    plan: string;
    followUp?: string;
  }>;
  counseling?: {
    timeSpent?: string;
    mdmLevel?: string;
  };
  disposition?: string;
}

// Pre-Chart note structure (specific headers per clinical requirements)
export interface PreChartParsedData {
  noteType: 'pre-chart';
  patientDemographics: {
    name: string;
    dob: string;
    age: string;
    gender: string;
    mrn: string;
    preferredLanguage: string;
    phone: string;
    email: string;
    address: string;
    preferredPharmacy: string;
  };
  reasonForVisit: string;
  activeProblemList: Array<{ problem: string; onsetDate?: string; lastUpdated?: string; status?: string; control?: string }>;
  medicationSummary: Array<{ name: string; dose?: string; route?: string; frequency?: string; indication?: string; lastReviewed?: string }>;
  allergiesIntolerances: Array<{ allergen: string; category?: string; reaction?: string; severity?: string; status?: string }>;
  vitalSignsTrends: Array<{ date: string; bp?: string; hr?: string; temp?: string; weight?: string; bmi?: string; rr?: string; spo2?: string }>;
  keyLabsResults: Array<{ name: string; value: string; unit?: string; date?: string; status?: string; referenceRange?: string }>;
  immunizationsPreventiveCare: {
    immunizations: Array<{ vaccine: string; date?: string; status?: string; doseNumber?: string }>;
    preventiveCare: Array<{ item: string; category?: string; lastDate?: string; nextDue?: string; status?: string }>;
  };
  surgicalProcedureHistory: Array<{ procedure: string; date?: string; notes?: string }>;
  socialFamilyHistory: {
    social: { smoking: string; alcohol: string; drugs: string; activityLevel: string };
    family: string;
  };
  intervalHistory: string;
  alertsOverdueCareGaps: {
    alerts: string[];
    overdueItems: string[];
    careGaps: string[];
  };
  lastEncounterSummary: { date?: string; summary: string; provider?: string; keyTakeaways?: string[] } | null;
  suggestedActions: string[];
}

export const SynthesisColumn = ({ 
  patientId,
  smartNote,
  smartLoading,
  onGenerateSmart,
  onSaveSmart,
  isSavingSmart,
  smartHistory = [],
  preChartNote,
  preChartLoading,
  onGeneratePreChart,
  onSavePreChart,
  isSavingPreChart,
  preChartHistory = []
}: SynthesisColumnProps) => {
  // Respect build-time frontend env var to show/hide regenerate buttons.
  // Default: true
  const showRegenerateButton = false; // Regenerate button removed (deprecated)

  const [activeTab, setActiveTab] = useState<'synthesis' | 'pre-chart'>('synthesis');
  const [copiedSection, setCopiedSection] = useState<string | null>(null);
  const [showPreviousNotes, setShowPreviousNotes] = useState(false);
  const [editingSection, setEditingSection] = useState<string | null>(null);
  const [editCache, setEditCache] = useState<Record<string, any>>({});
  const [expandedObjectiveLabs, setExpandedObjectiveLabs] = useState<Set<string>>(new Set());

  const [lastTranscriptSummary, setLastTranscriptSummary] = useState<{ date?: string; summary: string; provider?: string } | null>(null);

  const toggleObjectiveLabExpansion = (labName: string) => {
    setExpandedObjectiveLabs(prev => {
      const next = new Set(prev);
      if (next.has(labName)) {
        next.delete(labName);
      } else {
        next.add(labName);
      }
      return next;
    });
  };

  const currentNote = activeTab === 'synthesis' ? smartNote : preChartNote;
  const isLoading = activeTab === 'synthesis' ? smartLoading : preChartLoading;
  const isSaving = activeTab === 'synthesis' ? isSavingSmart : isSavingPreChart;
  const onGenerate = activeTab === 'synthesis' ? onGenerateSmart : onGeneratePreChart;
  const onSave = activeTab === 'synthesis' ? onSaveSmart : onSavePreChart;
  const historyNotes = activeTab === 'synthesis' ? smartHistory : preChartHistory;

  // Generate markdown for a single synthesis section
  const generateSectionMarkdown = (parsed: ParsedData | null, section: string, note?: { id?: string; content?: string; created_at?: string }): string => {
    if (!parsed) return '';
    const lines: string[] = [];
    const title = note?.created_at ? `Clinical Synthesis Note (${new Date(note.created_at).toLocaleString()})` : 'Clinical Synthesis Note';
    lines.push(`# ${title}`);
    lines.push('');

    switch (section) {
      case 'subjective':
        lines.push('## Subjective');
        lines.push('');
        lines.push('### Chief Complaint & HPI');
        lines.push(parsed.subjective.chiefComplaint || 'Not documented');
        if (parsed.subjective.hpi && parsed.subjective.hpi !== 'Not documented') {
          lines.push('');
          lines.push(parsed.subjective.hpi);
        }
        if (parsed.subjective.intervalHistory && parsed.subjective.intervalHistory !== 'No changes') {
          lines.push('');
          lines.push('### Interval History');
          lines.push(parsed.subjective.intervalHistory);
        }
        if (parsed.subjective.reviewOfSystems && parsed.subjective.reviewOfSystems.length > 0) {
          lines.push('');
          lines.push('### Review of Systems');
          for (const ros of parsed.subjective.reviewOfSystems) {
            lines.push(`- **${ros.system}:** ${ros.finding}${ros.status ? ` (${ros.status})` : ''}`);
          }
        }
        break;

      case 'pastMedicalHistory':
        lines.push('## Past Medical History');
        lines.push('');
        lines.push('### Active Problem List');
        if (isMissing(parsed.pastMedicalHistory?.activeProblems)) {
          lines.push('- -');
        } else if (isEmpty(parsed.pastMedicalHistory.activeProblems)) {
          lines.push('- No active problems documented');
        } else {
          for (const p of parsed.pastMedicalHistory.activeProblems) {
            const meta = [p.dxDate && `dx: ${p.dxDate}`, p.status, p.control].filter(Boolean).join(' | ');
            const newTag = p.newToday ? ' **[NEW TODAY]**' : '';
            lines.push(`- ${p.problem}${meta ? ` — ${meta}` : ''}${newTag}`);
          }
        }
        break;

      case 'medications':
        lines.push('## Medications');
        if (isMissing(parsed.medications?.current)) {
          lines.push('- -');
        } else if (isEmpty(parsed.medications.current)) {
          lines.push('- No medications documented');
        } else {
          for (const m of parsed.medications.current) {
            const dosage = [m.dose, m.route, m.frequency].filter(Boolean).join(' ');
            let changeTag = '';
            if (m.change === 'new' || m.change === 'increased') changeTag = ' 🟢';
            else if (m.change === 'stopped' || m.change === 'decreased') changeTag = ' 🔴';
            lines.push(`- ${m.name}${dosage ? ` — ${dosage}` : ''}${changeTag}${m.change && m.change !== 'unchanged' ? ` (${m.change})` : ''}`);
          }
        }
        break;

      case 'allergies':
        lines.push('## Allergies / Alerts');
        if (isMissing(parsed.allergies)) {
          lines.push('- -');
        } else if (isEmpty(parsed.allergies)) {
          lines.push('- No known allergies');
        } else {
          for (const a of parsed.allergies) {
            lines.push(`- ⚠️ **${a.allergen}**${a.reaction ? ` — ${a.reaction}` : ''}${a.severity ? ` (${a.severity.toUpperCase()})` : ''}`);
          }
        }
        break;

      case 'socialFamilyHistory':
        lines.push('## Social & Family History');
        lines.push('');
        lines.push('### Social');
        lines.push(parsed.socialFamilyHistory?.social || 'Not documented');
        if (parsed.socialFamilyHistory?.family && parsed.socialFamilyHistory.family !== 'Not documented') {
          lines.push('');
          lines.push('### Family');
          lines.push(parsed.socialFamilyHistory.family);
        }
        break;

      case 'objective': {
        lines.push('## Objective');
        lines.push('');

        const hasVitals = parsed.objective.vitals && Object.keys(parsed.objective.vitals).length > 0;
        const hasExamFindings = parsed.objective.examFindings && parsed.objective.examFindings.length > 0;
        const hasLabsImaging = parsed.objective.labsImaging && parsed.objective.labsImaging.length > 0;

        // If no objective data at all, show empty state
        if (!hasVitals && !hasExamFindings && !hasLabsImaging) {
          lines.push('-');
        } else {
          if (hasVitals) {
            lines.push('### Vitals');
            const v = parsed.objective.vitals as any;
            if (v.bloodPressure) lines.push(`- Blood Pressure: ${v.bloodPressure}`);
            if (v.heartRate) lines.push(`- Heart Rate: ${v.heartRate}`);
            if (v.temperature) lines.push(`- Temperature: ${v.temperature}`);
            if (v.weight) lines.push(`- Weight: ${formatWeight(v.weight)}`);
            if (v.bmi) lines.push(`- BMI: ${v.bmi}`);
            if (v.respiratoryRate) lines.push(`- Respiratory Rate: ${v.respiratoryRate}`);
            if (v.oxygenSaturation) lines.push(`- O2 Saturation: ${v.oxygenSaturation}`);
            if (v.lastUpdated) lines.push(`\n_Last updated: ${v.lastUpdated}_`);
          }
          if (hasExamFindings) {
            lines.push('');
            lines.push('### Exam Findings');
            for (const exam of parsed.objective.examFindings) {
              lines.push(`- **${exam.system}:** ${exam.finding}${exam.chronic ? ' (chronic)' : ''}`);
            }
          }
          if (hasLabsImaging) {
            lines.push('');
            lines.push('### Labs / Imaging');
            for (const lab of parsed.objective.labsImaging) {
              lines.push(`- ${lab.name}: ${lab.value}${lab.unit ? ` ${lab.unit}` : ''}${lab.date ? ` (${lab.date})` : ''}${lab.status ? ` — **${lab.status.toUpperCase()}**` : ''}`);
            }
          }
        }
        break;
      }

      case 'assessmentAndPlan':
        lines.push('## Assessment & Plan');
        if (!parsed.assessmentAndPlan || parsed.assessmentAndPlan.length === 0) {
          lines.push('- No assessment documented');
        } else {
          for (const item of parsed.assessmentAndPlan) {
            lines.push('');
            lines.push(`### ${item.priority ? `${item.priority}. ` : ''}${item.problem}`);
            lines.push(item.narrative);
            if (item.objectiveData) lines.push(`→ ${item.objectiveData}`);
            lines.push(`**Plan:** ${item.plan}`);
            if (item.followUp) lines.push(`_Follow-up: ${item.followUp}_`);
          }
        }
        break;

      case 'counseling':
        if (parsed.counseling) {
          lines.push('## Counseling / Time / Complexity');
          if (parsed.counseling.timeSpent) lines.push(`- ${parsed.counseling.timeSpent}`);
          if (parsed.counseling.mdmLevel) lines.push(`- Medical Decision-Making Level: ${parsed.counseling.mdmLevel}`);
        }
        break;

      case 'disposition':
        if (parsed.disposition) {
          lines.push('## Disposition / Follow-up');
          lines.push(parsed.disposition);
        }
        break;

      default:
        return '';
    }

    return lines.join('\n');
  };

  // Generate markdown for a single pre-chart section
  const generatePreChartSection = (preChart: PreChartParsedData | null, section: string, note?: { id?: string; content?: string; created_at?: string }): string => {
    if (!preChart) return '';
    const lines: string[] = [];
    const title = note?.created_at ? `Pre-Chart Summary (${new Date(note.created_at).toLocaleString()})` : 'Pre-Chart Summary';
    lines.push(`# ${title}`);
    lines.push('');

    switch (section) {
      case 'demographics': {
        lines.push('## Patient Demographics');
        const pd = preChart.patientDemographics;
        lines.push(`- **Name:** ${pd?.name || 'N/A'}`);
        lines.push(`- **DOB:** ${pd?.dob || 'N/A'} | **Age:** ${pd?.age || 'N/A'}`);
        lines.push(`- **Gender:** ${pd?.gender ? (pd.gender.charAt(0).toUpperCase() + pd.gender.slice(1)) : 'N/A'} | **MRN:** ${pd?.mrn || 'N/A'}`);
        lines.push(`- **Language:** ${pd?.preferredLanguage || 'N/A'}`);
        if (pd?.phone || pd?.email) lines.push(`- **Contact:** ${[pd?.phone, pd?.email].filter(Boolean).join(' | ')}`);
        if (pd?.preferredPharmacy) lines.push(`- **Pharmacy:** ${pd.preferredPharmacy}`);
        break;
      }
      case 'reason':
        lines.push("## Reason for Today's Visit");
        lines.push(preChart.reasonForVisit || 'Not specified');
        break;
      case 'activeProblemList':
        lines.push('## Active Problem List');
        if (isMissing(preChart.activeProblemList)) lines.push('- -');
        else if (isEmpty(preChart.activeProblemList)) lines.push('- No active problems documented');
        else for (const p of preChart.activeProblemList) {
          const meta = [p.onsetDate && `onset: ${p.onsetDate}`, p.status, p.control].filter(Boolean).join(' | ');
          lines.push(`- ${p.problem}${meta ? ` — ${meta}` : ''}`);
        }
        break;
      case 'medicationSummary':
        lines.push('## Medication Summary');
        if (isMissing(preChart.medicationSummary)) lines.push('- -');
        else if (isEmpty(preChart.medicationSummary)) lines.push('- No current medications');
        else for (const m of preChart.medicationSummary) {
          const dosage = [m.dose, m.route, m.frequency].filter(Boolean).join(' ');
          lines.push(`- ${m.name}${dosage ? ` — ${dosage}` : ''}${m.indication ? ` (for ${m.indication})` : ''}`);
        }
        break;
      case 'allergies':
        lines.push('## Allergies & Intolerances');
        if (isMissing(preChart.allergiesIntolerances)) lines.push('- -');
        else if (isEmpty(preChart.allergiesIntolerances)) lines.push('- No known allergies');
        else for (const a of preChart.allergiesIntolerances) lines.push(`- ${a.allergen}${a.reaction ? ` — ${a.reaction}` : ''}${a.severity ? ` (${a.severity})` : ''}`);
        break;
      case 'vitalSigns':
        lines.push('## Vital Signs Trends');
        if (!preChart.vitalSignsTrends || preChart.vitalSignsTrends.length === 0) lines.push('- No recent vital signs recorded');
        else {
          lines.push('| Date | BP | HR | Temp | Weight | SpO2 |');
          lines.push('|------|----|----|------|--------|------|');
          for (const v of preChart.vitalSignsTrends) lines.push(`| ${v.date} | ${v.bp || '-'} | ${v.hr || '-'} | ${v.temp || '-'} | ${formatWeight(v.weight) || '-'} | ${v.spo2 || '-'} |`);
        }
        break;
      case 'keyLabs':
        lines.push('## Key Labs & Results');
        if (isMissing(preChart.keyLabsResults)) lines.push('- -');
        else if (isEmpty(preChart.keyLabsResults)) lines.push('- No recent lab results');
        else for (const l of preChart.keyLabsResults) lines.push(`- ${l.name}: ${l.value}${l.unit ? ` ${l.unit}` : ''}${l.date ? ` (${l.date})` : ''}${l.status ? ` — ${l.status}` : ''}`);
        break;
      case 'immunizations':
        lines.push('## Immunizations & Preventive Care');
        const ipc = preChart.immunizationsPreventiveCare;
        if (ipc?.immunizations && ipc.immunizations.length > 0) {
          lines.push('### Immunizations');
          for (const imm of ipc.immunizations) lines.push(`- ${imm.vaccine}${imm.date ? ` — ${imm.date}` : ''}${imm.status ? ` (${imm.status})` : ''}`);
        }
        if (ipc?.preventiveCare && ipc.preventiveCare.length > 0) {
          lines.push('### Preventive Care');
          for (const pc of ipc.preventiveCare) lines.push(`- ${pc.item}${pc.lastDate ? ` — last: ${pc.lastDate}` : ''}${pc.nextDue ? ` | due: ${pc.nextDue}` : ''}${pc.status ? ` (${pc.status})` : ''}`);
        }
        break;
      case 'surgicalHistory':
        lines.push('## Past Surgical / Procedure History');
        if (isMissing(preChart.surgicalProcedureHistory)) lines.push('- -');
        else if (isEmpty(preChart.surgicalProcedureHistory)) lines.push('- No surgical or procedure history documented');
        else for (const s of preChart.surgicalProcedureHistory) lines.push(`- ${s.procedure}${s.date ? ` — ${s.date}` : ''}${s.notes ? ` (${s.notes})` : ''}`);
        break;
      case 'socialFamily':
        lines.push('## Social & Family History');
        const sfh = preChart.socialFamilyHistory;
        if (sfh?.social) {
          lines.push('### Social History');
          if (sfh.social.smoking) lines.push(`- **Smoking:** ${sfh.social.smoking}`);
          if (sfh.social.alcohol) lines.push(`- **Alcohol:** ${sfh.social.alcohol}`);
          if (sfh.social.drugs) lines.push(`- **Substances:** ${sfh.social.drugs}`);
          if (sfh.social.activityLevel) lines.push(`- **Activity:** ${sfh.social.activityLevel}`);
        }
        if (sfh) {
          const fam = (sfh.family || '').toString().trim();
          lines.push('### Family History');
          lines.push(fam && fam !== '-' ? fam : 'Not documented');
        }
        break;
      case 'intervalHistory':
        lines.push('## Interval History Since Last Visit');
        lines.push(preChart.intervalHistory || 'No interval history available');
        break;
      case 'alerts':
        lines.push('## Alerts / Overdue Items / Care Gaps');
        const aocg = preChart.alertsOverdueCareGaps;
        if (aocg?.alerts && aocg.alerts.length > 0) {
          lines.push('### Alerts');
          for (const a of aocg.alerts) lines.push(`- ${a}`);
        }
        if (aocg?.overdueItems && aocg.overdueItems.length > 0) {
          lines.push('### Overdue Items');
          for (const o of aocg.overdueItems) lines.push(`- ${o}`);
        }
        if (aocg?.careGaps && aocg.careGaps.length > 0) {
          lines.push('### Care Gaps');
          for (const g of aocg.careGaps) lines.push(`- ${g}`);
        }
        break;
      case 'lastEncounter':
        lines.push('## Last Encounter Summary');
        if (preChart.lastEncounterSummary) {
          const les = preChart.lastEncounterSummary;
          if (les.date || les.provider) lines.push(`_${[les.date, les.provider].filter(Boolean).join(' — ')}_`);
          lines.push(les.summary);
          if (les.keyTakeaways && les.keyTakeaways.length > 0) {
            lines.push('### Key Takeaways');
            for (const t of les.keyTakeaways) lines.push(`- ${t}`);
          }
        } else {
          lines.push('- No previous encounter summary available');
        }
        break;
      case 'suggestedActions':
        lines.push('## Suggested Actions / Pre-Visit Orders');
        if (!preChart.suggestedActions || preChart.suggestedActions.length === 0) lines.push('- No suggested actions at this time');
        else for (const a of preChart.suggestedActions) lines.push(`- ${a}`);
        break;
      default:
        return '';
    }

    return lines.join('\n');
  };

  // Copy a specific section to clipboard
  const copySection = async (sectionId: string) => {
    try {
      let md = '';
      if (activeTab === 'synthesis') {
        md = generateSectionMarkdown(parsedData, sectionId, currentNote || undefined) || '';
      } else {
        md = generatePreChartSection(preChartData, sectionId, currentNote || undefined) || '';
      }
      if (!md) md = 'No content available for this section';
      // Remove top-level document title (e.g., "# Clinical Synthesis Note ...") when copying a single section
      const lines = md.split('\n');
      if (lines.length > 0 && lines[0].trim().startsWith('#')) {
        // drop title line
        lines.shift();
        // drop following blank line if present
        if (lines.length > 0 && lines[0].trim() === '') lines.shift();
        md = lines.join('\n');
      }
      await navigator.clipboard.writeText(md);
      setCopiedSection(sectionId);
      setTimeout(() => setCopiedSection(null), 2000);
    } catch (e) {
      console.error('Copy failed', e);
    }
  };

  // Parse pre-chart note data
  const parsePreChartData = (content?: string): PreChartParsedData | null => {
    if (!content || !content.trim()) return null;
    try {
      const parsed = JSON.parse(content);
      if (parsed.noteType !== 'pre-chart') return null;
      return parsed as PreChartParsedData;
    } catch {
      return null;
    }
  };

  // Parse synthesis note data (original parseNoteData)
  const parseNoteData = (content?: string): ParsedData | null => {
    if (!content || !content.trim()) return null;
    
    try {
      // Try to parse as JSON first
      const parsed = JSON.parse(content);

      // If it's a pre-chart note, don't parse as synthesis
      if (parsed.noteType === 'pre-chart') return null;

      // Extract data from the JSON structure - support new and legacy formats
      const data: ParsedData = {
        subjective: {
          chiefComplaint: parsed.subjective?.chiefComplaint || parsed.chiefComplaint || 'Not documented',
          hpi: parsed.subjective?.hpi || parsed.hpi || 'Not documented',
          intervalHistory: parsed.subjective?.intervalHistory || parsed.intervalHistory || 'No changes',
          reviewOfSystems: Array.isArray(parsed.subjective?.reviewOfSystems) ? parsed.subjective.reviewOfSystems :
                          Array.isArray(parsed.reviewOfSystems) ? parsed.reviewOfSystems : []
        },
        pastMedicalHistory: {
          activeProblems: Array.isArray(parsed.pastMedicalHistory?.activeProblems) ? parsed.pastMedicalHistory.activeProblems : []
        },
        medications: {
          current: Array.isArray(parsed.medications?.current) ? parsed.medications.current :
                   Array.isArray(parsed.medications) ? parsed.medications : []
        },
        allergies: Array.isArray(parsed.allergies) ? parsed.allergies : [],
        socialFamilyHistory: {
          social: typeof parsed.socialFamilyHistory === 'string' 
            ? parsed.socialFamilyHistory 
            : parsed.socialFamilyHistory?.social || 'Not documented',
          family: typeof parsed.socialFamilyHistory === 'string'
            ? ''
            : parsed.socialFamilyHistory?.family || 'Not documented'
        },
        objective: {
          vitals: (parsed.objective?.vitals && typeof parsed.objective.vitals === 'object' && !Array.isArray(parsed.objective.vitals))
            ? parsed.objective.vitals
            : parsed.recentVitals || {},
          examFindings: Array.isArray(parsed.objective?.examFindings) ? parsed.objective.examFindings : [],
          labsImaging: Array.isArray(parsed.objective?.labsImaging) 
            ? parsed.objective.labsImaging 
            : Array.isArray(parsed.recentLabs) ? parsed.recentLabs : []
        },
        assessmentAndPlan: Array.isArray(parsed.assessmentAndPlan) ? parsed.assessmentAndPlan :
                          Array.isArray(parsed.assessment) ? parsed.assessment : [],
        counseling: parsed.counseling || undefined,
        disposition: parsed.disposition || undefined
      };

      // Preserve any edited/free-text fields that were stored in the raw JSON.
      // These fields are intentionally outside the strict ParsedData schema but
      // are used by the UI to show user edits without converting to structured fields.
      try {
        if (parsed.subjective && typeof parsed.subjective === 'object' && parsed.subjective._editedText) {
          (data.subjective as any)._editedText = parsed.subjective._editedText;
        }
        if (parsed.objective && typeof parsed.objective === 'object' && parsed.objective._editedText) {
          (data.objective as any)._editedText = parsed.objective._editedText;
        }
        if (parsed.pastMedicalHistory && typeof parsed.pastMedicalHistory === 'object' && parsed.pastMedicalHistory._editedText) {
          (data.pastMedicalHistory as any)._editedText = parsed.pastMedicalHistory._editedText;
        }
        if (parsed.medications && typeof parsed.medications === 'object' && parsed.medications._editedText) {
          (data.medications as any)._editedText = parsed.medications._editedText;
        }
        if (parsed.counseling && typeof parsed.counseling === 'object' && parsed.counseling._editedText) {
          (data.counseling as any)._editedText = parsed.counseling._editedText;
        }
        if (parsed.socialFamilyHistory && typeof parsed.socialFamilyHistory === 'object' && parsed.socialFamilyHistory._editedText) {
          (data.socialFamilyHistory as any)._editedText = parsed.socialFamilyHistory._editedText;
        }
        if (parsed._editedAssessmentText) {
          (data as any)._editedAssessmentText = parsed._editedAssessmentText;
        }
        if (parsed._editedAllergiesText) {
          (data as any)._editedAllergiesText = parsed._editedAllergiesText;
        }
      } catch (e) {
        // non-fatal: if these props are missing or malformed, continue without them
        // console.debug('No edited fields preserved', e);
      }
      
      return data;
    } catch (e) {
      // If not JSON, return null (we'll show empty state)
      console.error('Failed to parse note data:', e);
      return null;
    }
  };

  const formatWeight = (w?: string | null): string | undefined => {
    if (!w) return w as any;
    try {
      const s = w.toString().trim();
      // Extract numeric value
      const numMatch = s.match(/^([\d.]+)\s*(kg|lbs?)?$/i);
      if (numMatch) {
        const val = parseFloat(numMatch[1]);
        const unit = numMatch[2]?.toLowerCase();
        if (unit === 'kg') {
          // Convert kg to lbs
          return `${(val * 2.20462).toFixed(1)} lbs`;
        } else if (unit && /^lbs?$/i.test(unit)) {
          // Already in lbs
          return `${val.toFixed(1)} lbs`;
        } else {
          // No unit, assume kg and convert
          return `${(val * 2.20462).toFixed(1)} lbs`;
        }
      }
      // If we can't parse, return as-is
      return s;
    } catch (e) {
      return w as any;
    }
  };

  // Parse based on note type
  const parsedData = parseNoteData(currentNote?.content);
  const preChartData = parsePreChartData(currentNote?.content);

  // Fetch most-recent transcript summary for this patient (transcript-only)
  useEffect(() => {
    const controller = new AbortController();

    if (!patientId) {
      setLastTranscriptSummary(null);
      return () => controller.abort();
    }

    (async () => {
      try {
        const res = await fetch(`/api/medai/medplum/healthscribe/last-transcript-summary/${patientId}`, {
          signal: controller.signal,
        });
        if (!res.ok) {
          setLastTranscriptSummary(null);
          return;
        }
        const json = (await res.json()) as any;
        if (json?.ok && json?.lastTranscriptSummary?.summary) {
          setLastTranscriptSummary({
            date: json.lastTranscriptSummary.date,
            summary: json.lastTranscriptSummary.summary,
            provider: json.lastTranscriptSummary.provider,
          });
        } else {
          setLastTranscriptSummary(null);
        }
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          return;
        }
        setLastTranscriptSummary(null);
      }
    })();

    return () => controller.abort();
  }, [patientId]);

  const getLastTranscriptSummary = () => lastTranscriptSummary;

  if (!patientId) {
    return (
      <div className="flex flex-col h-full bg-card rounded-lg border border-border overflow-hidden">
        <div className="emr-section-header flex items-center gap-2">
          <Sparkles className="w-5 h-5" />
          <span>Synthesis</span>
        </div>
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          Select a patient to view synthesis
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-card rounded-lg border border-border overflow-hidden">
      {/* Chrome-style Tab Bar */}
      <div className="flex items-end gap-2 bg-primary px-2 pt-2 pb-0 h-12 rounded-t-lg">
        <ChromeTab 
          active={activeTab === 'synthesis'} 
          onClick={() => setActiveTab('synthesis')} 
          icon={Sparkles} 
          label="Synthesis" 
        />
        <ChromeTab 
          active={activeTab === 'pre-chart'} 
          onClick={() => setActiveTab('pre-chart')} 
          icon={FileSearch} 
          label="Pre-Chart" 
        />
      </div>

      {/* Content */}
      <div className="relative flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* Main scrollable content area */}
        <div className="flex-1 overflow-y-auto p-4 pb-24 scrollbar-thin space-y-4 min-h-0">
          {isLoading ? (
          <div className="flex flex-col items-center justify-center h-64 gap-4">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
            <p className="text-sm text-muted-foreground">
              {activeTab === 'synthesis' ? 'Generating synthesis...' : 'Generating pre-chart...'}
            </p>
          </div>
        ) : !currentNote?.content ? (
          <div className="flex flex-col items-center justify-center h-64 gap-4">
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
              {activeTab === 'synthesis' ? (
                <Sparkles className="w-8 h-8 text-muted-foreground" />
              ) : (
                <ClipboardList className="w-8 h-8 text-muted-foreground" />
              )}
            </div>
            <p className="text-sm text-muted-foreground text-center">
              {activeTab === 'synthesis' ? 'Synthesis notes will be available after first encounter is recorded.' : 'New patient, no data available.'}
            </p>
            {(showRegenerateButton || activeTab === 'pre-chart') && (
              <button
                  onClick={() => onGenerate()}
                disabled={isLoading}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? (
                  <>
                    <Sparkles className="w-4 h-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    {activeTab === 'synthesis' ? 'Generate Synthesis' : 'Generate new Pre-Chart notes'}
                  </>
                )}
              </button>
            )}
          </div>
        ) : (
          <>
            {/* Action Buttons */}
            <div className="flex gap-2">
              {showRegenerateButton && (
                <button
                  onClick={() => onGenerate()}
                  disabled={isLoading}
                  className="flex items-center gap-2 px-3 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Sparkles className="w-4 h-4" />
                  Regenerate
                </button>
              )}

              {/* Copy All button removed per request */}


            </div>

            {/* Synthesis Tab Content - SOAP Format */}
            {activeTab === 'synthesis' && parsedData && (
              <>
                {/* Subjective Section */}
                <div className="emr-medical-card">
                  <div className="emr-medical-card-header flex items-center gap-2">
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4" />
                      Subjective
                    </div>
                    <div className="ml-auto flex items-center gap-1">
                      {editingSection === 'subjective' ? (
                        <>
                          <button
                            onClick={async () => {
                                try {
                                  const originalParsed = parseNoteData(currentNote?.content);
                                  const subj = editCache.subjective || {};
                                  const updated = {
                                    ...originalParsed,
                                    subjective: {
                                      ...originalParsed?.subjective,
                                      chiefComplaint: subj.chiefComplaint !== undefined ? subj.chiefComplaint : (originalParsed?.subjective?.chiefComplaint ?? 'Not documented'),
                                      hpi: subj.hpi !== undefined ? subj.hpi : (originalParsed?.subjective?.hpi ?? 'Not documented'),
                                      intervalHistory: subj.intervalHistory !== undefined ? subj.intervalHistory : (originalParsed?.subjective?.intervalHistory ?? 'No changes'),
                                      reviewOfSystems: subj.reviewOfSystems ?? originalParsed?.subjective?.reviewOfSystems ?? []
                                    }
                                  };
                                  await onSave(JSON.stringify(updated));
                                  setEditingSection(null);
                                  setEditCache({});
                                } catch (e) {
                                  console.error('Save failed', e);
                                }
                            }}
                            disabled={isSaving}
                            className="p-1.5 text-green-600 hover:bg-green-50 rounded transition-colors"
                            title="Save"
                          >
                            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                          </button>
                          <button
                            onClick={() => {
                              setEditingSection(null);
                              setEditCache({});
                            }}
                            className="p-1.5 text-red-600 hover:bg-red-50 rounded transition-colors"
                            title="Cancel"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => setEditingSection('subjective')}
                            className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
                            title="Edit"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button onClick={() => copySection('subjective')} className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors" title="Copy">
                            {copiedSection === 'subjective' ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div>
                      {editingSection === 'subjective' ? (
                        <div className="space-y-3">
                          <div>
                            <label className="text-xs font-semibold text-muted-foreground uppercase block mb-1">Chief Complaint</label>
                            <input
                              type="text"
                              className="w-full border border-gray-300 rounded p-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-300"
                              value={editCache.subjective?.chiefComplaint ?? parsedData.subjective.chiefComplaint}
                              onChange={(e) => setEditCache(prev => ({ ...prev, subjective: { ...prev.subjective, chiefComplaint: e.target.value } }))}
                            />
                          </div>

                          <div>
                            <label className="text-xs font-semibold text-muted-foreground uppercase block mb-1">History of Present Illness</label>
                            <textarea
                              rows={4}
                              className="w-full border border-gray-300 rounded p-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-300"
                              value={editCache.subjective?.hpi ?? parsedData.subjective.hpi}
                              onChange={(e) => setEditCache(prev => ({ ...prev, subjective: { ...prev.subjective, hpi: e.target.value } }))}
                            />
                          </div>

                          <div>
                            <label className="text-xs font-semibold text-muted-foreground uppercase block mb-1">Interval History</label>
                            <textarea
                              rows={3}
                              className="w-full border border-gray-300 rounded p-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-300"
                              value={editCache.subjective?.intervalHistory ?? parsedData.subjective.intervalHistory}
                              onChange={(e) => setEditCache(prev => ({ ...prev, subjective: { ...prev.subjective, intervalHistory: e.target.value } }))}
                            />
                          </div>

                          <div>
                            <label className="text-xs font-semibold text-muted-foreground uppercase block mb-1">Review Of Systems</label>
                            <div className="space-y-2">
                              {(editCache.subjective?.reviewOfSystems ?? parsedData.subjective.reviewOfSystems ?? []).map((ros: any, idx: number) => (
                                <div key={idx} className="flex gap-2">
                                  <input
                                    type="text"
                                    className="flex-1 border border-gray-200 rounded p-1 text-sm"
                                    placeholder="System"
                                    value={ros.system || ''}
                                    onChange={(e) => {
                                      const current = [...(editCache.subjective?.reviewOfSystems ?? parsedData.subjective.reviewOfSystems ?? [])];
                                      current[idx] = { ...current[idx], system: e.target.value };
                                      setEditCache(prev => ({ ...prev, subjective: { ...prev.subjective, reviewOfSystems: current } }));
                                    }}
                                  />
                                  <input
                                    type="text"
                                    className="flex-1 border border-gray-200 rounded p-1 text-sm"
                                    placeholder="Finding"
                                    value={ros.finding || ''}
                                    onChange={(e) => {
                                      const current = [...(editCache.subjective?.reviewOfSystems ?? parsedData.subjective.reviewOfSystems ?? [])];
                                      current[idx] = { ...current[idx], finding: e.target.value };
                                      setEditCache(prev => ({ ...prev, subjective: { ...prev.subjective, reviewOfSystems: current } }));
                                    }}
                                  />
                                  <input
                                    type="text"
                                    className="w-28 border border-gray-200 rounded p-1 text-sm"
                                    placeholder="Status"
                                    value={ros.status || ''}
                                    onChange={(e) => {
                                      const current = [...(editCache.subjective?.reviewOfSystems ?? parsedData.subjective.reviewOfSystems ?? [])];
                                      current[idx] = { ...current[idx], status: e.target.value };
                                      setEditCache(prev => ({ ...prev, subjective: { ...prev.subjective, reviewOfSystems: current } }));
                                    }}
                                  />
                                </div>
                              ))}
                              <div>
                                <button
                                  onClick={() => {
                                    const current = [...(editCache.subjective?.reviewOfSystems ?? parsedData.subjective.reviewOfSystems ?? [])];
                                    current.push({ system: '', finding: '', status: '' });
                                    setEditCache(prev => ({ ...prev, subjective: { ...prev.subjective, reviewOfSystems: current } }));
                                  }}
                                  className="text-sm text-primary mt-1"
                                >
                                  + Add ROS
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <>
                          <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Chief Complaint & HPI</p>
                          <p className="text-sm text-foreground whitespace-pre-wrap">{parsedData.subjective.chiefComplaint || <span className="italic text-muted-foreground">-</span>}</p>
                          <p className="text-sm text-foreground mt-1 whitespace-pre-wrap">
                            {parsedData.subjective.hpi && parsedData.subjective.hpi !== 'Not documented' ? (
                              parsedData.subjective.hpi
                            ) : (
                              <span className="italic text-muted-foreground">-</span>
                            )}
                          </p>
                        </>
                      )}
                    </div>

                    {editingSection !== 'subjective' && (
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Interval History</p>
                        <p className="text-sm text-foreground whitespace-pre-wrap">
                          {parsedData.subjective.intervalHistory && parsedData.subjective.intervalHistory !== 'No changes' ? (
                            parsedData.subjective.intervalHistory
                          ) : parsedData.subjective.intervalHistory === 'No changes' ? (
                            <span className="italic text-muted-foreground">No changes</span>
                          ) : (
                            <span className="italic text-muted-foreground">-</span>
                          )}
                        </p>
                      </div>
                    )}
                    
                    {editingSection !== 'subjective' && parsedData.subjective.reviewOfSystems && parsedData.subjective.reviewOfSystems.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Review of Systems</p>
                        <div className="space-y-1">
                          {parsedData.subjective.reviewOfSystems.map((ros, index) => {
                            const raw = (ros.status || '').toString().toLowerCase();
                            const statusClass = raw === 'new' || raw.includes('new')
                              ? 'bg-emerald-100 text-emerald-700'
                              : raw === 'worse' || raw === 'worsening' || raw === 'worse-severity'
                              ? 'bg-amber-100 text-amber-700'
                              : raw === 'improved' || raw === 'resolved' || raw === 'better'
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-slate-100 text-slate-700';
                            const display = raw ? (raw.charAt(0).toUpperCase() + raw.slice(1)) : '';
                            return (
                              <div key={index} className="flex items-center justify-between text-sm">
                                <div>
                                  <span className="font-medium">{ros.system}:</span> {ros.finding}
                                </div>
                                {ros.status && (
                                  <div className="ml-4">
                                    <span className={cn('emr-badge text-xs flex-shrink-0', statusClass)}>{display}</span>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                {/* Objective Section */}
                <div className="emr-medical-card">
                  <div className="emr-medical-card-header flex items-center gap-2">
                    <div className="flex items-center gap-2">
                      <Stethoscope className="w-4 h-4" />
                      Objective
                    </div>
                    <div className="ml-auto flex items-center gap-1">
                      {editingSection === 'objective' ? (
                        <>
                          <button
                            onClick={async () => {
                              try {
                                const originalParsed = parseNoteData(currentNote?.content);
                                const obj = editCache.objective || {};
                                const updated = {
                                  ...originalParsed,
                                  objective: {
                                    ...originalParsed?.objective,
                                    vitals: obj.vitals ?? originalParsed?.objective?.vitals ?? {},
                                    examFindings: obj.examFindings ?? originalParsed?.objective?.examFindings ?? [],
                                    labsImaging: obj.labsImaging ?? originalParsed?.objective?.labsImaging ?? []
                                  }
                                };
                                await onSave(JSON.stringify(updated));
                                setEditingSection(null);
                                setEditCache({});
                              } catch (e) {
                                console.error('Save failed', e);
                              }
                            }}
                            disabled={isSaving}
                            className="p-1.5 text-green-600 hover:bg-green-50 rounded transition-colors"
                            title="Save"
                          >
                            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                          </button>
                          <button
                            onClick={() => {
                              setEditingSection(null);
                              setEditCache({});
                            }}
                            className="p-1.5 text-red-600 hover:bg-red-50 rounded transition-colors"
                            title="Cancel"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => setEditingSection('objective')}
                            className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
                            title="Edit"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button onClick={() => copySection('objective')} className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors" title="Copy">
                            {copiedSection === 'objective' ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="space-y-3">
                      {editingSection === 'objective' ? (
                        <div className="space-y-3">
                          <div>
                            <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Vitals</p>
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <p className="text-xs text-muted-foreground mb-1">Blood Pressure</p>
                                <input
                                  type="text"
                                  className="w-full border border-gray-200 rounded p-1 text-sm"
                                  placeholder="e.g., 120/80"
                                  value={editCache.objective?.vitals?.bloodPressure ?? parsedData.objective.vitals?.bloodPressure ?? ''}
                                  onChange={(e) => setEditCache(prev => ({ ...prev, objective: { ...(prev.objective || {}), vitals: { ...(prev.objective?.vitals || parsedData.objective.vitals || {}), bloodPressure: e.target.value } } }))}
                                />
                              </div>
                              <div>
                                <p className="text-xs text-muted-foreground mb-1">Heart Rate</p>
                                <input
                                  type="text"
                                  className="w-full border border-gray-200 rounded p-1 text-sm"
                                  placeholder="e.g., 72 bpm"
                                  value={editCache.objective?.vitals?.heartRate ?? parsedData.objective.vitals?.heartRate ?? ''}
                                  onChange={(e) => setEditCache(prev => ({ ...prev, objective: { ...(prev.objective || {}), vitals: { ...(prev.objective?.vitals || parsedData.objective.vitals || {}), heartRate: e.target.value } } }))}
                                />
                              </div>
                              <div>
                                <p className="text-xs text-muted-foreground mb-1">Temperature</p>
                                <input
                                  type="text"
                                  className="w-full border border-gray-200 rounded p-1 text-sm"
                                  placeholder="e.g., 98.6°F"
                                  value={editCache.objective?.vitals?.temperature ?? parsedData.objective.vitals?.temperature ?? ''}
                                  onChange={(e) => setEditCache(prev => ({ ...prev, objective: { ...(prev.objective || {}), vitals: { ...(prev.objective?.vitals || parsedData.objective.vitals || {}), temperature: e.target.value } } }))}
                                />
                              </div>
                              <div>
                                <p className="text-xs text-muted-foreground mb-1">Weight</p>
                                <input
                                  type="text"
                                  className="w-full border border-gray-200 rounded p-1 text-sm"
                                  placeholder="e.g., 180 lb"
                                  value={editCache.objective?.vitals?.weight ?? parsedData.objective.vitals?.weight ?? ''}
                                  onChange={(e) => setEditCache(prev => ({ ...prev, objective: { ...(prev.objective || {}), vitals: { ...(prev.objective?.vitals || parsedData.objective.vitals || {}), weight: e.target.value } } }))}
                                />
                              </div>
                            </div>
                          </div>

                          <div>
                            <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Exam Findings</p>
                            <div className="space-y-2">
                              {(editCache.objective?.examFindings ?? parsedData.objective.examFindings ?? []).map((ef: any, idx: number) => (
                                <div key={idx} className="flex gap-2">
                                  <input
                                    type="text"
                                    className="flex-1 border border-gray-200 rounded p-1 text-sm"
                                    placeholder="System"
                                    value={ef.system || ''}
                                    onChange={(e) => {
                                      const current = [...(editCache.objective?.examFindings ?? parsedData.objective.examFindings ?? [])];
                                      current[idx] = { ...current[idx], system: e.target.value };
                                      setEditCache(prev => ({ ...prev, objective: { ...prev.objective, examFindings: current } }));
                                    }}
                                  />
                                  <input
                                    type="text"
                                    className="flex-1 border border-gray-200 rounded p-1 text-sm"
                                    placeholder="Finding"
                                    value={ef.finding || ''}
                                    onChange={(e) => {
                                      const current = [...(editCache.objective?.examFindings ?? parsedData.objective.examFindings ?? [])];
                                      current[idx] = { ...current[idx], finding: e.target.value };
                                      setEditCache(prev => ({ ...prev, objective: { ...prev.objective, examFindings: current } }));
                                    }}
                                  />
                                      {/* chronic column removed from inline editing to keep UI compact */}
                                </div>
                              ))}
                              <button
                                onClick={() => {
                                  const current = [...(editCache.objective?.examFindings ?? parsedData.objective.examFindings ?? [])];
                                  current.push({ system: '', finding: '', chronic: false });
                                  setEditCache(prev => ({ ...prev, objective: { ...prev.objective, examFindings: current } }));
                                }}
                                className="text-sm text-primary mt-1"
                              >
                                + Add Exam Finding
                              </button>
                            </div>
                          </div>

                          <div>
                            <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Labs / Imaging</p>
                            <div className="space-y-2">
                              {(editCache.objective?.labsImaging ?? parsedData.objective.labsImaging ?? []).map((lab: any, idx: number) => (
                                <div key={idx} className="flex gap-2">
                                  <input
                                    className="flex-1 border border-gray-200 rounded p-1 text-sm"
                                    placeholder="Name"
                                    value={lab.name || ''}
                                    onChange={(e) => {
                                      const current = [...(editCache.objective?.labsImaging ?? parsedData.objective.labsImaging ?? [])];
                                      current[idx] = { ...current[idx], name: e.target.value };
                                      setEditCache(prev => ({ ...prev, objective: { ...prev.objective, labsImaging: current } }));
                                    }}
                                  />
                                  <input
                                    className="w-32 border border-gray-200 rounded p-1 text-sm"
                                    placeholder="Value"
                                    value={lab.value || ''}
                                    onChange={(e) => {
                                      const current = [...(editCache.objective?.labsImaging ?? parsedData.objective.labsImaging ?? [])];
                                      current[idx] = { ...current[idx], value: e.target.value };
                                      setEditCache(prev => ({ ...prev, objective: { ...prev.objective, labsImaging: current } }));
                                    }}
                                  />
                                </div>
                              ))}
                              <button
                                onClick={() => {
                                  const current = [...(editCache.objective?.labsImaging ?? parsedData.objective.labsImaging ?? [])];
                                  current.push({ name: '', value: '' });
                                  setEditCache(prev => ({ ...prev, objective: { ...prev.objective, labsImaging: current } }));
                                }}
                                className="text-sm text-primary mt-1"
                              >
                                + Add Lab/Imaging
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : (parsedData.objective as any)._editedText ? (
                      <div className="whitespace-pre-wrap text-sm text-foreground">
                        {((parsedData.objective as any)._editedText as string)
                          .split('\n')
                          .filter(line => !line.match(/^(Vitals|Exam Findings|Labs\/Imaging):/i))
                          .join('\n')
                          .trim()}
                      </div>
                    ) : (
                      <>
                    {/* Vitals */}
                    {parsedData.objective.vitals && Object.keys(parsedData.objective.vitals).length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Vitals</p>
                        <div className="space-y-2">
                          {parsedData.objective.vitals.bloodPressure && (() => {
                            const status = evaluateVitalStatus('bloodPressure', parsedData.objective.vitals.bloodPressure);
                            return (
                              <div>
                                <div className="flex items-center justify-between">
                                  <p className="text-sm text-muted-foreground">Blood Pressure</p>
                                  <span className="text-sm font-medium text-foreground">{parsedData.objective.vitals.bloodPressure}</span>
                                </div>
                                {status && (
                                  <div className="flex justify-end mt-1">
                                    <span className={cn(
                                      'emr-badge',
                                      status.tone === 'normal'
                                        ? 'bg-emerald-100 text-emerald-700'
                                        : 'bg-amber-100 text-amber-700'
                                    )}>
                                      {status.label}
                                    </span>
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                          {parsedData.objective.vitals.heartRate && (() => {
                            const status = evaluateVitalStatus('heartRate', parsedData.objective.vitals.heartRate);
                            return (
                              <div>
                                <div className="flex items-center justify-between">
                                  <p className="text-sm text-muted-foreground">Heart Rate</p>
                                  <span className="text-sm font-medium text-foreground">{parsedData.objective.vitals.heartRate}</span>
                                </div>
                                {status && (
                                  <div className="flex justify-end mt-1">
                                    <span className={cn(
                                      'emr-badge',
                                      status.tone === 'normal'
                                        ? 'bg-emerald-100 text-emerald-700'
                                        : 'bg-amber-100 text-amber-700'
                                    )}>
                                      {status.label}
                                    </span>
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                          {parsedData.objective.vitals.temperature && (() => {
                            const status = evaluateVitalStatus('temperature', parsedData.objective.vitals.temperature);
                            return (
                              <div>
                                <div className="flex items-center justify-between">
                                  <p className="text-sm text-muted-foreground">Temperature</p>
                                  <span className="text-sm font-medium text-foreground">{parsedData.objective.vitals.temperature}</span>
                                </div>
                                {status && (
                                  <div className="flex justify-end mt-1">
                                    <span className={cn(
                                      'emr-badge',
                                      status.tone === 'normal'
                                        ? 'bg-emerald-100 text-emerald-700'
                                        : 'bg-amber-100 text-amber-700'
                                    )}>
                                      {status.label}
                                    </span>
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                          {parsedData.objective.vitals.weight && (() => {
                            const status = evaluateVitalStatus('weight', parsedData.objective.vitals.weight);
                            return (
                              <div>
                                <div className="flex items-center justify-between">
                                  <p className="text-sm text-muted-foreground">Weight</p>
                                  <span className="text-sm font-medium text-foreground">{parsedData.objective.vitals.weight}</span>
                                </div>
                                {status && (
                                  <div className="flex justify-end mt-1">
                                    <span className={cn(
                                      'emr-badge',
                                      status.tone === 'normal'
                                        ? 'bg-emerald-100 text-emerald-700'
                                        : 'bg-amber-100 text-amber-700'
                                    )}>
                                      {status.label}
                                    </span>
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                          {parsedData.objective.vitals.bmi && (() => {
                            const status = evaluateVitalStatus('bmi', parsedData.objective.vitals.bmi);
                            return (
                              <div>
                                <div className="flex items-center justify-between">
                                  <p className="text-sm text-muted-foreground">BMI</p>
                                  <span className="text-sm font-medium text-foreground">{parsedData.objective.vitals.bmi}</span>
                                </div>
                                {status && (
                                  <div className="flex justify-end mt-1">
                                    <span className={cn(
                                      'emr-badge',
                                      status.tone === 'normal'
                                        ? 'bg-emerald-100 text-emerald-700'
                                        : 'bg-amber-100 text-amber-700'
                                    )}>
                                      {status.label}
                                    </span>
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                        {parsedData.objective.vitals.lastUpdated && (
                          <p className="text-xs text-muted-foreground mt-2">Last updated: {parsedData.objective.vitals.lastUpdated}</p>
                        )}
                      </div>
                    )}
                    
                    {/* Exam Findings */}
                    {parsedData.objective.examFindings && parsedData.objective.examFindings.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Exam Findings</p>
                        <div className="space-y-1">
                          {parsedData.objective.examFindings.map((exam, index) => (
                            <div key={index} className="text-sm">
                              <span className="font-medium">{exam.system}:</span> {exam.finding}
                              {exam.chronic && (
                                <span className="ml-2 text-xs text-muted-foreground">(chronic)</span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    {/* Labs/Imaging */}
                    {parsedData.objective.labsImaging && parsedData.objective.labsImaging.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Labs / Imaging</p>
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
                                const labsByName = new Map<string, typeof parsedData.objective.labsImaging>();

                                parsedData.objective.labsImaging.forEach((lab) => {
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
                                    const isExpanded = expandedObjectiveLabs.has(labName);
                                    const status = evaluateLabStatus(mostRecent.name, mostRecent.value);

                                    const rows = [
                                      <tr key={labName} className="border-b border-border hover:bg-muted/30">
                                        <td className="py-2 px-2">
                                          {hasHistory && (
                                            <button
                                              onClick={() => toggleObjectiveLabExpansion(labName)}
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
                      </div>
                    )}

                    {/* Empty state when no objective data */}
                    {(!parsedData.objective.vitals || Object.keys(parsedData.objective.vitals).length === 0) &&
                     (!parsedData.objective.examFindings || parsedData.objective.examFindings.length === 0) &&
                     (!parsedData.objective.labsImaging || parsedData.objective.labsImaging.length === 0) && (
                      <p className="text-sm text-muted-foreground">-</p>
                    )}
                      </>
                    )}
                  </div>
                </div>

                {/* Assessment & Plan */}
                <div className="emr-medical-card">
                  <div className="emr-medical-card-header flex items-center gap-2">
                    <div className="flex items-center gap-2">
                      <Lightbulb className="w-4 h-4" />
                      Assessment & Plan
                    </div>
                    <div className="ml-auto flex items-center gap-1">
                      {editingSection === 'assessmentAndPlan' ? (
                        <>
                          <button
                            onClick={async () => {
                              try {
                                const originalParsed = parseNoteData(currentNote?.content);
                                // Save structured assessment array
                                const updated = { 
                                  ...originalParsed, 
                                  assessmentAndPlan: editCache.assessmentAndPlan?.items || originalParsed?.assessmentAndPlan || []
                                };
                                await onSave(JSON.stringify(updated));
                                setEditingSection(null);
                                setEditCache({});
                              } catch (e) {
                                console.error('Save failed', e);
                              }
                            }}
                            disabled={isSaving}
                            className="p-1.5 text-green-600 hover:bg-green-50 rounded transition-colors"
                            title="Save"
                          >
                            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                          </button>
                          <button
                            onClick={() => {
                              setEditingSection(null);
                              setEditCache({});
                            }}
                            className="p-1.5 text-red-600 hover:bg-red-50 rounded transition-colors"
                            title="Cancel"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => setEditingSection('assessmentAndPlan')}
                            className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
                            title="Edit"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button onClick={() => copySection('assessmentAndPlan')} className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors" title="Copy">
                            {copiedSection === 'assessmentAndPlan' ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  {editingSection === 'assessmentAndPlan' ? (
                    <div className="space-y-3">
                      {(editCache.assessmentAndPlan?.items || parsedData.assessmentAndPlan || []).map((item: any, index: number) => (
                        <div key={index} className="p-3 border border-gray-300 rounded bg-muted/30">
                          <div className="space-y-2">
                            <div>
                              <label className="text-xs font-semibold text-muted-foreground uppercase block mb-1">Problem</label>
                              <input
                                type="text"
                                className="w-full px-2 py-1 text-sm border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-300"
                                placeholder="Problem/diagnosis"
                                value={item.problem || ''}
                                onChange={(e) => {
                                  const updated = [...(editCache.assessmentAndPlan?.items || parsedData.assessmentAndPlan || [])];
                                  updated[index] = { ...updated[index], problem: e.target.value };
                                  setEditCache(prev => ({ ...prev, assessmentAndPlan: { items: updated } }));
                                }}
                              />
                            </div>
                            <div>
                              <label className="text-xs font-semibold text-muted-foreground uppercase block mb-1">Assessment Narrative</label>
                              <textarea
                                className="w-full px-2 py-1 text-sm border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-300"
                                rows={2}
                                placeholder="Clinical assessment"
                                value={item.narrative || ''}
                                onChange={(e) => {
                                  const updated = [...(editCache.assessmentAndPlan?.items || parsedData.assessmentAndPlan || [])];
                                  updated[index] = { ...updated[index], narrative: e.target.value };
                                  setEditCache(prev => ({ ...prev, assessmentAndPlan: { items: updated } }));
                                }}
                              />
                            </div>
                            <div>
                              <label className="text-xs font-semibold text-muted-foreground uppercase block mb-1">Plan</label>
                              <textarea
                                className="w-full px-2 py-1 text-sm border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-300"
                                rows={2}
                                placeholder="Treatment plan"
                                value={item.plan || ''}
                                onChange={(e) => {
                                  const updated = [...(editCache.assessmentAndPlan?.items || parsedData.assessmentAndPlan || [])];
                                  updated[index] = { ...updated[index], plan: e.target.value };
                                  setEditCache(prev => ({ ...prev, assessmentAndPlan: { items: updated } }));
                                }}
                              />
                            </div>
                            <div className="flex gap-2">
                              <div className="flex-1">
                                <label className="text-xs font-semibold text-muted-foreground uppercase block mb-1">Objective Data</label>
                                <input
                                  type="text"
                                  className="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-300"
                                  placeholder="Supporting data"
                                  value={item.objectiveData || ''}
                                  onChange={(e) => {
                                    const updated = [...(editCache.assessmentAndPlan?.items || parsedData.assessmentAndPlan || [])];
                                    updated[index] = { ...updated[index], objectiveData: e.target.value };
                                    setEditCache(prev => ({ ...prev, assessmentAndPlan: { items: updated } }));
                                  }}
                                />
                              </div>
                              <div className="flex-1">
                                <label className="text-xs font-semibold text-muted-foreground uppercase block mb-1">Follow-up</label>
                                <input
                                  type="text"
                                  className="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-300"
                                  placeholder="Follow-up instructions"
                                  value={item.followUp || ''}
                                  onChange={(e) => {
                                    const updated = [...(editCache.assessmentAndPlan?.items || parsedData.assessmentAndPlan || [])];
                                    updated[index] = { ...updated[index], followUp: e.target.value };
                                    setEditCache(prev => ({ ...prev, assessmentAndPlan: { items: updated } }));
                                  }}
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (parsedData as any)._editedAssessmentText ? (
                    <div className="whitespace-pre-wrap text-sm text-foreground">
                      {((parsedData as any)._editedAssessmentText as string).trim()}
                    </div>
                  ) : !parsedData.assessmentAndPlan || parsedData.assessmentAndPlan.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No assessment documented</p>
                  ) : (
                    <div className="space-y-3">
                      {parsedData.assessmentAndPlan.map((item, index) => (
                        <div key={index} className="p-3 bg-muted/30 rounded-md border border-border">
                          <div className="flex items-start gap-2 mb-2">
                            {item.priority && (
                              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">
                                {item.priority}
                              </span>
                            )}
                            <p className="text-sm font-semibold text-foreground">{item.problem}</p>
                          </div>
                          <div className="space-y-2 text-sm">
                            <p className="text-foreground">{item.narrative}</p>
                            {item.objectiveData && (
                              <p className="text-muted-foreground">→ {item.objectiveData}</p>
                            )}
                            <p className="text-foreground font-medium">Plan: {item.plan}</p>
                            {item.followUp && (
                              <p className="text-xs text-muted-foreground italic">{item.followUp}</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Past Medical History - Active Problems */}
                <div className="emr-medical-card">
                  <div className="emr-medical-card-header flex items-center gap-2">
                    <div className="flex items-center gap-2">
                      <Activity className="w-4 h-4" />
                      Past Medical History - Active Problem List
                    </div>
                    <div className="ml-auto flex items-center gap-1">
                      {editingSection === 'pastMedicalHistory' ? (
                        <>
                          <button
                            onClick={async () => {
                              try {
                                const originalParsed = parseNoteData(currentNote?.content);
                                // Save structured problem array
                                const updated = { 
                                  ...originalParsed, 
                                  pastMedicalHistory: { 
                                    activeProblems: editCache.pastMedicalHistory?.problems || originalParsed?.pastMedicalHistory?.activeProblems || []
                                  } 
                                };
                                await onSave(JSON.stringify(updated));
                                setEditingSection(null);
                                setEditCache({});
                              } catch (e) {
                                console.error('Save failed', e);
                              }
                            }}
                            disabled={isSaving}
                            className="p-1.5 text-green-600 hover:bg-green-50 rounded transition-colors"
                            title="Save"
                          >
                            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                          </button>
                          <button
                            onClick={() => {
                              setEditingSection(null);
                              setEditCache({});
                            }}
                            className="p-1.5 text-red-600 hover:bg-red-50 rounded transition-colors"
                            title="Cancel"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => setEditingSection('pastMedicalHistory')}
                            className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
                            title="Edit"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button onClick={() => copySection('pastMedicalHistory')} className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors" title="Copy">
                            {copiedSection === 'pastMedicalHistory' ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  {editingSection === 'pastMedicalHistory' ? (
                    <div className="space-y-2">
                      {(editCache.pastMedicalHistory?.problems || parsedData.pastMedicalHistory.activeProblems || []).map((problem: any, index: number) => (
                        <div key={index} className="p-2 border border-gray-300 rounded bg-muted/30">
                          <input
                            type="text"
                            className="w-full mb-1 px-2 py-1 text-sm border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-300"
                            placeholder="Problem"
                            value={problem.problem || ''}
                            onChange={(e) => {
                              const updated = [...(editCache.pastMedicalHistory?.problems || parsedData.pastMedicalHistory.activeProblems || [])];
                              updated[index] = { ...updated[index], problem: e.target.value };
                              setEditCache(prev => ({ ...prev, pastMedicalHistory: { problems: updated } }));
                            }}
                          />
                          <div className="flex gap-2">
                            <input
                              type="text"
                              className="flex-1 px-2 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-300"
                              placeholder="Dx Date"
                              value={problem.dxDate || ''}
                              onChange={(e) => {
                                const updated = [...(editCache.pastMedicalHistory?.problems || parsedData.pastMedicalHistory.activeProblems || [])];
                                updated[index] = { ...updated[index], dxDate: e.target.value };
                                setEditCache(prev => ({ ...prev, pastMedicalHistory: { problems: updated } }));
                              }}
                            />
                            <input
                              type="text"
                              className="flex-1 px-2 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-300"
                              placeholder="Status/Control"
                              value={problem.status || problem.control || ''}
                              onChange={(e) => {
                                const updated = [...(editCache.pastMedicalHistory?.problems || parsedData.pastMedicalHistory.activeProblems || [])];
                                updated[index] = { ...updated[index], status: e.target.value };
                                setEditCache(prev => ({ ...prev, pastMedicalHistory: { problems: updated } }));
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (parsedData.pastMedicalHistory as any)._editedText ? (
                    <div className="whitespace-pre-wrap text-sm text-foreground">
                      {((parsedData.pastMedicalHistory as any)._editedText as string).trim()}
                    </div>
                  ) : isMissing(parsedData.pastMedicalHistory?.activeProblems) ? (
                    <p className="text-sm text-muted-foreground italic">-</p>
                  ) : isEmpty(parsedData.pastMedicalHistory.activeProblems) ? (
                    <p className="text-sm text-muted-foreground italic">No active problems documented</p>
                  ) : (
                    <div className="space-y-2">
                      {parsedData.pastMedicalHistory.activeProblems.map((problem, index) => (
                        <div key={index} className="flex items-start justify-between">
                          <div>
                            <p className="text-sm font-medium text-foreground">
                              {problem.problem}
                              {problem.newToday && (
                                <span className="ml-2 emr-badge bg-blue-100 text-blue-700 text-xs">New Today</span>
                              )}
                            </p>
                            {problem.dxDate && (
                              <p className="text-xs text-muted-foreground">Date Recorded: {problem.dxDate}</p>
                            )}
                          </div>
                          {(problem.status || problem.control) && (() => {
                                    const raw = ((problem.control || problem.status) || '').toString();
                                    const normalized = raw.trim().toLowerCase();
                                    let displayText = '';
                                    let badgeClass = 'bg-slate-100 text-slate-700';

                                    if (!normalized || normalized === 'unknown') {
                                      displayText = 'Active';
                                      badgeClass = 'bg-blue-100 text-blue-700';
                                    } else if (normalized === 'current' || normalized === 'controlled') {
                                      displayText = normalized.charAt(0).toUpperCase() + normalized.slice(1).replace('-', ' ');
                                      badgeClass = 'bg-emerald-100 text-emerald-700';
                                    } else if (normalized === 'active' || normalized === 'uncontrolled') {
                                      displayText = normalized.charAt(0).toUpperCase() + normalized.slice(1).replace('-', ' ');
                                      badgeClass = 'bg-amber-100 text-amber-700';
                                    } else {
                                      displayText = normalized.charAt(0).toUpperCase() + normalized.slice(1).replace('-', ' ');
                                      badgeClass = 'bg-slate-100 text-slate-700';
                                    }

                                    return <span className={cn('emr-badge ml-4 flex-shrink-0', badgeClass)}>{displayText}</span>;
                          })()}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Medications */}
                <div className="emr-medical-card">
                  <div className="emr-medical-card-header flex items-center gap-2">
                    <div className="flex items-center gap-2">
                      <Pill className="w-4 h-4" />
                      Medications
                    </div>
                    <div className="ml-auto flex items-center gap-1">
                      {editingSection === 'medications' ? (
                        <>
                          <button
                            onClick={async () => {
                              try {
                                const originalParsed = parseNoteData(currentNote?.content);
                                // Save structured medication array
                                const updated = { 
                                  ...originalParsed, 
                                  medications: { 
                                    current: editCache.medications?.meds || originalParsed?.medications?.current || []
                                  } 
                                };
                                await onSave(JSON.stringify(updated));
                                setEditingSection(null);
                                setEditCache({});
                              } catch (e) {
                                console.error('Save failed', e);
                              }
                            }}
                            disabled={isSaving}
                            className="p-1.5 text-green-600 hover:bg-green-50 rounded transition-colors"
                            title="Save"
                          >
                            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                          </button>
                          <button
                            onClick={() => {
                              setEditingSection(null);
                              setEditCache({});
                            }}
                            className="p-1.5 text-red-600 hover:bg-red-50 rounded transition-colors"
                            title="Cancel"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => setEditingSection('medications')}
                            className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
                            title="Edit"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button onClick={() => copySection('medications')} className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors" title="Copy">
                            {copiedSection === 'medications' ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  {editingSection === 'medications' ? (
                    <div className="space-y-2">
                      {(editCache.medications?.meds || parsedData.medications.current || []).map((med: any, index: number) => (
                        <div key={index} className="p-2 border border-gray-300 rounded bg-muted/30">
                          <input
                            type="text"
                            className="w-full mb-1 px-2 py-1 text-sm border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-300"
                            placeholder="Medication name"
                            value={med.name || ''}
                            onChange={(e) => {
                              const updated = [...(editCache.medications?.meds || parsedData.medications.current || [])];
                              updated[index] = { ...updated[index], name: e.target.value };
                              setEditCache(prev => ({ ...prev, medications: { meds: updated } }));
                            }}
                          />
                          <div className="flex gap-2">
                            <input
                              type="text"
                              className="flex-1 px-2 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-300"
                              placeholder="Dose"
                              value={med.dose || ''}
                              onChange={(e) => {
                                const updated = [...(editCache.medications?.meds || parsedData.medications.current || [])];
                                updated[index] = { ...updated[index], dose: e.target.value };
                                setEditCache(prev => ({ ...prev, medications: { meds: updated } }));
                              }}
                            />
                            <input
                              type="text"
                              className="flex-1 px-2 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-300"
                              placeholder="Route"
                              value={med.route || ''}
                              onChange={(e) => {
                                const updated = [...(editCache.medications?.meds || parsedData.medications.current || [])];
                                updated[index] = { ...updated[index], route: e.target.value };
                                setEditCache(prev => ({ ...prev, medications: { meds: updated } }));
                              }}
                            />
                            <input
                              type="text"
                              className="flex-1 px-2 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-300"
                              placeholder="Frequency"
                              value={med.frequency || ''}
                              onChange={(e) => {
                                const updated = [...(editCache.medications?.meds || parsedData.medications.current || [])];
                                updated[index] = { ...updated[index], frequency: e.target.value };
                                setEditCache(prev => ({ ...prev, medications: { meds: updated } }));
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (parsedData.medications as any)._editedText ? (
                    <div className="whitespace-pre-wrap text-sm text-foreground">
                      {((parsedData.medications as any)._editedText as string).trim()}
                    </div>
                  ) : isMissing(parsedData.medications?.current) ? (
                    <p className="text-sm text-muted-foreground italic">-</p>
                  ) : isEmpty(parsedData.medications.current) ? (
                    <p className="text-sm text-muted-foreground italic">No medications documented</p>
                  ) : (
                    <div className="space-y-2">
                      {parsedData.medications.current.map((med, index) => (
                          <div key={index} className="text-sm">
                            <div className="flex items-center justify-between">
                              <p className="font-medium text-foreground">
                                {med.name} {med.dose}
                              </p>
                              {med.change && (
                                <div className="ml-4 flex-shrink-0">
                                  <span className={cn(
                                    "emr-badge text-xs",
                                    med.change === 'new' || med.change === 'increased'
                                      ? 'bg-emerald-100 text-emerald-700'
                                      : med.change === 'stopped' || med.change === 'decreased'
                                      ? 'bg-red-100 text-red-700'
                                      : 'bg-blue-100 text-blue-700'
                                  )}>
                                    {med.change.charAt(0).toUpperCase() + med.change.slice(1)}
                                  </span>
                                </div>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {[med.route, med.frequency].filter(Boolean).join(', ')}
                            </p>
                          </div>
                        ))}
                    </div>
                  )}
                </div>

                {/* Allergies / Alerts */}
                <div className="emr-medical-card">
                  <div className="emr-medical-card-header flex items-center gap-2">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4" />
                      Allergies / Alerts
                    </div>
                    <div className="ml-auto flex items-center gap-1">
                      {editingSection === 'allergies' ? (
                        <>
                          <button
                            onClick={async () => {
                              try {
                                const originalParsed = parseNoteData(currentNote?.content);
                                  // Store structured allergies array
                                  const updated = { 
                                    ...originalParsed, 
                                    allergies: editCache.allergies?.items || originalParsed?.allergies || []
                                  };
                                await onSave(JSON.stringify(updated));
                                setEditingSection(null);
                                setEditCache({});
                              } catch (e) {
                                console.error('Save failed', e);
                              }
                            }}
                            disabled={isSaving}
                            className="p-1.5 text-green-600 hover:bg-green-50 rounded transition-colors"
                            title="Save"
                          >
                            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                          </button>
                          <button
                            onClick={() => {
                              setEditingSection(null);
                              setEditCache({});
                            }}
                            className="p-1.5 text-red-600 hover:bg-red-50 rounded transition-colors"
                            title="Cancel"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => setEditingSection('allergies')}
                            className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
                            title="Edit"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button onClick={() => copySection('allergies')} className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors" title="Copy">
                            {copiedSection === 'allergies' ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                      {editingSection === 'allergies' ? (
                        <div className="space-y-2">
                          {(editCache.allergies?.items ?? parsedData.allergies ?? []).map((allergy: any, idx: number) => (
                            <div key={idx} className="p-2 border border-gray-200 rounded bg-muted/30">
                              <input
                                type="text"
                                className="w-full mb-1 px-2 py-1 text-sm border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-300"
                                placeholder="Allergen"
                                value={allergy.allergen || ''}
                                onChange={(e) => {
                                  const current = [...(editCache.allergies?.items ?? parsedData.allergies ?? [])];
                                  current[idx] = { ...current[idx], allergen: e.target.value };
                                  setEditCache(prev => ({ ...prev, allergies: { items: current } }));
                                }}
                              />
                              <div className="flex gap-2">
                                <input
                                  type="text"
                                  className="flex-1 px-2 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-300"
                                  placeholder="Reaction"
                                  value={allergy.reaction || ''}
                                  onChange={(e) => {
                                    const current = [...(editCache.allergies?.items ?? parsedData.allergies ?? [])];
                                    current[idx] = { ...current[idx], reaction: e.target.value };
                                    setEditCache(prev => ({ ...prev, allergies: { items: current } }));
                                  }}
                                />
                                <input
                                  type="text"
                                  className="w-28 px-2 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-300"
                                  placeholder="Severity"
                                  value={allergy.severity || ''}
                                  onChange={(e) => {
                                    const current = [...(editCache.allergies?.items ?? parsedData.allergies ?? [])];
                                    current[idx] = { ...current[idx], severity: e.target.value };
                                    setEditCache(prev => ({ ...prev, allergies: { items: current } }));
                                  }}
                                />
                              </div>
                            </div>
                          ))}
                          <button
                            onClick={() => {
                              const current = [...(editCache.allergies?.items ?? parsedData.allergies ?? [])];
                              current.push({ allergen: '', reaction: '', severity: '' });
                              setEditCache(prev => ({ ...prev, allergies: { items: current } }));
                            }}
                            className="text-sm text-primary mt-1"
                          >
                            + Add Allergy
                          </button>
                        </div>
                      ) : (parsedData as any)._editedAllergiesText ? (
                    <div className="whitespace-pre-wrap text-sm text-foreground">
                      {((parsedData as any)._editedAllergiesText as string).trim()}
                    </div>
                  ) : isMissing(parsedData.allergies) ? (
                    <p className="text-sm text-muted-foreground italic">-</p>
                  ) : isEmpty(parsedData.allergies) ? (
                    <p className="text-sm text-muted-foreground italic">No known allergies</p>
                  ) : (
                    <div className="space-y-2">
                      {parsedData.allergies.map((allergy, index) => {
                        // Derive severity: prefer explicit allergy.severity, then inspect FHIR-style reaction[] entries
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
                        // Treat missing or explicit 'unknown' severities as 'moderate'
                        let normalized = (raw || 'moderate').toString().toLowerCase();
                        if (normalized === 'unknown') normalized = 'moderate';
                        const displaySeverity = normalized.charAt(0).toUpperCase() + normalized.slice(1);
                        const severityClass = normalized === 'severe' || normalized === 'high'
                          ? 'bg-red-100 text-red-700'
                          : normalized === 'moderate'
                          ? 'bg-amber-100 text-amber-700'
                          : normalized === 'mild' || normalized === 'low'
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-amber-100 text-amber-700';

                        return (
                          <div key={index} className="flex items-center justify-between">
                            <div>
                              <p className="text-sm font-medium text-foreground">{allergy.allergen}</p>
                              <p className="text-xs text-muted-foreground">{Array.isArray(allergy.reaction) ? (allergy.reaction.map((r:any)=>r.text || r.manifestation?.[0]?.text).filter(Boolean).join(', ')) : allergy.reaction}</p>
                            </div>
                            <span className={cn("emr-badge ml-4 flex-shrink-0", severityClass)}>
                              {displaySeverity}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Social & Family History */}
                <div className="emr-medical-card">
                  <div className="emr-medical-card-header flex items-center gap-2">
                    <div className="flex items-center gap-2">
                      <Users className="w-4 h-4" />
                      Social & Family History
                    </div>
                    <div className="ml-auto flex items-center gap-1">
                      {editingSection === 'socialFamilyHistory' ? (
                        <>
                          <button
                            onClick={async () => {
                              try {
                                const originalParsed = parseNoteData(currentNote?.content);
                                // Save structured social and family fields
                                const updated = {
                                  ...originalParsed,
                                  socialFamilyHistory: {
                                    social: editCache.socialFamilyHistory?.social !== undefined ? editCache.socialFamilyHistory.social : (originalParsed?.socialFamilyHistory?.social || 'Not documented'),
                                    family: editCache.socialFamilyHistory?.family !== undefined ? editCache.socialFamilyHistory.family : (originalParsed?.socialFamilyHistory?.family || 'Not documented')
                                  }
                                };
                                await onSave(JSON.stringify(updated));
                                setEditingSection(null);
                                setEditCache({});
                              } catch (e) {
                                console.error('Save failed', e);
                              }
                            }}
                            disabled={isSaving}
                            className="p-1.5 text-green-600 hover:bg-green-50 rounded transition-colors"
                            title="Save"
                          >
                            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                          </button>
                          <button
                            onClick={() => {
                              setEditingSection(null);
                              setEditCache({});
                            }}
                            className="p-1.5 text-red-600 hover:bg-red-50 rounded transition-colors"
                            title="Cancel"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => setEditingSection('socialFamilyHistory')}
                            className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
                            title="Edit"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button onClick={() => copySection('socialFamilyHistory')} className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors" title="Copy">
                            {copiedSection === 'socialFamilyHistory' ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  {editingSection === 'socialFamilyHistory' ? (
                    <div className="space-y-2">
                      <div>
                        <label className="text-xs font-semibold text-muted-foreground uppercase block mb-1">Social</label>
                        <textarea
                          className="w-full border border-gray-300 rounded p-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-300"
                          rows={3}
                          placeholder="Social history"
                          value={editCache.socialFamilyHistory?.social ?? parsedData.socialFamilyHistory.social}
                          onChange={(e) => setEditCache(prev => ({
                            ...prev,
                            socialFamilyHistory: { 
                              ...prev.socialFamilyHistory,
                              social: e.target.value,
                              family: prev.socialFamilyHistory?.family ?? parsedData.socialFamilyHistory.family
                            }
                          }))}
                        />
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-muted-foreground uppercase block mb-1">Family</label>
                        <textarea
                          className="w-full border border-gray-300 rounded p-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-300"
                          rows={3}
                          placeholder="Family history"
                          value={editCache.socialFamilyHistory?.family ?? parsedData.socialFamilyHistory.family}
                          onChange={(e) => setEditCache(prev => ({
                            ...prev,
                            socialFamilyHistory: { 
                              ...prev.socialFamilyHistory,
                              social: prev.socialFamilyHistory?.social ?? parsedData.socialFamilyHistory.social,
                              family: e.target.value
                            }
                          }))}
                        />
                      </div>
                    </div>
                  ) : (parsedData.socialFamilyHistory as any)._editedText ? (
                    <div className="whitespace-pre-wrap text-sm text-foreground">
                      {((parsedData.socialFamilyHistory as any)._editedText as string)
                        .split('\n')
                        .filter(line => !line.match(/^(Social|Family):/i))
                        .join('\n')
                        .trim()}
                    </div>
                  ) : (
                    <div className="space-y-2">
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Social</p>
                      <p className="text-sm text-foreground">
                        {parsedData.socialFamilyHistory.social || <span className="italic text-muted-foreground">-</span>}
                      </p>
                    </div>
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Family</p>
                        <p className="text-sm text-foreground">
                          {parsedData.socialFamilyHistory.family && parsedData.socialFamilyHistory.family !== 'Not documented' ? (
                            parsedData.socialFamilyHistory.family
                          ) : (
                            <span className="italic text-muted-foreground">-</span>
                          )}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
                

                {/* Counseling / Time / Complexity */}
                {parsedData.counseling && (
                  <div className="emr-medical-card">
                    <div className="emr-medical-card-header flex items-center gap-2">
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4" />
                        Counseling / Time / Complexity
                      </div>
                      <div className="ml-auto flex items-center gap-1">
                        {editingSection === 'counseling' ? (
                          <>
                            <button
                              onClick={async () => {
                                try {
                                  const originalParsed = parseNoteData(currentNote?.content);
                                  // Save structured counseling fields
                                  const updated = { 
                                    ...originalParsed, 
                                    counseling: { 
                                      timeSpent: editCache.counseling?.timeSpent ?? (originalParsed?.counseling?.timeSpent || ''),
                                      mdmLevel: editCache.counseling?.mdmLevel ?? (originalParsed?.counseling?.mdmLevel || '')
                                    } 
                                  };
                                  await onSave(JSON.stringify(updated));
                                  setEditingSection(null);
                                  setEditCache({});
                                } catch (e) {
                                  console.error('Save failed', e);
                                }
                              }}
                              disabled={isSaving}
                              className="p-1.5 text-green-600 hover:bg-green-50 rounded transition-colors"
                              title="Save"
                            >
                              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                            </button>
                            <button
                              onClick={() => {
                                setEditingSection(null);
                                setEditCache({});
                              }}
                              className="p-1.5 text-red-600 hover:bg-red-50 rounded transition-colors"
                              title="Cancel"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => setEditingSection('counseling')}
                              className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
                              title="Edit"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button onClick={() => copySection('counseling')} className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors" title="Copy">
                              {copiedSection === 'counseling' ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    {editingSection === 'counseling' ? (
                      <div className="space-y-2">
                        <div>
                          <label className="text-xs font-semibold text-muted-foreground uppercase block mb-1">Time Spent</label>
                          <input
                            type="text"
                            className="w-full border border-gray-300 rounded p-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-300"
                            placeholder="e.g., 30 minutes"
                            value={editCache.counseling?.timeSpent ?? (parsedData.counseling?.timeSpent || '')}
                            onChange={(e) => setEditCache(prev => ({
                              ...prev,
                              counseling: { 
                                ...prev.counseling,
                                timeSpent: e.target.value,
                                mdmLevel: prev.counseling?.mdmLevel ?? parsedData.counseling?.mdmLevel
                              }
                            }))}
                          />
                        </div>
                        <div>
                          <label className="text-xs font-semibold text-muted-foreground uppercase block mb-1">MDM Level</label>
                          <input
                            type="text"
                            className="w-full border border-gray-300 rounded p-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-300"
                            placeholder="e.g., Moderate"
                            value={editCache.counseling?.mdmLevel ?? (parsedData.counseling?.mdmLevel || '')}
                            onChange={(e) => setEditCache(prev => ({
                              ...prev,
                              counseling: { 
                                ...prev.counseling,
                                timeSpent: prev.counseling?.timeSpent ?? parsedData.counseling?.timeSpent,
                                mdmLevel: e.target.value
                              }
                            }))}
                          />
                        </div>
                      </div>
                    ) : (parsedData.counseling as any)._editedText ? (
                      <div className="whitespace-pre-wrap text-sm text-foreground">
                        {((parsedData.counseling as any)._editedText as string).trim()}
                      </div>
                    ) : (
                      <div className="space-y-1 text-sm">
                        {parsedData.counseling.timeSpent && (
                          <p className="text-foreground">{parsedData.counseling.timeSpent}</p>
                        )}
                        {parsedData.counseling.mdmLevel && (
                          <p className="text-muted-foreground">MDM Level: {parsedData.counseling.mdmLevel}</p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Disposition / Follow-up */}
                {parsedData.disposition && (
                  <div className="emr-medical-card">
                    <div className="emr-medical-card-header flex items-center gap-2">
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4" />
                        Disposition / Follow-up
                      </div>
                      <div className="ml-auto flex items-center gap-1">
                        {editingSection === 'disposition' ? (
                          <>
                            <button
                              onClick={async () => {
                                try {
                                  const originalParsed = parseNoteData(currentNote?.content);
                                  // Store edited disposition text
                                  const updated = {
                                    ...originalParsed,
                                    disposition: editCache.disposition?.text !== undefined ? editCache.disposition.text : originalParsed?.disposition
                                  };
                                  await onSave(JSON.stringify(updated));
                                  setEditingSection(null);
                                  setEditCache({});
                                } catch (e) {
                                  console.error('Save failed', e);
                                }
                              }}
                              disabled={isSaving}
                              className="p-1.5 text-green-600 hover:bg-green-50 rounded transition-colors"
                              title="Save"
                            >
                              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                            </button>
                            <button
                              onClick={() => {
                                setEditingSection(null);
                                setEditCache({});
                              }}
                              className="p-1.5 text-red-600 hover:bg-red-50 rounded transition-colors"
                              title="Cancel"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => setEditingSection('disposition')}
                              className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
                              title="Edit"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button onClick={() => copySection('disposition')} className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors" title="Copy">
                              {copiedSection === 'disposition' ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    {editingSection === 'disposition' ? (
                      <textarea
                        className="w-full border border-gray-300 rounded p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 font-mono"
                        rows={3}
                        value={editCache.disposition?.text ?? parsedData.disposition}
                        onChange={(e) => setEditCache(prev => ({
                          ...prev,
                          disposition: { text: e.target.value }
                        }))}
                      />
                    ) : (
                      <p className="text-sm text-foreground">
                        {parsedData.disposition || <span className="italic text-muted-foreground">-</span>}
                      </p>
                    )}
                  </div>
                )}
              </>
            )}

            {/* Synthesis fallback when no parsed data */}
            {activeTab === 'synthesis' && !parsedData && currentNote && (
              <div className="text-sm text-muted-foreground text-center py-8">
                Unable to parse synthesis note data. The note may be in an old format.
              </div>
            )}

            {/* Pre-Chart Tab Content */}
            {activeTab === 'pre-chart' && preChartData && (
              <PreChartTabContent
                preChartData={preChartData}
                copySection={copySection}
                copiedSection={copiedSection}
                getLastTranscriptSummary={getLastTranscriptSummary}
                onGeneratePreChart={onGeneratePreChart}
                preChartLoading={preChartLoading}
              />
            )}

            {/* Pre-Chart fallback when no parsed data */}
            {activeTab === 'pre-chart' && !preChartData && currentNote && (
              <div className="flex flex-col items-center justify-center gap-4 py-8">
                <div className="text-sm text-muted-foreground text-center">
                  Unable to parse pre-chart note data. The note may be in an old format.
                </div>
                <button
                  onClick={() => onGeneratePreChart()}
                  disabled={preChartLoading}
                  className="flex items-center gap-2 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {preChartLoading ? (
                    <>
                      <Sparkles className="w-4 h-4 animate-spin" />
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
          </>
          )}
          </div>

            {/* Previous Notes Section - Animated overlay with traveling header */}
            {!isLoading && (
              <div
                className={cn(
                  "absolute inset-x-0 bottom-0 z-40 bg-card border-t border-border flex flex-col transition-all duration-500 ease-in-out",
                  showPreviousNotes
                    ? 'top-0'
                    : 'top-[calc(100%-53px)]'
                )}
              >
                {/* Header that travels up */}
                <button
                  onClick={() => setShowPreviousNotes(!showPreviousNotes)}
                  className="flex items-center gap-2 text-sm font-medium text-foreground hover:text-primary transition-colors p-4 hover:bg-muted flex-shrink-0 border-b border-border"
                >
                  {showPreviousNotes ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  <Clock className="w-4 h-4" />
                  Previous {activeTab === 'synthesis' ? 'Synthesis' : 'Pre-Chart'} Notes ({historyNotes.length})
                </button>

                {/* Content area - only visible when expanded */}
                {showPreviousNotes && (
                  <div className="flex-1 overflow-y-auto p-4">
                    <div className="space-y-2">
                {historyNotes.map((note) => {
                  const date = note.created_at
                    ? new Date(note.created_at).toLocaleDateString('en-US', {
                        month: '2-digit',
                        day: '2-digit',
                        year: 'numeric'
                      })
                    : 'Unknown date';
                  let parsed = null;
                  if (note.content) {
                    try {
                      parsed = JSON.parse(note.content);
                    } catch {
                      // leave parsed as null
                    }
                  }
                  return (
                    <DropdownNote
                      key={note.id || Math.random()}
                      date={date}
                      preview=""
                      content={note.content}
                      parsed={parsed}
                      noteType={activeTab}
                      getLastTranscriptSummary={getLastTranscriptSummary}
                    />
                  );
                })}
                    </div>
                  </div>
                )}
              </div>
            )}
        </div>
      </div>
  );
};
