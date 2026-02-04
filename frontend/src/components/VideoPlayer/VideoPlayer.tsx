import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useAppStore, useCurrentFrame, useSourceNodes, useTargetNodes, useSelectedNode } from '../../store';
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

// Frame buffer configuration
const BUFFER_SIZE = 50; // Maximum frames to keep in buffer
const PRELOAD_AHEAD = 25; // Frames to preload ahead during playback
const JPEG_QUALITY = 80; // JPEG quality for optimized playback

interface BufferedFrame {
  image: HTMLImageElement;
  loaded: boolean;
}

export function VideoPlayer({ videoId, totalFrames, fps, resolution, nodes }: VideoPlayerProps) {
  const currentFrame = useCurrentFrame();
  const setCurrentFrame = useAppStore((state) => state.setCurrentFrame);
  const isPlaying = useAppStore((state) => state.isPlaying);
  const setIsPlaying = useAppStore((state) => state.setIsPlaying);
  const sourceNodes = useSourceNodes();
  const targetNodes = useTargetNodes();
  const selectedNode = useSelectedNode();

  const [frameReady, setFrameReady] = useState(false);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Frame buffer for smooth playback
  const frameBufferRef = useRef<Map<number, BufferedFrame>>(new Map());
  const loadingFramesRef = useRef<Set<number>>(new Set());

  // requestAnimationFrame state
  const animationFrameRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number>(0);
  const frameDuration = 1000 / fps;

  // Pre-indexed bounding boxes by frame for O(1) lookup
  const bboxesByFrame = useMemo(() => {
    const index = new Map<number, { nodeId: string; category: string; bbox: BBox; isStatic: boolean }[]>();

    for (const node of nodes) {
      for (const [frameStr, bbox] of Object.entries(node.bboxes_by_frame)) {
        const frameNum = parseInt(frameStr, 10);
        if (!index.has(frameNum)) {
          index.set(frameNum, []);
        }
        index.get(frameNum)!.push({
          nodeId: node.node_id,
          category: node.category,
          bbox,
          isStatic: node.is_static,
        });
      }
    }

    return index;
  }, [nodes]);

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

  // Get bboxes for current frame using pre-indexed map (O(1))
  // Returns role for each bbox: 'source', 'target', 'selected', or null
  const getBBoxesForFrame = useCallback((): { nodeId: string; category: string; bbox: BBox; role: 'source' | 'target' | 'selected' | null }[] => {
    const frameBboxes = bboxesByFrame.get(currentFrame);
    if (!frameBboxes) return [];

    return frameBboxes.map(({ nodeId, category, bbox }) => {
      // Determine role based on selection state
      let role: 'source' | 'target' | 'selected' | null = null;
      if (selectedNode?.node_id === nodeId) {
        role = 'selected';
      } else if (sourceNodes.includes(nodeId)) {
        role = 'source';
      } else if (targetNodes.includes(nodeId)) {
        role = 'target';
      }
      return { nodeId, category, bbox, role };
    });
  }, [currentFrame, bboxesByFrame, sourceNodes, targetNodes, selectedNode]);

  // Load a frame into the buffer
  const loadFrame = useCallback((frameIdx: number): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
      // Check if already in buffer
      const cached = frameBufferRef.current.get(frameIdx);
      if (cached && cached.loaded) {
        resolve(cached.image);
        return;
      }

      // Check if already loading
      if (loadingFramesRef.current.has(frameIdx)) {
        // Wait for existing load
        const checkLoaded = () => {
          const frame = frameBufferRef.current.get(frameIdx);
          if (frame?.loaded) {
            resolve(frame.image);
          } else {
            requestAnimationFrame(checkLoaded);
          }
        };
        checkLoaded();
        return;
      }

      loadingFramesRef.current.add(frameIdx);

      const img = new Image();
      img.onload = () => {
        frameBufferRef.current.set(frameIdx, { image: img, loaded: true });
        loadingFramesRef.current.delete(frameIdx);
        resolve(img);
      };
      img.onerror = () => {
        loadingFramesRef.current.delete(frameIdx);
        reject(new Error(`Failed to load frame ${frameIdx}`));
      };

      // Use JPEG endpoint for optimized bandwidth
      img.src = videosApi.getJpegFrameUrl(videoId, frameIdx, JPEG_QUALITY);
      frameBufferRef.current.set(frameIdx, { image: img, loaded: false });
    });
  }, [videoId]);

  // Preload frames ahead
  const preloadFrames = useCallback((startFrame: number, count: number = PRELOAD_AHEAD) => {
    for (let i = 1; i <= count; i++) {
      const frameToPreload = (startFrame + i) % totalFrames;
      if (!frameBufferRef.current.has(frameToPreload) && !loadingFramesRef.current.has(frameToPreload)) {
        loadFrame(frameToPreload).catch(() => {
          // Silently ignore preload failures
        });
      }
    }

    // Clean up old frames to maintain buffer size
    if (frameBufferRef.current.size > BUFFER_SIZE) {
      const framesToKeep = new Set<number>();
      // Keep frames around current position
      for (let i = -5; i <= PRELOAD_AHEAD; i++) {
        const frame = (startFrame + i + totalFrames) % totalFrames;
        framesToKeep.add(frame);
      }

      for (const frame of frameBufferRef.current.keys()) {
        if (!framesToKeep.has(frame)) {
          frameBufferRef.current.delete(frame);
        }
      }
    }
  }, [loadFrame, totalFrames]);

  // Render frame to canvas
  const renderFrame = useCallback((frameIdx: number) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const bufferedFrame = frameBufferRef.current.get(frameIdx);
    if (bufferedFrame?.loaded) {
      ctx.drawImage(bufferedFrame.image, 0, 0, resolution.width, resolution.height);
      setFrameReady(true);
    } else {
      // Frame not ready, load it
      loadFrame(frameIdx).then((img) => {
        ctx.drawImage(img, 0, 0, resolution.width, resolution.height);
        setFrameReady(true);
      }).catch(() => {
        setFrameReady(false);
      });
    }
  }, [loadFrame, resolution.width, resolution.height]);

  // Load and render current frame when it changes (for manual seeking)
  useEffect(() => {
    renderFrame(currentFrame);
    preloadFrames(currentFrame);
  }, [currentFrame, renderFrame, preloadFrames]);

  // requestAnimationFrame-based playback loop
  useEffect(() => {
    if (!isPlaying) {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      return;
    }

    // Preload initial batch when playback starts
    const startFrame = useAppStore.getState().currentFrame;
    preloadFrames(startFrame, PRELOAD_AHEAD);

    const animate = (timestamp: number) => {
      if (!lastFrameTimeRef.current) {
        lastFrameTimeRef.current = timestamp;
      }

      const elapsed = timestamp - lastFrameTimeRef.current;

      if (elapsed >= frameDuration) {
        const current = useAppStore.getState().currentFrame;
        const nextFrame = (current + 1) % totalFrames;

        // Only advance if next frame is ready (prevents frame drops)
        const nextBuffered = frameBufferRef.current.get(nextFrame);
        if (nextBuffered?.loaded) {
          setCurrentFrame(nextFrame);
          lastFrameTimeRef.current = timestamp - (elapsed % frameDuration);
          preloadFrames(nextFrame);
        } else {
          // Frame not ready, try to load it urgently
          loadFrame(nextFrame).then(() => {
            // Frame will be rendered on next animation frame
          });
        }
      }

      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      lastFrameTimeRef.current = 0;
    };
  }, [isPlaying, totalFrames, frameDuration, setCurrentFrame, preloadFrames, loadFrame]);

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

  // Clear buffer when video changes
  useEffect(() => {
    frameBufferRef.current.clear();
    loadingFramesRef.current.clear();
    setFrameReady(false);
  }, [videoId]);

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
          <canvas
            ref={canvasRef}
            width={resolution.width}
            height={resolution.height}
            className="w-full h-full"
            style={{ imageRendering: 'auto' }}
          />
          {frameReady && (
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
