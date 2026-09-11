import os
import sys
import base64
from typing import List

# Dynamic / optional ML imports for cloud & serverless compatibility
try:
    import numpy as np
    import cv2
    from ultralytics import YOLO
    ML_AVAILABLE = True
except ImportError:
    ML_AVAILABLE = False
    np = None
    cv2 = None
    YOLO = None

# Models configuration
MODEL1_PATH = os.getenv("MODEL1_PATH", r"C:\Users\soumy\OneDrive\Desktop\SIH-21624\best.pt")
MODEL2_PATH = os.getenv("MODEL2_PATH", r"C:\Users\soumy\OneDrive\Desktop\SIH-21624\best (model_2).pt")

EXPECTED_CLASSES_1 = {
    0: "HMV",
    1: "LMV",
    2: "Pedestrian",
    3: "Pothole",
    4: "Crack",
    5: "Manhole",
    6: "SpeedBump",
}

EXPECTED_CLASSES_2 = {
    0: "TrafficCone",
    1: "Rock",
    2: "RoadDebris",
    3: "FallenTree",
}

class InferenceService:
    _instance = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(InferenceService, cls).__new__(cls)
            cls._instance.initialize()
        return cls._instance

    def initialize(self):
        self.ready = False
        print("Initializing InferenceService...")

        if not ML_AVAILABLE or YOLO is None:
            print("Notice: ML packages (ultralytics, opencv) not installed. Running in lightweight serverless mode.")
            self.model1 = None
            self.model2 = None
            return
        
        if not os.path.exists(MODEL1_PATH):
            print(f"Warning: Model 1 not found at {MODEL1_PATH}. Inference will return empty detections.")
            self.model1 = None
        else:
            self.model1 = YOLO(MODEL1_PATH)
            
        if not os.path.exists(MODEL2_PATH):
            print(f"Warning: Model 2 not found at {MODEL2_PATH}. Inference will return empty detections.")
            self.model2 = None
        else:
            self.model2 = YOLO(MODEL2_PATH)
            
        self.ready = self.model1 is not None and self.model2 is not None

    def infer_base64(self, frame_b64: str) -> List[dict]:
        """
        Takes a base64 encoded JPEG, runs it through Model 1 and Model 2,
        and returns a list of detections.
        """
        if not self.ready or not ML_AVAILABLE or cv2 is None or np is None:
            return []
            
        # Decode base64 to image
        if frame_b64.startswith("data:image"):
            frame_b64 = frame_b64.split(",")[1]
            
        try:
            img_data = base64.b64decode(frame_b64)
            nparr = np.frombuffer(img_data, np.uint8)
            frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        except Exception as e:
            print(f"Frame decode error: {e}")
            return []
        
        if frame is None:
            return []

        detections = []
        
        # Run Model 1
        if self.model1:
            res1 = self.model1(frame, conf=0.25, verbose=False)
            for box in res1[0].boxes:
                cls_id = int(box.cls[0])
                conf_val = float(box.conf[0])
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                cls_name = EXPECTED_CLASSES_1.get(cls_id, f"M1_{cls_id}")
                
                detections.append({
                    "class_id": cls_id,
                    "class_name": cls_name,
                    "confidence": conf_val,
                    "bbox_x1": x1,
                    "bbox_y1": y1,
                    "bbox_x2": x2,
                    "bbox_y2": y2,
                    "model": "model_1"
                })
            
        # Run Model 2
        if self.model2:
            res2 = self.model2(frame, conf=0.25, verbose=False)
            for box in res2[0].boxes:
                cls_id = int(box.cls[0])
                conf_val = float(box.conf[0])
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                cls_name = EXPECTED_CLASSES_2.get(cls_id, f"M2_{cls_id}")
                
                detections.append({
                    "class_id": cls_id,
                    "class_name": cls_name,
                    "confidence": conf_val,
                    "bbox_x1": x1,
                    "bbox_y1": y1,
                    "bbox_x2": x2,
                    "bbox_y2": y2,
                    "model": "model_2"
                })
            
        return detections

# Singleton instance exported
inference_service = InferenceService()
