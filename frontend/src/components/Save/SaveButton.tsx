import { useState } from 'react';
import { useIsMutating } from '@tanstack/react-query';
import { useSyncData } from '../../hooks';

interface SaveButtonProps {
  videoId: string;
}

type SyncState = 'idle' | 'syncing' | 'synced' | 'error';

export function SaveButton({ videoId }: SaveButtonProps) {
  const [syncState, setSyncState] = useState<SyncState>('idle');
  const { sync, isMutating } = useSyncData(videoId);
  const globalMutating = useIsMutating();

  const handleClick = async () => {
    if (syncState === 'syncing') return;

    setSyncState('syncing');
    try {
      await sync();
      setSyncState('synced');
      setTimeout(() => setSyncState('idle'), 2000);
    } catch {
      setSyncState('error');
      setTimeout(() => setSyncState('idle'), 2000);
    }
  };

  const getButtonStyle = () => {
    switch (syncState) {
      case 'syncing':
        return 'bg-amber-800 cursor-wait';
      case 'synced':
        return 'bg-green-600';
      case 'error':
        return 'bg-red-600';
      default:
        return 'bg-amber-600 hover:bg-amber-700';
    }
  };

  const getLabel = () => {
    switch (syncState) {
      case 'syncing':
        return 'Syncing...';
      case 'synced':
        return 'Saved!';
      case 'error':
        return 'Error';
      default:
        return 'Save';
    }
  };

  const getIcon = () => {
    switch (syncState) {
      case 'syncing':
        // Spinner icon
        return (
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        );
      case 'synced':
        // Checkmark icon
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 13l4 4L19 7"
            />
          </svg>
        );
      case 'error':
        // X icon
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        );
      default:
        // Save/disk icon
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"
            />
          </svg>
        );
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={syncState === 'syncing'}
      className={`flex items-center gap-2 text-white px-3 py-1.5 rounded text-sm font-medium ${getButtonStyle()}`}
    >
      {getIcon()}
      {getLabel()}
      {/* Show indicator if mutations are in-flight */}
      {syncState === 'idle' && (isMutating || globalMutating > 0) && (
        <span className="w-2 h-2 bg-amber-400 rounded-full animate-pulse" title="Changes pending..." />
      )}
    </button>
  );
}
