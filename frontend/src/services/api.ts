import axios from 'axios';
import type { Observation, InferResponse, FleetBusStatus, GeoJSONFeature } from './types';

const API_URL = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '/api' : 'http://127.0.0.1:8000');

export { type Observation };

// ── Health ───────────────────────────────────────────────────────────────────

export const checkHealth = async (): Promise<boolean> => {
  try {
    const res = await axios.get(`${API_URL}/health`, { timeout: 3000 });
    return res.data?.status === 'ok';
  } catch {
    return false;
  }
};

// ── Events ───────────────────────────────────────────────────────────────────

export const fetchEventGeoJSON = async (filters?: {
  event_type?: string;
  status?: string;
}): Promise<{ type: string; features: GeoJSONFeature[] }> => {
  const params = new URLSearchParams();
  if (filters?.event_type && filters.event_type !== 'All') params.set('event_type', filters.event_type);
  if (filters?.status && filters.status !== 'All') params.set('status', filters.status);
  const response = await axios.get(`${API_URL}/events/geojson?${params.toString()}`);
  return response.data;
};

export const fetchEventObservations = async (eventId: number): Promise<Observation[]> => {
  const response = await axios.get(`${API_URL}/events/${eventId}/observations`);
  return response.data;
};

export const fetchEvents = async () => {
  const response = await axios.get(`${API_URL}/events`);
  return response.data;
};

// ── Fleet ────────────────────────────────────────────────────────────────────

export const fetchFleetStatus = async (): Promise<FleetBusStatus[]> => {
  const response = await axios.get(`${API_URL}/fleet/status`);
  return response.data;
};

// ── Inference (DEMO MODE ONLY) ──────────────────────────────────────────────

export const inferFrame = async (
  frameBase64: string,
  busId: string,
  latitude: number,
  longitude: number,
  options?: {
    speed_kmh?: number;
    course_deg?: number;
    gps_source?: string;
    gps_accuracy_m?: number;
  }
): Promise<InferResponse> => {
  const response = await axios.post(`${API_URL}/infer`, {
    bus_id: busId,
    frame_base64: frameBase64,
    latitude,
    longitude,
    speed_kmh: options?.speed_kmh ?? null,
    course_deg: options?.course_deg ?? null,
    gps_source: options?.gps_source ?? 'SIMULATED',
    gps_accuracy_m: options?.gps_accuracy_m ?? 10.0,
  }, { timeout: 10000 });
  return response.data;
};

// ── Telemetry ────────────────────────────────────────────────────────────────

export const sendTelemetry = async (
  busId: string,
  latitude: number,
  longitude: number,
  options?: {
    speed_kmh?: number;
    course_deg?: number;
    gps_source?: string;
  }
) => {
  await axios.post(`${API_URL}/telemetry`, {
    bus_id: busId,
    latitude,
    longitude,
    speed_kmh: options?.speed_kmh ?? null,
    course_deg: options?.course_deg ?? null,
    gps_source: options?.gps_source ?? 'SIMULATED',
  });
};

// ── Observations & Session Clearing ──────────────────────────────────────────

export const postObservation = async (payload: {
  bus_id: string;
  latitude: number;
  longitude: number;
  speed_kmh?: number;
  course_deg?: number;
  model: string;
  class_id: number;
  class_name: string;
  confidence: number;
  bbox_x1: number;
  bbox_y1: number;
  bbox_x2: number;
  bbox_y2: number;
  gps_source?: string;
  gps_accuracy_m?: number;
  session_id?: string;
  timestamp?: string;
}) => {
  const response = await axios.post(`${API_URL}/observations`, payload, { timeout: 5000 });
  return response.data;
};

export const clearSession = async (sessionId: string) => {
  const response = await axios.post(`${API_URL}/sessions/${sessionId}/clear`, {}, { timeout: 5000 });
  return response.data;
};

export const getWebSocketUrl = (): string => {
  if (API_URL.startsWith('http://') || API_URL.startsWith('https://')) {
    return `${API_URL.replace(/^http/, 'ws')}/ws/events`;
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  const prefix = API_URL.startsWith('/') ? API_URL : `/${API_URL}`;
  return `${protocol}//${host}${prefix}/ws/events`;
};

