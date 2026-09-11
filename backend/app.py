import datetime
from typing import List, Optional
from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
import models
import schemas
from database import engine, get_db

# Create database tables safely
try:
    models.Base.metadata.create_all(bind=engine)
except Exception as e:
    print(f"Warning: Database table creation deferred or failed: {e}")

from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="SIH26124 Observation API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
from fastapi import WebSocket, WebSocketDisconnect
import json

class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        dead_connections = []
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                dead_connections.append(connection)
        for dead in dead_connections:
            self.disconnect(dead)

manager = ConnectionManager()

@app.get("/health", status_code=status.HTTP_200_OK)
def health_check():
    return {"status": "ok"}

import event_fusion

@app.post("/observations", response_model=schemas.ObservationFusionResponse, status_code=status.HTTP_201_CREATED)
async def create_observation(obs: schemas.ObservationCreate, db: Session = Depends(get_db)):
    obs_data = obs.model_dump()
    if obs_data.get('timestamp') is None:
        obs_data['timestamp'] = datetime.datetime.now(datetime.timezone.utc)
    
    db_obs = models.Observation(**obs_data)
    
    best_event, event_created = event_fusion.fuse_observation(db, db_obs)
    
    # Add observation to session and commit the transaction
    db.add(db_obs)
    db.commit()
    db.refresh(db_obs)
    
    # Broadcast event updates to connected WebSocket clients
    await manager.broadcast({
        "type": "NEW_EVENT" if event_created else "EVENT_UPDATED",
        "event_id": best_event.event_id,
        "event_type": best_event.event_type,
        "latitude": best_event.latitude,
        "longitude": best_event.longitude,
        "unique_bus_count": best_event.unique_bus_count,
        "observation_count": best_event.observation_count,
        "status": best_event.status
    })
    
    return schemas.ObservationFusionResponse(
        observation=db_obs,
        event_id=best_event.event_id,
        event_created=event_created
    )

@app.get("/observations", response_model=List[schemas.ObservationResponse])
def get_observations(
    bus_id: Optional[str] = Query(None, description="Filter by Bus ID"),
    class_name: Optional[str] = Query(None, description="Filter by Object Class Name"),
    model: Optional[str] = Query(None, description="Filter by Model Name"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db)
):
    query = db.query(models.Observation)
    
    if bus_id:
        query = query.filter(models.Observation.bus_id == bus_id)
    if class_name:
        query = query.filter(models.Observation.class_name == class_name)
    if model:
        query = query.filter(models.Observation.model == model)
        
    observations = query.offset(skip).limit(limit).all()
    return observations

@app.get("/observations/{observation_id}", response_model=schemas.ObservationResponse)
def get_observation(observation_id: int, db: Session = Depends(get_db)):
    obs = db.query(models.Observation).filter(models.Observation.observation_id == observation_id).first()
    if not obs:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Observation not found")
    return obs

@app.get("/events", response_model=List[schemas.EventResponse])
def get_events(
    event_type: Optional[str] = Query(None, description="Filter by Event Type"),
    status: Optional[str] = Query(None, description="Filter by Status"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db)
):
    query = db.query(models.Event)
    if event_type:
        query = query.filter(models.Event.event_type == event_type)
    if status:
        query = query.filter(models.Event.status == status)
    
    return query.offset(skip).limit(limit).all()

@app.get("/events/geojson")
def get_events_geojson(
    event_type: Optional[str] = Query(None, description="Filter by Event Type"),
    status: Optional[str] = Query(None, description="Filter by Status"),
    db: Session = Depends(get_db)
):
    query = db.query(models.Event)
    if event_type:
        query = query.filter(models.Event.event_type == event_type)
    if status:
        query = query.filter(models.Event.status == status)
        
    events = query.all()
    
    features = []
    for evt in events:
        feature = {
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [evt.longitude, evt.latitude]
            },
            "properties": {
                "event_id": evt.event_id,
                "event_type": evt.event_type,
                "severity": evt.severity,
                "status": evt.status,
                "aggregated_confidence": evt.aggregated_confidence,
                "observation_count": evt.observation_count,
                "unique_bus_count": evt.unique_bus_count,
                "first_seen": evt.first_seen.isoformat() if evt.first_seen else None,
                "last_seen": evt.last_seen.isoformat() if evt.last_seen else None
            }
        }
        features.append(feature)
        
    return {
        "type": "FeatureCollection",
        "features": features
    }

@app.get("/events/{event_id}", response_model=schemas.EventResponse)
def get_event_by_id(event_id: int, db: Session = Depends(get_db)):
    evt = db.query(models.Event).filter(models.Event.event_id == event_id).first()
    if not evt:
        raise HTTPException(status_code=404, detail="Event not found")
    return evt

@app.get("/events/{event_id}/observations", response_model=List[schemas.ObservationResponse])
def get_event_observations(event_id: int, db: Session = Depends(get_db)):
    observations = db.query(models.Observation).filter(models.Observation.event_id == event_id).all()
    return observations

# ==============================================================================
# SESSIONS & DEMO LIFECYCLE
# ==============================================================================

