'use client';

import { X, Play, Pause, RotateCcw, RotateCw, Volume2, VolumeX, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

interface AudioPlayerModalProps {
  isOpen: boolean;
  onClose: () => void;
  audioUrl: string;
  title?: string;
  preloadedDuration?: number; // Duration in seconds, preloaded from parent
  jobName?: string; // Job name for delete functionality
  onDelete?: (jobName: string) => Promise<void>; // Callback to delete the recording
}

export const AudioPlayerModal = ({
  isOpen,
  onClose,
  audioUrl,
  title = 'Audio Player',
  preloadedDuration,
  jobName,
  onDelete,
}: AudioPlayerModalProps) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const isValidDuration = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value > 0;

  // Close on Escape and lock body scroll
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  // NEW: react to preloadedDuration changes even after modal is already open
  useEffect(() => {
    if (!isOpen) return;
    if (isValidDuration(preloadedDuration)) {
      setDuration(preloadedDuration);
      // Do not force isLoading true if we already have a trusted duration
    }
  }, [preloadedDuration, isOpen]);

  // Initialize and manage audio element
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
    };

    const handleLoadedMetadata = () => {
      if (isValidDuration(audio.duration)) {
        setDuration(audio.duration);
      }
      setIsLoading(false);
      console.log('Audio metadata loaded, duration:', audio.duration);
    };

    const handleDurationChange = () => {
      if (isValidDuration(audio.duration)) {
        setDuration(audio.duration);
        console.log('Duration updated:', audio.duration);
      }
    };

    const handleCanPlayThrough = () => {
      if (isValidDuration(audio.duration)) {
        setDuration(audio.duration);
      }
      setIsLoading(false);
      console.log('Audio can play through, duration:', audio.duration);
    };

    const handleEnded = () => {
      setIsPlaying(false);
    };

    const handleCanPlay = () => {
      if (isValidDuration(audio.duration)) {
        setDuration(audio.duration);
      }
      setIsLoading(false);
      console.log('Audio can play, duration:', audio.duration);
    };

    const handleLoadStart = () => {
      setIsLoading(true);
      console.log('Audio load started');
    };

    const handleError = (e: Event) => {
      setIsLoading(false);
      const target = e.target as HTMLAudioElement;
      const error = target.error;
      console.error('Audio error:', {
        code: error?.code,
        message: error?.message,
        src: audio.src,
        networkState: audio.networkState,
        readyState: audio.readyState,
      });
    };

    const handleLoadedData = () => {
      if (isValidDuration(audio.duration)) {
        setDuration(audio.duration);
        console.log('Audio data loaded, duration:', audio.duration);
      }
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('durationchange', handleDurationChange);
    audio.addEventListener('canplaythrough', handleCanPlayThrough);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('canplay', handleCanPlay);
    audio.addEventListener('loadstart', handleLoadStart);
    audio.addEventListener('error', handleError);
    audio.addEventListener('loadeddata', handleLoadedData);

    // Load the audio if we have a URL
    if (isOpen && audioUrl) {
      console.log('Loading audio from URL:', audioUrl.substring(0, 100));
      setIsLoading(true);
      setIsPlaying(false);
      setCurrentTime(0);
      // Use preloaded duration if available; otherwise keep previous or reset to 0
      setDuration(isValidDuration(preloadedDuration) ? preloadedDuration : 0);

      audio.src = audioUrl;

      // Try to get duration synchronously if already available
      if (isValidDuration(audio.duration)) {
        setDuration(audio.duration);
        setIsLoading(false);
        console.log('Duration available immediately:', audio.duration);
      } else {
        // Duration will be set via event listeners
        audio.load();
      }
    }

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('durationchange', handleDurationChange);
      audio.removeEventListener('canplaythrough', handleCanPlayThrough);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('canplay', handleCanPlay);
      audio.removeEventListener('loadstart', handleLoadStart);
      audio.removeEventListener('error', handleError);
      audio.removeEventListener('loadeddata', handleLoadedData);
    };
  }, [isOpen, audioUrl, preloadedDuration]);

  const togglePlayPause = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  const skipForward = () => {
    if (audioRef.current) {
      audioRef.current.currentTime = Math.min(audioRef.current.currentTime + 10, duration);
    }
  };

  const skipBackward = () => {
    if (audioRef.current) {
      audioRef.current.currentTime = Math.max(audioRef.current.currentTime - 10, 0);
    }
  };

  const changePlaybackRate = (rate: number) => {
    if (audioRef.current) {
      audioRef.current.playbackRate = rate;
      setPlaybackRate(rate);
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const vol = parseFloat(e.target.value);
    if (audioRef.current) {
      audioRef.current.volume = vol;
      setVolume(vol);
      setIsMuted(vol === 0);
    }
  };

  const toggleMute = () => {
    if (audioRef.current) {
      if (isMuted) {
        audioRef.current.volume = volume || 0.5;
        setIsMuted(false);
      } else {
        audioRef.current.volume = 0;
        setIsMuted(true);
      }
    }
  };

  const formatTime = (seconds: number) => {
    if (!isFinite(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleDelete = async () => {
    if (!jobName || !onDelete) return;
    setIsDeleting(true);
    try {
      await onDelete(jobName);
      setShowDeleteConfirm(false);
      onClose();
    } catch (e) {
      console.error('Failed to delete recording:', e);
    } finally {
      setIsDeleting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="relative w-full max-w-2xl bg-card rounded-lg shadow-2xl border border-border">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          <div className="flex items-center gap-2">
            {jobName && onDelete && (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="p-2 rounded-md hover:bg-destructive/10 text-destructive transition-colors"
                aria-label="Delete recording"
                title="Delete recording"
              >
                <Trash2 className="w-5 h-5" />
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 rounded-md hover:bg-muted transition-colors"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Audio Player */}
        <div className="p-6">
          <audio ref={audioRef} preload="auto" className="hidden" />

          {/* Progress Bar */}
          <div className="mb-4">
            <input
              type="range"
              min="0"
              max={duration || 0}
              value={currentTime}
              onChange={handleSeek}
              disabled={isLoading || duration === 0}
              className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer slider"
            />
            <div className="flex justify-between text-sm text-muted-foreground mt-2 font-medium">
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center justify-center gap-4 mb-6">
            <button
              onClick={skipBackward}
              disabled={isLoading}
              className="flex items-center gap-1 px-3 py-2 rounded-full hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="Rewind 10s"
            >
              <RotateCcw className="w-5 h-5" />
              <span className="text-xs font-semibold">10s</span>
            </button>

            <button
              onClick={togglePlayPause}
              disabled={isLoading}
              className="p-4 rounded-full bg-primary hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? (
                <Pause className="w-6 h-6 text-background" />
              ) : (
                <Play className="w-6 h-6 text-background" />
              )}
            </button>

            <button
              onClick={skipForward}
              disabled={isLoading}
              className="flex items-center gap-1 px-3 py-2 rounded-full hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="Forward 10s"
            >
              <span className="text-xs font-semibold">10s</span>
              <RotateCw className="w-5 h-5" />
            </button>
          </div>

          {/* Playback Speed */}
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm text-muted-foreground">Playback Speed</span>
            <div className="flex gap-2">
              {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => (
                <button
                  key={rate}
                  onClick={() => changePlaybackRate(rate)}
                  disabled={isLoading}
                  className={`px-3 py-1 text-xs rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                    playbackRate === rate
                      ? 'bg-primary text-background'
                      : 'bg-muted hover:bg-muted/80 text-foreground'
                  }`}
                >
                  {rate}x
                </button>
              ))}
            </div>
          </div>

          {/* Volume Control */}
          <div className="flex items-center gap-3">
            <button
              onClick={toggleMute}
              disabled={isLoading}
              className="p-2 rounded-md hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={isMuted ? 0 : volume}
              onChange={handleVolumeChange}
              disabled={isLoading}
              className="flex-1 h-2 bg-muted rounded-lg appearance-none cursor-pointer slider"
            />
            <span className="text-xs text-muted-foreground w-12 text-right">
              {Math.round((isMuted ? 0 : volume) * 100)}%
            </span>
          </div>

          {isLoading && (
            <div className="text-center text-sm text-muted-foreground mt-4">Loading audio...</div>
          )}

          {!isLoading && duration === 0 && (
            <div className="text-center text-sm text-destructive mt-4">
              Unable to load audio. The file may be corrupted or in an unsupported format.
            </div>
          )}
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50">
          <div className="bg-card border border-border rounded-lg p-6 max-w-sm w-full shadow-xl">
            <h3 className="text-lg font-semibold text-foreground mb-2">Delete Recording?</h3>
            <p className="text-sm text-muted-foreground mb-4">
              This will permanently delete this audio recording. This action is irreversible and cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={isDeleting}
                className="px-4 py-2 text-sm font-medium text-foreground bg-muted hover:bg-muted/80 rounded-md transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={isDeleting}
                className="px-4 py-2 text-sm font-medium text-white bg-destructive hover:bg-destructive/90 rounded-md transition-colors disabled:opacity-50"
              >
                {isDeleting ? 'Deleting...' : 'Delete Recording'}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .slider::-webkit-slider-thumb {
          appearance: none;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: hsl(var(--primary));
          cursor: pointer;
        }

        .slider::-moz-range-thumb {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: hsl(var(--primary));
          cursor: pointer;
          border: none;
        }

        .slider:disabled::-webkit-slider-thumb {
          background: hsl(var(--muted-foreground));
        }

        .slider:disabled::-moz-range-thumb {
          background: hsl(var(--muted-foreground));
        }
      `}</style>
    </div>
  );
};