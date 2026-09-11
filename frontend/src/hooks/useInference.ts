import { useState, useCallback, useRef } from 'react';
import { inferFrame } from '../services/api';
import type { Detection, GpsState } from '../services/types';

interface InferenceStats {
  fps: number;
  inferenceLatencyMs: number;
  totalFrames: number;
  totalDetections: number;
}

export function useInference() {
  const [detections, setDetections] = useState<Detection[]>([]);
  const [running, setRunning] = useState(false);
  const [stats, setStats] = useState<InferenceStats>({
    fps: 0,
    inferenceLatencyMs: 0,
    totalFrames: 0,
    totalDetections: 0,
  });
  const [backendOnline, setBackendOnline] = useState(true);

  const runningRef = useRef(false);
  const fpsCounterRef = useRef({ frames: 0, lastTime: Date.now() });
  const statsRef = useRef(stats);

  // Process a single frame
  const processFrame = useCallback(
    async (
      captureFrame: () => string | null,
      busId: string,
      gps: GpsState,
      advanceGps: () => void
    ) => {
      if (!runningRef.current) return;

      const frame = captureFrame();
      if (!frame) return;

      advanceGps();

      const start = performance.now();

      try {
        const result = await inferFrame(frame, busId, gps.latitude, gps.longitude, {
          speed_kmh: gps.speed_kmh,
          course_deg: gps.course_deg,
          gps_source: gps.source,
          gps_accuracy_m: gps.accuracy_m,
        });

        const latency = performance.now() - start;
        setDetections(result.detections);
        setBackendOnline(true);

        // Update FPS counter
        fpsCounterRef.current.frames++;
        const elapsed = (Date.now() - fpsCounterRef.current.lastTime) / 1000;
        if (elapsed >= 1) {
          const fps = fpsCounterRef.current.frames / elapsed;
          fpsCounterRef.current = { frames: 0, lastTime: Date.now() };
          statsRef.current = {
            fps: Math.round(fps * 10) / 10,
            inferenceLatencyMs: Math.round(latency),
            totalFrames: statsRef.current.totalFrames + 1,
            totalDetections: statsRef.current.totalDetections + result.detections.length,
          };
          setStats({ ...statsRef.current });
        } else {
          statsRef.current.totalFrames++;
          statsRef.current.totalDetections += result.detections.length;
        }
      } catch (err) {
        setBackendOnline(false);
        console.warn('[Inference] Backend error:', err);
      }
    },
    []
  );

  // Start the inference loop
  const startLoop = useCallback(
    (
      captureFrame: () => string | null,
      busId: string,
      gps: GpsState,
      advanceGps: () => void,
      intervalMs: number = 300 // ~3 FPS
    ) => {
      runningRef.current = true;
      setRunning(true);
      fpsCounterRef.current = { frames: 0, lastTime: Date.now() };
      statsRef.current = { fps: 0, inferenceLatencyMs: 0, totalFrames: 0, totalDetections: 0 };

      const loop = async () => {
        if (!runningRef.current) return;
        await processFrame(captureFrame, busId, gps, advanceGps);
        if (runningRef.current) {
          setTimeout(loop, intervalMs);
        }
      };

      loop();
    },
    [processFrame]
  );

  const stopLoop = useCallback(() => {
    runningRef.current = false;
    setRunning(false);
    setDetections([]);
  }, []);

  return {
    detections,
    running,
    stats,
    backendOnline,
    startLoop,
    stopLoop,
    processFrame,
  };
}