@app.post("/sessions/{session_id}/clear")
async def clear_session(session_id: str, db: Session = Depends(get_db)):
    """
    Safely clears observations and recalculates/removes affected events for a given session.
    Preserves all historical and other session data without wiping the database.
    """
    observations = db.query(models.Observation).filter(models.Observation.session_id == session_id).all()
    if not observations:
        return {
            "session_id": session_id,
            "deleted_observations": 0,
            "affected_events": 0,
            "status": "no_op"
        }
    
    affected_event_ids = set(o.event_id for o in observations if o.event_id is not None)
    
    deleted_count = len(observations)
    for obs in observations:
        db.delete(obs)
    db.flush()
    
    deleted_events = 0
    updated_events = 0
    for event_id in affected_event_ids:
        if event_fusion.recalculate_event_after_removal(db, event_id):
            updated_events += 1
        else:
            deleted_events += 1
            
    db.commit()
    
    # Broadcast session cleared message to all connected clients
    await manager.broadcast({
        "type": "SESSION_CLEARED",
        "session_id": session_id,
        "deleted_observations": deleted_count,
        "updated_events": updated_events,
        "deleted_events": deleted_events
    })
    
    return {
        "session_id": session_id,
        "deleted_observations": deleted_count,
        "updated_events": updated_events,
        "deleted_events": deleted_events,
        "status": "cleared"
    }

# ==============================================================================
# WEBSOCKET ENDPOINT
# ==============================================================================

@app.websocket("/ws/events")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            # We don't expect messages from the client, just keep connection open
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)

# ==============================================================================
# TELEMETRY & FLEET (DEMO & EDGE)
# ==============================================================================

@app.post("/telemetry", status_code=status.HTTP_201_CREATED)
async def create_telemetry(telemetry: schemas.TelemetryCreate, db: Session = Depends(get_db)):
    data = telemetry.model_dump()
    if data.get('timestamp') is None:
        data['timestamp'] = datetime.datetime.now(datetime.timezone.utc)
    
    db_telemetry = models.Telemetry(**data)
    db.add(db_telemetry)
    db.commit()
    
    # Broadcast telemetry update to map
    await manager.broadcast({
        "type": "TELEMETRY_UPDATED",
        "bus_id": db_telemetry.bus_id,
        "latitude": db_telemetry.latitude,
        "longitude": db_telemetry.longitude,
        "speed_kmh": db_telemetry.speed_kmh,
        "course_deg": db_telemetry.course_deg
    })
    
    return {"status": "ok"}

@app.get("/fleet/status", response_model=List[schemas.FleetBusStatus])
def get_fleet_status(db: Session = Depends(get_db)):
    # Very basic approach: get the latest telemetry for each bus
    # In production, this would be a more complex query or cache.
    buses = db.query(models.Telemetry.bus_id).distinct().all()
    status_list = []
    
    cutoff_time = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=5)
    
    for (bus_id,) in buses:
        latest = db.query(models.Telemetry).filter(models.Telemetry.bus_id == bus_id).order_by(models.Telemetry.timestamp.desc()).first()
        if latest:
            is_active = latest.timestamp >= cutoff_time if latest.timestamp.tzinfo else latest.timestamp.replace(tzinfo=datetime.timezone.utc) >= cutoff_time
            status_list.append(schemas.FleetBusStatus(
                bus_id=bus_id,
                last_seen=latest.timestamp,
                latitude=latest.latitude,
                longitude=latest.longitude,
                speed_kmh=latest.speed_kmh,
                status="Online" if is_active else "Offline"
            ))
            
    return status_list

# ==============================================================================
# LIVE DEMO INFERENCE API (BROWSER MODE ONLY)
# ==============================================================================
import asyncio
from inference_service import inference_service

@app.post("/infer", response_model=schemas.InferResponse)
async def infer_frame(req: schemas.InferRequest, db: Session = Depends(get_db)):
    # 1. Run inference
    detections = inference_service.infer_base64(req.frame_base64)
    
    # 2. Process telemetry (keep fleet tracking alive even without detections)
    ts = req.timestamp or datetime.datetime.now(datetime.timezone.utc)
    
    telemetry_data = {
        "bus_id": req.bus_id,
        "latitude": req.latitude,
        "longitude": req.longitude,
        "speed_kmh": req.speed_kmh,
        "course_deg": req.course_deg,
        "gps_source": req.gps_source,
        "gps_accuracy_m": req.gps_accuracy_m,
        "timestamp": ts
    }
    
    db_telemetry = models.Telemetry(**telemetry_data)
    db.add(db_telemetry)
    
    # Broadcast telemetry
    await manager.broadcast({
        "type": "TELEMETRY_UPDATED",
        **telemetry_data,
        "timestamp": ts.isoformat()
    })
    
    # 3. Create observations for each detection
    fused_events = set()
    observations_created = 0
    
    for det in detections:
        obs_data = {
            "bus_id": req.bus_id,
            "latitude": req.latitude,
            "longitude": req.longitude,
            "speed_kmh": req.speed_kmh,
            "course_deg": req.course_deg,
            "model": det["model"],
            "class_id": det["class_id"],
            "class_name": det["class_name"],
            "confidence": det["confidence"],
            "bbox_x1": det["bbox_x1"],
            "bbox_y1": det["bbox_y1"],
            "bbox_x2": det["bbox_x2"],
            "bbox_y2": det["bbox_y2"],
            "timestamp": ts,
            "gps_source": req.gps_source,
            "gps_accuracy_m": req.gps_accuracy_m
        }
        
        db_obs = models.Observation(**obs_data)
        best_event, event_created = event_fusion.fuse_observation(db, db_obs)
        
        db.add(db_obs)
        fused_events.add(best_event.event_id)
        observations_created += 1
        
        # Broadcast event updates
        await manager.broadcast({
            "type": "NEW_EVENT" if event_created else "EVENT_UPDATED",
            "event_id": best_event.event_id,
            "event_type": best_event.event_type,
            "latitude": best_event.latitude,
            "longitude": best_event.longitude,
            "unique_bus_count": best_event.unique_bus_count,
            "observation_count": best_event.observation_count,
            "status": best_event.status
        })

    db.commit()
    
    return schemas.InferResponse(
        detections=detections,
        observations_created=observations_created,
        fused_events=list(fused_events)
    )

