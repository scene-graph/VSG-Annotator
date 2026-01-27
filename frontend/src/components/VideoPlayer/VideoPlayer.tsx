import { useEffect, useRef, useState, useCallback } from 'react';
import { useAppStore, useCurrentFrame, useHighlightedNodes } from '../../store';
import { videosApi } from '../../services/api';
import type { Node, BBox } from '../../types';
import { BBoxOverlay } from './BBoxOverlay';

interface VideoPlayerProps {
  videoId: string;
  totalFrames: number;
  fps: number;
  resolution: { width: number; height: number };
  nodes: Node[];
}

export function VideoPlayer({ videoId, totalFrames, fps, resolution, nodes }: VideoPlayerProps) {
  const currentFrame = useCurrentFrame();
  const setCurrentFrame = useAppStore((state) => state.setCurrentFrame);
  const isPlaying = useAppStore((state) => state.isPlaying);
  const setIsPlaying = useAppStore((state) => state.setIsPlaying);
  const highlightedNodes = useHighlightedNodes();

  const [imageLoaded, setImageLoaded] = useState(false);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const playIntervalRef = useRef<number | null>(null);

  // Get current frame URL
  const frameUrl = videosApi.getFrameUrl(videoId, currentFrame);

  // Handle container resize
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateSize = () => {
      const rect = container.getBoundingClientRect();
      setContainerSize({ width: rect.width, height: rect.height });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(container);

    return () => observer.disconnect();
  }, []);

  // Calculate scale to fit container while maintaining aspect ratio
  const scale = Math.min(
    containerSize.width / resolution.width,
    containerSize.height / resolution.height
  );

  const displayWidth = resolution.width * scale;
  const displayHeight = resolution.height * scale;

  // Get bboxes for current frame
  const getBBoxesForFrame = useCallback((): { nodeId: string; category: string; bbox: BBox; isHighlighted: boolean }[] => {
    const bboxes: { nodeId: string; category: string; bbox: BBox; isHighlighted: boolean }[] = [];
    const frameStr = String(currentFrame);

    for (const node of nodes) {
      const bbox = node.bboxes_by_frame[frameStr];
      if (bbox) {
        bboxes.push({
          nodeId: node.node_id,
          category: node.category,
          bbox,
          isHighlighted: highlightedNodes.includes(node.node_id),
        });
      }
    }

    return bboxes;
  }, [currentFrame, nodes, highlightedNodes]);

  // Play/pause logic
  useEffect(() => {
    if (isPlaying) {
      playIntervalRef.current = window.setInterval(() => {
        const current = useAppStore.getState().currentFrame;
        setCurrentFrame((current + 1) % totalFrames);
      }, 1000 / fps);
    } else if (playIntervalRef.current) {
      clearInterval(playIntervalRef.current);
      playIntervalRef.current = null;
    }

    return () => {
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
      }
    };
  }, [isPlaying, totalFrames, fps, setCurrentFrame]);

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      switch (e.key) {
        case ' ':
          e.preventDefault();
          setIsPlaying(!isPlaying);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          setCurrentFrame(Math.max(0, currentFrame - 1));
          break;
        case 'ArrowRight':
          e.preventDefault();
          setCurrentFrame(Math.min(totalFrames - 1, currentFrame + 1));
          break;
        case 'Home':
          e.preventDefault();
          setCurrentFrame(0);
          break;
        case 'End':
          e.preventDefault();
          setCurrentFrame(totalFrames - 1);
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentFrame, totalFrames, isPlaying, setCurrentFrame, setIsPlaying]);

  return (
    <div className="flex flex-col h-full bg-gray-900 rounded-lg overflow-hidden">
      {/* Video display area */}
      <div
        ref={containerRef}
        className="flex-1 relative flex items-center justify-center min-h-0"
      >
        <div
          className="relative"
          style={{ width: displayWidth, height: displayHeight }}
        >
          <img
            src={frameUrl}
            alt={`Frame ${currentFrame}`}
            className="w-full h-full object-contain"
            onLoad={() => setImageLoaded(true)}
            onError={() => setImageLoaded(false)}
          />
          {imageLoaded && (
            <BBoxOverlay
              bboxes={getBBoxesForFrame()}
              scale={scale}
              width={displayWidth}
              height={displayHeight}
            />
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="p-4 bg-gray-800">
        {/* Timeline slider */}
        <div className="flex items-center gap-4 mb-2">
          <span className="text-white text-sm font-mono w-16">
            {String(currentFrame).padStart(4, '0')}
          </span>
          <input
            type="range"
            min={0}
            max={totalFrames - 1}
            value={currentFrame}
            onChange={(e) => setCurrentFrame(Number(e.target.value))}
            className="flex-1 h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer"
          />
          <span className="text-white text-sm font-mono w-16 text-right">
            {String(totalFrames - 1).padStart(4, '0')}
          </span>
        </div>

        {/* Playback controls */}
        <div className="flex items-center justify-center gap-4">
          <button
            onClick={() => setCurrentFrame(0)}
            className="p-2 text-white hover:bg-gray-700 rounded"
            title="Go to start (Home)"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
            </svg>
          </button>

          <button
            onClick={() => setCurrentFrame(Math.max(0, currentFrame - 1))}
            className="p-2 text-white hover:bg-gray-700 rounded"
            title="Previous frame (Left Arrow)"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
            </svg>
          </button>

          <button
            onClick={() => setIsPlaying(!isPlaying)}
            className="p-3 bg-blue-600 text-white hover:bg-blue-700 rounded-full"
            title="Play/Pause (Space)"
          >
            {isPlaying ? (
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
              </svg>
            ) : (
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>

          <button
            onClick={() => setCurrentFrame(Math.min(totalFrames - 1, currentFrame + 1))}
            className="p-2 text-white hover:bg-gray-700 rounded"
            title="Next frame (Right Arrow)"
          >
            <svg className="w-5 h-5 rotate-180" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
            </svg>
          </button>

          <button
            onClick={() => setCurrentFrame(totalFrames - 1)}
            className="p-2 text-white hover:bg-gray-700 rounded"
            title="Go to end (End)"
          >
            <svg className="w-5 h-5 rotate-180" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
            </svg>
          </button>
        </div>

        {/* Frame info */}
        <div className="flex justify-center mt-2 text-gray-400 text-sm">
          Frame {currentFrame + 1} of {totalFrames} | {fps} FPS
        </div>
      </div>
    </div>
  );
}
