"""AI-Powered Intelligent Physiotherapy Assessment and Rehabilitation Monitoring System."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from database import SessionLocal, init_db
import models
from routes import auth, camera, exercise, patient


DEFAULT_EXERCISES = [
    ("Squat", "Lower body exercise targeting quadriceps, glutes, and hamstrings."),
    ("Bicep Curl", "Upper arm exercise for bicep strengthening."),
    ("Shoulder Abduction", "Shoulder mobility exercise raising arms laterally."),
    ("Straight Leg Raise", "Core and hip flexor strengthening exercise."),
    ("Posture", "Static posture alignment analysis."),
]


def seed_exercises(db: Session):
    for name, description in DEFAULT_EXERCISES:
        exists = db.query(models.Exercise).filter(models.Exercise.name == name).first()
        if not exists:
            db.add(models.Exercise(name=name, description=description))
    db.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    db = SessionLocal()
    try:
        seed_exercises(db)
    finally:
        db.close()
    yield
    from camera.camera_stream import release_camera

    release_camera()


app = FastAPI(
    title="Physiotherapy Assessment API",
    description=(
        "AI-Powered Intelligent Physiotherapy Assessment and Rehabilitation Monitoring System. "
        "Uses YOLOv8 Pose, OpenCV, and real-time joint angle analysis."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(camera.router)
app.include_router(exercise.router)
app.include_router(patient.router)


@app.get("/", tags=["Health"])
def root():
    return {
        "message": "Physiotherapy Assessment API is running",
        "docs": "/docs",
        "version": "1.0.0",
    }


@app.get("/health", tags=["Health"])
def health_check():
    from camera.camera_stream import is_camera_running

    return {
        "status": "healthy",
        "camera_active": is_camera_running(),
    }
