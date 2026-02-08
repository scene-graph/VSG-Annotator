import { useState, useRef, useEffect } from 'react';
import { useExportSummary } from '../../hooks';
import { exportApi } from '../../services/api';

interface ExportButtonProps {
  videoId: string;
}

export function ExportButton({ videoId }: ExportButtonProps) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [includeRejected, setIncludeRejected] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { data: summary } = useExportSummary(videoId);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleDownload = async () => {
    const url = exportApi.getDownloadUrl(videoId, includeRejected, true);

    // Create a temporary link and click it to trigger download
    const link = document.createElement('a');
    link.href = url;
    link.download = `${videoId}_revised.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setShowDropdown(false);
  };

  const revisionCount = summary?.revisions?.total || 0;
  const sceneInfoRevisions = summary?.revisions?.scene_info_revisions || 0;
  const cameraMotionRevisions = summary?.revisions?.camera_motion_revisions || 0;
  const nodeRevisions = summary?.revisions?.node_revisions || 0;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded text-sm font-medium"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
          />
        </svg>
        Export
        {revisionCount > 0 && (
          <span className="bg-green-500 text-white text-xs px-1.5 py-0.5 rounded-full">
            {revisionCount}
          </span>
        )}
      </button>

      {showDropdown && (
        <div className="absolute right-0 mt-2 w-72 bg-gray-800 rounded-lg shadow-lg border border-gray-700 z-50">
          <div className="p-4">
            <h3 className="text-white font-medium mb-3">Export Options</h3>

            {/* Revision Summary */}
            {summary && (
              <div className="bg-gray-900 rounded p-3 mb-4 text-sm">
                <div className="text-gray-400 mb-2">Revision Summary</div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="text-gray-400">
                    Accepted: <span className="text-green-400">{summary.revisions?.accepted || 0}</span>
                  </div>
                  <div className="text-gray-400">
                    Rejected: <span className="text-red-400">{summary.revisions?.rejected || 0}</span>
                  </div>
                  <div className="text-gray-400">
                    Modified: <span className="text-blue-400">{summary.revisions?.modified || 0}</span>
                  </div>
                  <div className="text-gray-400">
                    Created: <span className="text-purple-400">{summary.revisions?.created || 0}</span>
                  </div>
                </div>
                {(sceneInfoRevisions > 0 || cameraMotionRevisions > 0) && (
                  <div className="mt-2 pt-2 border-t border-gray-700">
                    <div className="text-gray-400 text-xs">Metadata Revisions</div>
                    <div className="grid grid-cols-2 gap-2 text-xs mt-1">
                      <div className="text-gray-400">
                        Scene Info: <span className="text-cyan-400">{sceneInfoRevisions}</span>
                      </div>
                      <div className="text-gray-400">
                        Camera Motion: <span className="text-orange-400">{cameraMotionRevisions}</span>
                      </div>
                    </div>
                  </div>
                )}
                {nodeRevisions > 0 && (
                  <div className="mt-2 pt-2 border-t border-gray-700">
                    <div className="text-gray-400 text-xs">Node Revisions</div>
                    <div className="text-gray-400 text-xs mt-1">
                      Modified Nodes: <span className="text-emerald-400">{nodeRevisions}</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Options */}
            <div className="space-y-3 mb-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeRejected}
                  onChange={(e) => setIncludeRejected(e.target.checked)}
                  className="rounded bg-gray-700 border-gray-600"
                />
                <span className="text-gray-300 text-sm">Include rejected edges</span>
              </label>
            </div>

            {/* Download Button */}
            <button
              onClick={handleDownload}
              className="w-full bg-green-600 hover:bg-green-700 text-white py-2 rounded font-semibold flex items-center justify-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                />
              </svg>
              Download Revised VSG
            </button>

            <p className="text-gray-500 text-xs mt-2 text-center">
              Downloads JSON file with all revisions applied
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
