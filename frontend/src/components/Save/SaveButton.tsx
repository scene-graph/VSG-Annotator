import { useState } from 'react';
import { useIsMutating } from '@tanstack/react-query';
import { useSyncData } from '../../hooks';
import { usePendingEdgeEdit } from '../../store';

interface SaveButtonProps {
  videoId: string;
}

type SyncState = 'idle' | 'saving' | 'syncing' | 'synced' | 'error';

export function SaveButton({ videoId }: SaveButtonProps) {
  const [syncState, setSyncState] = useState<SyncState>('idle');
  const { sync, isMutating } = useSyncData(videoId);
  const globalMutating = useIsMutating();
  const pendingEdgeEdit = usePendingEdgeEdit();

  const isBusy = syncState === 'saving' || syncState === 'syncing';
  const hasPendingEdit = pendingEdgeEdit !== null;

  const handleClick = async () => {
    if (isBusy) return;

    try {
      if (hasPendingEdit) {
        setSyncState('saving');
        // EdgeReview.handleSaveAccept re-throws on failure, so this
        // surfaces mutation errors instead of silently moving on.
        await pendingEdgeEdit.commit();
      }
      setSyncState('syncing');
      await sync();
      setSyncState('synced');
      setTimeout(() => setSyncState('idle'), 2000);
    } catch {
      setSyncState('error');
      setTimeout(() => setSyncState('idle'), 2500);
    }
  };

  const getButtonStyle = () => {
    switch (syncState) {
      case 'saving':
        return 'bg-blue-700 cursor-wait';
      case 'syncing':
        return 'bg-amber-800 cursor-wait';
      case 'synced':
        return 'bg-green-600';
      case 'error':
        return 'bg-red-600';
      default:
        return hasPendingEdit
          ? 'bg-blue-600 hover:bg-blue-700'
          : 'bg-amber-600 hover:bg-amber-700';
    }
  };

  const getLabel = () => {
    switch (syncState) {
      case 'saving':
        return 'Saving...';
      case 'syncing':
        return 'Syncing...';
      case 'synced':
        return 'Saved!';
      case 'error':
        return 'Error';
      default:
        return hasPendingEdit ? 'Save Changes' : 'Save';
    }
  };

  const getIcon = () => {
    if (syncState === 'saving' || syncState === 'syncing') {
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
    }
    if (syncState === 'synced') {
      return (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      );
    }
    if (syncState === 'error') {
      return (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      );
    }
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
  };

  const title = hasPendingEdit
    ? 'Commit the unsaved edge edit, then sync.'
    : 'Invalidate caches and refetch from server.';

  return (
    <button
      onClick={handleClick}
      disabled={isBusy}
      title={title}
      className={`flex items-center gap-2 text-white px-3 py-1.5 rounded text-sm font-medium ${getButtonStyle()}`}
    >
      {getIcon()}
      {getLabel()}
      {syncState === 'idle' && hasPendingEdit && (
        <span
          className="w-2 h-2 bg-yellow-300 rounded-full animate-pulse"
          title="Unsaved changes in the edge editor"
        />
      )}
      {syncState === 'idle' && !hasPendingEdit && (isMutating || globalMutating > 0) && (
        <span
          className="w-2 h-2 bg-amber-300 rounded-full animate-pulse"
          title="Background mutation in flight..."
        />
      )}
    </button>
  );
}
