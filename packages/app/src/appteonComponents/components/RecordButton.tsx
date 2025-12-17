import { Mic, Square, Loader2 } from 'lucide-react';
import { cn } from '../helpers/utils';

interface RecordButtonProps {
  isRecording: boolean;
  onToggle: () => void;
  disabled?: boolean;
  isProcessing?: boolean;
}

export const RecordButton = ({ isRecording, onToggle, disabled, isProcessing }: RecordButtonProps) => {
  return (
    <button
      onClick={onToggle}
      disabled={disabled}
      className={cn(
        "emr-record-btn",
        isRecording ? "recording" : "",
        disabled && "opacity-50 cursor-not-allowed"
      )}
    >
      {isProcessing ? (
        <Loader2 className="w-8 h-8 text-muted-foreground animate-spin" />
      ) : isRecording ? (
        <Square className="w-10 h-10 text-success-foreground fill-current" />
      ) : (
        <Mic className="w-10 h-10 text-destructive-foreground" />
      )}
    </button>
  );
};
