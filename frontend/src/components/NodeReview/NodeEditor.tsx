import { useState, useEffect, Fragment, useRef } from 'react';
import type { Node, NodeVisualAttributes, NodePhysicalAttributes } from '../../types';
import { useAISuggestions } from '../../hooks/useAI';
import { useAppStore, useAiSuggestionsByNode, useAiSuggestionFrameByNode, useAiSuggestionStatusByNode, useAiSuggestionSourceByNode } from '../../store';
import type { AttributeSuggestionResponse } from '../../services/ai';
import { AIDebugModal } from './AIDebugModal';

interface NodeEditorProps {
  node: Node;
  videoId: string;
  onSave: (changes: {
    visual?: NodeVisualAttributes;
    physical?: NodePhysicalAttributes;
    is_static?: boolean;
  }) => void;
  onCancel: () => void;
}

// Attribute value options - Updated to match schema exactly
const COLOR_VALUES = [
  'unknown', 'white', 'black', 'gray', 'brown', 'beige', 'tan', 'red', 'orange',
  'yellow', 'green', 'blue', 'purple', 'pink', 'gold', 'silver',
  'copper', 'bronze', 'light', 'dark', 'varied', 'multicolor', 'transparent'
];

const TEXTURE_VALUES = [
  'unknown', 'smooth', 'rough', 'soft', 'hard', 'fuzzy', 'fluffy', 'woven',
  'knitted', 'glossy', 'matte', 'grainy', 'bumpy', 'wrinkled',
  'crinkled', 'patterned'
];

const MATERIAL_VALUES = [
  'unknown', 'wood', 'metal', 'plastic', 'glass', 'ceramic', 'stone', 'concrete',
  'fabric', 'leather', 'cloth', 'foam', 'rubber', 'paper', 'cardboard',
  'skin', 'hair', 'fur'
];

const SIZE_VALUES = ['unknown', 'tiny', 'small', 'medium', 'large', 'huge', 'normal'];

const SHAPE_VALUES = [
  'unknown', 'rectangular', 'square', 'triangular', 'oval', 'circular', 'flat',
  'cylindrical', 'spherical', 'box-shaped', 'humanoid', 'hand-shaped',
  'irregular', 'elongated', 'round'
];

