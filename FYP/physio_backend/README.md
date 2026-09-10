# AI-Powered Intelligent Physiotherapy Assessment and Rehabilitation Monitoring System

Production-ready FastAPI backend with YOLOv8 Pose estimation, OpenCV camera streaming, joint angle analysis, exercise rep counting, and SQLite patient history storage.

## Technology Stack

- **Backend:** Python 3.10+, FastAPI, Uvicorn
- **Computer Vision:** YOLOv8 Pose (`yolov8n-pose.pt`), Ultralytics, OpenCV, NumPy
- **Database:** SQLite + SQLAlchemy ORM
- **Validation:** Pydantic

## Project Structure

```
physio_backend/
├── main.py
├── requirements.txt
├── database.py
├── models.py
├── schemas.py
├── auth_utils.py
├── camera/
│   └── camera_stream.py
├── yolo/
│   └── pose_detector.py
├── analysis/
│   ├── angle_calculation.py
│   ├── squat.py
│   ├── bicep_curl.py
│   ├── shoulder_abduction.py
│   ├── straight_leg_raise.py
│   └── posture.py
├── routes/
│   ├── auth.py
│   ├── camera.py
│   ├── exercise.py
│   └── patient.py
├── services/
│   └── exercise_manager.py
└── ml/
    ├── exercise_classifier.py
    ├── abnormal_movement.py
    └── recovery_prediction.py
```

## Setup & Run Instructions

### 1. Create virtual environment

```powershell
cd "physio_backend"
python -m venv venv
.\venv\Scripts\Activate.ps1
```

### 2. Install dependencies

```powershell
pip install -r requirements.txt
```

### 3. Download YOLO model (auto-downloads on first run)

```powershell
python -c "from ultralytics import YOLO; YOLO('yolov8n-pose.pt')"
```

### 4. Initialize database

Database is created automatically on server startup (`physio.db`). Exercises are seeded automatically.

### 5. Run FastAPI server

```powershell
uvicorn main:app --reload
```

Open Swagger UI: **http://127.0.0.1:8000/docs**

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/register` | Register patient/therapist |
| POST | `/login` | Login and get JWT token |
| GET | `/exercises` | List all exercises |
| POST | `/select-exercise` | Start exercise session (auth required) |
| GET | `/camera/start` | Start webcam |
| GET | `/camera/frame` | Get annotated JPEG frame (base64) |
| GET | `/camera/stop` | Release camera |
| GET | `/pose-data` | Get detected keypoints |
| GET | `/joint-angles` | Get real-time joint angles |
| GET | `/exercise-result` | Get reps, accuracy, feedback |
| GET | `/patient/history` | Get session history (auth required) |

---

## Sample API Requests

### Register

```http
POST /register
Content-Type: application/json

{
  "name": "Ali Khan",
  "email": "ali@example.com",
  "password": "password123",
  "role": "patient"
}
```

**Expected response:**

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "token_type": "bearer",
  "user_id": 1,
  "name": "Ali Khan",
  "role": "patient"
}
```

### Login

```http
POST /login
Content-Type: application/json

{
  "email": "ali@example.com",
  "password": "password123"
}
```

### Select Exercise (with Bearer token)

```http
POST /select-exercise
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "exercise_id": 1
}
```

**Expected response:**

```json
{
  "message": "Exercise 'Squat' selected",
  "exercise": "Squat",
  "session_id": 1
}
```

### Start Camera

```http
GET /camera/start
```

### Get Exercise Result

```http
GET /exercise-result
```

**Expected response:**

```json
{
  "exercise": "Squat",
  "repetitions": 5,
  "accuracy": 94.0,
  "angles": {
    "knee": 85.2,
    "hip": 95.1
  },
  "feedback": [
    "Good posture"
  ],
  "state": "down"
}
```

### Patient History

```http
GET /patient/history
Authorization: Bearer <access_token>
```

---

## Testing with Swagger

1. Run `uvicorn main:app --reload`
2. Open http://127.0.0.1:8000/docs
3. Register a user via `POST /register`
4. Copy `access_token` from response
5. Click **Authorize** → enter `Bearer <token>`
6. Call `GET /camera/start`
7. Call `POST /select-exercise` with `exercise_id: 1`
8. Poll `GET /exercise-result` while performing squats in front of the camera

---

## Exercises Supported

| ID | Exercise | Key Metrics |
|----|----------|-------------|
| 1 | Squat | Knee angle, hip angle, knee alignment |
| 2 | Bicep Curl | Elbow angle, elbow stability |
| 3 | Shoulder Abduction | Shoulder angle, posture |
| 4 | Straight Leg Raise | Hip angle, knee straightness |
| 5 | Posture | Shoulder/hip alignment, spine angle |

---

## Error Handling

- **Camera unavailable:** HTTP 503 with descriptive message
- **YOLO model load failure:** HTTP 503 on frame processing
- **Missing keypoints:** Feedback message + empty/partial angles
- **Low confidence (< 0.5):** Joints ignored automatically
- **Invalid exercise:** HTTP 404/400

---

## Notes

- Ensure webcam is connected and not used by another app
- Stand 2–3 meters from camera with full body visible
- First YOLO inference may take a few seconds (model download + warmup)
- Change `PHYSIO_SECRET_KEY` environment variable in production
