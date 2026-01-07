'use client';
import { useState, useEffect, useRef } from 'react';
import { ChevronDown, ChevronRight, FileText, AudioLines, Clock, Pause, Play, XCircle } from 'lucide-react';
import { useMedplum } from '@medplum/react';
import { cn } from '../helpers/utils';
import { RecordButton } from './RecordButton';
import { WaveformVisualizer } from './WaveformVisualizer';
import { TranscriptionArea } from './TranscriptionArea';
import { TranscriptModal } from '../modals/TranscriptModal';
import { AudioPlayerModal } from '../modals/AudioPlayerModal';
import { useRecordingContext } from '../contexts/RecordingContext';

interface ScribeColumnProps {
  patientId: string | null;
  onScribeComplete?: (data: any) => void;
  onGenerateSynthesis?: (transcriptText?: string, jobName?: string) => Promise<void>;
}

type TranscriptSegment = {
  start: number;
  end: number;
  speaker: string;
  text: string;
};

const httpBase = `${process.env.MEDPLUM_BASE_URL || ''}`;
const UPLOAD_AUDIO_URL = `${httpBase}/api/medai/medplum/healthscribe/upload-audio`;
const START_JOB = `${httpBase}/api/medai/medplum/healthscribe/batch/start`;
const ASYNC_TRANSCRIBE_URL = `${httpBase}/api/medai/medplum/healthscribe/async-transcribe`;

// Maximum recording duration: 1 hour (3600 seconds)
const MAX_RECORDING_DURATION_SECONDS = 3600;
// Keepalive interval for paused state (send every 10 seconds)
const KEEPALIVE_INTERVAL_MS = 10000;

