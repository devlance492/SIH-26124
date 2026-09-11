import React, { useState, useEffect, useCallback, useRef } from 'react';
import { fetchEventGeoJSON, fetchFleetStatus } from '../services/api';
import { useCamera } from '../hooks/useCamera';
import { useDemoReplay } from '../hooks/useDemoReplay';
import { useGps } from '../hooks/useGps';
import { useInference } from '../hooks/useInference';
import { useWebSocket } from '../hooks/useWebSocket';
import type { SourceMode, LayoutMode, GeoJSONFeature, FleetBusStatus, WebSocketMessage } from '../services/types';

import { SourceSelector } from './SourceSelector';
import { VideoCanvas } from './VideoCanvas';
import { DemoControls } from './DemoControls';
import { DetectionPanel } from './DetectionPanel';
import { GpsPanel } from './GpsPanel';
import { FleetPanel } from './FleetPanel';
import { EventMap } from './EventMap';
import { ConnectionStatus } from './ConnectionStatus';
import { PerformancePanel } from './PerformancePanel';

export const Dashboard: React.FC = () => {
  const [mode, setMode] = useState<SourceMode>('NONE');
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('normal');
  const [busId, setBusId] = useState('BUS-001');
  const [features, setFeatures] = useState<GeoJSONFeature[]>([]);
  const [fleet, setFleet] = useState<FleetBusStatus[]>([]);
  const [filterType, setFilterType] = useState('All');
  const [videoFileObj, setVideoFileObj] = useState<File | null>(null);

  const camera = useCamera();
  const demoReplay = useDemoReplay();
  const gpsInfo = useGps();
  const inference = useInference();

  const containerRef = useRef<HTMLDivElement>(null);

  // Sync Bus ID to demo replay hook
  useEffect(() => {
    demoReplay.setBusId(busId);
  }, [busId, demoReplay]);

  // Load initial map & fleet data
  const loadData = useCallback(async () => {
    try {
      const eventData = await fetchEventGeoJSON();
      setFeatures(eventData.features || []);
      const fleetData = await fetchFleetStatus();
      setFleet(fleetData || []);
    } catch (e) {
      console.error('Failed to load map/fleet data', e);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Handle live WebSocket updates
  const handleWsMessage = useCallback((msg: WebSocketMessage) => {
    if (msg.type === 'NEW_EVENT' || msg.type === 'EVENT_UPDATED') {
      loadData();
    } else if (msg.type === 'SESSION_CLEARED') {
      loadData();
    } else if (msg.type === 'TELEMETRY_UPDATED' || msg.type === 'BUS_UPDATED') {
      loadData();
    }
  }, [loadData]);

  useWebSocket(handleWsMessage);

  // Select Camera
  const handleSelectCamera = async () => {
    if (mode === 'VIDEO') demoReplay.stop();
    setMode('CAMERA');
    await camera.enumerateDevices();
    await camera.startCamera();

    if (gpsInfo.gps.source !== 'REAL_DEVICE') {
      gpsInfo.setSource('SIMULATED');
    }

    inference.startLoop(
      camera.captureFrame,
      busId,
      gpsInfo.gps,
      gpsInfo.advanceSimulated,
      300
    );
  };

  // Select Upload Video (Starts Demo Replay Mode with precomputed Model 1 cache)
  const handleSelectVideo = (file: File) => {
    if (mode === 'CAMERA') camera.stopCamera();
    setMode('VIDEO');
    setVideoFileObj(file);
    demoReplay.loadCache(file.name);

    // Load video into replay hook
    const url = URL.createObjectURL(file);
    if (demoReplay.videoRef.current) {
      const vid = demoReplay.videoRef.current;
      vid.src = url;
      vid.muted = true;
      vid.loop = true;
      vid.playsInline = true;
      vid.load();
      vid.oncanplay = () => {
        demoReplay.play();
      };
    }
  };

  const handleStop = () => {
    if (mode === 'CAMERA') {
      inference.stopLoop();
      camera.stopCamera();
    } else if (mode === 'VIDEO') {
      demoReplay.stop();
    }
    setMode('NONE');
    setVideoFileObj(null);
  };

  // Active detections & video element
  const activeVideoElement = 
    mode === 'CAMERA' ? camera.videoRef.current :
    mode === 'VIDEO' ? demoReplay.videoRef.current : null;

  const currentDetections = 
    mode === 'CAMERA' ? inference.detections :
    mode === 'VIDEO' ? demoReplay.activeDetections : [];

  const currentGps = 
    mode === 'VIDEO' ? demoReplay.simulatedGps : gpsInfo.gps;

  return (
    <div className={`app-layout layout-${layoutMode}`} ref={containerRef}>
      {/* App Header */}
      <header className="app-header">
        <div className="logo">
          <h1>BharatPotHole</h1>
          <span className="badge">MODEL 1 DEMO GIS DASHBOARD</span>
        </div>

        <div className="header-meta ml-auto flex items-center gap-4">
          <div className="bus-id-input flex items-center gap-2">
            <label className="text-sm text-slate-400">Bus ID:</label>
            <input 
              type="text" 
              value={busId} 
              onChange={(e) => setBusId(e.target.value)}
              className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-white text-sm"
              disabled={mode !== 'NONE'}
            />
          </div>
        </div>
      </header>

      {/* Connection & System Status */}
      <ConnectionStatus 
        backendOnline={inference.backendOnline}
        cameraActive={camera.active || mode === 'VIDEO'}
        gpsStatus={currentGps.status}
      />

      {/* Main Grid */}
      <main className={`app-main layout-${layoutMode}`}>
        {/* LEFT COLUMN: Video, Canvas & Controls */}
        <div className="left-column video-section">
          <SourceSelector 
            mode={mode}
            onSelectCamera={handleSelectCamera}
            onSelectVideo={handleSelectVideo}
            onStop={handleStop}
            cameraError={camera.error}
            videoFileName={videoFileObj?.name}
          />

          <div className="video-canvas-container">
            {mode === 'NONE' ? (
              <div className="empty-video-state" style={{ minHeight: '380px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div className="empty-content text-center p-6">
                  <span className="empty-icon text-4xl block mb-2">🎬</span>
                  <h3 className="text-lg font-bold text-slate-200">Select "Upload Video" or "Camera" to Start</h3>
                  <p className="text-sm text-slate-400 mt-1">Model 1 real-time hazard detection & live GIS event fusion</p>
                </div>
              </div>
            ) : (
              <VideoCanvas 
                videoElement={activeVideoElement}
                detections={currentDetections}
                currentFrame={demoReplay.currentFrame}
                totalFrames={demoReplay.totalFrames}
                currentTime={demoReplay.currentTime}
                fps={demoReplay.fps}
                gps={currentGps}
                busId={busId}
                showHud={true}
              />
            )}

            {/* Hidden video elements for decoding */}
            <video ref={camera.videoRef} style={{ display: 'none' }} playsInline muted />
            <video ref={demoReplay.videoRef} style={{ display: 'none' }} playsInline muted loop />
          </div>

          {/* Demo Controls (Only visible when video is selected) */}
          {mode === 'VIDEO' && (
            <DemoControls 
              isPlaying={demoReplay.isPlaying}
              currentTime={demoReplay.currentTime}
              duration={demoReplay.duration}
              currentFrame={demoReplay.currentFrame}
              totalFrames={demoReplay.totalFrames}
              playbackRate={demoReplay.playbackRate}
              sessionId={demoReplay.sessionId}
              layoutMode={layoutMode}
              onPlay={demoReplay.play}
              onPause={demoReplay.pause}
              onStop={demoReplay.stop}
              onSeek={demoReplay.seek}
              onChangeSpeed={demoReplay.changePlaybackRate}
              onChangeLayout={setLayoutMode}
              onClearSession={demoReplay.clearCurrentSession}
            />
          )}

          {/* Live Detections Panel */}
          <DetectionPanel detections={currentDetections} />
        </div>

        {/* MIDDLE COLUMN: Live GIS Map */}
        <div className="map-column">
          <div className="map-header flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-slate-300">Live Spatial GIS Map (Haversine Event Fusion)</h3>
            <span className="text-xs text-slate-400">{features.length} Active Events</span>
          </div>

          <EventMap 
            features={filterType === 'All' ? features : features.filter(f => f.properties.event_type === filterType)} 
            fleet={fleet}
          />
        </div>

        {/* RIGHT COLUMN: GPS, Fleet & Performance */}
        <div className="side-panel right-column">
          <GpsPanel 
            gps={currentGps} 
            busId={busId}
            onSetSource={gpsInfo.setSource} 
          />
          
          <FleetPanel 
            features={features}
            fleet={fleet}
            filterType={filterType}
            setFilterType={setFilterType}
            onRefresh={loadData}
          />
          
          <PerformancePanel 
            mode={mode}
            fps={mode === 'VIDEO' ? demoReplay.fps : inference.stats.fps}
            replayFps={mode === 'VIDEO' ? (demoReplay.isPlaying ? demoReplay.fps * demoReplay.playbackRate : 0) : inference.stats.fps}
            observationsSent={demoReplay.stats.observationsSent}
            totalFrames={mode === 'VIDEO' ? demoReplay.currentFrame : inference.stats.totalFrames}
          />
        </div>
      </main>
    </div>
  );
};
