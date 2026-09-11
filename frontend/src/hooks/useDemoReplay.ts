import { useState, useCallback, useRef, useEffect } from 'react';
import type {
  DemoCacheData,
  DemoCacheDetection,
  GpsState,
  Detection
} from '../services/types';
import { postObservation, clearSession } from '../services/api';

const START_LAT = 28.432738;
const START_LON = 77.014969;
const SIM_SPEED_KMH = 32.0;
const SIM_COURSE_DEG = 85.0;

function generateSessionId(): string {
  return `DEMO-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 1000)}`;
}

export function useDemoReplay() {
  const [cache, setCache] = useState<DemoCacheData | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [totalFrames, setTotalFrames] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [fps, setFps] = useState(25.0);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [sessionId, setSessionId] = useState<string>(generateSessionId());
  const [activeDetections, setActiveDetections] = useState<Detection[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [simulatedGps, setSimulatedGps] = useState<GpsState>({
    latitude: START_LAT,
    longitude: START_LON,
    speed_kmh: SIM_SPEED_KMH,
    course_deg: SIM_COURSE_DEG,
    source: 'SIMULATED',
    status: 'CONNECTED',
    accuracy_m: 10.0,
  });

  const [stats, setStats] = useState({
    videoFps: 25.0,
    replayFps: 25.0,
    observationsSent: 0,
    pendingObservations: 0,
  });

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rvfcHandleRef = useRef<number | null>(null);
  const animHandleRef = useRef<number | null>(null);
  const lastProcessedFrameRef = useRef<number>(-1);
  const sentFramesRef = useRef<Set<number>>(new Set());
  const cacheRef = useRef<DemoCacheData | null>(null);
  const busIdRef = useRef<string>('BUS-001');
  const sessionIdRef = useRef<string>(sessionId);

  // Keep refs in sync
  cacheRef.current = cache;
  sessionIdRef.current = sessionId;

  // 1. Compute simulated GPS coordinate for a given frame
  const computeGpsForFrame = useCallback((frameIdx: number, frameFps: number): GpsState => {
    const elapsedSeconds = frameIdx / (frameFps || 25.0);
    const distanceKm = (SIM_SPEED_KMH * elapsedSeconds) / 3600.0;
    const rad = (SIM_COURSE_DEG * Math.PI) / 180.0;
    
    const dLat = (distanceKm * Math.cos(rad)) / 111.32;
    const dLon = (distanceKm * Math.sin(rad)) / (111.32 * Math.cos((START_LAT * Math.PI) / 180.0));

    return {
      latitude: Number((START_LAT + dLat).toFixed(6)),
      longitude: Number((START_LON + dLon).toFixed(6)),
      speed_kmh: SIM_SPEED_KMH,
      course_deg: SIM_COURSE_DEG,
      source: 'SIMULATED',
      status: 'CONNECTED',
      accuracy_m: 10.0,
    };
  }, []);

  // 2. Update frame-synchronized detections and dispatch observations asynchronously
  const syncFrame = useCallback((vid: HTMLVideoElement) => {
    if (!vid) return;
    const currentFps = cacheRef.current?.video_metadata.fps || fps || 25.0;
    const frameIdx = Math.floor(vid.currentTime * currentFps);

    setCurrentTime(vid.currentTime);
    setCurrentFrame(frameIdx);

    const gps = computeGpsForFrame(frameIdx, currentFps);
    setSimulatedGps(gps);

    if (!cacheRef.current) return;

    // Look up detections for current frame (suppressing Manhole)
    const rawDets = cacheRef.current.frames[String(frameIdx)] || [];
    const filtered: Detection[] = rawDets
      .filter((d: DemoCacheDetection) => d.class_name !== 'Manhole')
      .map((d: DemoCacheDetection) => ({
        class_id: d.class_id,
        class_name: d.class_name,
        confidence: d.confidence,
        bbox_x1: d.bbox[0],
        bbox_y1: d.bbox[1],
        bbox_x2: d.bbox[2],
        bbox_y2: d.bbox[3],
        model: 'model_1',
      }));

    setActiveDetections(filtered);

    // Asynchronously dispatch observations to backend for new frames without blocking playback
    if (filtered.length > 0 && !sentFramesRef.current.has(frameIdx)) {
      sentFramesRef.current.add(frameIdx);
      lastProcessedFrameRef.current = frameIdx;

      for (const det of filtered) {
        postObservation({
          bus_id: busIdRef.current,
          latitude: gps.latitude,
          longitude: gps.longitude,
          speed_kmh: gps.speed_kmh,
          course_deg: gps.course_deg,
          model: 'model_1',
          class_id: det.class_id,
          class_name: det.class_name,
          confidence: det.confidence,
          bbox_x1: det.bbox_x1,
          bbox_y1: det.bbox_y1,
          bbox_x2: det.bbox_x2,
          bbox_y2: det.bbox_y2,
          gps_source: 'SIMULATED',
          gps_accuracy_m: 10.0,
          session_id: sessionIdRef.current,
        }).then(() => {
          setStats(prev => ({
            ...prev,
            observationsSent: prev.observationsSent + 1,
          }));
        }).catch(err => {
          console.warn('[useDemoReplay] Async observation upload notice:', err.message);
        });
      }
    }
  }, [computeGpsForFrame, fps]);

  // 3. Frame tick loop using requestVideoFrameCallback when available
  const scheduleNextFrame = useCallback(() => {
    const vid = videoRef.current;
    if (!vid) return;

    if (typeof (vid as any).requestVideoFrameCallback === 'function') {
      rvfcHandleRef.current = (vid as any).requestVideoFrameCallback(() => {
        syncFrame(vid);
        if (!vid.paused && !vid.ended) {
          scheduleNextFrame();
        }
      });
    } else {
      animHandleRef.current = requestAnimationFrame(() => {
        syncFrame(vid);
        if (!vid.paused && !vid.ended) {
          scheduleNextFrame();
        }
      });
    }
  }, [syncFrame]);

  // 4. Load default or custom cache JSON
  const loadCache = useCallback(async (customCache?: DemoCacheData | File | string) => {
    try {
      if (customCache && typeof customCache === 'object' && !(customCache instanceof File)) {
        setCache(customCache);
        setTotalFrames(customCache.video_metadata.total_frames);
        setFps(customCache.video_metadata.fps || 25.0);
        setDuration(customCache.video_metadata.duration_s);
        setError(null);
        return;
      }

      if (customCache instanceof File) {
        const text = await customCache.text();
        const parsed: DemoCacheData = JSON.parse(text);
        setCache(parsed);
        setTotalFrames(parsed.video_metadata.total_frames);
        setFps(parsed.video_metadata.fps || 25.0);
        setDuration(parsed.video_metadata.duration_s);
        setError(null);
        return;
      }

      if (typeof customCache === 'string') {
        const baseName = customCache.replace(/\.[^/.]+$/, '');
        try {
          const specificRes = await fetch(`/demo_replay/${baseName}_detections.json`);
          if (specificRes.ok) {
            const data: DemoCacheData = await specificRes.json();
            setCache(data);
            setTotalFrames(data.video_metadata.total_frames);
            setFps(data.video_metadata.fps || 25.0);
            setDuration(data.video_metadata.duration_s);
            setError(null);
            return;
          }
        } catch {
          // fallback
        }
      }

      const res = await fetch('/demo_replay/detections.json');
      if (res.ok) {
        const data: DemoCacheData = await res.json();
        setCache(data);
        setTotalFrames(data.video_metadata.total_frames);
        setFps(data.video_metadata.fps || 25.0);
        setDuration(data.video_metadata.duration_s);
        setError(null);
      }
    } catch (err: any) {
      console.warn('[useDemoReplay] Could not load detection cache:', err);
    }
  }, []);

  // 5. Initialize cache and video event listeners
  useEffect(() => {
    loadCache();
  }, [loadCache]);

  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;

    const handleTimeUpdate = () => {
      syncFrame(vid);
    };

    const handlePlay = () => {
      setIsPlaying(true);
      scheduleNextFrame();
    };

    const handlePause = () => {
      setIsPlaying(false);
    };

    vid.addEventListener('timeupdate', handleTimeUpdate);
    vid.addEventListener('play', handlePlay);
    vid.addEventListener('pause', handlePause);
    vid.addEventListener('seeking', handleTimeUpdate);

    return () => {
      vid.removeEventListener('timeupdate', handleTimeUpdate);
      vid.removeEventListener('play', handlePlay);
      vid.removeEventListener('pause', handlePause);
      vid.removeEventListener('seeking', handleTimeUpdate);
    };
  }, [syncFrame, scheduleNextFrame]);

  // 6. Playback controls
  const play = useCallback(() => {
    const vid = videoRef.current;
    if (vid) {
      vid.play().then(() => {
        setIsPlaying(true);
        scheduleNextFrame();
      }).catch(e => console.warn('Play error:', e));
    }
  }, [scheduleNextFrame]);

  const pause = useCallback(() => {
    const vid = videoRef.current;
    if (vid) {
      vid.pause();
      setIsPlaying(false);
    }
  }, []);

  const stop = useCallback(() => {
    const vid = videoRef.current;
    if (vid) {
      vid.pause();
      vid.currentTime = 0;
      setIsPlaying(false);
      setCurrentTime(0);
      setCurrentFrame(0);
      setActiveDetections([]);
    }
  }, []);

  const seek = useCallback((targetTime: number) => {
    const vid = videoRef.current;
    if (vid) {
      vid.currentTime = targetTime;
      syncFrame(vid);
    }
  }, [syncFrame]);

  const changePlaybackRate = useCallback((rate: number) => {
    const vid = videoRef.current;
    if (vid) {
      vid.playbackRate = rate;
      setPlaybackRate(rate);
    }
  }, []);

  // 7. Clear current demo session safely without wiping historical database
  const clearCurrentSession = useCallback(async () => {
    try {
      const res = await clearSession(sessionIdRef.current);
      console.log('[useDemoReplay] Session cleared:', res);
      const newSession = generateSessionId();
      setSessionId(newSession);
      sentFramesRef.current.clear();
      setStats(prev => ({
        ...prev,
        observationsSent: 0,
      }));
      return res;
    } catch (err: any) {
      console.error('[useDemoReplay] Clear session error:', err);
      throw err;
    }
  }, []);

  // 8. Set bus ID
  const setBusId = useCallback((id: string) => {
    busIdRef.current = id;
  }, []);

  return {
    videoRef,
    cache,
    isPlaying,
    currentFrame,
    totalFrames,
    currentTime,
    duration,
    fps,
    playbackRate,
    sessionId,
    activeDetections,
    simulatedGps,
    stats,
    error,
    play,
    pause,
    stop,
    seek,
    changePlaybackRate,
    clearCurrentSession,
    setBusId,
    loadCache,
    syncFrame,
  };
}