export function NodeEditor({ node, videoId, onSave, onCancel }: NodeEditorProps) {
  // Visual attributes
  const [color, setColor] = useState(node.attributes?.visual?.color || 'unknown');
  const [texture, setTexture] = useState(node.attributes?.visual?.texture || 'unknown');
  const [material, setMaterial] = useState(node.attributes?.visual?.material || 'unknown');

  // Physical attributes
  const [size, setSize] = useState(node.attributes?.physical?.size || 'medium');
  const [shape, setShape] = useState(node.attributes?.physical?.shape || 'unknown');
  const [isStatic, setIsStatic] = useState(node.is_static);

  // AI suggestions
  const currentFrame = useAppStore((state) => state.currentFrame);
  const aiMutation = useAISuggestions();
  const aiSuggestionsByNode = useAiSuggestionsByNode();
  const aiSuggestionFrameByNode = useAiSuggestionFrameByNode();
  const aiSuggestionStatusByNode = useAiSuggestionStatusByNode();
  const aiSuggestionSourceByNode = useAiSuggestionSourceByNode();
  const aiProvider = useAppStore((state) => state.aiProvider);
  const setAiSuggestion = useAppStore((state) => state.setAiSuggestion);
  const clearAiSuggestion = useAppStore((state) => state.clearAiSuggestion);
  const [aiSuggestions, setAiSuggestions] = useState<AttributeSuggestionResponse | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [debugMode, setDebugMode] = useState(true); // Default to true for debugging
  const [showDebugModal, setShowDebugModal] = useState(false);
  const [debugInfo, setDebugInfo] = useState<any>(null);
  const abortRef = useRef<AbortController | null>(null);
  const storedSuggestion = aiSuggestionsByNode[node.node_id];
  const storedSuggestionFrame = aiSuggestionFrameByNode[node.node_id];
  const storedSuggestionStatus = aiSuggestionStatusByNode[node.node_id] ?? 'idle';
  const storedSuggestionSource = aiSuggestionSourceByNode[node.node_id];
  const effectiveSuggestion = storedSuggestion ?? aiSuggestions;
  const showSuggestionPanel = (storedSuggestion && !storedSuggestion.error) || (showSuggestions && aiSuggestions && !aiSuggestions.error);

  // Sync local state when node prop changes
  useEffect(() => {
    setColor(node.attributes?.visual?.color || 'unknown');
    setTexture(node.attributes?.visual?.texture || 'unknown');
    setMaterial(node.attributes?.visual?.material || 'unknown');
    setSize(node.attributes?.physical?.size || 'medium');
    setShape(node.attributes?.physical?.shape || 'unknown');
    setIsStatic(node.is_static);
  }, [node.node_id, node.attributes?.visual?.color, node.attributes?.visual?.texture,
      node.attributes?.visual?.material, node.attributes?.physical?.size, node.attributes?.physical?.shape, node.is_static]);

  useEffect(() => {
    setAiSuggestions(null);
    setShowSuggestions(false);
    setDebugInfo(null);
  }, [node.node_id]);

  // Get AI suggestions
  const handleGetAISuggestions = async () => {
    try {
      if (abortRef.current) {
        abortRef.current.abort();
      }
      const controller = new AbortController();
      abortRef.current = controller;
      setShowSuggestions(false);
      const result = await aiMutation.mutateAsync({
        request: {
          video_id: videoId,
          node_id: node.node_id,
          frame_idx: currentFrame,
          debug: debugMode,
          provider: aiProvider,
        },
        signal: controller.signal,
      });

      // Always set debug info if in debug mode
      if (debugMode) {
        // Calculate node's visible frame range
        // Frontend receives transformed data where bboxes are directly on the node
        const bboxes = node.bboxes_by_frame || {};
        const frameNumbers = Object.keys(bboxes).map(Number).sort((a, b) => a - b);
        const nodeFrameRange = frameNumbers.length > 0
          ? { min: frameNumbers[0], max: frameNumbers[frameNumbers.length - 1] }
          : null;

        const debugData = {
          request: {
            video_id: videoId,
            node_id: node.node_id,
            frame_idx: currentFrame,
            provider: aiProvider,
            bbox: bboxes[String(currentFrame)],
            frame_path: `Frame ${currentFrame} (UI shows as Frame ${currentFrame + 1})`,
            node_visible_range: nodeFrameRange
              ? `Frames ${nodeFrameRange.min}-${nodeFrameRange.max} (UI: ${nodeFrameRange.min + 1}-${nodeFrameRange.max + 1})`
              : 'No frames',
          },
          cropped_image: result.cropped_image,
          raw_request: result.raw_request,
          raw_response: result.raw_response,
          response_content: result.response_content,
          processed_suggestions: !result.error ? {
            visual: result.visual,
            physical: result.physical,
            confidence: result.confidence,
          } : undefined,
          error: result.error,
          debug_info: result.debug_info,
        };
        setDebugInfo(debugData);
        setShowDebugModal(true);
      }

      if (!result.error) {
        setAiSuggestions(result);
        setShowSuggestions(true);
        setAiSuggestion(node.node_id, result, result.frame_idx, 'single');
      } else {
        console.error('AI suggestion error:', result.error);
        // Show error even without debug mode
        if (!debugMode) {
          alert(`AI Error: ${result.error}`);
        }
      }
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        return;
      }
      console.error('Failed to get AI suggestions:', error);
      if (debugMode) {
        setDebugInfo({
          request: {
            video_id: videoId,
            node_id: node.node_id,
            frame_idx: currentFrame,
          },
          error: String(error),
        });
        setShowDebugModal(true);
      } else {
        alert(`Failed to get AI suggestions: ${error}`);
      }
    }
  };

  const handleCancelAISuggestions = () => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  };

  // Apply AI suggestion
  const applyAISuggestion = (attribute: string, value: string) => {
    switch (attribute) {
      case 'color':
        setColor(value);
        break;
      case 'texture':
        setTexture(value);
        break;
      case 'material':
        setMaterial(value);
        break;
      case 'size':
        setSize(value);
        break;
      case 'shape':
        setShape(value);
        break;
    }
  };

  // Apply all AI suggestions at once
  const applyAllSuggestions = () => {
    if (effectiveSuggestion && !effectiveSuggestion.error) {
      setColor(effectiveSuggestion.visual.color);
      setTexture(effectiveSuggestion.visual.texture);
      setMaterial(effectiveSuggestion.visual.material);
      setSize(effectiveSuggestion.physical.size);
      setShape(effectiveSuggestion.physical.shape);
      setShowSuggestions(false);
    }
  };

  const applyAllAndSave = () => {
    if (!effectiveSuggestion || effectiveSuggestion.error) {
      return;
    }

    setColor(effectiveSuggestion.visual.color);
    setTexture(effectiveSuggestion.visual.texture);
    setMaterial(effectiveSuggestion.visual.material);
    setSize(effectiveSuggestion.physical.size);
    setShape(effectiveSuggestion.physical.shape);
    setShowSuggestions(false);

    onSave({
      visual: {
        color: effectiveSuggestion.visual.color,
        texture: effectiveSuggestion.visual.texture,
        material: effectiveSuggestion.visual.material,
      },
      physical: {
        size: effectiveSuggestion.physical.size,
        shape: effectiveSuggestion.physical.shape,
      },
    });
  };

  const handleDismissSuggestions = () => {
    clearAiSuggestion(node.node_id);
    setAiSuggestions(null);
    setShowSuggestions(false);
  };

  const handleSave = () => {
    const changes: {
      visual?: NodeVisualAttributes;
      physical?: NodePhysicalAttributes;
      is_static?: boolean;
    } = {};

    // Check for visual attribute changes
    const origVisual = node.attributes?.visual || { color: 'unknown', texture: 'unknown', material: 'unknown' };
    if (color !== origVisual.color || texture !== origVisual.texture || material !== origVisual.material) {
      changes.visual = { color, texture, material };
    }

    // Check for physical attribute changes
    const origPhysical = node.attributes?.physical || { size: 'medium', shape: 'unknown' };
    if (size !== origPhysical.size || shape !== origPhysical.shape) {
      changes.physical = { size, shape };
    }

    if (isStatic !== node.is_static) {
      changes.is_static = isStatic;
    }

    if (Object.keys(changes).length === 0) {
      onCancel();
      return;
    }

    onSave(changes);
  };

  return (
    <>
      {/* Debug Modal */}
      <AIDebugModal
        isOpen={showDebugModal}
        onClose={() => setShowDebugModal(false)}
        debugInfo={debugInfo}
      />

      <div className="space-y-4">
        {/* AI Suggestions Section */}
        <div>
          {/* Debug Mode Toggle */}
          <div className="flex items-center justify-between mb-2">
            <label className="flex items-center gap-2 text-sm text-gray-400">
              <input
                type="checkbox"
                checked={debugMode}
                onChange={(e) => setDebugMode(e.target.checked)}
                className="rounded"
              />
              Debug Mode
            </label>
            {debugInfo && (
              <button
                onClick={() => setShowDebugModal(true)}
                className="text-xs text-purple-400 hover:text-purple-300"
              >
                View Last Debug Info
              </button>
            )}
          </div>

          {/* AI Suggestions Button */}
        <button
          onClick={handleGetAISuggestions}
          disabled={aiMutation.isPending}
          className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-purple-800 text-white py-2 px-4 rounded-lg flex items-center justify-center gap-2 transition-colors"
        >
          {aiMutation.isPending ? (
            <>
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Getting AI Suggestions...
            </>
          ) : (
            <>
              <span className="text-lg">✨</span>
              Get AI Suggestions
            </>
          )}
        </button>
        {aiMutation.isPending && (
          <button
            onClick={handleCancelAISuggestions}
            className="mt-2 w-full bg-gray-700 hover:bg-gray-600 text-white py-2 px-4 rounded-lg transition-colors"
          >
            Cancel AI Request
          </button>
        )}
        <div className="mt-2 text-xs text-gray-400">
          Using AI model: {aiProvider} (configured default). Please review suggestions before saving.
        </div>

        <div className="mt-3 p-3 bg-gray-800/60 border border-gray-700 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-200">
              {showSuggestionPanel && effectiveSuggestion && !effectiveSuggestion.error
                ? `AI Suggestions (Confidence: ${(effectiveSuggestion.confidence * 100).toFixed(0)}%)`
                : 'Original Only'}
            </span>
            {showSuggestionPanel && effectiveSuggestion && !effectiveSuggestion.error && (
              <button
                onClick={applyAllSuggestions}
                className="text-xs bg-purple-600 hover:bg-purple-700 px-2 py-1 rounded text-white"
              >
                Apply All
              </button>
            )}
          </div>
          {showSuggestionPanel && effectiveSuggestion && !effectiveSuggestion.error && (
            <div className="text-xs text-gray-400 mb-2">
              Click an AI value to apply it. Edit original values directly in the middle column.
            </div>
          )}
          <div className={`grid ${showSuggestionPanel && effectiveSuggestion && !effectiveSuggestion.error ? 'grid-cols-3' : 'grid-cols-2'} gap-2 text-xs`}>
            <div className="text-gray-500">Attribute</div>
            <div className="text-gray-400">Original</div>
            {showSuggestionPanel && effectiveSuggestion && !effectiveSuggestion.error && (
              <div className="text-purple-300">AI</div>
            )}

            {[
              {
                label: 'color',
                orig: node.attributes?.visual?.color || 'unknown',
                value: color,
                setValue: setColor,
                options: COLOR_VALUES,
                ai: effectiveSuggestion?.visual.color,
              },
              {
                label: 'texture',
                orig: node.attributes?.visual?.texture || 'unknown',
                value: texture,
                setValue: setTexture,
                options: TEXTURE_VALUES,
                ai: effectiveSuggestion?.visual.texture,
              },
              {
                label: 'material',
                orig: node.attributes?.visual?.material || 'unknown',
                value: material,
                setValue: setMaterial,
                options: MATERIAL_VALUES,
                ai: effectiveSuggestion?.visual.material,
              },
              {
                label: 'size',
                orig: node.attributes?.physical?.size || 'medium',
                value: size,
                setValue: setSize,
                options: SIZE_VALUES,
                ai: effectiveSuggestion?.physical.size,
              },
              {
                label: 'shape',
                orig: node.attributes?.physical?.shape || 'unknown',
                value: shape,
                setValue: setShape,
                options: SHAPE_VALUES,
                ai: effectiveSuggestion?.physical.shape,
              },
            ].map((row) => {
              const hasAi = showSuggestionPanel && effectiveSuggestion && !effectiveSuggestion.error && row.ai;
              const different = hasAi ? row.orig !== row.ai : false;
              return (
                <Fragment key={row.label}>
                  <div className="text-gray-500">{row.label}</div>
                  <div>
                    <select
                      value={row.value}
                      onChange={(e) => row.setValue(e.target.value)}
                      className="w-full bg-gray-700 text-white rounded p-1.5 text-sm"
                    >
                      {row.options.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                      {!row.options.includes(row.value) && (
                        <option value={row.value}>{row.value}</option>
                      )}
                    </select>
                  </div>
                  {hasAi && (
                    <button
                      onClick={() => applyAISuggestion(row.label, row.ai as string)}
                      className={different
                        ? 'text-purple-200 bg-purple-900/30 rounded px-2 py-1 text-left'
                        : 'text-gray-400 px-2 py-1 text-left'}
                      title="Click to apply AI value"
                    >
                      {row.ai}
                    </button>
                  )}
                </Fragment>
              );
            })}
          </div>
        </div>

        {showSuggestionPanel && effectiveSuggestion && !effectiveSuggestion.error && (
          <div className="mt-2 text-xs text-gray-400 flex items-center gap-2">
            <span>
              AI frame: {storedSuggestionFrame ?? effectiveSuggestion.frame_idx}
              {storedSuggestionSource === 'bulk' ? ' (largest bbox)' : ''}
            </span>
            <button
              onClick={() => setCurrentFrame(storedSuggestionFrame ?? effectiveSuggestion.frame_idx)}
              className="text-xs text-purple-300 hover:text-purple-200"
            >
              Jump
            </button>
          </div>
        )}

        {/* Error message */}
        {(effectiveSuggestion?.error || storedSuggestionStatus === 'error') && (
          <div className="mt-2 p-2 bg-red-900/20 border border-red-600/30 rounded text-xs text-red-400">
            Error: {effectiveSuggestion?.error || 'Failed to get AI suggestions'}
          </div>
        )}
      </div>

      {/* Node Type */}
      <div className="space-y-2">
        <div className="text-gray-400 text-sm uppercase">Node Type</div>
        <div>
          <label className="text-gray-500 text-sm block mb-1">Static / Dynamic</label>
          <select
            value={isStatic ? 'static' : 'dynamic'}
            onChange={(e) => setIsStatic(e.target.value === 'static')}
            className="w-full bg-gray-700 text-white rounded p-2 text-base"
          >
            <option value="static">Static</option>
            <option value="dynamic">Dynamic</option>
          </select>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2">
        <button
          onClick={handleSave}
          className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2 rounded font-semibold"
        >
          Save Changes
        </button>
        {showSuggestionPanel && effectiveSuggestion && !effectiveSuggestion.error && (
          <button
            onClick={applyAllAndSave}
            className="flex-1 bg-purple-600 hover:bg-purple-700 text-white py-2 rounded font-semibold"
          >
            Apply All AI & Save
          </button>
        )}
        {(storedSuggestion || aiSuggestions) && (
          <button
            onClick={handleDismissSuggestions}
            className="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-2 rounded font-semibold"
          >
            Dismiss AI Suggestions
          </button>
        )}
        <button
          onClick={onCancel}
          className="flex-1 bg-gray-600 hover:bg-gray-700 text-white py-2 rounded font-semibold"
        >
          Cancel
        </button>
        </div>
      </div>
    </>
  );
}
