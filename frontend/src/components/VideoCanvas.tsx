import React, { useRef, useEffect } from 'react';
import type { Detection, GpsState } from '../services/types';

const MODEL1_COLORS: Record<string, string> = {
  HMV: '#38bdf8',       // Light Blue
  LMV: '#4ade80',       // Light Green
  Pedestrian: '#facc15',// Yellow
  Pothole: '#ef4444',   // Bright Red
  Crack: '#fb923c',     // Orange
  SpeedBump: '#2dd4bf', // Teal
};

interface VideoCanvasProps {
  videoElement: HTMLVideoElement | null;
  detections: Detection[];
  currentFrame?: number;
  totalFrames?: number;
  currentTime?: number;
  fps?: number;
  gps?: GpsState;
  busId?: string;
  showHud?: boolean;
}

export const VideoCanvas: React.FC<VideoCanvasProps> = ({
  videoElement,
  detections,
  currentFrame = 0,
  totalFrames = 0,
  currentTime = 0,
  fps = 25.0,
  gps,
  busId = 'BUS-001',
  showHud = true,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);

  // Keep latest detections in ref for 60fps canvas draw without re-triggering useEffect
  const detectionsRef = useRef<Detection[]>(detections);
  detectionsRef.current = detections;

  const hudDataRef = useRef({ currentFrame, totalFrames, currentTime, fps, gps, busId, showHud });
  hudDataRef.current = { currentFrame, totalFrames, currentTime, fps, gps, busId, showHud };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      const container = containerRef.current;
      const vid = videoElement;

      if (!container || !vid) {
        animFrameRef.current = requestAnimationFrame(draw);
        return;
      }

      if (vid.readyState >= 2 && vid.videoWidth > 0 && vid.videoHeight > 0) {
        const vw = vid.videoWidth;
        const vh = vid.videoHeight;
        const containerW = container.clientWidth || 640;
        const targetH = Math.round(containerW * (vh / vw));

        if (canvas.width !== containerW || canvas.height !== targetH) {
          canvas.width = containerW;
          canvas.height = targetH;
        }

        const width = canvas.width;
        const height = canvas.height;

        // 1. Draw current video frame to canvas
        ctx.drawImage(vid, 0, 0, width, height);

        // 2. Draw Model 1 Bounding Boxes
        const scaleX = width / vw;
        const scaleY = height / vh;
        const activeDets = detectionsRef.current || [];

        for (const det of activeDets) {
          if (det.class_name === 'Manhole') continue;

          const color = MODEL1_COLORS[det.class_name] || '#facc15';

          const x1 = det.bbox_x1 * scaleX;
          const y1 = det.bbox_y1 * scaleY;
          const x2 = det.bbox_x2 * scaleX;
          const y2 = det.bbox_y2 * scaleY;
          const boxW = Math.max(2, x2 - x1);
          const boxH = Math.max(2, y2 - y1);

          // Bounding box rectangle with glow/border
          ctx.strokeStyle = color;
          ctx.lineWidth = 3;
          ctx.strokeRect(x1, y1, boxW, boxH);

          // Label text
          const label = `${det.class_name} ${(det.confidence * 100).toFixed(0)}%`;
          ctx.font = 'bold 13px Inter, -apple-system, sans-serif';
          const textMetrics = ctx.measureText(label);
          const textW = textMetrics.width;
          const textH = 20;

          const labelY = y1 >= textH ? y1 : y1 + textH + 4;

          // Label background
          ctx.fillStyle = color;
          ctx.fillRect(x1, labelY - textH, textW + 10, textH);

          // Label text
          ctx.fillStyle = '#090d16';
          ctx.fillText(label, x1 + 5, labelY - 5);
        }

        // 3. Draw On-Screen Presentation HUD
        const { currentFrame: curF, totalFrames: totF, currentTime: curT, fps: curFps, gps: curGps, busId: curBus, showHud: isHud } = hudDataRef.current;

        if (isHud) {
          const hudW = Math.min(width - 24, 380);
          const hudH = 76;
          const hudX = 12;
          const hudY = 12;

          // Dark translucent glass panel
          ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
          ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
          ctx.lineWidth = 1;

          ctx.beginPath();
          if (typeof (ctx as any).roundRect === 'function') {
            (ctx as any).roundRect(hudX, hudY, hudW, hudH, 6);
          } else {
            ctx.rect(hudX, hudY, hudW, hudH);
          }
          ctx.fill();
          ctx.stroke();

          // Header
          ctx.fillStyle = '#38bdf8';
          ctx.font = 'bold 13px Inter, sans-serif';
          ctx.fillText('BharatPotHole | MODEL 1 DEMO REPLAY', hudX + 12, hudY + 22);

          // Frame & Time
          ctx.fillStyle = '#f1f5f9';
          ctx.font = '12px Inter, sans-serif';
          const frameText = totF > 0 
            ? `Frame: ${curF} / ${totF} | Time: ${curT.toFixed(2)}s | FPS: ${curFps.toFixed(1)}`
            : `Frame: ${curF} | Time: ${curT.toFixed(2)}s | FPS: ${curFps.toFixed(1)}`;
          ctx.fillText(frameText, hudX + 12, hudY + 42);

          // GPS
          ctx.fillStyle = '#94a3b8';
          ctx.font = '11px Inter, sans-serif';
          const latStr = curGps ? curGps.latitude.toFixed(5) : '28.43274';
          const lonStr = curGps ? curGps.longitude.toFixed(5) : '77.01497';
          ctx.fillText(`GPS: ${latStr}, ${lonStr} (SIMULATED) | BUS: ${curBus}`, hudX + 12, hudY + 62);
        }
      }

      animFrameRef.current = requestAnimationFrame(draw);
    };

    animFrameRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [videoElement]);

  return (
    <div ref={containerRef} className="video-canvas-container-inner" style={{ width: '100%', position: 'relative', overflow: 'hidden' }}>
      <canvas
        ref={canvasRef}
        className="video-canvas"
        style={{ width: '100%', display: 'block', borderRadius: '8px', background: '#090d16' }}
      />
    </div>
  );
};
