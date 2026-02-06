import { useState } from 'react';
import type {
  SceneInfo,
  CameraMotion,
  CameraMotionPrimary,
} from '../../types';
import { useModifySceneInfo, useModifyCameraMotion } from '../../hooks';
import { useCurrentUser } from '../../store';

interface VideoMetadataEditorProps {
  videoId: string;
  type: 'scene_info' | 'camera_motion';
  sceneInfo: SceneInfo | null | undefined;
  cameraMotion: CameraMotion | null | undefined;
  onClose: () => void;
}

// Dropdown select component
function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
}) {
  return (
    <div>
      <label className="text-gray-400 text-xs uppercase block mb-1">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-gray-700 text-white rounded p-2 text-sm"
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    </div>
  );
}


// Options for scene info
const MOTION_TYPE_OPTIONS = ['dolly', 'pedestal', 'truck', 'pan', 'tilt', 'roll', 'zoom', 'static'];
const MOTION_DIRECTION_OPTIONS = ['in', 'out', 'up', 'down', 'left', 'right', 'cw', 'ccw', 'none'];
const STEADINESS_OPTIONS = ['stable', 'slight_shake', 'moderate_shake', 'shaky'];
const INTENSITY_OPTIONS = ['minimal', 'subtle', 'moderate', 'dynamic'];

const TRANSITION_TYPES_OPTIONS = [
  'cut', 'fade', 'dissolve', 'wipe', 'match_cut', 'jump_cut', 'unknown'
];

const SCENE_CHANGE_RELATIONS_OPTIONS = [
  'indoor_to_outdoor', 'outdoor_to_indoor', 'same_place_continuation',
  'place_change', 'time_jump', 'day_night_change', 'flashback',
  'parallel_crosscut', 'unknown'
];

const SCENE_CATEGORY_OPTIONS = [
  // Indoor - Residential
  'bedroom', 'living_room', 'dining_room', 'kitchen', 'bathroom',
  'hallway', 'closet', 'basement', 'attic', 'home_garage',
  // Indoor - Commercial
  'office', 'store', 'restaurant', 'cafe', 'bar', 'hotel_room',
  'hospital', 'clinic', 'bank', 'gym', 'spa', 'salon',
  // Indoor - Educational
  'classroom', 'library', 'laboratory', 'auditorium', 'school_cafeteria',
  // Indoor - Entertainment
  'theater', 'museum', 'gallery', 'stadium',
  // Indoor - Transit
  'lobby', 'elevator', 'stairway', 'corridor', 'waiting_room', 'station',
  // Indoor - Industrial
  'warehouse', 'factory', 'workshop',
  // Outdoor - Natural
  'park', 'garden', 'forest', 'beach', 'mountain', 'lake', 'field', 'desert',
  // Outdoor - Urban
  'street', 'sidewalk', 'plaza', 'parking_lot', 'rooftop', 'alley',
  // Outdoor - Sports
  'playground', 'sports_field', 'pool', 'court',
  // Vehicle
  'car_interior', 'bus_interior', 'train_interior', 'airplane_interior', 'boat_interior',
  // Special
  'unknown',
];

