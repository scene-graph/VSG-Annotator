import { useState } from 'react';
import { X, Copy, CheckCircle } from 'lucide-react';

interface EdgeAIDebugModalProps {
  isOpen: boolean;
  onClose: () => void;
  debugInfo: {
    request: {
      video_id: string;
      edge_id: string;
      edge_type: string;
      frame_idx: number;
      provider?: string;
      resolved_frame_idx?: number;
      context_frames?: number[];
    };
    context_images?: string[];
    raw_request?: any;
    raw_response?: any;
    response_content?: string;
    processed_suggestions?: {
      predicate: string;
      confidence: number;
      attributes?: {
        velocity: string;
        direction: string;
        trajectory: string;
      };
    };
    error?: string;
    debug_info?: Record<string, unknown>;
  } | null;
}

export function EdgeAIDebugModal({ isOpen, onClose, debugInfo }: EdgeAIDebugModalProps) {
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
      <div className="bg-gray-800 rounded-lg w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h2 className="text-xl font-semibold text-white">AI Edge Suggestions Debug View</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {debugInfo.context_images && debugInfo.context_images.length > 0 && (
            <div className="bg-gray-900 rounded-lg p-4">
              <h3 className="text-sm font-medium text-gray-400 mb-3">
                Context Frames Sent To VLM
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {debugInfo.context_images.map((image, idx) => {
                  const frame = debugInfo.request.context_frames?.[idx];
                  return (
                    <div key={`${frame ?? idx}-${idx}`} className="space-y-1">
                      <div className="text-xs text-gray-400">
                        Frame {frame ?? idx}
                      </div>
                      <img
                        src={`data:image/jpeg;base64,${image}`}
                        alt={`Context frame ${frame ?? idx}`}
                        className="w-full h-44 object-contain border border-gray-700 rounded bg-black/30"
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="bg-gray-900 rounded-lg p-4">
            <h3 className="text-sm font-medium text-gray-400 mb-3">Request Details</h3>
            <div className="space-y-1 text-sm">
              <div><span className="text-gray-500">Video ID: </span><span className="text-white font-mono">{debugInfo.request.video_id}</span></div>
              <div><span className="text-gray-500">Edge ID: </span><span className="text-white font-mono">{debugInfo.request.edge_id}</span></div>
              <div><span className="text-gray-500">Edge Type: </span><span className="text-white font-mono">{debugInfo.request.edge_type}</span></div>
              <div><span className="text-gray-500">Selected Frame: </span><span className="text-white font-mono">{debugInfo.request.frame_idx}</span></div>
              {debugInfo.request.resolved_frame_idx !== undefined && (
                <div><span className="text-gray-500">Resolved Frame: </span><span className="text-white font-mono">{debugInfo.request.resolved_frame_idx}</span></div>
              )}
              {debugInfo.request.context_frames && (
                <div><span className="text-gray-500">Context Frames: </span><span className="text-white font-mono">{debugInfo.request.context_frames.join(', ')}</span></div>
              )}
              {debugInfo.request.provider && (
                <div><span className="text-gray-500">Provider: </span><span className="text-white font-mono">{debugInfo.request.provider}</span></div>
              )}
            </div>
          </div>

          {debugInfo.processed_suggestions && (
            <div className="bg-gray-900 rounded-lg p-4">
              <h3 className="text-sm font-medium text-gray-400 mb-3">Processed Suggestions</h3>
              <div className="space-y-1 text-sm text-white">
                <div>predicate: <span className="text-purple-300">{debugInfo.processed_suggestions.predicate}</span></div>
                {debugInfo.processed_suggestions.attributes && (
                  <>
                    <div>velocity: <span className="text-purple-300">{debugInfo.processed_suggestions.attributes.velocity}</span></div>
                    <div>direction: <span className="text-purple-300">{debugInfo.processed_suggestions.attributes.direction}</span></div>
                    <div>trajectory: <span className="text-purple-300">{debugInfo.processed_suggestions.attributes.trajectory}</span></div>
                  </>
                )}
                <div>confidence: <span className="text-green-300">{(debugInfo.processed_suggestions.confidence * 100).toFixed(1)}%</span></div>
              </div>
            </div>
          )}

          {debugInfo.raw_request && (
            <div className="bg-gray-900 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-gray-400">API Request Payload</h3>
                <button
                  onClick={() => copyToClipboard(JSON.stringify(debugInfo.raw_request, null, 2), 'request')}
                  className="text-gray-400 hover:text-white transition-colors flex items-center gap-1 text-xs"
                >
                  {copiedSection === 'request' ? <><CheckCircle className="w-3 h-3" />Copied!</> : <><Copy className="w-3 h-3" />Copy</>}
                </button>
              </div>
              <pre className="bg-black/30 rounded p-3 text-xs text-green-400 overflow-x-auto">
                {JSON.stringify(debugInfo.raw_request, null, 2)}
              </pre>
            </div>
          )}

          {debugInfo.response_content && (
            <div className="bg-gray-900 rounded-lg p-4">
              <h3 className="text-sm font-medium text-gray-400 mb-3">Extracted Response Content</h3>
              <pre className="bg-black/30 rounded p-3 text-xs text-blue-400 overflow-x-auto max-h-64 overflow-y-auto">
                {debugInfo.response_content}
              </pre>
            </div>
          )}

          {debugInfo.raw_response && (
            <div className="bg-gray-900 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-gray-400">API Response (Full)</h3>
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
                    {copiedSection === 'response' ? <><CheckCircle className="w-3 h-3" />Copied!</> : <><Copy className="w-3 h-3" />Copy</>}
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

          {debugInfo.error && (
            <div className="bg-red-900/20 border border-red-700 rounded-lg p-4 text-sm text-red-300">
              Error: {debugInfo.error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
