'use client';
import React from 'react';
import { ScrollText, Copy, Check } from 'lucide-react';

interface TranscriptTextModalProps {
  isOpen: boolean;
  onClose: () => void;
  docInfo: { id: string; date?: string } | null;
  transcriptText: string;
}

export function TranscriptTextModal({ isOpen, onClose, docInfo, transcriptText }: TranscriptTextModalProps) {
  const [copied, setCopied] = React.useState(false);

  if (!isOpen) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(transcriptText || '');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // no-op
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-4xl max-h-[85vh] rounded-xl shadow-xl flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-purple-50 rounded-lg">
              <ScrollText className="w-5 h-5 text-purple-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Transcript</h3>
              {docInfo && (
                <p className="text-xs text-gray-500">Doc ID: {docInfo.id}{docInfo.date ? ` • ${docInfo.date}` : ''}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border bg-white hover:bg-gray-50 transition-colors"
              title="Copy transcript"
            >
              {copied ? (
                <>
                  <Check className="w-4 h-4 text-green-600" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  Copy
                </>
              )}
            </button>
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs bg-gray-600 text-white hover:bg-gray-700 rounded-lg transition-colors"
            >
              Close
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {transcriptText ? (
            <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
              <pre className="whitespace-pre-wrap break-words text-sm text-gray-800 leading-relaxed">{transcriptText}</pre>
            </div>
          ) : (
            <p className="text-sm text-gray-500">No transcript text available.</p>
          )}
        </div>
      </div>
    </div>
  );
}
