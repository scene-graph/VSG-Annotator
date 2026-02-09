import { useEffect, useState, useCallback, useRef } from 'react';
import { Routes, Route, Link, useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAppStore, useFilters, useCurrentUser, useSelectedNode, useSelectedEdge, useAnnotationMode, useBulkAiProgress, useAiProvider, useSetAiProvider, useResetBulkAi, useHydrateAiSuggestions, useClearAiSuggestions } from './store';
import { usersApi, videosApi } from './services/api';
import { useVideos, useVideo, useNodes, useEdges } from './hooks';
import { VideoPlayer } from './components/VideoPlayer';
import { TrackletTimeline } from './components/TrackletTimeline';
import { EdgeTimeline } from './components/EdgeTimeline';
import { EdgeReview } from './components/EdgeReview';
import { NodeReview } from './components/NodeReview';
import { Filters } from './components/Filters';
import { VideoMetadataPanel } from './components/VideoMetadata';
import { ExportButton } from './components/Export';
import { ImportButton } from './components/Import';
import { SaveButton } from './components/Save';
import clsx from 'clsx';
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels';
import { aiApi } from './services/ai';
import type { Node } from './types';

function VideoList() {
  const { data: videos, isLoading, error } = useVideos();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400">Loading videos...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-red-400">Error loading videos: {(error as Error).message}</div>
      </div>
    );
  }

  if (!videos || videos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <div className="text-gray-400 mb-4">No videos imported yet.</div>
        <div className="text-gray-500 text-sm">
          Run <code className="bg-gray-800 px-2 py-1 rounded">python scripts/import_vsg.py</code> to import videos.
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-white mb-6">Video Scene Graph Annotation</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {videos.map((video) => (
          <Link
            key={video.id}
            to={`/video/${video.video_id}`}
            className="bg-gray-800 rounded-lg p-4 hover:bg-gray-700 transition-colors"
          >
            <div className="text-white font-semibold mb-2">{video.video_id}</div>
            {video.dataset && (
              <div className="text-gray-400 text-sm mb-2">Dataset: {video.dataset}</div>
            )}
            <div className="flex items-center gap-4 text-sm">
              <div className="text-gray-400">
                <span className="text-white">{video.total_frames || '?'}</span> frames
              </div>
              <div className="text-gray-400">
                <span className="text-white">{video.node_count}</span> nodes
              </div>
              <div className="text-gray-400">
                <span className="text-white">{video.edge_count}</span> edges
              </div>
            </div>
            <div className="mt-2">
              <span
                className={`px-2 py-1 rounded text-xs ${
                  video.status === 'completed'
                    ? 'bg-green-500/20 text-green-400'
                    : video.status === 'in_progress'
                    ? 'bg-yellow-500/20 text-yellow-400'
                    : 'bg-gray-500/20 text-gray-400'
                }`}
              >
                {video.status}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

// Annotation mode toggle component
function AnnotationModeToggle() {
  const [isOpen, setIsOpen] = useState(false);
  const annotationMode = useAnnotationMode();
  const setAnnotationMode = useAppStore((state) => state.setAnnotationMode);
  const selectedNode = useSelectedNode();
  const selectedEdge = useSelectedEdge();
  const setSelectedNode = useAppStore((state) => state.setSelectedNode);
  const setSelectedEdge = useAppStore((state) => state.setSelectedEdge);

  const handleModeChange = (mode: 'nodes' | 'edges') => {
    setAnnotationMode(mode);
    // Clear the other selection when switching modes explicitly
    if (mode === 'nodes' && selectedEdge) {
      setSelectedEdge(null);
    } else if (mode === 'edges' && selectedNode) {
      setSelectedNode(null);
    }
  };

  return (
    <div className="bg-gray-800 rounded-lg p-2">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between"
      >
        <div className="flex items-center gap-2">
          <svg
            className={`w-3.5 h-3.5 text-gray-400 transition-transform ${isOpen ? 'rotate-90' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <span className="text-gray-400 text-xs uppercase">View Mode</span>
        </div>
        {!isOpen && (
          <span
            className={clsx(
              'px-2 py-0.5 rounded text-xs font-medium',
              annotationMode === 'nodes'
                ? 'bg-green-600/20 text-green-400'
                : 'bg-orange-600/20 text-orange-400'
            )}
          >
            {annotationMode === 'nodes' ? 'Nodes' : 'Edges'}
          </span>
        )}
      </button>
      {isOpen && (
        <div className="flex gap-2 mt-2">
          <button
            onClick={() => handleModeChange('nodes')}
            className={clsx(
              'flex-1 py-1.5 px-2 rounded text-xs font-medium transition-colors',
              annotationMode === 'nodes'
                ? 'bg-green-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            )}
          >
            Nodes
          </button>
          <button
            onClick={() => handleModeChange('edges')}
            className={clsx(
              'flex-1 py-1.5 px-2 rounded text-xs font-medium transition-colors',
              annotationMode === 'edges'
                ? 'bg-orange-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            )}
          >
            Edges
          </button>
        </div>
      )}
    </div>
  );
}

function VideoAnnotation() {
  const { videoId } = useParams<{ videoId: string }>();
  const navigate = useNavigate();
  const filters = useFilters();
  const setCurrentVideo = useAppStore((state) => state.setCurrentVideo);
  const setNodes = useAppStore((state) => state.setNodes);
  const setEdges = useAppStore((state) => state.setEdges);
  const nodes = useAppStore((state) => state.nodes);
  const edges = useAppStore((state) => state.edges);
  const selectedNode = useSelectedNode();
  const selectedEdge = useSelectedEdge();
  const annotationMode = useAnnotationMode();
  const setAiSuggestion = useAppStore((state) => state.setAiSuggestion);
  const setAiSuggestionStatus = useAppStore((state) => state.setAiSuggestionStatus);
  const startBulkAi = useAppStore((state) => state.startBulkAi);
  const updateBulkAiProgress = useAppStore((state) => state.updateBulkAiProgress);
  const finishBulkAi = useAppStore((state) => state.finishBulkAi);
  const cancelBulkAi = useAppStore((state) => state.cancelBulkAi);
  const bulkAiProgress = useBulkAiProgress();
  const bulkRunIdRef = useRef(0);
  const aiProvider = useAiProvider();
  const setAiProvider = useSetAiProvider();
  const resetBulkAi = useResetBulkAi();
  const hydrateAiSuggestions = useHydrateAiSuggestions();
  const clearAiSuggestions = useClearAiSuggestions();
  const [showBulkReviewPrompt, setShowBulkReviewPrompt] = useState(false);

  const [showMetadata, setShowMetadata] = useState(false);

  // Resizable right panel state
  const [rightPanelWidth, setRightPanelWidth] = useState(480);
  const isResizing = useRef(false);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return;

      // Calculate new width based on mouse position from right edge
      const newWidth = window.innerWidth - e.clientX - 16; // 16px for padding
      // Clamp between min (300) and max (800)
      setRightPanelWidth(Math.min(800, Math.max(300, newWidth)));
    };

    const handleMouseUp = () => {
      if (isResizing.current) {
        isResizing.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const { data: video, isLoading: videoLoading, error: videoError } = useVideo(videoId);
  const [videoStatus, setVideoStatus] = useState<string>('pending');
  const { data: nodesData } = useNodes(videoId);
  const { data: edgesData } = useEdges(videoId, filters);

  // Update store when data changes
  useEffect(() => {
    if (video) setCurrentVideo(video);
  }, [video, setCurrentVideo]);

  useEffect(() => {
    if (video?.status) {
      setVideoStatus(video.status);
    }
  }, [video?.status]);

  useEffect(() => {
    resetBulkAi();
    setShowBulkReviewPrompt(false);
  }, [videoId, resetBulkAi]);

  useEffect(() => {
    if (videoId) {
      hydrateAiSuggestions(videoId);
    } else {
      clearAiSuggestions();
    }
  }, [videoId, hydrateAiSuggestions, clearAiSuggestions]);

  useEffect(() => {
    if (nodesData) setNodes(nodesData);
  }, [nodesData, setNodes]);

  useEffect(() => {
    if (edgesData) {
      // Merge server edges with local edges, preferring local for created edges
      // This prevents duplicates when server returns created edges that we already have locally
      const currentEdges = useAppStore.getState().edges;
      const localCreatedEdges = currentEdges.filter(e => e.revision_action === 'create');
      const localCreatedIds = new Set(localCreatedEdges.map(e => e.edge_id));

      // Server edges, excluding ones we have locally created (local takes precedence)
      const serverEdges = edgesData.filter(e => !localCreatedIds.has(e.edge_id));

      // Combine server edges + local created edges
      setEdges([...serverEdges, ...localCreatedEdges]);
    }
  }, [edgesData, setEdges]);

  const getLargestBBoxFrame = useCallback((node: Node): number | null => {
    const entries = Object.entries(node.bboxes_by_frame || {});
    if (entries.length === 0) {
      return null;
    }

    let bestFrame: number | null = null;
    let bestArea = -1;

    for (const [frameStr, bbox] of entries) {
      const frameIdx = Number(frameStr);
      if (Number.isNaN(frameIdx)) continue;
      const area = bbox.width * bbox.height;
      if (area > bestArea || (area === bestArea && (bestFrame === null || frameIdx < bestFrame))) {
        bestArea = area;
        bestFrame = frameIdx;
      }
    }

    return bestFrame;
  }, []);

  const handleBulkAISuggestions = useCallback(async () => {
    if (!video || nodes.length === 0 || bulkAiProgress.running) return;
    bulkRunIdRef.current += 1;
    const runId = bulkRunIdRef.current;
    startBulkAi(nodes.length);
    let completed = 0;

    for (const node of nodes) {
      const state = useAppStore.getState();
      if (state.bulkAiProgress.cancelled || bulkRunIdRef.current !== runId) {
        break;
      }

      const frameIdx = getLargestBBoxFrame(node);
      if (frameIdx === null) {
        setAiSuggestionStatus(node.node_id, 'error');
        completed += 1;
        updateBulkAiProgress(completed);
        continue;
      }

      setAiSuggestionStatus(node.node_id, 'pending');
      try {
        const provider = useAppStore.getState().aiProvider;
        const result = await aiApi.suggestAttributes({
          video_id: video.video_id,
          node_id: node.node_id,
          frame_idx: frameIdx,
          debug: false,
          provider,
        });
        if (!result.error) {
          setAiSuggestion(node.node_id, result, frameIdx, 'bulk');
          setAiSuggestionStatus(node.node_id, 'done');
        } else {
          setAiSuggestionStatus(node.node_id, 'error');
        }
      } catch (error) {
        setAiSuggestionStatus(node.node_id, 'error');
      }

      completed += 1;
      updateBulkAiProgress(completed);
    }

    if (!useAppStore.getState().bulkAiProgress.cancelled && bulkRunIdRef.current === runId) {
      finishBulkAi();
      setShowBulkReviewPrompt(true);
    }
  }, [
    video,
    nodes,
    bulkAiProgress.running,
    getLargestBBoxFrame,
    startBulkAi,
    updateBulkAiProgress,
    finishBulkAi,
    setAiSuggestion,
    setAiSuggestionStatus,
  ]);

  const handleCancelBulk = useCallback(() => {
    bulkRunIdRef.current += 1;
    cancelBulkAi();
    setShowBulkReviewPrompt(false);
  }, [cancelBulkAi]);

  const handleStatusChange = async (newStatus: string) => {
    if (!video) return;
    try {
      const result = await videosApi.updateStatus(video.video_id, newStatus);
      setVideoStatus(result.status);
    } catch (error) {
      console.error('Failed to update video status:', error);
    }
  };

  useEffect(() => {
    if (bulkAiProgress.running) {
      setShowBulkReviewPrompt(false);
    }
  }, [bulkAiProgress.running]);

  if (videoLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-gray-400">Loading video...</div>
      </div>
    );
  }

  if (videoError || !video) {
    return (
      <div className="flex flex-col items-center justify-center h-screen">
        <div className="text-red-400 mb-4">Error loading video</div>
        <button
          onClick={() => navigate('/')}
          className="text-blue-400 hover:text-blue-300"
        >
          Back to video list
        </button>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link to="/" className="text-gray-400 hover:text-white">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className="text-white font-semibold">{video.video_id}</h1>
          {video.dataset && (
            <span className="text-gray-400 text-sm">({video.dataset})</span>
          )}
        </div>
        <div className="flex items-center gap-4">
          <select
            value={aiProvider}
            onChange={(e) => setAiProvider(e.target.value as 'kimi' | 'openai' | 'gemini')}
            className="bg-gray-700 text-white rounded px-2 py-1 text-sm border border-gray-600"
          >
            <option value="kimi">Kimi</option>
            <option value="openai">OpenAI</option>
            <option value="gemini">Gemini</option>
          </select>
          <button
            onClick={bulkAiProgress.running ? handleCancelBulk : handleBulkAISuggestions}
            disabled={(!video || nodes.length === 0) && !bulkAiProgress.running}
            className={clsx(
              'px-3 py-1.5 text-white text-sm font-semibold rounded border shadow-md transition-all',
              bulkAiProgress.running
                ? 'bg-gray-700 border-gray-500 hover:bg-gray-600'
                : 'bg-purple-600 hover:bg-purple-700 border-purple-400 hover:shadow-lg',
              (!video || nodes.length === 0) && !bulkAiProgress.running && 'bg-purple-800 border-purple-700 cursor-not-allowed'
            )}
          >
            {bulkAiProgress.running ? 'Cancel AI Suggestions' : 'AI Suggest All Nodes'}
          </button>
          {(bulkAiProgress.running || bulkAiProgress.completed > 0) && (
            <div className="flex items-center gap-2">
              <div className="w-24 h-2 bg-gray-700 rounded">
                <div
                  className="h-2 bg-purple-400 rounded"
                  style={{
                    width: bulkAiProgress.total > 0
                      ? `${Math.min(100, (bulkAiProgress.completed / bulkAiProgress.total) * 100)}%`
                      : '0%',
                  }}
                />
              </div>
              <span className="text-xs text-gray-300">
                {bulkAiProgress.completed}/{bulkAiProgress.total}
              </span>
            </div>
          )}
          {showBulkReviewPrompt && (
            <div className="flex items-center gap-2 bg-green-600/20 border border-green-600/40 text-green-200 text-xs px-2 py-1 rounded">
              AI suggestions finished — review nodes and accept/modify annotations.
              <button
                onClick={() => setShowBulkReviewPrompt(false)}
                className="text-green-100 hover:text-white"
              >
                Dismiss
              </button>
            </div>
          )}
          <ImportButton videoId={video.video_id} />
          <SaveButton videoId={video.video_id} />
          <ExportButton videoId={video.video_id} />
          <select
            value={videoStatus}
            onChange={(e) => handleStatusChange(e.target.value)}
            className={clsx(
              'rounded px-2 py-1 text-sm border',
              videoStatus === 'completed'
                ? 'bg-green-600/20 text-green-200 border-green-600/40'
                : videoStatus === 'in_progress'
                ? 'bg-yellow-600/20 text-yellow-200 border-yellow-600/40'
                : 'bg-gray-700 text-gray-200 border-gray-600'
            )}
          >
            <option value="pending">pending</option>
            <option value="in_progress">in_progress</option>
            <option value="completed">completed</option>
          </select>
          <UserSelector />
        </div>
      </header>

      {/* Video Metadata Panel */}
      <VideoMetadataPanel
        videoId={video.video_id}
        isOpen={showMetadata}
        onToggle={() => setShowMetadata(!showMetadata)}
      />

      {/* Main content */}
      <div className="flex-1 flex min-h-0 p-4 gap-4">
        {/* Left column: Video + Timeline */}
        <div className="flex-1 flex flex-col min-w-0">
          <PanelGroup orientation="vertical" id="main-layout">
            {/* Video player panel */}
            <Panel defaultSize={45} minSize={20} maxSize={70}>
              <div className="h-full pb-2">
                <VideoPlayer
                  videoId={video.video_id}
                  totalFrames={video.total_frames || 100}
                  fps={video.fps || 5}
                  resolution={video.resolution || { width: 1920, height: 1080 }}
                  nodes={nodes}
                />
              </div>
            </Panel>

            <PanelResizeHandle className="h-2 bg-transparent hover:bg-blue-500/20 transition-colors relative">
              <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-0.5 bg-gray-700" />
            </PanelResizeHandle>

            {/* Tracklet Timeline panel */}
            <Panel defaultSize={20} minSize={10} maxSize={40}>
              <div className="h-full py-2">
                <TrackletTimeline
                  nodes={nodes}
                  totalFrames={video.total_frames || 100}
                />
              </div>
            </Panel>

            <PanelResizeHandle className="h-2 bg-transparent hover:bg-blue-500/20 transition-colors relative">
              <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-0.5 bg-gray-700" />
            </PanelResizeHandle>

            {/* Edge Timeline panel */}
            <Panel defaultSize={35} minSize={20} maxSize={60}>
              <div className="h-full pt-2">
                <EdgeTimeline
                  edges={edges}
                  totalFrames={video.total_frames || 100}
                />
              </div>
            </Panel>
          </PanelGroup>
        </div>

        {/* Resize handle */}
        <div
          className="w-1.5 cursor-col-resize bg-gray-700 hover:bg-blue-500 transition-colors rounded-full flex-shrink-0"
          onMouseDown={handleResizeStart}
        />

        {/* Right column: Mode Toggle + Filters + Review */}
        <div
          className="flex flex-col gap-4 flex-shrink-0"
          style={{ width: rightPanelWidth }}
        >
          {/* Annotation Mode Toggle */}
          <AnnotationModeToggle />

          {/* Filters */}
          <Filters videoId={video.video_id} />

          {/* Node/Edge Review - conditional based on selection or mode */}
          <div className="flex-1 min-h-0">
            {selectedNode ? (
              <NodeReview videoId={video.video_id} />
            ) : selectedEdge ? (
              <EdgeReview videoId={video.video_id} />
            ) : annotationMode === 'nodes' ? (
              <NodeReview videoId={video.video_id} />
            ) : (
              <EdgeReview videoId={video.video_id} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function UserSelector() {
  const currentUser = useCurrentUser();
  const setCurrentUser = useAppStore((state) => state.setCurrentUser);

  const { data: users } = useQuery({
    queryKey: ['users'],
    queryFn: usersApi.list,
  });

  // Auto-select admin user on initial load
  useEffect(() => {
    if (users && !currentUser) {
      const adminUser = users.find((u) => u.username === 'admin');
      if (adminUser) {
        setCurrentUser(adminUser);
      }
    }
  }, [users, currentUser, setCurrentUser]);

  return (
    <div className="flex items-center gap-2">
      <span className="text-gray-400 text-sm">User:</span>
      <select
        value={currentUser?.id || ''}
        onChange={(e) => {
          const userId = Number(e.target.value);
          const user = users?.find((u) => u.id === userId);
          setCurrentUser(user || null);
        }}
        className="bg-gray-700 text-white rounded px-2 py-1 text-sm"
      >
        <option value="">Select user...</option>
        {users?.map((user) => (
          <option key={user.id} value={user.id}>
            {user.username}
          </option>
        ))}
      </select>
    </div>
  );
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<VideoList />} />
      <Route path="/video/:videoId" element={<VideoAnnotation />} />
    </Routes>
  );
}

export default App;
