"use client";
import { useState, useEffect } from 'react';
import { X, FileText, Copy, Check, Sparkles, Pencil, Save, Loader2, ChevronDown, ChevronRight } from 'lucide-react';

interface SmartSynthesisModalProps {
  isOpen: boolean;
  onClose: () => void;
  patientId: string;
  note: { id?: string; content?: string; created_at?: string } | null;
  loading: boolean;
  onGenerate: () => Promise<void>;
  onSave: (content: string) => Promise<void>;
  isSaving: boolean;
}

interface ParsedSection {
  title: string;
  content: string;
  color: string;
}

export function SmartSynthesisModal({ 
  isOpen, 
  onClose, 
  patientId, 
  note, 
  loading, 
  onGenerate, 
  onSave, 
  isSaving 
}: SmartSynthesisModalProps) {
  const [copiedSection, setCopiedSection] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (note?.content && !isEditing) {
      setEditContent(note.content);
      // Auto-open all sections on initial load
      const sections = parseSections(note.content);
      const initialOpen: Record<string, boolean> = {};
      sections.forEach((s, idx) => { initialOpen[`section-${idx}`] = true; });
      setOpenSections(initialOpen);
    }
  }, [note, isEditing]);

  const copyToClipboard = async (text: string, section: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedSection(section);
      setTimeout(() => setCopiedSection(null), 2000);
    } catch (e) {
      console.error('Copy failed', e);
    }
  };

  const startEdit = () => {
    setEditContent(note?.content || '');
    setIsEditing(true);
  };

  const cancelEdit = () => {
    setIsEditing(false);
    setEditContent(note?.content || '');
  };

  const handleSave = async () => {
    await onSave(editContent);
    setIsEditing(false);
  };

  const toggleSection = (key: string) => {
    setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // Parse content into sections based on ## headers or JSON structure
  const tryParseJsonNote = (text?: string): any | null => {
    if (!text) return null;
    try {
      const obj = JSON.parse(text);
      if (obj && typeof obj === 'object' && obj.pastMedicalHistory) return obj;
    } catch {}
    return null;
  };

  const parseSections = (text?: string): ParsedSection[] => {
    if (!text || !text.trim()) return [];
    const json = tryParseJsonNote(text);
    if (json) {
      const sections: ParsedSection[] = [];
      const subj = json.subjective || {};
      sections.push({
        title: 'Subjective',
        content: [
          `• Chief Complaint & HPI: ${subj.chiefComplaintHPI || 'Not documented'}`,
          `• Interval History: ${subj.intervalHistory || 'Not documented'}`,
          `• Review of Systems: ${subj.reviewOfSystems || 'Not documented'}`
        ].join('\n'),
        color: 'blue'
      });
      const pmhx = json.pastMedicalHistory || {};
      const active = (pmhx.activeProblems || []).map((p: any) => `- ${p.problem}${p.status ? ` (status: ${p.status})` : ''}${p.control ? `, control: ${p.control}` : ''}${p.dxDate ? `, dx: ${p.dxDate}` : ''}`).join('\n') || 'None';
      const inactive = (pmhx.inactiveProblems || []).map((p: any) => `- ${p.problem}${p.resolvedDate ? ` (resolved, ${p.resolvedDate})` : ''}`).join('\n') || 'None';
      const surgical = (pmhx.surgicalHistory || []).map((s: any) => `- ${s.procedure}${s.date ? ` (${s.date})` : ''}`).join('\n') || 'None';
      sections.push({
        title: 'Past Medical History',
        content: [`Active Problem List:\n${active}`, `Inactive/Resolved Problems:\n${inactive}`, `Surgical History:\n${surgical}`].join('\n\n'),
        color: 'purple'
      });
      const meds = (json.medications?.current || []).map((m: any) => {
        const parts = [m.name].concat([m.dose, m.route, m.frequency].filter(Boolean));
        const line = `- ${parts.join(' ')}`;
        const changeTag = m.change === 'NEW' ? '**← NEW**' : m.change === 'STOPPED' ? '**← STOPPED**' : m.change === 'DOSE_INCREASE' ? '**← DOSE INCREASE**' : m.change === 'DOSE_DECREASE' ? '**← DOSE DECREASE**' : '';
        return changeTag ? `${line} ${changeTag}` : line;
      }).join('\n') || '- None';
      sections.push({ title: 'Medications', content: `• Current Medications:\n${meds}`, color: 'green' });
      const allergies = (json.allergies || []).map((a: any) => `- ${a.allergen}${a.reaction ? ` (${a.reaction})` : ''}${a.severity ? ` [${a.severity}]` : ''}`).join('\n') || '- None';
      sections.push({ title: 'Allergies', content: allergies, color: 'red' });
      sections.push({ title: 'Social/Family History', content: json.socialFamilyHistory || 'Not documented', color: 'teal' });
      const obj = json.objective || {};
      sections.push({ title: 'Objective', content: [`• Vitals Today: ${obj.vitals || 'Not documented'}`, `• Physical Exam: ${obj.physicalExam || 'Not documented'}`, `• Labs/Imaging: ${obj.labsImaging || 'None'}`].join('\n'), color: 'yellow' });
      const ap = (json.assessmentPlan || []).map((item: any, idx: number) => (
        [`${idx + 1}. ${item.problem}`, `• Brief narrative summary: ${item.summary}`, `• Supporting objective data: ${item.objective}`, `• Plan for this visit: ${item.plan}`, `• Follow-up / patient instructions: ${item.followUp}`].join('\n')
      )).join('\n\n') || 'None';
      sections.push({ title: 'Assessment & Plan', content: ap, color: 'indigo' });
      const counsel = (json.counseling || []).map((c: string) => `• ${c}`).join('\n') || 'None';
      sections.push({ title: 'Counseling / Time / Complexity', content: counsel, color: 'orange' });
      sections.push({ title: 'Disposition / Follow-up', content: `• ${json.disposition || 'Not documented'}`, color: 'blue' });
      return sections;
    }
    
    const lines = text.split('\n');
    const sections: ParsedSection[] = [];
    let currentSection: ParsedSection | null = null;
    
    // Color palette for sections (9 colors for 9 sections)
    const colors = ['blue', 'green', 'yellow', 'purple', 'pink', 'indigo', 'red', 'orange', 'teal'];
    let colorIndex = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      
      // Check for ## headers (main sections)
      if (trimmed.startsWith('## ')) {
        if (currentSection) {
          sections.push(currentSection);
        }
        const title = trimmed.replace(/^##\s*/, '');

        // Prefer explicit color mapping for important clinical sections
        const normalized = title.toLowerCase();
        let assignedColor = colors[colorIndex % colors.length];
        if (/\b(objective)\b/i.test(normalized)) {
          assignedColor = 'teal';
        } else if (/\b(social|family|history)\b/i.test(normalized)) {
          assignedColor = 'teal';
        } else if (/\b(counseling|time|complexity)\b/i.test(normalized)) {
          assignedColor = 'teal';
        }

        currentSection = {
          title,
          content: '',
          color: assignedColor
        };
        colorIndex++;
      } else if (currentSection) {
        currentSection.content += line + '\n';
      } else if (trimmed) {
        // Content before first section
        if (sections.length === 0) {
          currentSection = {
            title: 'Overview',
            content: line + '\n',
            color: 'gray'
          };
        }
      }
    }
    
    if (currentSection) {
      sections.push(currentSection);
    }
    
    return sections;
  };

  const formatSectionContent = (text: string) => {
    if (!text || !text.trim()) {
      return <span className="text-gray-500 italic">Not documented</span>;
    }

    const lines = text.split('\n').filter(line => line.trim());
    
    return (
      <div className="space-y-1">
        {lines.map((line, idx) => {
          const trimmed = line.trim();
          if (trimmed.startsWith('###')) {
            return <h4 key={idx} className="font-semibold text-base mt-3 mb-1">{trimmed.replace(/^###\s*/, '')}</h4>;
          }
          if (trimmed.startsWith('##')) {
            return <h3 key={idx} className="font-semibold text-lg mt-4 mb-2">{trimmed.replace(/^##\s*/, '')}</h3>;
          }
          if (trimmed.startsWith('#')) {
            return <h2 key={idx} className="font-bold text-xl mt-4 mb-2">{trimmed.replace(/^#\s*/, '')}</h2>;
          }
          // Medication change highlighting: check before generic list rendering
          // (so markers like **← NEW** can be highlighted)
          const isMedLine = /^[-•]/.test(trimmed) || /\b(mg|mcg|tablet|capsule|dose|BID|TID|q\d+h)/i.test(trimmed);
          const isNew = /\*\*←\s*NEW\*\*/.test(trimmed);
          const isStopped = /\*\*←\s*STOPPED\*\*/.test(trimmed);
          const doseInc = /\*\*←\s*DOSE INCREASE\*\*/.test(trimmed);
          const doseDec = /\*\*←\s*DOSE DECREASE\*\*/.test(trimmed);
          if (isMedLine && (isNew || isStopped || doseInc || doseDec)) {
            const parts = trimmed.split(/\*\*/);
            const color = isStopped || doseDec ? '#b91c1c' : '#15803d';
            return (
              <p key={idx}>
                {parts.map((part, i) => {
                  if (part.includes('← NEW') || part.includes('← STOPPED') || part.includes('← DOSE INCREASE') || part.includes('← DOSE DECREASE')) {
                    return <span key={i} style={{ color, fontWeight: 'bold' }}>{part}</span>;
                  }
                  return <span key={i}>{part}</span>;
                })}
              </p>
            );
          }

          if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
            return <li key={idx} className="ml-4">{trimmed.substring(2)}</li>;
          }
          if (/^\d+\.\s/.test(trimmed)) {
            return <li key={idx} className="ml-4 list-decimal">{trimmed.replace(/^\d+\.\s/, '')}</li>;
          }
          if (trimmed.startsWith('**') && trimmed.endsWith('**')) {
            return <p key={idx} className="font-semibold">{trimmed.replace(/\*\*/g, '')}</p>;
          }
          return <p key={idx}>{trimmed}</p>;
        })}
      </div>
    );
  };

  const formatFullNote = () => {
    if (!note?.content) return '';
    return note.content;
  };

  const CopyButton = ({ section, text }: { section: string; text: string }) => {
    const isCopied = copiedSection === section;
    return (
      <button
        onClick={(e) => {
          e.stopPropagation();
          copyToClipboard(text, section);
        }}
        className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
        title={`Copy ${section}`}
      >
        {isCopied ? (
          <Check className="w-4 h-4 text-green-600" />
        ) : (
          <Copy className="w-4 h-4" />
        )}
      </button>
    );
  };

  // Color mapping functions for inline styles (Tailwind doesn't support dynamic classes)
  const getColorBg = (color: string) => {
    const map: Record<string, string> = {
      blue: '#eff6ff', green: '#f0fdf4', yellow: '#fefce8', purple: '#faf5ff',
      pink: '#fdf2f8', indigo: '#eef2ff', red: '#fef2f2', orange: '#fff7ed', teal: '#f0fdfa', gray: '#f9fafb'
    };
    return map[color] || map.gray;
  };

  const getColorBgHover = (color: string) => {
    const map: Record<string, string> = {
      blue: '#dbeafe', green: '#dcfce7', yellow: '#fef9c3', purple: '#f3e8ff',
      pink: '#fce7f3', indigo: '#e0e7ff', red: '#fee2e2', orange: '#ffedd5', teal: '#ccfbf1', gray: '#f3f4f6'
    };
    return map[color] || map.gray;
  };

  const getColorText = (color: string) => {
    const map: Record<string, string> = {
      blue: '#1e3a8a', green: '#14532d', yellow: '#713f12', purple: '#581c87',
      pink: '#831843', indigo: '#312e81', red: '#7f1d1d', orange: '#7c2d12', teal: '#115e59', gray: '#1f2937'
    };
    return map[color] || map.gray;
  };

  const sections = note ? parseSections(note.content) : [];

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-7xl max-h-[90vh] rounded-xl shadow-xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b bg-gradient-to-r from-blue-50 to-teal-50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-50 rounded-lg">
              <FileText className="w-5 h-5 text-blue-600" />
            </div>
            <h2 className="text-xl font-bold text-gray-900">Smart Synthesis Notes</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-500 hover:text-gray-700 text-3xl leading-none hover:bg-gray-100 rounded-lg transition-colors"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Actions Bar */}
        {note && (
          <div className="flex items-center justify-end gap-2 px-6 py-3 border-b bg-gray-50">
            {!isEditing && (
              <button
                onClick={startEdit}
                className="text-sm inline-flex items-center gap-1.5 px-4 py-2 rounded-md border bg-white hover:bg-gray-50 transition-colors"
                title="Edit Smart Synthesis note"
              >
                <Pencil className="w-4 h-4" />
                Edit
              </button>
            )}
            <button
              onClick={() => copyToClipboard(formatFullNote(), 'all')}
              className="text-sm inline-flex items-center gap-1.5 px-4 py-2 rounded-md border bg-white hover:bg-gray-50 transition-colors"
              title="Copy entire note"
            >
              {copiedSection === 'all' ? (
                <>
                  <Check className="w-4 h-4 text-green-600" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  Copy All
                </>
              )}
            </button>
            <button
              onClick={onGenerate}
              disabled={loading}
              className="text-sm inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-teal-600 text-white hover:bg-teal-700 disabled:bg-gray-400 transition-colors"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Generating…
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  Regenerate
                </>
              )}
            </button>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          {loading ? (
            <div className="text-base text-gray-600 flex items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading Smart Synthesis note…
            </div>
          ) : !note ? (
            <div className="space-y-4">
              <div className="text-base text-gray-500 italic">
                No Smart Synthesis notes yet. Record a visit to generate.
              </div>
              <button
                onClick={onGenerate}
                disabled={loading}
                className="text-base inline-flex items-center gap-2 px-5 py-3 rounded-md bg-teal-600 text-white hover:bg-teal-700 disabled:bg-gray-400 transition-colors"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Generating…
                  </>
                ) : (
                  <>
                    <Sparkles className="w-5 h-5" />
                    Generate Smart Synthesis
                  </>
                )}
              </button>
            </div>
          ) : (
            <div>
              {isEditing ? (
                <textarea
                  className="w-full border border-gray-300 rounded p-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-200"
                  rows={25}
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                />
              ) : sections.length > 0 ? (
                <div className="space-y-4">
                  {sections.map((section, idx) => {
                    const sectionKey = `section-${idx}`;
                    const isOpen = openSections[sectionKey] !== false; // Default open
                    
                    return (
                      <div key={idx} className="border rounded-lg overflow-hidden shadow-sm">
                        <button
                          onClick={() => toggleSection(sectionKey)}
                          className="w-full flex items-center justify-between px-4 py-3 transition-colors"
                          style={{
                            backgroundColor: getColorBg(section.color),
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = getColorBgHover(section.color)}
                          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = getColorBg(section.color)}
                        >
                          <div className="flex items-center gap-2">
                            {isOpen ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
                            <span className="font-semibold text-lg" style={{ color: getColorText(section.color) }}>{section.title.toUpperCase()}</span>
                          </div>
                          <CopyButton section={section.title} text={section.content.trim()} />
                        </button>
                        {isOpen && (
                          <div className="px-4 py-3 bg-white text-base text-gray-700 leading-relaxed">
                            {formatSectionContent(section.content)}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="prose prose-base max-w-none whitespace-pre-wrap text-base text-gray-800 leading-relaxed">
                  {formatSectionContent(note.content || '')}
                </div>
              )}

              {isEditing && (
                <div className="mt-4 flex items-center justify-end gap-2">
                  <button
                    onClick={cancelEdit}
                    className="text-sm inline-flex items-center gap-1.5 px-4 py-2 rounded-md border bg-white hover:bg-gray-50 transition-colors"
                  >
                    <X className="w-4 h-4" />
                    Cancel
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={isSaving}
                    className="text-sm inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-400 transition-colors"
                  >
                    {isSaving ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Saving…
                      </>
                    ) : (
                      <>
                        <Save className="w-4 h-4" />
                        Save
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
