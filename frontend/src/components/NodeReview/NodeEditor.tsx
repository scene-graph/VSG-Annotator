import { useState, useEffect } from 'react';
import type { Node, NodeVisualAttributes, NodePhysicalAttributes } from '../../types';

interface NodeEditorProps {
  node: Node;
  onSave: (changes: {
    visual?: NodeVisualAttributes;
    physical?: NodePhysicalAttributes;
  }) => void;
  onCancel: () => void;
}

// Attribute value options
const COLOR_VALUES = ['unknown', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'brown', 'black', 'white', 'gray', 'silver', 'gold', 'beige', 'tan', 'multi-colored'];
const TEXTURE_VALUES = ['unknown', 'smooth', 'rough', 'soft', 'hard', 'glossy', 'matte', 'metallic', 'wooden', 'fabric', 'leather', 'plastic', 'glass', 'stone', 'concrete', 'tile', 'patterned'];
const MATERIAL_VALUES = ['unknown', 'wood', 'metal', 'plastic', 'glass', 'fabric', 'leather', 'paper', 'cardboard', 'ceramic', 'stone', 'concrete', 'rubber', 'foam', 'composite'];
const SIZE_VALUES = ['unknown', 'tiny', 'small', 'medium', 'large', 'very_large'];
const SHAPE_VALUES = ['unknown', 'rectangular', 'square', 'round', 'oval', 'triangular', 'cylindrical', 'spherical', 'irregular', 'flat', 'cubic'];

export function NodeEditor({ node, onSave, onCancel }: NodeEditorProps) {
  // Visual attributes
  const [color, setColor] = useState(node.attributes?.visual?.color || 'unknown');
  const [texture, setTexture] = useState(node.attributes?.visual?.texture || 'unknown');
  const [material, setMaterial] = useState(node.attributes?.visual?.material || 'unknown');

  // Physical attributes
  const [size, setSize] = useState(node.attributes?.physical?.size || 'medium');
  const [shape, setShape] = useState(node.attributes?.physical?.shape || 'unknown');

  // Sync local state when node prop changes
  useEffect(() => {
    setColor(node.attributes?.visual?.color || 'unknown');
    setTexture(node.attributes?.visual?.texture || 'unknown');
    setMaterial(node.attributes?.visual?.material || 'unknown');
    setSize(node.attributes?.physical?.size || 'medium');
    setShape(node.attributes?.physical?.shape || 'unknown');
  }, [node.node_id, node.attributes?.visual?.color, node.attributes?.visual?.texture,
      node.attributes?.visual?.material, node.attributes?.physical?.size, node.attributes?.physical?.shape]);

  const handleSave = () => {
    const changes: {
      visual?: NodeVisualAttributes;
      physical?: NodePhysicalAttributes;
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

    if (Object.keys(changes).length === 0) {
      onCancel();
      return;
    }

    onSave(changes);
  };

  return (
    <div className="space-y-4">
      {/* Visual Attributes */}
      <div className="space-y-2">
        <div className="text-gray-400 text-xs uppercase">Visual Attributes</div>

        <div>
          <label className="text-gray-500 text-xs block mb-1">Color</label>
          <select
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="w-full bg-gray-700 text-white rounded p-2 text-sm"
          >
            {COLOR_VALUES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            {!COLOR_VALUES.includes(color) && (
              <option value={color}>{color}</option>
            )}
          </select>
        </div>

        <div>
          <label className="text-gray-500 text-xs block mb-1">Texture</label>
          <select
            value={texture}
            onChange={(e) => setTexture(e.target.value)}
            className="w-full bg-gray-700 text-white rounded p-2 text-sm"
          >
            {TEXTURE_VALUES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
            {!TEXTURE_VALUES.includes(texture) && (
              <option value={texture}>{texture}</option>
            )}
          </select>
        </div>

        <div>
          <label className="text-gray-500 text-xs block mb-1">Material</label>
          <select
            value={material}
            onChange={(e) => setMaterial(e.target.value)}
            className="w-full bg-gray-700 text-white rounded p-2 text-sm"
          >
            {MATERIAL_VALUES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
            {!MATERIAL_VALUES.includes(material) && (
              <option value={material}>{material}</option>
            )}
          </select>
        </div>
      </div>

      {/* Physical Attributes */}
      <div className="space-y-2">
        <div className="text-gray-400 text-xs uppercase">Physical Attributes</div>

        <div>
          <label className="text-gray-500 text-xs block mb-1">Size</label>
          <select
            value={size}
            onChange={(e) => setSize(e.target.value)}
            className="w-full bg-gray-700 text-white rounded p-2 text-sm"
          >
            {SIZE_VALUES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
            {!SIZE_VALUES.includes(size) && (
              <option value={size}>{size}</option>
            )}
          </select>
        </div>

        <div>
          <label className="text-gray-500 text-xs block mb-1">Shape</label>
          <select
            value={shape}
            onChange={(e) => setShape(e.target.value)}
            className="w-full bg-gray-700 text-white rounded p-2 text-sm"
          >
            {SHAPE_VALUES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
            {!SHAPE_VALUES.includes(shape) && (
              <option value={shape}>{shape}</option>
            )}
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
        <button
          onClick={onCancel}
          className="flex-1 bg-gray-600 hover:bg-gray-700 text-white py-2 rounded font-semibold"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
