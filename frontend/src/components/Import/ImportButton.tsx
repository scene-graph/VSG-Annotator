import { useState, useRef } from 'react';
import { useImportVsg } from '../../hooks/useVideo';
import { useCurrentUser } from '../../store';

interface ImportButtonProps {
  videoId: string;
}

export function ImportButton({ videoId }: ImportButtonProps) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const currentUser = useCurrentUser();

  const importMutation = useImportVsg();

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (!file.name.endsWith('.json')) {
        setError('Please select a .json file');
        return;
      }
      setSelectedFile(file);
      setShowConfirm(true);
      setError(null);
    }
  };

  const handleConfirm = async () => {
    if (!selectedFile || !currentUser) return;

    try {
      await importMutation.mutateAsync({
        videoId,
        file: selectedFile,
        userId: currentUser.id,
        clearRevisions: true,
      });
      setShowConfirm(false);
      setSelectedFile(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    }
  };

  const handleCancel = () => {
    setShowConfirm(false);
    setSelectedFile(null);
    setError(null);
    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const inputId = `import-file-input-${videoId}`;

  const handleLabelClick = (e: React.MouseEvent) => {
    if (!currentUser) {
      e.preventDefault();
      setError('Please select a user first');
      return;
    }
    if (importMutation.isPending) {
      e.preventDefault();
      return;
    }
    // Allow the label's default behavior to trigger the file input
  };

  return (
    <>
      {/* Hidden file input - using label association instead of programmatic click */}
      <input
        ref={fileInputRef}
        id={inputId}
        type="file"
        accept=".json"
        onChange={handleFileSelect}
        className="sr-only"
      />

      {/* Label styled as button - clicking opens file picker natively */}
      <div className="relative group">
        <label
          htmlFor={inputId}
          onClick={handleLabelClick}
          className={`flex items-center gap-2 text-white px-3 py-1.5 rounded text-sm font-medium ${
            importMutation.isPending || !currentUser
              ? 'bg-blue-800 cursor-not-allowed'
              : 'bg-blue-600 hover:bg-blue-700 cursor-pointer'
          }`}
        >
          {importMutation.isPending ? (
            <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24">
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
                fill="none"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
              />
            </svg>
          )}
          {importMutation.isPending ? 'Importing...' : 'Import'}
        </label>
        {/* Tooltip */}
        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 px-3 py-2 bg-gray-900 text-gray-200 text-xs rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
          May not work in Chrome. Use Safari for best results.
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 border-4 border-transparent border-b-gray-900" />
        </div>
      </div>

      {/* Error toast */}
      {error && (
        <div className="fixed bottom-4 right-4 bg-red-600 text-white px-4 py-2 rounded shadow-lg z-50 flex items-center gap-2">
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            className="text-white hover:text-red-200"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Success toast */}
      {importMutation.isSuccess && (
        <div className="fixed bottom-4 right-4 bg-green-600 text-white px-4 py-2 rounded shadow-lg z-50">
          VSG imported successfully!
        </div>
      )}

      {/* Confirmation dialog */}
      {showConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-6 max-w-md mx-4 shadow-xl">
            <h3 className="text-white text-lg font-semibold mb-2">
              Import VSG File
            </h3>
            <p className="text-gray-300 mb-4">
              This will replace the current VSG and <span className="text-yellow-400 font-medium">clear all revisions</span>.
              The imported file should already have any revisions baked in.
            </p>
            <div className="bg-gray-900 rounded p-3 mb-4">
              <div className="text-gray-400 text-sm">Selected file:</div>
              <div className="text-white truncate">{selectedFile?.name}</div>
            </div>
            <div className="flex gap-3 justify-end">
              <button
                onClick={handleCancel}
                className="px-4 py-2 text-gray-300 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                disabled={importMutation.isPending}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 text-white rounded font-medium"
              >
                {importMutation.isPending ? 'Importing...' : 'Import'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
