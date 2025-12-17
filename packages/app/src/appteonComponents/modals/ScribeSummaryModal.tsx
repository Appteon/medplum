'use client';
import { useState } from 'react';
import { useMedplum } from '@medplum/react';
import { X, Cpu, Copy, Check, Sparkles, Loader2, ScrollText } from 'lucide-react';

interface ScribeSummaryModalProps {
  isOpen: boolean;
  onClose: () => void;
  patientId: string;
  scribeNotes: Record<string, string>;
  scribeLoading: boolean;
  scribeRegenerating: boolean;
  hsTimeline: Array<{ segmentId: string; startSec: number | null; endSec: number | null; speaker?: string; text: string }>;
  onRegenerate: () => Promise<void>;
  httpBase: string;
}

export function ScribeSummaryModal({ 
  isOpen,
  onClose,
  patientId, 
  scribeNotes, 
  scribeLoading, 
  scribeRegenerating, 
  hsTimeline,
  onRegenerate,
  httpBase
}: ScribeSummaryModalProps) {
  const medplum = useMedplum();
  const [selectedModel, setSelectedModel] = useState<'llama' | 'openai' | 'xai'>('llama');
  const [copiedSection, setCopiedSection] = useState<string | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);

  const copyToClipboard = async (text: string, section: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedSection(section);
      setTimeout(() => setCopiedSection(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const formatTime = (sec: number | null | undefined) => {
    if (sec == null || Number.isNaN(sec)) return '';
    const s = Math.max(0, Math.floor(Number(sec)));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, '0')}`;
  };

  async function handleFetchTranscriptDebug() {
    if (!patientId) return;

    try {
      console.log('=== DEBUG: Fetching latest transcript ===');
      
      // Search for ALL DocumentReferences for this patient
      const raw: any = await medplum.searchResources(
        'DocumentReference',
        `subject=Patient/${patientId}&_count=100&_sort=-date`
      );

      // Normalize Medplum responses: some clients return an array, others a Bundle
      const allDocs: any[] = Array.isArray(raw)
        ? raw
        : Array.isArray(raw?.entry)
        ? raw.entry.map((e: any) => e.resource)
        : [];

      console.log('DEBUG: Total DocumentReferences found:', allDocs.length);

      // Filter for transcripts and sort by event time descending
      const transcripts = allDocs.filter((doc: any) => {
        const cats = Array.isArray(doc.category) ? doc.category : [];
        const isTranscript = cats.some((c: any) => 
          Array.isArray(c.coding) && c.coding.some((cd: any) => cd.code === 'transcript')
        );
        console.log('DEBUG: Doc', doc.id, 'isTranscript:', isTranscript, 'date:', doc.date, 'indexed:', doc.indexed, 'created:', doc.created, 'meta.lastUpdated:', doc?.meta?.lastUpdated);
        return isTranscript;
      });
      
      console.log('DEBUG: Filtered transcripts:', transcripts.length);
      
      // Sort by event time descending using date first, then indexed/created
      const getTimestamp = (d: any) => {
        const maybe = d?.date || d?.indexed || d?.created || 0;
        return new Date(maybe).getTime() || 0;
      };

      transcripts.sort((a: any, b: any) => getTimestamp(b) - getTimestamp(a));

      // Try to align using DiagnosticReport.issued by matching job name
      try {
        const drRaw: any = await medplum.searchResources(
          'DiagnosticReport',
          `subject=Patient/${patientId}&_count=50&_sort=-issued`
        );
        const drs: any[] = Array.isArray(drRaw)
          ? drRaw
          : Array.isArray(drRaw?.entry)
          ? drRaw.entry.map((e: any) => e.resource)
          : [];
        const hsReports = drs.filter((dr: any) => {
          const cats = Array.isArray(dr.category) ? dr.category : [];
          return cats.some((c: any) => Array.isArray(c.coding) && c.coding.some((cd: any) => cd.code === 'healthscribe'));
        });
        hsReports.sort((a: any, b: any) => new Date(b.issued || 0).getTime() - new Date(a.issued || 0).getTime());
        const latestDr = hsReports[0];
        const jobNameExt = latestDr?.extension?.find((ext: any) => ext.url === 'http://medplum.com/fhir/StructureDefinition/healthscribe-job-name');
        const drJobName = jobNameExt?.valueString || null;
        if (drJobName) {
          const matched = transcripts.find((t: any) => Array.isArray(t.extension) && t.extension.some((ext: any) => ext.url === 'http://medplum.com/fhir/StructureDefinition/healthscribe-job-name' && ext.valueString === drJobName));
          if (matched) {
            console.log('DEBUG: Aligning transcript with DiagnosticReport jobName:', drJobName, '->', matched.id);
            transcripts.sort((a: any, b: any) => (a.id === matched.id ? -1 : b.id === matched.id ? 1 : getTimestamp(b) - getTimestamp(a)));
          }
        }
      } catch (e) {
        console.error('DEBUG: DiagnosticReport alignment failed:', e);
      }

      const transcriptDoc = transcripts[0] || null;

      if (!transcriptDoc) {
        alert('No transcript found. Available categories:\n' + 
          allDocs.slice(0, 5).map(d => `- ${d.id}: ${JSON.stringify(d.category)}`).join('\n'));
        return;
      }

      console.log('DEBUG: Latest transcript doc:', transcriptDoc.id, 'date:', transcriptDoc.date);

      // Extract transcript text
      let transcriptText = '';
      if (transcriptDoc.content?.[0]?.attachment?.data) {
        try {
          transcriptText = atob(transcriptDoc.content[0].attachment.data);
          console.log('DEBUG: Decoded from base64');
        } catch (e) {
          console.error('DEBUG: Failed to decode base64 transcript:', e);
        }
      } else if (transcriptDoc.content?.[0]?.attachment?.url) {
        try {
          const textResp = await fetch(transcriptDoc.content[0].attachment.url);
          if (textResp.ok) {
            transcriptText = await textResp.text();
            console.log('DEBUG: Fetched from URL');
          }
        } catch (e) {
          console.error('DEBUG: Failed to fetch transcript via URL:', e);
        }
      }

      console.log('DEBUG: Transcript text length:', transcriptText.length);
      console.log('DEBUG: Transcript preview (first 500 chars):', transcriptText.substring(0, 500));
      
      alert(`Latest Transcript Found!\n\nDocument ID: ${transcriptDoc.id}\nDate: ${transcriptDoc.date}\nLength: ${transcriptText.length} characters\n\nPreview:\n${transcriptText.substring(0, 300)}...`);
    } catch (e: any) {
      console.error('DEBUG: Error fetching transcript:', e);
      alert(`Error: ${e.message}`);
    }
  }

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
        <div className="bg-white w-full max-w-7xl max-h-[90vh] rounded-xl shadow-xl flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b bg-gradient-to-r from-purple-50 to-pink-50">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-50 rounded-lg">
                <Cpu className="w-5 h-5 text-purple-600" />
              </div>
              <h2 className="text-xl font-bold text-gray-900">Scribe Notes</h2>
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
          <div className="flex items-center justify-between px-6 py-3 border-b bg-gray-50">
            <div className="flex-1 max-w-xs">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                AI Model
              </label>
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value as 'llama' | 'openai' | 'xai')}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-200"
              >
                <option value="llama">Llama 3 (AWS Bedrock)</option>
                <option value="openai">GPT-4o Mini (OpenAI)</option>
                <option value="xai">Grok 2 (xAI)</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              {/* Debug button */}
              <button
                onClick={handleFetchTranscriptDebug}
                className="text-sm inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-gray-600 text-white hover:bg-gray-700 transition-colors"
                title="Debug: Fetch latest transcript"
              >
                Fetch Transcript Text
              </button>
              <button
                onClick={onRegenerate}
                disabled={scribeRegenerating}
                className="text-sm inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-purple-600 text-white hover:bg-purple-700 disabled:bg-gray-400 transition-colors"
              >
                {scribeRegenerating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Regenerating…
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    Regenerate
                  </>
                )}
              </button>
              {hsTimeline.length > 0 && (
                <button
                  onClick={() => setShowTranscript(true)}
                  className="text-sm inline-flex items-center gap-1.5 px-4 py-2 rounded-md border bg-white hover:bg-gray-50"
                  title="View full transcript"
                >
                  <ScrollText className="h-4 w-4" />
                  Transcript
                </button>
              )}
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-6 py-6">
            {scribeLoading ? (
              <div className="text-base text-gray-600 flex items-center gap-3">
                <Loader2 className="h-5 w-5 animate-spin" />
                Loading scribe notes…
              </div>
            ) : scribeNotes[selectedModel] ? (
              <div className="prose prose-base max-w-none">
                <div className="p-5 bg-gray-50 rounded-lg border border-gray-200">
                  <div className="whitespace-pre-wrap text-base text-gray-800 leading-relaxed">
                    {scribeNotes[selectedModel]}
                  </div>
                </div>
                <div className="mt-4 flex justify-end">
                  <button
                    onClick={() => copyToClipboard(scribeNotes[selectedModel], `scribe-${selectedModel}`)}
                    className="text-sm inline-flex items-center gap-1.5 px-4 py-2 rounded-md border bg-white hover:bg-gray-50 transition-colors"
                    title={`Copy ${selectedModel} scribe notes`}
                  >
                    {copiedSection === `scribe-${selectedModel}` ? (
                      <>
                        <Check className="w-4 h-4 text-green-600" />
                        Copied!
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" />
                        Copy
                      </>
                    )}
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-base text-gray-500 italic">
                No scribe notes available yet for {selectedModel === 'llama' ? 'Llama 3' : selectedModel === 'openai' ? 'OpenAI' : 'xAI'}. Record a visit to generate them.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Transcript Modal */}
      {showTranscript && (
        <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-4xl max-h-[80vh] rounded-xl shadow-xl flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h3 className="text-xl font-semibold">Full Transcript</h3>
              <button
                onClick={() => setShowTranscript(false)}
                className="text-gray-500 hover:text-gray-700 text-2xl leading-none"
              >
                ×
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {hsTimeline.length ? (
                <div className="space-y-3">
                  {hsTimeline.map((row, idx) => (
                    <div key={idx} className="border-l-2 border-gray-300 pl-3">
                      <div className="text-xs text-gray-500 mb-1">
                        {formatTime(row.startSec)} {row.speaker ? `• ${row.speaker}` : ''}
                      </div>
                      <div className="text-sm">{row.text}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-500">No transcript available.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
