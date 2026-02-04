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

// Multi-select component
function MultiSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
  options: string[];
}) {
  const toggleOption = (opt: string) => {
    if (value.includes(opt)) {
      // Remove if already selected (but keep at least one)
      if (value.length > 1) {
        onChange(value.filter((v) => v !== opt));
      }
    } else {
      // Add if not selected
      onChange([...value, opt]);
    }
  };

  return (
    <div>
      <label className="text-gray-400 text-xs uppercase block mb-1">{label}</label>
      <div className="flex flex-wrap gap-1 bg-gray-700 rounded p-2 min-h-[40px]">
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => toggleOption(opt)}
            className={`px-2 py-1 rounded text-xs transition-colors ${
              value.includes(opt)
                ? 'bg-blue-600 text-white'
                : 'bg-gray-600 text-gray-300 hover:bg-gray-500'
            }`}
          >
            {opt}
          </button>
        ))}
      </div>
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
  const [category, setCategory] = useState<string[]>(
    sceneInfo?.category || ['unknown']
  );
  const [transitionTypes, setTransitionTypes] = useState<string[]>(
    sceneInfo?.transition_types || ['unknown']
  );
  const [sceneChangeRelations, setSceneChangeRelations] = useState<string[]>(
    sceneInfo?.scene_change_relations || ['unknown']
  );
  const [confidence, setConfidence] = useState(sceneInfo?.confidence || 0.5);

  const handleSave = () => {
    onSave({
      category,
      transition_types: transitionTypes,
      scene_change_relations: sceneChangeRelations,
      confidence,
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <MultiSelect
          label="Category"
          value={category}
          onChange={setCategory}
          options={SCENE_CATEGORY_OPTIONS}
        />
        <div>
          <label className="text-gray-400 text-xs uppercase block mb-1">Confidence</label>
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
      </div>

      <MultiSelect
        label="Transition Types"
        value={transitionTypes}
        onChange={setTransitionTypes}
        options={TRANSITION_TYPES_OPTIONS}
      />

      <MultiSelect
        label="Scene Change Relations"
        value={sceneChangeRelations}
        onChange={setSceneChangeRelations}
        options={SCENE_CHANGE_RELATIONS_OPTIONS}
      />

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
