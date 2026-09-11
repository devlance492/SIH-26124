import React, { useState } from 'react';

interface PerformancePanelProps {
  mode: string;
  fps: number;
  replayFps: number;
  observationsSent: number;
  totalFrames: number;
}

export const PerformancePanel: React.FC<PerformancePanelProps> = ({
  mode,
  replayFps,
  observationsSent,
  totalFrames,
}) => {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className={`panel-section performance-panel ${collapsed ? 'collapsed' : ''}`}>
      <div 
        className="panel-header-small collapsible flex items-center justify-between" 
        onClick={() => setCollapsed(!collapsed)}
        style={{ cursor: 'pointer' }}
      >
        <h3>System & Replay Performance</h3>
        <span className="collapse-icon">{collapsed ? '▼' : '▲'}</span>
      </div>

      {!collapsed && (
        <div className="stat-grid perf-stats mt-3">
          <div className="stat-box small">
            <span className="stat-label">Inference Mode</span>
            <span className="stat-value text-sm text-yellow">
              {mode === 'VIDEO' ? 'PRECOMPUTED' : 'LIVE'}
            </span>
          </div>
          <div className="stat-box small">
            <span className="stat-label">Video Replay</span>
            <span className="stat-value text-sm text-green">{replayFps.toFixed(1)} FPS</span>
          </div>
          <div className="stat-box small">
            <span className="stat-label">Observations Sent</span>
            <span className="stat-value text-sm text-blue">{observationsSent}</span>
          </div>
          <div className="stat-box small">
            <span className="stat-label">Processed Frames</span>
            <span className="stat-value text-sm">{totalFrames}</span>
          </div>
        </div>
      )}
    </div>
  );
};