function SceneInfoEditor({
  sceneInfo,
  onSave,
  onCancel,
}: {
  sceneInfo: SceneInfo | null | undefined;
  onSave: (info: SceneInfo) => void;
  onCancel: () => void;
}) {
  // Build scenes array from sceneInfo categories
  const [scenes, setScenes] = useState<string[]>(() => {
    const cats = sceneInfo?.category || ['unknown'];
    return cats;
  });

  // Transitions and relations: N scenes requires N-1 of each
  const [transitions, setTransitions] = useState<string[]>(() => {
    const trans = sceneInfo?.transition_types || [];
    // Ensure we have exactly N-1 transitions
    const needed = Math.max(0, (sceneInfo?.category?.length || 1) - 1);
    if (trans.length < needed) {
      return [...trans, ...Array(needed - trans.length).fill('cut')];
    }
    return trans.slice(0, needed);
  });

  const [relations, setRelations] = useState<string[]>(() => {
    const rels = sceneInfo?.scene_change_relations || [];
    // Ensure we have exactly N-1 relations
    const needed = Math.max(0, (sceneInfo?.category?.length || 1) - 1);
    if (rels.length < needed) {
      return [...rels, ...Array(needed - rels.length).fill('unknown')];
    }
    return rels.slice(0, needed);
  });

  // Confidence is read-only (model metric)
  const confidence = sceneInfo?.confidence || 0.5;

  const addScene = () => {
    setScenes([...scenes, 'unknown']);
    setTransitions([...transitions, 'cut']);
    setRelations([...relations, 'unknown']);
  };

  const removeScene = (index: number) => {
    if (scenes.length <= 1) return;

    const newScenes = scenes.filter((_, i) => i !== index);

    // Remove the transition/relation associated with this scene
    // If removing first scene, remove transition[0] (transition TO scene 1)
    // If removing last scene, remove transition[N-2] (transition FROM scene N-1)
    // If removing middle scene at index i, remove transition[i-1] (transition TO this scene)
    let transIdx: number;
    if (index === 0) {
      transIdx = 0; // Remove first transition
    } else {
      transIdx = index - 1; // Remove transition leading TO this scene
    }

    const newTransitions = transitions.filter((_, i) => i !== transIdx);
    const newRelations = relations.filter((_, i) => i !== transIdx);

    setScenes(newScenes);
    setTransitions(newTransitions);
    setRelations(newRelations);
  };

  const updateScene = (index: number, value: string) => {
    const newScenes = [...scenes];
    newScenes[index] = value;
    setScenes(newScenes);
  };

  const updateTransition = (index: number, value: string) => {
    const newTransitions = [...transitions];
    newTransitions[index] = value;
    setTransitions(newTransitions);
  };

  const updateRelation = (index: number, value: string) => {
    const newRelations = [...relations];
    newRelations[index] = value;
    setRelations(newRelations);
  };

  const handleSave = () => {
    onSave({
      category: scenes,
      transition_types: transitions,
      scene_change_relations: relations,
      confidence,
    });
  };

  return (
    <div className="space-y-3">
      {scenes.map((scene, idx) => (
        <div key={idx}>
          {/* Scene row */}
          <div className="flex items-center gap-2">
            <span className="text-gray-400 text-xs w-16 flex-shrink-0">Scene {idx + 1}</span>
            <select
              value={scene}
              onChange={(e) => updateScene(idx, e.target.value)}
              className="flex-1 bg-gray-700 text-white rounded p-2 text-sm"
            >
              {SCENE_CATEGORY_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
            {scenes.length > 1 && (
              <button
                onClick={() => removeScene(idx)}
                className="text-red-400 hover:text-red-300 px-2 py-1 text-lg font-bold"
                title="Remove scene"
              >
                -
              </button>
            )}
          </div>

          {/* Transition row (after scene, before next scene) */}
          {idx < scenes.length - 1 && (
            <div className="ml-6 pl-4 border-l border-gray-600 my-2 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-gray-500 text-xs w-4">↓</span>
                <span className="text-gray-400 text-xs w-16">Transition</span>
                <select
                  value={transitions[idx] || 'cut'}
                  onChange={(e) => updateTransition(idx, e.target.value)}
                  className="flex-1 bg-gray-700 text-white rounded p-1.5 text-sm"
                >
                  {TRANSITION_TYPES_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-500 text-xs w-4">↓</span>
                <span className="text-gray-400 text-xs w-16">Relation</span>
                <select
                  value={relations[idx] || 'unknown'}
                  onChange={(e) => updateRelation(idx, e.target.value)}
                  className="flex-1 bg-gray-700 text-white rounded p-1.5 text-sm"
                >
                  {SCENE_CHANGE_RELATIONS_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>
      ))}

      <button
        onClick={addScene}
        className="text-blue-400 hover:text-blue-300 text-sm py-1"
      >
        + Add Scene
      </button>

      {/* Confidence at bottom - read-only */}
      <div className="border-t border-gray-700 pt-4 mt-4">
        <div className="flex items-center justify-between">
          <span className="text-gray-400 text-xs uppercase">Confidence (Model Metric)</span>
          <span className="text-gray-400 text-sm">{(confidence * 100).toFixed(0)}%</span>
        </div>
      </div>

      <div className="flex gap-2 pt-2">
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

function CameraMotionEditor({
  cameraMotion,
  onSave,
  onCancel,
}: {
  cameraMotion: CameraMotion | null | undefined;
  onSave: (motion: CameraMotion) => void;
  onCancel: () => void;
}) {
  const [confidence, setConfidence] = useState(cameraMotion?.confidence || 0.5);
  const [motionType, setMotionType] = useState<CameraMotionPrimary['type']>(
    cameraMotion?.primary_motion?.type || 'static'
  );
  const [motionDirection, setMotionDirection] = useState<CameraMotionPrimary['direction']>(
    cameraMotion?.primary_motion?.direction || 'none'
  );
  const [steadiness, setSteadiness] = useState<CameraMotionPrimary['steadiness']>(
    cameraMotion?.primary_motion?.steadiness || 'stable'
  );
  const [intensity, setIntensity] = useState<CameraMotionPrimary['intensity']>(
    cameraMotion?.primary_motion?.intensity || 'minimal'
  );
  const [description, setDescription] = useState(cameraMotion?.description || '');

  const handleSave = () => {
    onSave({
      confidence,
      primary_motion: {
        type: motionType,
        direction: motionDirection,
        steadiness,
        intensity,
      },
      description: description || undefined,
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-gray-300 text-xs uppercase mb-2">Primary Motion</h4>
        <div className="grid grid-cols-2 gap-4">
          <Select
            label="Type"
            value={motionType}
            onChange={(v) => setMotionType(v as CameraMotionPrimary['type'])}
            options={MOTION_TYPE_OPTIONS}
          />
          <Select
            label="Direction"
            value={motionDirection}
            onChange={(v) => setMotionDirection(v as CameraMotionPrimary['direction'])}
            options={MOTION_DIRECTION_OPTIONS}
          />
        </div>
        <div className="grid grid-cols-2 gap-4 mt-4">
          <Select
            label="Steadiness"
            value={steadiness}
            onChange={(v) => setSteadiness(v as CameraMotionPrimary['steadiness'])}
            options={STEADINESS_OPTIONS}
          />
          <Select
            label="Intensity"
            value={intensity}
            onChange={(v) => setIntensity(v as CameraMotionPrimary['intensity'])}
            options={INTENSITY_OPTIONS}
          />
        </div>
      </div>

      <div>
        <label className="text-gray-400 text-xs uppercase block mb-1">Description</label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full bg-gray-700 text-white rounded p-2 text-sm"
          placeholder="Brief description of camera movement"
        />
      </div>

      <div className="border-t border-gray-700 pt-4">
        <label className="text-gray-400 text-xs uppercase block mb-1">Confidence (Model Metric)</label>
        <input
          type="number"
          value={confidence}
          onChange={(e) => setConfidence(Number(e.target.value))}
          min={0}
          max={1}
          step={0.1}
          className="w-full bg-gray-700 text-white rounded p-2 text-sm"
        />
      </div>

      <div className="flex gap-2 pt-2">
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

export function VideoMetadataEditor({
  videoId,
  type,
  sceneInfo,
  cameraMotion,
  onClose,
}: VideoMetadataEditorProps) {
  const currentUser = useCurrentUser();
  const modifySceneInfo = useModifySceneInfo();
  const modifyCameraMotion = useModifyCameraMotion();

  const handleSaveSceneInfo = async (info: SceneInfo) => {
    if (!currentUser) {
      alert('Please select a user before editing');
      return;
    }

    try {
      await modifySceneInfo.mutateAsync({
        video_id: videoId,
        user_id: currentUser.id,
        scene_info: info,
      });
      onClose();
    } catch (error) {
      console.error('Failed to save scene info:', error);
      alert('Failed to save scene info');
    }
  };

  const handleSaveCameraMotion = async (motion: CameraMotion) => {
    if (!currentUser) {
      alert('Please select a user before editing');
      return;
    }

    try {
      await modifyCameraMotion.mutateAsync({
        video_id: videoId,
        user_id: currentUser.id,
        camera_motion: motion,
      });
      onClose();
    } catch (error) {
      console.error('Failed to save camera motion:', error);
      alert('Failed to save camera motion');
    }
  };

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-white font-medium">
          Edit {type === 'scene_info' ? 'Scene Info' : 'Camera Motion'}
        </h3>
        <button onClick={onClose} className="text-gray-400 hover:text-white">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {type === 'scene_info' ? (
        <SceneInfoEditor
          sceneInfo={sceneInfo}
          onSave={handleSaveSceneInfo}
          onCancel={onClose}
        />
      ) : (
        <CameraMotionEditor
          cameraMotion={cameraMotion}
          onSave={handleSaveCameraMotion}
          onCancel={onClose}
        />
      )}
    </div>
  );
}
