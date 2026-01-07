'use client';
import { createContext, useContext, useState, type ReactNode } from 'react';

interface RecordingContextType {
  isRecording: boolean;
  isPaused: boolean;
  setIsRecording: (value: boolean) => void;
  setIsPaused: (value: boolean) => void;
}

const RecordingContext = createContext<RecordingContextType | null>(null);

export function RecordingProvider({ children }: { children: ReactNode }) {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

  return (
    <RecordingContext.Provider value={{ isRecording, isPaused, setIsRecording, setIsPaused }}>
      {children}
    </RecordingContext.Provider>
  );
}

export function useRecordingContext(): RecordingContextType {
  const context = useContext(RecordingContext);
  if (!context) {
    // Return a default context if not within provider (for backward compatibility)
    return {
      isRecording: false,
      isPaused: false,
      setIsRecording: () => {},
      setIsPaused: () => {},
    };
  }
  return context;
}
