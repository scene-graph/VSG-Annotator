import { useState } from 'react';
import { X, Copy, CheckCircle, AlertCircle } from 'lucide-react';

interface AIDebugModalProps {
  isOpen: boolean;
  onClose: () => void;
  debugInfo: {
    request: {
      video_id: string;
      node_id: string;
      frame_idx: number;
      bbox?: { left?: number; top?: number; width: number; height: number; x?: number; y?: number };
      frame_path?: string;
      node_visible_range?: string;
    };
    cropped_image?: string; // base64
    raw_request?: any;
    raw_response?: any;
    response_content?: string;
    processed_suggestions?: {
      visual: { color: string; texture: string; material: string };
      physical: { size: string; shape: string };
      confidence: number;
    };
    error?: string;
    debug_info?: {
      frame_path_attempted?: string[];
      frame_exists?: boolean;
      bbox_used?: { left?: number; top?: number; width: number; height: number; x?: number; y?: number };
      error_details?: string;
      response_meta?: { content_type?: string; content_length?: number };
      response_content_present?: boolean;
    };
  } | null;
}

export function AIDebugModal({ isOpen, onClose, debugInfo }: AIDebugModalProps) {
  const [copiedSection, setCopiedSection] = useState<string | null>(null);
  const [showRawResponse, setShowRawResponse] = useState(false);

  if (!isOpen || !debugInfo) return null;

  const copyToClipboard = (text: string, section: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSection(section);
    setTimeout(() => setCopiedSection(null), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-gray-800 rounded-lg w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h2 className="text-xl font-semibold text-white flex items-center gap-2">
            🔍 AI Suggestions Debug View
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {/* Cropped Image Preview */}
          {debugInfo.cropped_image && (
            <div className="bg-gray-900 rounded-lg p-4">
              <h3 className="text-sm font-medium text-gray-400 mb-3 flex items-center gap-2">
                📷 Cropped Image Being Analyzed
              </h3>
              <div className="flex justify-center">
                <img
                  src={`data:image/jpeg;base64,${debugInfo.cropped_image}`}
                  alt="Cropped object"
                  className="max-w-full max-h-64 border-2 border-gray-600 rounded"
                />
              </div>
            </div>
          )}

          {/* Request Details */}
          <div className="bg-gray-900 rounded-lg p-4">
            <h3 className="text-sm font-medium text-gray-400 mb-3 flex items-center gap-2">
              📋 Request Details
            </h3>
            <div className="space-y-2 text-sm">
              <div className="flex">
                <span className="text-gray-500 w-32">Video ID:</span>
                <span className="text-white font-mono">{debugInfo.request.video_id}</span>
              </div>
              <div className="flex">
                <span className="text-gray-500 w-32">Node ID:</span>
                <span className="text-white font-mono">{debugInfo.request.node_id}</span>
              </div>
              <div className="flex">
                <span className="text-gray-500 w-32">Frame:</span>
                <span className="text-white font-mono">
                  {debugInfo.request.frame_idx}
                  {debugInfo.request.frame_path && (
                    <span className="text-gray-400 text-xs ml-2">
                      ({debugInfo.request.frame_path})
                    </span>
                  )}
                </span>
              </div>
              {debugInfo.request.node_visible_range && (
                <div className="flex">
                  <span className="text-gray-500 w-32">Node Visible:</span>
                  <span className="text-green-400 text-sm">
                    {debugInfo.request.node_visible_range}
                  </span>
                </div>
              )}
              {debugInfo.debug_info?.frame_path_attempted && (
                <div className="flex">
                  <span className="text-gray-500 w-32">Frame Path:</span>
                  <span className="text-white font-mono text-xs break-all">
                    {Array.isArray(debugInfo.debug_info.frame_path_attempted)
                      ? debugInfo.debug_info.frame_path_attempted.join(' | ')
                      : debugInfo.debug_info.frame_path_attempted}
                  </span>
                </div>
              )}
              {debugInfo.debug_info?.frame_exists !== undefined && (
                <div className="flex">
                  <span className="text-gray-500 w-32">Frame Exists:</span>
                  <span className={debugInfo.debug_info.frame_exists ? 'text-green-400' : 'text-red-400'}>
                    {debugInfo.debug_info.frame_exists ? '✓ Yes' : '✗ No'}
                  </span>
                </div>
              )}
              {debugInfo.request.bbox && (
                <div className="flex">
                  <span className="text-gray-500 w-32">BBox:</span>
                  <span className="text-white font-mono text-xs">
                    x:{debugInfo.request.bbox.x ?? debugInfo.request.bbox.left ?? ''}, y:{debugInfo.request.bbox.y ?? debugInfo.request.bbox.top ?? ''},
                    w:{debugInfo.request.bbox.width}, h:{debugInfo.request.bbox.height}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Raw API Request */}
          {debugInfo.raw_request && (
            <div className="bg-gray-900 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-gray-400 flex items-center gap-2">
                  🔄 API Request Payload
                </h3>
                <button
                  onClick={() => copyToClipboard(JSON.stringify(debugInfo.raw_request, null, 2), 'request')}
                  className="text-gray-400 hover:text-white transition-colors flex items-center gap-1 text-xs"
                >
                  {copiedSection === 'request' ? (
                    <>
                      <CheckCircle className="w-3 h-3" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      Copy
                    </>
                  )}
                </button>
              </div>
              <pre className="bg-black/30 rounded p-3 text-xs text-green-400 overflow-x-auto">
                {JSON.stringify(debugInfo.raw_request, null, 2)}
              </pre>
            </div>
          )}

          {/* Extracted Response Content */}
          {debugInfo.response_content && (
            <div className="bg-gray-900 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-gray-400 flex items-center gap-2">
                  🧾 Extracted Response Content
                </h3>
                <button
                  onClick={() => copyToClipboard(debugInfo.response_content ?? '', 'response_content')}
                  className="text-gray-400 hover:text-white transition-colors flex items-center gap-1 text-xs"
                >
                  {copiedSection === 'response_content' ? (
                    <>
                      <CheckCircle className="w-3 h-3" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      Copy
                    </>
                  )}
                </button>
              </div>
              <pre className="bg-black/30 rounded p-3 text-xs text-blue-400 overflow-x-auto max-h-64 overflow-y-auto">
                {debugInfo.response_content}
              </pre>
            </div>
          )}

          {/* Raw API Response (optional) */}
          {debugInfo.raw_response && (
            <div className="bg-gray-900 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-gray-400 flex items-center gap-2">
                  ✅ API Response (Full)
                </h3>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowRawResponse((prev) => !prev)}
                    className="text-gray-400 hover:text-white transition-colors text-xs"
                  >
                    {showRawResponse ? 'Hide' : 'Show'}
                  </button>
                  <button
                    onClick={() => copyToClipboard(JSON.stringify(debugInfo.raw_response, null, 2), 'response')}
                    className="text-gray-400 hover:text-white transition-colors flex items-center gap-1 text-xs"
                  >
                    {copiedSection === 'response' ? (
                      <>
                        <CheckCircle className="w-3 h-3" />
                        Copied!
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        Copy
                      </>
                    )}
                  </button>
                </div>
              </div>
              {showRawResponse ? (
                <pre className="bg-black/30 rounded p-3 text-xs text-blue-400 overflow-x-auto max-h-64 overflow-y-auto">
                  {JSON.stringify(debugInfo.raw_response, null, 2)}
                </pre>
              ) : (
                <div className="text-xs text-gray-500">Response hidden. Click Show to expand.</div>
              )}
            </div>
          )}

          {/* Processed Suggestions */}
          {debugInfo.processed_suggestions && (
            <div className="bg-gray-900 rounded-lg p-4">
              <h3 className="text-sm font-medium text-gray-400 mb-3 flex items-center gap-2">
                🎯 Processed Suggestions
              </h3>
              <div className="space-y-3">
                <div>
                  <h4 className="text-xs text-gray-500 mb-1">Visual Attributes:</h4>
                  <div className="flex flex-wrap gap-2">
                    <span className="px-2 py-1 rounded bg-blue-500/20 text-blue-400 text-sm">
                      color: {debugInfo.processed_suggestions.visual.color}
                    </span>
                    <span className="px-2 py-1 rounded bg-green-500/20 text-green-400 text-sm">
                      texture: {debugInfo.processed_suggestions.visual.texture}
                    </span>
                    <span className="px-2 py-1 rounded bg-purple-500/20 text-purple-400 text-sm">
                      material: {debugInfo.processed_suggestions.visual.material}
                    </span>
                  </div>
                </div>
                <div>
                  <h4 className="text-xs text-gray-500 mb-1">Physical Attributes:</h4>
                  <div className="flex flex-wrap gap-2">
                    <span className="px-2 py-1 rounded bg-yellow-500/20 text-yellow-400 text-sm">
                      size: {debugInfo.processed_suggestions.physical.size}
                    </span>
                    <span className="px-2 py-1 rounded bg-pink-500/20 text-pink-400 text-sm">
                      shape: {debugInfo.processed_suggestions.physical.shape}
                    </span>
                  </div>
                </div>
                <div className="text-sm">
                  <span className="text-gray-500">Confidence:</span>
                  <span className="ml-2 text-white font-medium">
                    {(debugInfo.processed_suggestions.confidence * 100).toFixed(1)}%
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Error Messages */}
          {(debugInfo.error || debugInfo.debug_info?.error_details) && (
            <div className="bg-red-900/20 border border-red-600/30 rounded-lg p-4">
              <h3 className="text-sm font-medium text-red-400 mb-3 flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                Errors
              </h3>
              <div className="space-y-2">
                {debugInfo.error && (
                  <div className="text-sm text-red-300">{debugInfo.error}</div>
                )}
                {debugInfo.debug_info?.error_details && (
                  <pre className="text-xs text-red-300 bg-black/30 rounded p-2 overflow-x-auto">
                    {debugInfo.debug_info.error_details}
                  </pre>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-700">
          <button
            onClick={onClose}
            className="w-full bg-gray-700 hover:bg-gray-600 text-white py-2 rounded font-medium transition-colors"
          >
            Close Debug View
          </button>
        </div>
      </div>
    </div>
  );
}
