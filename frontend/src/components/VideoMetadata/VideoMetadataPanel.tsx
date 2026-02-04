import { useState } from 'react';
import type { SceneInfo, CameraMotion } from '../../types';
import { useSceneInfo, useCameraMotion } from '../../hooks';
import { VideoMetadataEditor } from './VideoMetadataEditor';

interface VideoMetadataPanelProps {
  videoId: string;
  isOpen: boolean;
  onToggle: () => void;
}

// Badge component for consistent styling
function Badge({
  children,
  variant = 'default',
}: {
  children: React.ReactNode;
  variant?: 'default' | 'cyan' | 'orange' | 'green' | 'red' | 'purple' | 'blue';
}) {
  const colors = {
    default: 'bg-gray-600 text-gray-200',
    cyan: 'bg-cyan-500/20 text-cyan-400',
    orange: 'bg-orange-500/20 text-orange-400',
    green: 'bg-green-500/20 text-green-400',
    red: 'bg-red-500/20 text-red-400',
    purple: 'bg-purple-500/20 text-purple-400',
    blue: 'bg-blue-500/20 text-blue-400',
  };

  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[variant]}`}>
      {children}
    </span>
  );
}

// Row component for metadata display
function MetadataRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between py-1">
      <span className="text-gray-400 text-sm">{label}</span>
      <div className="flex items-center gap-1 flex-wrap justify-end max-w-[60%]">{children}</div>
    </div>
  );
}

function SceneInfoSection({ sceneInfo }: { sceneInfo: SceneInfo | null }) {
  if (!sceneInfo) {
    return (
      <div className="text-gray-500 text-sm italic">No scene info available</div>
    );
  }

  return (
    <div className="space-y-1">
      <MetadataRow label="Category">
        {sceneInfo.category?.map((cat, idx) => (
          <Badge key={idx} variant="cyan">{cat}</Badge>
        ))}
      </MetadataRow>
      <MetadataRow label="Confidence">
        <span className="text-white text-sm">{(sceneInfo.confidence * 100).toFixed(0)}%</span>
      </MetadataRow>
      <MetadataRow label="Transitions">
        {sceneInfo.transition_types?.map((t, idx) => (
          <Badge key={idx} variant="purple">{t}</Badge>
        ))}
      </MetadataRow>
      <MetadataRow label="Scene Changes">
        {sceneInfo.scene_change_relations?.map((r, idx) => (
          <Badge key={idx} variant="blue">{r}</Badge>
        ))}
      </MetadataRow>
    </div>
  );
}

function CameraMotionSection({ cameraMotion }: { cameraMotion: CameraMotion | null }) {
  if (!cameraMotion) {
    return (
      <div className="text-gray-500 text-sm italic">No camera motion data available</div>
    );
  }

  return (
    <div className="space-y-1">
      {cameraMotion.primary_motion && (
        <>
          <MetadataRow label="Motion Type">
            <Badge variant="orange">{cameraMotion.primary_motion.type}</Badge>
          </MetadataRow>
          <MetadataRow label="Direction">
            <Badge>{cameraMotion.primary_motion.direction}</Badge>
          </MetadataRow>
          <MetadataRow label="Steadiness">
            <Badge>{cameraMotion.primary_motion.steadiness}</Badge>
          </MetadataRow>
          <MetadataRow label="Intensity">
            <Badge>{cameraMotion.primary_motion.intensity}</Badge>
          </MetadataRow>
        </>
      )}
      {cameraMotion.description && (
        <div className="pt-2">
          <span className="text-gray-400 text-xs uppercase">Description</span>
          <p className="text-gray-300 text-sm mt-1">{cameraMotion.description}</p>
        </div>
      )}
      <div className="pt-2 border-t border-gray-700 mt-2">
        <MetadataRow label="Confidence">
          <span className="text-gray-400 text-sm">{(cameraMotion.confidence * 100).toFixed(0)}%</span>
        </MetadataRow>
      </div>
    </div>
  );
}

export function VideoMetadataPanel({ videoId, isOpen, onToggle }: VideoMetadataPanelProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editType, setEditType] = useState<'scene_info' | 'camera_motion' | null>(null);

  const { data: sceneInfo, isLoading: sceneInfoLoading } = useSceneInfo(videoId);
  const { data: cameraMotion, isLoading: cameraMotionLoading } = useCameraMotion(videoId);

  const handleEdit = (type: 'scene_info' | 'camera_motion') => {
    setEditType(type);
    setIsEditing(true);
  };

  const handleCloseEditor = () => {
    setIsEditing(false);
    setEditType(null);
  };

  if (isEditing && editType) {
    return (
      <div className="bg-gray-800 border-b border-gray-700">
        <VideoMetadataEditor
          videoId={videoId}
          type={editType}
          sceneInfo={sceneInfo}
          cameraMotion={cameraMotion}
          onClose={handleCloseEditor}
        />
      </div>
    );
  }

  return (
    <div className="bg-gray-800 border-b border-gray-700">
      {/* Header */}
      <button
        onClick={onToggle}
        className="w-full px-4 py-2 flex items-center justify-between hover:bg-gray-750"
      >
        <div className="flex items-center gap-2">
          <svg
            className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-90' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <span className="text-gray-300 text-sm font-medium uppercase">Video Metadata</span>
        </div>
      </button>

      {/* Content */}
      {isOpen && (
        <div className="px-4 pb-4">
          <div className="grid grid-cols-2 gap-6">
            {/* Scene Info Section */}
            <div className="bg-gray-900 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-white font-medium text-sm uppercase">Scene Info</h3>
                <button
                  onClick={() => handleEdit('scene_info')}
                  className="text-blue-400 hover:text-blue-300 text-xs"
                >
                  Edit
                </button>
              </div>
              {sceneInfoLoading ? (
                <div className="text-gray-500 text-sm">Loading...</div>
              ) : (
                <SceneInfoSection sceneInfo={sceneInfo ?? null} />
              )}
            </div>

            {/* Camera Motion Section */}
            <div className="bg-gray-900 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-white font-medium text-sm uppercase">Camera Motion</h3>
                <button
                  onClick={() => handleEdit('camera_motion')}
                  className="text-blue-400 hover:text-blue-300 text-xs"
                >
                  Edit
                </button>
              </div>
              {cameraMotionLoading ? (
                <div className="text-gray-500 text-sm">Loading...</div>
              ) : (
                <CameraMotionSection cameraMotion={cameraMotion ?? null} />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