const getWebSocketUrl = () => {
  if (typeof window === 'undefined') return 'wss://healthai.appteon.ai/ws/soniox';
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws/soniox`;
};

interface ScribeNote {
  id?: string;
  patient_id: string;
  job_name: string;
  model: string;
  summary: string;
  created_at?: string;
  visit_date?: string;
  date?: string;
}

interface ScribeEntry {
  id: string;
  date: string;
  chiefComplaint: string;
  keyPoints: string[];
  assessmentPlan: string[];
  fullSummary: string;
  jobName?: string;
}

export const ScribeColumn = ({
  patientId,
  onScribeComplete,
  onGenerateSynthesis,
}: ScribeColumnProps) => {
  const medplum = useMedplum();
  const recordingContext = useRecordingContext();
  const [isRecording, setIsRecordingLocal] = useState(false);
  const [isPaused, setIsPausedLocal] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [showPreviousSummaries, setShowPreviousSummaries] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [_segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [currentSummary, setCurrentSummary] = useState<ScribeEntry | null>(null);
  const [scribeHistory, setScribeHistory] = useState<ScribeEntry[]>([]);
  const [expandedHistoryItems, setExpandedHistoryItems] = useState<Record<string, boolean>>({});
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  // Flag to track if recording was cancelled (to skip post-processing)
  const isCancelledRef = useRef(false);
  // Keepalive timer ref for paused state
  const keepaliveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Ref for paused state (for WebSocket handler access)
  const isPausedRef = useRef(false);

  // Sync local recording state with context
  const setIsRecording = (value: boolean) => {
    setIsRecordingLocal(value);
    recordingContext.setIsRecording(value);
  };

  const setIsPaused = (value: boolean) => {
    setIsPausedLocal(value);
    isPausedRef.current = value;
    recordingContext.setIsPaused(value);
  };

  // Helper function for authenticated fetch calls
  const authenticatedFetch = async (url: string, options: RequestInit = {}): Promise<Response> => {
    const token = medplum.getAccessToken();
    const headers = new Headers(options.headers);

    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    return fetch(url, {
      ...options,
      credentials: 'include',
      headers,
    });
  };

  // Artifact loading state (used for loading indicators in original implementation)
  const [_loadingArtifact, setLoadingArtifact] = useState<string | null>(null);

  // Modal states
  const [showTranscriptModal, setShowTranscriptModal] = useState(false);
  const [showAudioModal, setShowAudioModal] = useState(false);
  const [modalTranscript, setModalTranscript] = useState('');
  const [modalAudioUrl, setModalAudioUrl] = useState('');
  const [modalTitle, setModalTitle] = useState('');
  const [modalAudioDuration, setModalAudioDuration] = useState<number | undefined>(undefined);
  // NEW: track which job is currently open in the audio modal
  const [modalJobName, setModalJobName] = useState<string | null>(null);

  // Preloaded audio data: jobName -> { url, duration }
  const [preloadedAudio, setPreloadedAudio] = useState<Record<string, { url: string; duration: number }>>({});
  const audioPreloadRefs = useRef<Record<string, HTMLAudioElement>>({});

  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<BlobPart[]>([]);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    return () => cleanup();
  }, []);

  // Fetch scribe notes history when patient changes
  useEffect(() => {
    if (!patientId) {
      setCurrentSummary(null);
      setScribeHistory([]);
      setLiveTranscript('');
      return;
    }

    const fetchScribeHistory = async () => {
      setIsLoadingHistory(true);
      try {
        const url = `${httpBase}/api/medai/medplum/healthscribe/scribe-notes/${encodeURIComponent(patientId)}`;
        const response = await fetch(url, { credentials: 'include' });

        if (!response.ok) {
          console.error('Failed to fetch scribe notes');
          setCurrentSummary(null);
          setScribeHistory([]);
          return;
        }

        const result = await response.json();
        if (result.ok && Array.isArray(result.notes) && result.notes.length > 0) {
          const entries = result.notes.map((note: ScribeNote) => parseScribeNote(note));

          setCurrentSummary(entries[0]);
          setScribeHistory(entries.slice(1));
        } else {
          setCurrentSummary(null);
          setScribeHistory([]);
        }
      } catch (e: any) {
        console.error('Error fetching scribe notes:', e);
        setCurrentSummary(null);
        setScribeHistory([]);
      } finally {
        setIsLoadingHistory(false);
      }
    };

    fetchScribeHistory();
  }, [patientId, httpBase]);

  // Listen for scribe notes generation events to refresh
  useEffect(() => {
    const handleScribeGenerated = async (ev: any) => {
      const targetPid = ev?.detail?.patientId;
      if (patientId && targetPid && targetPid !== patientId) return;

      console.log('Scribe notes generated, refreshing...');

      try {
        const url = `${httpBase}/api/medai/medplum/healthscribe/scribe-notes/${encodeURIComponent(patientId!)}`;
        const response = await fetch(url, { credentials: 'include' });

        if (response.ok) {
          const result = await response.json();
          if (result.ok && Array.isArray(result.notes) && result.notes.length > 0) {
            const entries = result.notes.map((note: ScribeNote) => parseScribeNote(note));
            setCurrentSummary(entries[0]);
            setScribeHistory(entries.slice(1));
            setLiveTranscript('');
          }
        }
      } catch (e) {
        console.error('Error refreshing scribe notes:', e);
      }
    };

    window.addEventListener('scribe-notes-generated', handleScribeGenerated);
    return () => window.removeEventListener('scribe-notes-generated', handleScribeGenerated);
  }, [patientId, httpBase]);

  // Preload audio metadata (duration) for all scribe entries
  useEffect(() => {
    const allEntries = [currentSummary, ...scribeHistory].filter(Boolean) as ScribeEntry[];
    if (allEntries.length === 0) return;

    const preloadAudioForEntry = async (entry: ScribeEntry) => {
      const jobName = entry.jobName || entry.id;
      if (!jobName) return;

      if (preloadedAudio[jobName]) return;

      try {
        const baseUrl = `${httpBase}/api/medai/medplum/healthscribe/audio/${encodeURIComponent(jobName)}`;

        // First, fetch metadata to get duration
        const metadataResp = await authenticatedFetch(`${baseUrl}?metadata=true`, { method: 'GET' });
        let duration: number | undefined;

        if (metadataResp.ok) {
          const metadata = await metadataResp.json();
          if (metadata.duration !== undefined && isFinite(Number(metadata.duration))) {
            duration = Number(metadata.duration);
          }
        }

        // Then fetch the actual audio data
        const audioResp = await authenticatedFetch(baseUrl, { method: 'GET' });

        if (!audioResp.ok) {
          console.warn(`Failed to preload audio for job ${jobName}`);
          return;
        }

        const blob = await audioResp.blob();
        const audioUrl = URL.createObjectURL(blob);

        if (duration !== undefined) {
          console.log(`Preloaded audio for ${jobName} with duration: ${duration}s`);
          setPreloadedAudio((prev) => ({
            ...prev,
            [jobName]: { url: audioUrl, duration },
          }));
        } else {
          // Fallback: extract duration from audio metadata
          console.log(`No duration metadata for ${jobName}, extracting from audio file...`);
          const audio = new Audio();
          audio.preload = 'metadata';
          audioPreloadRefs.current[jobName] = audio;

          let durationResolved = false;
          const resolveDuration = () => {
            if (durationResolved) return;
            if (audio.duration && isFinite(audio.duration)) {
              durationResolved = true;
              console.log(`Extracted duration for ${jobName}: ${audio.duration}s`);
              setPreloadedAudio((prev) => ({
                ...prev,
                [jobName]: { url: audioUrl, duration: audio.duration },
              }));
            }
          };

          audio.addEventListener('loadedmetadata', resolveDuration);
          audio.addEventListener('durationchange', resolveDuration);
          audio.src = audioUrl;
          audio.load();
        }
      } catch (e) {
        console.warn(`Error preloading audio for ${jobName}:`, e);
      }
    };

    allEntries.forEach((entry, index) => {
      setTimeout(() => preloadAudioForEntry(entry), index * 200);
    });

    return () => {
      Object.values(audioPreloadRefs.current).forEach((audio) => {
        try {
          audio.src = '';
          audio.load();
        } catch {}
      });
    };
  }, [currentSummary, scribeHistory, httpBase, preloadedAudio]);

  function parseScribeNote(note: ScribeNote): ScribeEntry {
    const summary = note.summary || '';
    const lines = summary.split('\n').filter((line) => line.trim());

    let chiefComplaint = 'Not documented';
    const keyPoints: string[] = [];
    const assessmentPlan: string[] = [];

    let currentSection = '';

    for (const line of lines) {
      const trimmed = line.trim();
      const upperLine = trimmed.toUpperCase();

      // Section headers
      if (upperLine.includes('CHIEF COMPLAINT')) {
        currentSection = 'chief';
        continue;
      } else if (
        upperLine.includes('KEY POINTS') ||
        upperLine.includes('SUBJECTIVE') ||
        upperLine.includes('OBJECTIVE')
      ) {
        currentSection = 'keypoints';
        continue;
      } else if (upperLine.includes('ASSESSMENT') || upperLine.includes('PLAN')) {
        currentSection = 'assessment';
        continue;
      }

      // Skip empty lines and section headers
      if (!trimmed || trimmed.startsWith('**') || trimmed.startsWith('#')) {
        continue;
      }

      // Extract content based on current section
      if (currentSection === 'chief') {
        const content = trimmed.replace(/^[-•*]\s*/, '').trim();
        if (content && content !== 'Not documented') {
          chiefComplaint = content;
          currentSection = ''; // Only take first non-empty line after header
        }
      } else if (currentSection === 'keypoints') {
        const content = trimmed.replace(/^[-•*]\s*/, '').replace(/^\d+\.\s*/, '').trim();
        // Filter out empty strings and placeholder text
        if (content && content !== 'Not documented' && content !== '-') {
          keyPoints.push(content);
        }
      } else if (currentSection === 'assessment') {
        const content = trimmed.replace(/^[-•*]\s*/, '').replace(/^\d+\.\s*/, '').trim();
        // Filter out empty strings and placeholder text
        if (content && content !== 'Not documented' && content !== '-') {
          assessmentPlan.push(content);
        }
      }
    }

    // Fallback for chief complaint if not found
    if (chiefComplaint === 'Not documented' && lines.length > 0) {
      const firstLine = lines[0].replace(/^#+\s*/, '').replace(/^[-•*]\s*/, '').replace(/^\*\*.*?\*\*:?\s*/, '').trim();
      if (firstLine && firstLine !== 'Not documented') {
        chiefComplaint = firstLine.substring(0, 100);
      }
    }

    // Fallback for key points if empty
    if (keyPoints.length === 0 && lines.length > 2) {
      const fallbackPoints = lines
        .slice(1, Math.min(5, lines.length))
        .map((l) => l.replace(/^[-•*]\s*/, '').replace(/^\*\*.*?\*\*:?\s*/, '').trim())
        .filter((l) => l && l !== 'Not documented' && l !== '-' && !l.match(/^(CHIEF|KEY|ASSESSMENT|PLAN)/i));
      keyPoints.push(...fallbackPoints.slice(0, 3));
    }

    const visitDateRaw = note.visit_date || note.created_at || note.date || undefined;
    let formattedDate = 'Unknown date';
    if (visitDateRaw) {
      try {
        const parsed =
          typeof visitDateRaw === 'number' ? new Date(visitDateRaw) : new Date(String(visitDateRaw));
        if (!isNaN(parsed.getTime())) {
          formattedDate = parsed.toLocaleDateString('en-US', {
            month: '2-digit',
            day: '2-digit',
            year: 'numeric',
          });
        }
      } catch (e) {
        // leave formattedDate as 'Unknown date'
      }
    }

    return {
      id: note.id || note.job_name,
      jobName: note.job_name,
      date: formattedDate,
      chiefComplaint,
      keyPoints,
      assessmentPlan,
      fullSummary: summary,
    };
  }

  function cleanup() {
    try {
      mediaRecorder.current?.stop();
    } catch {}
    try {
      stream.current?.getTracks().forEach((t) => t.stop());
    } catch {}
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
    if (keepaliveTimerRef.current) {
      clearInterval(keepaliveTimerRef.current);
      keepaliveTimerRef.current = null;
    }
    try {
      wsRef.current?.close();
    } catch {}
    setIsPaused(false);
    isCancelledRef.current = false;
  }

  // Pause recording - stop capturing audio but keep WebSocket alive with keepalive packets
  function pauseRecording() {
    if (!isRecording || isPaused) return;

    setIsPaused(true);

    // Pause the MediaRecorder
    if (mediaRecorder.current && mediaRecorder.current.state === 'recording') {
      try {
        mediaRecorder.current.pause();
      } catch (e) {
        console.warn('Failed to pause MediaRecorder:', e);
      }
    }

    // Stop the duration timer
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }

    // Start sending keepalive packets to Soniox
    keepaliveTimerRef.current = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        try {
          // Send a keepalive JSON message
          wsRef.current.send(JSON.stringify({ action: 'keepalive' }));
        } catch (e) {
          console.warn('Failed to send keepalive:', e);
        }
      }
    }, KEEPALIVE_INTERVAL_MS);

    setLiveTranscript((prev) => prev + '\n\n[Recording paused]');
  }

  // Resume recording after pause
  function resumeRecording() {
    if (!isRecording || !isPaused) return;

    setIsPaused(false);

    // Stop keepalive timer
    if (keepaliveTimerRef.current) {
      clearInterval(keepaliveTimerRef.current);
      keepaliveTimerRef.current = null;
    }

    // Resume the MediaRecorder
    if (mediaRecorder.current && mediaRecorder.current.state === 'paused') {
      try {
        mediaRecorder.current.resume();
      } catch (e) {
        console.warn('Failed to resume MediaRecorder:', e);
      }
    }

    // Restart the duration timer
    timer.current = setInterval(() => setDuration((d) => d + 1), 1000);

    setLiveTranscript((prev) => {
      // Remove the [Recording paused] marker
      const withoutPaused = prev.replace(/\n\n\[Recording paused\]$/, '');
      return withoutPaused + '\n\n[Recording resumed]';
    });
  }

  // Cancel recording - discard everything and don't trigger any processing
  function cancelRecording() {
    if (!isRecording) return;

    isCancelledRef.current = true;

    // Stop all timers
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
    if (keepaliveTimerRef.current) {
      clearInterval(keepaliveTimerRef.current);
      keepaliveTimerRef.current = null;
    }

    // Stop MediaRecorder without processing
    if (mediaRecorder.current && mediaRecorder.current.state !== 'inactive') {
      try {
        mediaRecorder.current.stop();
      } catch {}
    }

    // Stop media stream
    try {
      stream.current?.getTracks().forEach((t) => t.stop());
    } catch {}

    // Close WebSocket without sending complete message
    try {
      wsRef.current?.close();
    } catch {}

    // Clear all recording state
    chunks.current = [];
    setIsRecording(false);
    setIsPaused(false);
    setDuration(0);
    setLiveTranscript('');
    setSegments([]);
    setShowCancelConfirm(false);
    setIsProcessing(false);

    // Reset cancelled flag after cleanup
    setTimeout(() => {
      isCancelledRef.current = false;
    }, 100);
  }

  // Handle cancel button click - auto-pause and show confirmation
  function handleCancelClick() {
    // Auto-pause the recording while showing confirmation dialog
    if (isRecording && !isPaused) {
      pauseRecording();
    }
    setShowCancelConfirm(true);
  }

  // Confirm cancellation
  function confirmCancel() {
    cancelRecording();
  }

  // Dismiss cancellation dialog - auto-resume if was recording
  function dismissCancel() {
    setShowCancelConfirm(false);
    // Auto-resume the recording if it was paused by the cancel dialog
    if (isRecording && isPaused) {
      resumeRecording();
    }
  }

  function connectWebSocket() {
    try {
      const wsUrl = getWebSocketUrl();
      console.log('Connecting to WebSocket:', wsUrl);
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('WebSocket connected to transcription service');
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          // Ignore transcription messages when paused (but allow status messages)
          if (isPausedRef.current && (data.status === 'partial' || data.status === 'complete')) {
            return;
          }

          if (data.status === 'connected') {
            setLiveTranscript('Connected. Ready to record...');
          } else if (data.status === 'processing') {
            const statusMsg = data.message || 'Processing...';
            setLiveTranscript((prev) => {
              if (!prev || prev.startsWith('Recording') || prev.startsWith('Connecting')) {
                return statusMsg;
              }
              return prev;
            });
          } else if (data.status === 'partial' && data.text) {
            setLiveTranscript((prev) => {
              const speaker = data.speaker || 'SPEAKER_0';
              const speakerLabel =
                speaker === '1' || speaker === 'SPEAKER_1'
                  ? 'Doctor'
                  : speaker === '2' || speaker === 'SPEAKER_2'
                  ? 'Patient'
                  : speaker;
              const speakerTag = `[${speakerLabel}]`;
              const newText = `${speakerTag} ${data.text}`;

              if (
                !prev ||
                prev.startsWith('Recording') ||
                prev.startsWith('Connecting') ||
                prev.startsWith('Processing') ||
                prev.startsWith('Connected')
              ) {
                return newText;
              }

              const lines = prev.split('\n');
              const lastLineIndex = lines.length - 1;
              const lastLine = lines[lastLineIndex];

              if (lastLine && lastLine.startsWith(speakerTag)) {
                lines[lastLineIndex] = newText;
                return lines.join('\n');
              } else {
                return prev + '\n' + newText;
              }
            });
          } else if (data.status === 'complete' && data.segments) {
            setSegments(data.segments);
            const fullText = data.segments
              .map((seg: TranscriptSegment) => {
                const speakerLabel =
                  seg.speaker === '1' || seg.speaker === 'SPEAKER_1'
                    ? 'Doctor'
                    : seg.speaker === '2' || seg.speaker === 'SPEAKER_2'
                    ? 'Patient'
                    : seg.speaker;
                return `[${speakerLabel}] ${seg.text}`;
              })
              .join('\n');
            setLiveTranscript(fullText);
            try {
              ws.close();
            } catch {}
          } else if (data.error) {
            setError(data.error);
            try {
              ws.close();
            } catch {}
          }
        } catch (e) {
          console.error('Failed to parse WebSocket message:', e);
        }
      };

      ws.onerror = (err) => {
        console.error('WebSocket error:', err);
        setError('Connection to transcription service failed');
      };

      ws.onclose = () => {
        console.log('WebSocket closed');
      };
    } catch (e) {
      console.error('Failed to connect to WebSocket:', e);
      setError('Could not connect to transcription service');
    }
  }

  async function startRecording() {
    setError(null);
    setDuration(0);
    setLiveTranscript('Connecting to transcription service...');
    setSegments([]);
    isCancelledRef.current = false;

    try {
      connectWebSocket();

      await new Promise((resolve, reject) => {
        const checkInterval = setInterval(() => {
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            clearInterval(checkInterval);
            resolve(true);
          } else if (wsRef.current?.readyState === WebSocket.CLOSED) {
            clearInterval(checkInterval);
            reject(new Error('WebSocket closed'));
          }
        }, 100);

        setTimeout(() => {
          clearInterval(checkInterval);
          reject(new Error('Connection timeout'));
        }, 5000);
      });

      setLiveTranscript('Connected. Starting recording...');

      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : undefined;

      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder.current = mime
        ? new MediaRecorder(stream.current, { mimeType: mime })
        : new MediaRecorder(stream.current);
      chunks.current = [];

      mediaRecorder.current.ondataavailable = (e) => {
        if (e.data?.size) {
          chunks.current.push(e.data);
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(e.data);
          }
        }
      };

      mediaRecorder.current.start(3000);

      setIsRecording(true);
      setLiveTranscript('Recording... listening...');

      // Timer with 1-hour cap check
      timer.current = setInterval(() => {
        setDuration((d) => {
          const newDuration = d + 1;
          // Auto-stop at 1 hour
          if (newDuration >= MAX_RECORDING_DURATION_SECONDS) {
            console.log('Recording reached 1 hour limit, auto-stopping...');
            setLiveTranscript((prev) => prev + '\n\n[Recording reached 1 hour limit - auto-stopping]');
            // Schedule stopRecording for next tick to avoid state issues
            setTimeout(() => stopRecording(), 0);
          }
          return newDuration;
        });
      }, 1000);
    } catch (e: any) {
      setError(e?.message || 'Failed to start recording');
      try {
        wsRef.current?.close();
      } catch {}
    }
  }

  async function stopRecording() {
    if (!isRecording) return;

    // If recording was cancelled, don't process - just exit
    if (isCancelledRef.current) {
      return;
    }

    // Stop the duration timer
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }

    // Stop keepalive timer if paused
    if (keepaliveTimerRef.current) {
      clearInterval(keepaliveTimerRef.current);
      keepaliveTimerRef.current = null;
    }

    setIsRecording(false);
    setIsPaused(false);
    setIsProcessing(true);
    setLiveTranscript('Finalizing recording...');

    // Wait for the MediaRecorder to finish and capture the final audio chunk
    // The stop() method is asynchronous - it fires a final 'dataavailable' event
    // followed by a 'stop' event. We must wait for these before creating the blob.
    const recorder = mediaRecorder.current;
    if (recorder && recorder.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        const handleStop = () => {
          recorder.removeEventListener('stop', handleStop);
          resolve();
        };
        recorder.addEventListener('stop', handleStop);

        // Request any pending data before stopping
        try {
          recorder.requestData();
        } catch {}

        // Stop the recorder - this will trigger final dataavailable then stop events
        try {
          recorder.stop();
        } catch {}

        // Safety timeout in case stop event doesn't fire
        setTimeout(resolve, 1000);
      });
    }

    // Now stop the media stream tracks
    try {
      stream.current?.getTracks().forEach((t) => t.stop());
    } catch {}

    if (!chunks.current.length) {
      setError('No audio captured');
      try {
        wsRef.current?.close();
      } catch {}
      setIsProcessing(false);
      return;
    }

    const captured = liveTranscript.trim();

    try {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ action: 'complete' }));
        setTimeout(() => {
          try {
            wsRef.current?.close();
          } catch {}
        }, 300);
      }
    } catch {}

    if (captured && !captured.startsWith('Finalizing')) {
      setLiveTranscript('Recording complete. Full transcript:\n\n' + captured);
    } else {
      setLiveTranscript('Recording complete. Processing...');
    }

    const mimeType = recorder?.mimeType || 'audio/webm';
    const blob = new Blob(chunks.current, { type: mimeType });
    const blobSizeMB = (blob.size / (1024 * 1024)).toFixed(2);
    console.log(`Preparing to upload audio: ${blobSizeMB} MB, duration: ${duration}s`);

    try {
      await uploadAndStart(blob, mimeType);
    } finally {
      setIsProcessing(false);
    }
  }

  async function uploadAndStart(file: Blob, contentType: string) {
    if (!patientId) return;

    try {
      // Calculate audio duration before uploading
      let duration: number | null = null;
      try {
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        const arrayBuffer = await file.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        duration = audioBuffer.duration;
        console.log('Calculated audio duration:', duration, 'seconds');
      } catch (e) {
        console.error('Failed to calculate audio duration:', e);
        // Continue without duration - backend will handle it
      }

      const uploadHeaders: Record<string, string> = {
        'Content-Type': contentType,
        'X-Patient-Id': patientId,
      };
      if (duration !== null) {
        uploadHeaders['X-Audio-Duration'] = duration.toString();
      }

      const fileSizeMB = (file.size / (1024 * 1024)).toFixed(2);
      setLiveTranscript(`Uploading audio (${fileSizeMB} MB)...`);

      // Use longer timeout for large file uploads (30 minutes should be plenty)
      const uploadTimeoutMs = 30 * 60 * 1000; // 30 minutes
      const uploadAbortController = new AbortController();
      const uploadTimeoutId = setTimeout(() => uploadAbortController.abort(), uploadTimeoutMs);

      const uploadResponse = await authenticatedFetch(UPLOAD_AUDIO_URL, {
        method: 'POST',
        headers: uploadHeaders,
        body: file,
        signal: uploadAbortController.signal,
      }).catch((e) => {
        clearTimeout(uploadTimeoutId);
        if (e.name === 'AbortError') {
          throw new Error(`Upload timed out after 30 minutes for ${fileSizeMB} MB file. Please try again.`);
        }
        // Handle network errors (connection reset, timeout, etc.)
        const isLargeFile = file.size > 50 * 1024 * 1024; // 50MB
        throw new Error(
          isLargeFile
            ? `Network error uploading large audio file (${fileSizeMB} MB). ${e.message}`
            : `Network error: ${e.message}`
        );
      }).finally(() => {
        clearTimeout(uploadTimeoutId);
      });

      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        setError(`Upload failed (${uploadResponse.status}): ${errorText}`);
        return;
      }

      const uploadResult = await uploadResponse.json();
      if (!uploadResult?.ok || !uploadResult?.jobName) {
        setError(uploadResult?.error || 'Failed to upload audio');
        return;
      }

      const jobName = uploadResult.jobName;
      const mediaId = uploadResult.mediaId;

      setLiveTranscript('Creating job record...');

      const startJobResponse = await authenticatedFetch(START_JOB, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobName, patientId, mediaId, appointmentId: null }),
      }).catch((e) => {
        throw new Error(`Failed to create job record: ${e.message}`);
      });

      if (!startJobResponse.ok) {
        const errorText = await startJobResponse.text();
        throw new Error(`Failed to create job record (${startJobResponse.status}): ${errorText}`);
      }

      const started = await startJobResponse.json();
      if (!started?.ok) {
        console.warn('Job creation returned error:', started?.error);
      }

      // Process audio through transcription service
      // This can take 5-30+ minutes for long recordings, so we need a very long timeout
      setLiveTranscript('Processing audio transcription...\n(This may take several minutes for longer recordings)');

      let asyncTranscript = '';
      try {
        // Create AbortController with 90-minute timeout for long recordings
        const transcriptionTimeoutMs = 90 * 60 * 1000; // 90 minutes
        const abortController = new AbortController();
        const timeoutId = setTimeout(() => abortController.abort(), transcriptionTimeoutMs);

        const asyncResp = await authenticatedFetch(`${ASYNC_TRANSCRIBE_URL}/${encodeURIComponent(jobName)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: abortController.signal,
        }).catch((e) => {
          clearTimeout(timeoutId);
          if (e.name === 'AbortError') {
            throw new Error('Transcription timed out after 90 minutes. Please try with a shorter recording.');
          }
          console.error('Network error calling async transcription:', e);
          throw new Error(`Network error during transcription: ${e.message}`);
        }).finally(() => {
          clearTimeout(timeoutId);
        });

        if (!asyncResp.ok) {
          const errorText = await asyncResp.text();
          console.error('Async transcription failed:', asyncResp.status, errorText);
          throw new Error(`Transcription failed (${asyncResp.status}): ${errorText}`);
        }

        const asyncResult = await asyncResp.json();
        if (asyncResult.ok && asyncResult.transcript) {
          asyncTranscript = asyncResult.transcript;
          console.log('✅ Async transcription successful!');
          console.log('  - Transcript length:', asyncTranscript.length, 'characters');
          console.log('  - Token count:', asyncResult.tokenCount);
          console.log('  - Segments:', asyncResult.segments?.length || 0);
          console.log('  - Full async transcript:', asyncTranscript);
          setLiveTranscript('Transcription complete.\n\n' + asyncTranscript);
        } else {
          console.warn('Async transcription returned empty result:', asyncResult);
          const warningMsg = asyncResult.error || 'No transcript returned';
          setLiveTranscript(`Transcription returned no text: ${warningMsg}. Proceeding without transcript.`);
        }
      } catch (asyncErr: any) {
        console.error('Transcription error:', asyncErr);
        setLiveTranscript(`Transcription error: ${asyncErr.message}. Proceeding without transcript.`);
        // Note: We don't re-throw here to allow the flow to continue without transcript
      }

      // Warn if we don't have a transcript
      if (!asyncTranscript || !asyncTranscript.trim()) {
        console.warn('⚠️ No transcript available - scribe notes will not be generated');
        console.warn('  - This means the audio was uploaded but transcription failed or returned empty');
        setLiveTranscript((prev) => prev + '\n\n⚠️ Transcription failed. No scribe notes will be generated.');
      }

      // Use async transcript for scribe and synthesis generation
      if (asyncTranscript && asyncTranscript.trim()) {
        console.log('📝 Generating scribe notes with async transcript');
        console.log('  - Using transcript length:', asyncTranscript.length, 'characters');

        try {
          const SCRIBE_URL = `${httpBase}/api/medai/medplum/healthscribe/scribe/generate`;
          setLiveTranscript((prev) => prev + '\n\nGenerating AI scribe notes...');

          const scribeResp = await authenticatedFetch(SCRIBE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              patient_id: patientId,
              job_name: jobName,
              transcript_text: asyncTranscript,
              appointment_id: null,
            }),
          }).catch((e) => {
            throw new Error(`Network error generating scribe notes: ${e.message}`);
          });

          if (!scribeResp.ok) {
            const errorText = await scribeResp.text();
            throw new Error(`Scribe generation failed (${scribeResp.status}): ${errorText}`);
          }

          const scribeResult = await scribeResp.json();
          if (!scribeResult.ok) {
            throw new Error(scribeResult.error || 'Scribe generation returned error');
          }

          setLiveTranscript((prev) => prev + '\n✅ AI scribe notes generated successfully!');

          window.dispatchEvent(
            new CustomEvent('scribe-notes-generated', {
              detail: {
                patientId,
                jobName,
                scribeNotes: scribeResult.scribe_notes,
              },
            }),
          );

          if (onScribeComplete) {
            onScribeComplete(scribeResult);
          }

          // Use async transcript for synthesis generation as well
          const synthPromise = onGenerateSynthesis
            ? onGenerateSynthesis(asyncTranscript, jobName).catch((e) => {
                console.error('Error generating synthesis notes:', e);
              })
            : null;

          try {
            if (synthPromise) await synthPromise;
          } catch (e) {
            // already logged
          }

          setTimeout(async () => {
            try {
              const url = `${httpBase}/api/medai/medplum/healthscribe/scribe-notes/${encodeURIComponent(
                patientId,
              )}`;
              const response = await fetch(url, { credentials: 'include' });

              if (response.ok) {
                const result = await response.json();
                if (result.ok && Array.isArray(result.notes) && result.notes.length > 0) {
                  const entries = result.notes.map((note: ScribeNote) => parseScribeNote(note));
                  setCurrentSummary(entries[0]);
                  setScribeHistory(entries.slice(1));
                  setLiveTranscript('');
                }
              }
            } catch (e) {
              console.error('Error refreshing after generation:', e);
            }
          }, 2000);
        } catch (e: any) {
          console.error('Error generating scribe notes:', e);
          setLiveTranscript((prev) => prev + `\n❌ Error generating AI scribe notes: ${e.message}`);
        }
      }
    } catch (e: any) {
      setError(e?.message || 'Upload failed');
    }
  }

  const handleToggleRecording = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col h-full bg-card rounded-lg border border-border overflow-hidden">
      {/* Header */}
      <div className="emr-section-header flex items-center gap-2">
        <FileText className="w-5 h-5" />
        <span>Scribe</span>
      </div>

      {/* Content */}
      <div className="relative flex-1 flex flex-col min-h-0 overflow-hidden">
        {!patientId ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            Select a patient to start
          </div>
        ) : (
          <>
            {/* Main scrollable content area */}
            <div className="flex-1 overflow-y-auto p-4 pb-24 space-y-4 min-h-0">
              {/* Recording Section */}
              <div
                className={cn(
                  'flex flex-col items-center py-6 transition-all duration-300',
                  isRecording ? 'pb-4' : '',
                )}
              >
                {/* Recording Controls */}
                <div className="flex items-center gap-3">
                  {/* Pause/Resume Button - only show when recording */}
                  {isRecording && (
                    <button
                      onClick={isPaused ? resumeRecording : pauseRecording}
                      className={cn(
                        'w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200',
                        isPaused
                          ? 'bg-emerald-500 hover:bg-emerald-600 text-white'
                          : 'bg-amber-500 hover:bg-amber-600 text-white'
                      )}
                      title={isPaused ? 'Resume recording' : 'Pause recording'}
                    >
                      {isPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                    </button>
                  )}

                  {/* Main Record/Stop Button */}
                  <RecordButton
                    isRecording={isRecording}
                    isProcessing={isProcessing}
                    onToggle={handleToggleRecording}
                  />

                  {/* Cancel Button - only show when recording */}
                  {isRecording && (
                    <button
                      onClick={handleCancelClick}
                      className="w-10 h-10 rounded-full flex items-center justify-center bg-gray-500 hover:bg-gray-600 text-white transition-all duration-200"
                      title="Cancel recording"
                    >
                      <XCircle className="w-4 h-4" />
                    </button>
                  )}
                </div>

                <p className="mt-3 text-sm text-muted-foreground">
                  {isRecording
                    ? isPaused
                      ? `Paused at ${formatDuration(duration)}`
                      : `Recording... ${formatDuration(duration)} (max 1hr)`
                    : isProcessing
                    ? 'Processing and generating notes...'
                    : 'Click to start recording'}
                </p>

                {isRecording && !isPaused && <WaveformVisualizer />}
              </div>

              {/* Cancel Confirmation Dialog */}
              {showCancelConfirm && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                  <div className="bg-card border border-border rounded-lg p-6 max-w-sm mx-4 shadow-xl">
                    <h3 className="text-lg font-semibold text-foreground mb-2">Cancel Recording?</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      This will discard the current recording and transcript. This action cannot be undone.
                    </p>
                    <div className="flex justify-end gap-3">
                      <button
                        onClick={dismissCancel}
                        className="px-4 py-2 text-sm font-medium text-foreground bg-muted hover:bg-muted/80 rounded-md transition-colors"
                      >
                        Keep Recording
                      </button>
                      <button
                        onClick={confirmCancel}
                        className="px-4 py-2 text-sm font-medium text-white bg-destructive hover:bg-destructive/90 rounded-md transition-colors"
                      >
                        Cancel Recording
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {error && (
                <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-sm text-destructive">
                  {error}
                </div>
              )}

              {/* Live Transcription */}
              {isRecording && (
                <div className="flex-1 min-h-0 mb-4">
                  <h3 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-2">
                    <div className="w-2 h-2 bg-destructive rounded-full animate-pulse"></div>
                    Live Transcription
                  </h3>
                  <TranscriptionArea isRecording={isRecording} transcript={liveTranscript} />
                </div>
              )}

              {/* Most Recent Summary or Transcript */}
              {!isRecording && (
                <div className="flex-1 overflow-y-auto scrollbar-thin">
                  {liveTranscript ? (
                    <>
                      <h3 className="text-sm font-semibold text-muted-foreground mb-3">
                        Most Recent Transcript
                      </h3>
                      <div className="emr-medical-card">
                        <div className="emr-medical-card-header">Transcript</div>
                        <p className="text-sm text-foreground whitespace-pre-wrap">
                          {liveTranscript}
                        </p>
                      </div>
                    </>
                  ) : currentSummary ? (
                    <>
                      <div className="flex items-start justify-between mb-3">
                        <div className="emr-medical-card-header">Most Recent Encounter Summary</div>
                        <div className="flex items-center gap-3">
                          <button
                            title="Show transcript"
                            onClick={async () => {
                              const job = currentSummary.jobName || currentSummary.id;
                              if (!job) {
                                setError('Error: No job identifier found');
                                return;
                              }
                              console.log('Fetching transcript for job:', job);
                              setLoadingArtifact(job);
                              try {
                                const url = `${httpBase}/api/medai/medplum/healthscribe/transcript/${encodeURIComponent(
                                  job,
                                )}`;
                                console.log('Transcript URL:', url);
                                const resp = await authenticatedFetch(url, {
                                  method: 'GET',
                                });
                                if (!resp.ok) {
                                  const t = await resp.text();
                                  console.error(
                                    'Failed to fetch transcript:',
                                    resp.status,
                                    t,
                                  );
                                  setError(`Failed to load transcript (${resp.status}): ${t}`);
                                  return;
                                }
                                const data = await resp
                                  .json()
                                  .catch(async () => ({ transcript: await resp.text() }));
                                const text =
                                  data?.transcript ??
                                  data?.text ??
                                  (typeof data === 'string' ? data : undefined);
                                console.log(
                                  'Received transcript, length:',
                                  text?.length || 0,
                                );
                                if (text) {
                                  setModalTranscript(text);
                                  setModalTitle(`Transcript - ${currentSummary.date}`);
                                  setShowTranscriptModal(true);
                                } else {
                                  setError('No transcript available');
                                }
                              } catch (e: any) {
                                console.error('Error fetching transcript:', e);
                                setError(`Error: ${e?.message || String(e)}`);
                              } finally {
                                setLoadingArtifact(null);
                              }
                            }}
                            className="p-1 rounded hover:bg-muted/50"
                          >
                            <FileText className="w-4 h-4" />
                          </button>

                          <button
                            title="Play audio"
                            onClick={async () => {
                              const job = currentSummary.jobName || currentSummary.id;
                              if (!job) {
                                setError('Error: No job identifier found');
                                return;
                              }

                              setModalJobName(job);

                              // If already preloaded, use it immediately
                              const preloaded = preloadedAudio[job];
                              if (preloaded) {
                                console.log(
                                  'Using preloaded audio for job:',
                                  job,
                                  'duration:',
                                  preloaded.duration,
                                );
                                setModalAudioUrl(preloaded.url);
                                setModalAudioDuration(preloaded.duration);
                                setModalTitle(`Recording - ${currentSummary.date}`);
                                setShowAudioModal(true);
                                return;
                              }

                              console.log('Fetching audio for job:', job);
                              setLoadingArtifact(job);
                              try {
                                const baseUrl = `${httpBase}/api/medai/medplum/healthscribe/audio/${encodeURIComponent(job)}`;

                                // Fetch metadata for duration
                                let duration: number | undefined;
                                try {
                                  const metaResp = await authenticatedFetch(`${baseUrl}?metadata=true`, { method: 'GET' });
                                  if (metaResp.ok) {
                                    const meta = await metaResp.json();
                                    if (meta.duration !== undefined && isFinite(Number(meta.duration))) {
                                      duration = Number(meta.duration);
                                    }
                                  }
                                } catch (e) {
                                  console.warn('Failed to fetch audio metadata:', e);
                                }

                                // Fetch actual audio data
                                const resp = await authenticatedFetch(baseUrl, { method: 'GET' });
                                if (!resp.ok) {
                                  const t = await resp.text();
                                  console.error('Failed to fetch audio:', resp.status, t);
                                  setError(`Failed to load audio (${resp.status}): ${t}`);
                                  return;
                                }

                                const blob = await resp.blob();
                                const audioUrl = URL.createObjectURL(blob);

                                // Cache for future use
                                if (duration !== undefined) {
                                  setPreloadedAudio((prev) => ({
                                    ...prev,
                                    [job]: { url: audioUrl, duration },
                                  }));
                                }

                                // Open modal
                                setModalAudioUrl(audioUrl);
                                setModalAudioDuration(duration);
                                setModalTitle(`Recording - ${currentSummary.date}`);
                                setShowAudioModal(true);
                              } catch (e: any) {
                                console.error('Error fetching audio:', e);
                                setError(e?.message || 'Failed to load audio');
                              } finally {
                                setLoadingArtifact(null);
                              }
                            }}
                            className="p-1 rounded hover:bg-muted/50"
                          >
                            <AudioLines className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      <div className="emr-medical-card">
                        <h3 className="text-sm font-semibold text-muted-foreground">Chief Complaint</h3>
                        <p className="text-sm text-foreground">
                          {currentSummary.chiefComplaint}
                        </p>
                      </div>

                      {currentSummary.keyPoints.length > 0 && (
                        <div className="emr-medical-card">
                          <h3 className="text-sm font-semibold text-muted-foreground">Key Points</h3>
                          <ul className="space-y-1.5">
                            {currentSummary.keyPoints.map((point, index) => (
                              <li
                                key={index}
                                className="text-sm text-foreground flex items-start gap-2"
                              >
                                <span className="text-primary mt-1">•</span>
                                <span>{point}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {currentSummary.assessmentPlan.length > 0 && (
                        <div className="emr-medical-card">
                          <h3 className="text-sm font-semibold text-muted-foreground">Assessment & Plan</h3>
                          <ul className="space-y-1.5">
                            {currentSummary.assessmentPlan.map((item, index) => (
                              <li
                                key={index}
                                className="text-sm text-foreground flex items-start gap-2"
                              >
                                <span className="text-primary mt-1">•</span>
                                <span>{item}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </>
                  ) : isLoadingHistory ? (
                    <div className="flex items-center justify-center h-32">
                      <p className="text-sm text-muted-foreground">Loading scribe notes...</p>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-32">
                      <p className="text-sm text-muted-foreground">
                        No scribe summaries available
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Previous Summaries Section */}
            {!isRecording && (
              <div
                className={cn(
                  "absolute inset-x-0 bottom-0 z-40 bg-card border-t border-border flex flex-col transition-all duration-500 ease-in-out",
                  showPreviousSummaries
                    ? 'top-0'
                    : 'top-[calc(100%-53px)]'
                )}
              >
                <button
                  onClick={() => setShowPreviousSummaries(!showPreviousSummaries)}
                  className="flex items-center gap-2 text-sm font-medium text-foreground hover:text-primary transition-colors p-4 hover:bg-muted flex-shrink-0 border-b border-border"
                >
                  {showPreviousSummaries ? (
                    <ChevronDown className="w-4 h-4" />
                  ) : (
                    <ChevronRight className="w-4 h-4" />
                  )}
                  <Clock className="w-4 h-4" />
                  Previous Scribe Summaries ({scribeHistory.length})
                </button>

                {showPreviousSummaries && (
                  <div className="flex-1 overflow-y-auto p-4">
                    <div className="space-y-2">
                      {scribeHistory.map((entry) => (
                        <div
                          key={entry.id}
                          className="border border-border rounded-md overflow-hidden"
                        >
                          <div className="flex items-center justify-between">
                            <button
                              onClick={() =>
                                setExpandedHistoryItems((prev) => ({
                                  ...prev,
                                  [entry.id]: !prev[entry.id],
                                }))
                              }
                              className="flex-1 flex items-center gap-2 p-2 hover:bg-muted/80 transition-colors"
                            >
                              {expandedHistoryItems[entry.id] ? (
                                <ChevronDown className="w-4 h-4 text-muted-foreground" />
                              ) : (
                                <ChevronRight className="w-4 h-4 text-muted-foreground" />
                              )}
                              <span className="text-sm font-medium">
                                Visit on {entry.date}
                              </span>
                            </button>

                            <div className="flex items-center gap-2 pr-2">
                              <button
                                title="Show transcript"
                                onClick={async () => {
                                  const id = entry.id;
                                  const job = (entry as any).jobName || id;
                                  console.log('Fetching history transcript for job:', job);
                                  setLoadingArtifact(id);
                                  try {
                                    const url = `${httpBase}/api/medai/medplum/healthscribe/transcript/${encodeURIComponent(
                                      job,
                                    )}`;
                                    console.log('History transcript URL:', url);
                                    const resp = await authenticatedFetch(url, {
                                      method: 'GET',
                                    });
                                    if (!resp.ok) {
                                      const t = await resp.text();
                                      console.error(
                                        'Failed to fetch history transcript:',
                                        resp.status,
                                        t,
                                      );
                                      setError(`Failed to load transcript (${resp.status}): ${t}`);
                                      return;
                                    }
                                    const data = await resp
                                      .json()
                                      .catch(async () => ({
                                        transcript: await resp.text(),
                                      }));
                                    const text =
                                      data?.transcript ??
                                      data?.text ??
                                      (typeof data === 'string' ? data : undefined);
                                    console.log(
                                      'Received history transcript, length:',
                                      text?.length || 0,
                                    );
                                    if (text) {
                                      setModalTranscript(text);
                                      setModalTitle(`Transcript - ${entry.date}`);
                                      setShowTranscriptModal(true);
                                    } else {
                                      setError('No transcript available');
                                    }
                                  } catch (e: any) {
                                    console.error('Error fetching history transcript:', e);
                                    setError(`Error: ${e?.message || String(e)}`);
                                  } finally {
                                    setLoadingArtifact(null);
                                  }
                                }}
                                className="p-1 rounded hover:bg-muted/50"
                              >
                                <FileText className="w-4 h-4" />
                              </button>

                              <button
                                title="Play audio"
                                onClick={async () => {
                                  const id = entry.id;
                                  const job = (entry as any).jobName || id;
                                  if (!job) {
                                    setError('Error: No job identifier found');
                                    return;
                                  }

                                  setModalJobName(job);

                                  const preloaded = preloadedAudio[job];
                                  if (preloaded) {
                                    console.log(
                                      'Using preloaded audio for history job:',
                                      job,
                                      'duration:',
                                      preloaded.duration,
                                    );
                                    setModalAudioUrl(preloaded.url);
                                    setModalAudioDuration(preloaded.duration);
                                    setModalTitle(`Recording - ${entry.date}`);
                                    setShowAudioModal(true);
                                    return;
                                  }

                                  console.log('Fetching history audio for job:', job);
                                  setLoadingArtifact(id);
                                  try {
                                    const baseUrl = `${httpBase}/api/medai/medplum/healthscribe/audio/${encodeURIComponent(job)}`;

                                    // Fetch metadata for duration
                                    let duration: number | undefined;
                                    try {
                                      const metaResp = await authenticatedFetch(`${baseUrl}?metadata=true`, { method: 'GET' });
                                      if (metaResp.ok) {
                                        const meta = await metaResp.json();
                                        if (meta.duration !== undefined && isFinite(Number(meta.duration))) {
                                          duration = Number(meta.duration);
                                        }
                                      }
                                    } catch (e) {
                                      console.warn('Failed to fetch audio metadata:', e);
                                    }

                                    // Fetch actual audio data
                                    const resp = await authenticatedFetch(baseUrl, { method: 'GET' });
                                    if (!resp.ok) {
                                      const t = await resp.text();
                                      console.error('Failed to fetch history audio:', resp.status, t);
                                      setError(`Failed to load audio (${resp.status}): ${t}`);
                                      return;
                                    }

                                    const blob = await resp.blob();
                                    const audioUrl = URL.createObjectURL(blob);

                                    // Cache for future use
                                    if (duration !== undefined) {
                                      setPreloadedAudio((prev) => ({
                                        ...prev,
                                        [job]: { url: audioUrl, duration },
                                      }));
                                    }

                                    // Open modal
                                    setModalAudioUrl(audioUrl);
                                    setModalAudioDuration(duration);
                                    setModalTitle(`Recording - ${entry.date}`);
                                    setShowAudioModal(true);
                                  } catch (e: any) {
                                    console.error('Error fetching history audio:', e);
                                    setError(e?.message || 'Failed to load audio');
                                  } finally {
                                    setLoadingArtifact(null);
                                  }
                                }}
                                className="p-1 rounded hover:bg-muted/50"
                              >
                                <AudioLines className="w-4 h-4" />
                              </button>
                            </div>
                          </div>

                          {expandedHistoryItems[entry.id] && (
                            <div className="p-3 bg-card space-y-3">
                              <div>
                                <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">
                                  Chief Complaint
                                </p>
                                <p className="text-sm text-foreground">
                                  {entry.chiefComplaint}
                                </p>
                              </div>

                              {entry.keyPoints.length > 0 && (
                                <div>
                                  <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">
                                    Key Points
                                  </p>
                                  <ul className="space-y-1">
                                    {entry.keyPoints.map((point, idx) => (
                                      <li
                                        key={idx}
                                        className="text-sm text-foreground flex items-start gap-2"
                                      >
                                        <span className="text-primary mt-0.5">•</span>
                                        <span>{point}</span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}

                              {entry.assessmentPlan.length > 0 && (
                                <div>
                                  <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">
                                    Assessment & Plan
                                  </p>
                                  <ul className="space-y-1">
                                    {entry.assessmentPlan.map((item, idx) => (
                                      <li
                                        key={idx}
                                        className="text-sm text-foreground flex items-start gap-2"
                                      >
                                        <span className="text-primary mt-0.5">•</span>
                                        <span>{item}</span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Modals */}
      <TranscriptModal
        isOpen={showTranscriptModal}
        onClose={() => setShowTranscriptModal(false)}
        transcript={modalTranscript}
        title={modalTitle}
      />

      <AudioPlayerModal
        isOpen={showAudioModal}
        onClose={() => {
          setShowAudioModal(false);
          setModalJobName(null);
          setModalAudioDuration(undefined);
        }}
        audioUrl={modalAudioUrl}
        title={modalTitle}
        preloadedDuration={
          modalAudioDuration ?? (modalJobName ? preloadedAudio[modalJobName]?.duration : undefined)
        }
      />
    </div>
  );
};