"use client";
import { useState, useEffect } from 'react';
import { X, ClipboardList, Copy, Check, Sparkles, Pencil, Save, Loader2, ChevronDown, ChevronRight } from 'lucide-react';

interface PreChartNotesModalProps {
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

export function PreChartNotesModal({ 
  isOpen, 
  onClose, 
  patientId, 
  note, 
  loading, 
  onGenerate, 
  onSave, 
  isSaving 
}: PreChartNotesModalProps) {
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

  // Parse content into sections based on ## headers
  const parseSections = (text?: string): ParsedSection[] => {
    if (!text || !text.trim()) return [];
    
    const lines = text.split('\n');
    const sections: ParsedSection[] = [];
    let currentSection: ParsedSection | null = null;
    
    // Color palette for sections
    const colors = ['blue', 'green', 'purple', 'orange', 'pink', 'indigo', 'teal', 'red', 'yellow'];
    let colorIndex = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      
      // Check for ## headers (main sections)
      if (trimmed.startsWith('## ')) {
        if (currentSection) {
          sections.push(currentSection);
        }
        const title = trimmed.replace(/^##\s*/, '');

        // Assign colors based on section type
        let assignedColor = colors[colorIndex % colors.length];
        const normalized = title.toLowerCase();
        if (normalized.includes('chief complaint')) {
          assignedColor = 'blue';
        } else if (normalized.includes('red flags') || normalized.includes('safety')) {
          assignedColor = 'red';
        } else if (normalized.includes('interval events')) {
          assignedColor = 'yellow';
        } else if (normalized.includes('active problem') || normalized.includes('problem list')) {
          assignedColor = 'orange';
        } else if (normalized.includes('medication')) {
          assignedColor = 'purple';
        } else if (normalized.includes('preventive') || normalized.includes('recommendations')) {
          assignedColor = 'green';
        } else if (normalized.includes('labs')) {
          assignedColor = 'teal';
        } else if (normalized.includes('vitals') || normalized.includes('trend')) {
          assignedColor = 'indigo';
        } else if (normalized.includes('quick tasks') || normalized.includes('clinician')) {
          assignedColor = 'pink';
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
            title: 'Summary',
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

    // Common units mapping for known metrics
    const unitsMapping: Record<string, string> = {
      weight: 'kg',
      wt: 'kg',
      height: 'cm',
      ht: 'cm',
      temperature: '°F',
      temp: '°F',
      bp: 'mmHg',
      'blood pressure': 'mmHg',
      pulse: 'bpm',
      'heart rate': 'bpm',
      respirations: 'breaths/min',
      rr: 'breaths/min',
      spo2: '%',
      saturation: '%',
      glucose: 'mg/dL',
      hgb: 'g/dL',
      hemoglobin: 'g/dL',
      sodium: 'mmol/L',
      potassium: 'mmol/L',
      creatinine: 'mg/dL',
      bun: 'mg/dL',
      bmi: 'kg/m2',
    };

    const findUnitForLabel = (label: string) => {
      if (!label) return undefined;
      const nl = label.toLowerCase();
      for (const key of Object.keys(unitsMapping)) {
        if (nl.includes(key)) return unitsMapping[key];
      }
      return undefined;
    };

    const formatValueWithUnit = (value: string, label: string) => {
      if (!value || valueLooksLikeHasUnit(value)) return value;
      
      const nl = label.toLowerCase();
      
      // Special handling for weight: show both kg and lbs
      if (nl.includes('weight') || nl === 'wt') {
        const numVal = parseFloat(value);
        if (!isNaN(numVal)) {
          const lbs = (numVal * 2.20462).toFixed(1);
          return `${value} kg (${lbs} lbs)`;
        }
      }
      
      // Standard unit append for other metrics
      const unit = findUnitForLabel(label);
      return unit ? `${value} ${unit}` : value;
    };

    const valueLooksLikeHasUnit = (val: string) => {
      if (!val) return false;
      return /[a-zA-Z%°\/]/.test(val);
    };
    
    // Detect if this is a table (contains pipes) or a whitespace-separated table
    const hasPipeTable = lines.some(line => line.includes('|'));
    const whitespaceLines = lines.filter(line => /\s{2,}|\t/.test(line));
    const hasWhitespaceTable = whitespaceLines.length >= 2;

    if (hasPipeTable) {
      const tableLines = lines.filter(line => line.includes('|'));
      if (tableLines.length > 0) {
        let dataLines = tableLines.slice(1);
        if (dataLines.length > 0 && /^[:\-\s|]+$/.test(dataLines[0])) {
          dataLines = dataLines.slice(1);
        }

        const headers = tableLines[0].split('|').map(h => h.trim());
        const rows = dataLines.map(line => line.split('|').map(c => c.trim()));

        const labelIdx = 0;
        const unitIdx = headers.findIndex(h => /unit(s)?/i.test(h));

        return (
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse">
              <thead>
                <tr className="bg-gray-100">
                  {headers.map((h, i) => (
                    <th key={i} className="border px-3 py-2 text-left text-sm font-semibold">{h || ''}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, ri) => (
                  <tr key={ri} className="hover:bg-gray-50">
                    {headers.map((h, ci) => {
                      let cell = row[ci] ?? '';
                      cell = cell.trim();

                      if (unitIdx === -1 && ci !== labelIdx && cell && cell !== '-') {
                        const label = h || headers[ci] || '';
                        cell = formatValueWithUnit(cell, label);
                      }

                      return (
                        <td key={ci} className="border px-3 py-2 text-sm">{cell || '-'}</td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
    }

    if (hasWhitespaceTable) {
      const tableLines = whitespaceLines;
      const splitCols = (ln: string) => ln.split(/\s{2,}|\t/).map(c => c.trim());
      const headers = splitCols(tableLines[0]);
      const dataLines = tableLines.slice(1);
      const rows = dataLines.map(line => splitCols(line));

      const labelIdx = 0;
      const unitIdx = headers.findIndex(h => /unit(s)?/i.test(h));

      return (
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse">
            <thead>
              <tr className="bg-gray-100">
                {headers.map((h, i) => (
                  <th key={i} className="border px-3 py-2 text-left text-sm font-semibold">{h || ''}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri} className="hover:bg-gray-50">
                  {headers.map((h, ci) => {
                    let cell = row[ci] ?? '';
                    cell = cell.trim();

                    if (unitIdx === -1 && ci !== labelIdx && cell && cell !== '-') {
                      const label = h || headers[ci] || '';
                      cell = formatValueWithUnit(cell, label);
                    }

                    return (
                      <td key={ci} className="border px-3 py-2 text-sm">{cell || '-'}</td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    
    return (
      <div className="space-y-1">
        {lines.map((line, idx) => {
          let trimmed = line.trim();

          const kvMatch = trimmed.match(/^(.+?)[\:\-\t]{1,3}\s*(.+)$/);
          if (kvMatch) {
            const label = kvMatch[1].trim();
            let value = kvMatch[2].trim();
            if (value && !valueLooksLikeHasUnit(value)) {
              const unit = findUnitForLabel(label);
              if (unit) value = `${value} ${unit}`;
            }
            trimmed = `${label}: ${value}`;
          }
          if (trimmed.startsWith('###')) {
            return <h4 key={idx} className="font-semibold text-base mt-3 mb-1">{trimmed.replace(/^###\s*/, '')}</h4>;
          }
          if (trimmed.startsWith('##')) {
            return <h3 key={idx} className="font-semibold text-lg mt-4 mb-2">{trimmed.replace(/^##\s*/, '')}</h3>;
          }
          if (trimmed.startsWith('#')) {
            return <h2 key={idx} className="font-bold text-xl mt-4 mb-2">{trimmed.replace(/^#\s*/, '')}</h2>;
          }
          if (trimmed.startsWith('- ') || trimmed.startsWith('* ') || trimmed.startsWith('• ')) {
            return <li key={idx} className="ml-4">{trimmed.substring(2)}</li>;
          }
          if (trimmed.startsWith('☐ ')) {
            return <li key={idx} className="ml-4 flex items-start"><span className="mr-2">☐</span><span>{trimmed.substring(2)}</span></li>;
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

  // Color mapping functions for inline styles
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

  const getDisplayTitle = (title: string) => {
    const normalized = (title || '').toLowerCase();
    if (normalized.includes('red flags') || normalized.includes('safety')) {
      return 'Concerning features';
    }
    return title;
  };

  const shouldDisplaySection = (title: string) => {
    if (!title) return true;
    const normalized = title.toLowerCase().trim();
    // Hide the generic Summary section
    if (normalized === 'summary') return false;
    // Hide "Chief complaint for today" specifically
    if (normalized.includes('chief complaint') && normalized.includes('today')) return false;
    return true;
  };

  const sections = note ? parseSections(note.content) : [];
  const visibleSections = sections.filter(s => shouldDisplaySection(s.title));

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-7xl max-h-[90vh] rounded-xl shadow-xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b bg-gradient-to-r from-indigo-50 to-purple-50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-50 rounded-lg">
              <ClipboardList className="w-5 h-5 text-indigo-600" />
            </div>
            <h2 className="text-xl font-bold text-gray-900">Pre-Chart Notes</h2>
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
                title="Edit Pre-Chart note"
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
              className="text-sm inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-gray-400 transition-colors"
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
              Loading Pre-Chart notes…
            </div>
          ) : !note ? (
            <div className="space-y-4">
              <div className="text-base text-gray-500 italic">
                No Pre-Chart notes yet. Generate a summary of patient's medical history.
              </div>
              <button
                onClick={onGenerate}
                disabled={loading}
                className="text-base inline-flex items-center gap-2 px-5 py-3 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-gray-400 transition-colors"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Generating…
                  </>
                ) : (
                  <>
                    <Sparkles className="w-5 h-5" />
                    Generate Pre-Chart Notes
                  </>
                )}
              </button>
            </div>
          ) : (
            <div>
              {isEditing ? (
                <textarea
                  className="w-full border border-gray-300 rounded p-3 text-base focus:outline-none focus:ring-2 focus:ring-indigo-200"
                  rows={25}
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                />
              ) : visibleSections.length > 0 ? (
                <div className="space-y-4">
                  {visibleSections.map((section, idx) => {
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
                            <span className="font-semibold text-lg" style={{ color: getColorText(section.color) }}>{getDisplayTitle(section.title)}</span>
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
