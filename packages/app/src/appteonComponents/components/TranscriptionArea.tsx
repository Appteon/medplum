import { useEffect, useState } from 'react';
import { cn } from '../helpers/utils';

interface TranscriptionAreaProps {
  isRecording: boolean;
  transcript: string;
}

export const TranscriptionArea = ({ isRecording, transcript }: TranscriptionAreaProps) => {
  const [displayText, setDisplayText] = useState('');
  const [parsedLines, setParsedLines] = useState<Array<{ speaker: string; text: string }>>([]);

  useEffect(() => {
    if (isRecording && transcript) {
      setDisplayText(transcript);
      // Parse the transcript to separate speaker labels from text
      const lines = transcript.split('\n').filter(line => line.trim());
      const parsed = lines.map(line => {
        const match = line.match(/^\[(Doctor|Patient|SPEAKER_\d+)\]\s*(.*)$/);
        if (match) {
          return { speaker: match[1], text: match[2] };
        }
        return { speaker: '', text: line };
      });
      setParsedLines(parsed);
    } else if (!isRecording) {
      setDisplayText('');
      setParsedLines([]);
    }
  }, [isRecording, transcript]);

  return (
    <div className={cn(
      "flex-1 min-h-0 w-full bg-gradient-to-b from-card to-muted/30 rounded-lg overflow-y-auto scrollbar-thin",
      "border border-border shadow-inner"
    )}>
      {displayText ? (
        <div className="p-4 space-y-3">
          {parsedLines.map((line, idx) => {
            const isDoctor = line.speaker === 'Doctor' || line.speaker === 'SPEAKER_1';
            const isPatient = line.speaker === 'Patient' || line.speaker === 'SPEAKER_2';
            const isSpeaker = line.speaker.startsWith('SPEAKER_');

            return (
              <div
                key={idx}
                className={cn(
                  "rounded-lg p-3 border-l-4 transition-all duration-200",
                  isDoctor
                    ? "bg-blue-50 dark:bg-blue-950/20 border-l-blue-400 dark:border-l-blue-500"
                    : isPatient
                    ? "bg-amber-50 dark:bg-amber-950/20 border-l-amber-400 dark:border-l-amber-500"
                    : isSpeaker
                    ? "bg-purple-50 dark:bg-purple-950/20 border-l-purple-400 dark:border-l-purple-500"
                    : "bg-muted/40 border-l-muted-foreground/30"
                )}
              >
                {line.speaker && (
                  <div className="flex items-center gap-2 mb-1.5">
                    <span
                      className={cn(
                        "inline-block px-2.5 py-1 rounded-full text-xs font-semibold tracking-wide",
                        isDoctor
                          ? "bg-blue-200 dark:bg-blue-900/50 text-blue-900 dark:text-blue-100"
                          : isPatient
                          ? "bg-amber-200 dark:bg-amber-900/50 text-amber-900 dark:text-amber-100"
                          : isSpeaker
                          ? "bg-purple-200 dark:bg-purple-900/50 text-purple-900 dark:text-purple-100"
                          : "bg-muted text-muted-foreground"
                      )}
                    >
                      {isDoctor ? 'Doctor' : isPatient ? 'Patient' : line.speaker}
                    </span>
                  </div>
                )}
                <p className={cn(
                  "text-sm leading-relaxed",
                  line.speaker
                    ? "text-foreground font-medium"
                    : "text-muted-foreground italic"
                )}>
                  {line.text}
                </p>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex items-center justify-center h-full">
          <p className="text-sm text-muted-foreground italic">
            Transcription will appear here...
          </p>
        </div>
      )}
    </div>
  );
};
