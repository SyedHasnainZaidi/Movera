"""Exercise and analysis routes."""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

import models
from auth_utils import require_user
from camera.camera_stream import CameraError, is_camera_running, process_frame
from database import get_db
from schemas import (
    ExerciseResponse,
    ExerciseResultResponse,
    JointAnglesResponse,
    PoseDataResponse,
    SelectExerciseRequest,
    SelectExerciseResponse,
)
from services.exercise_manager import session_manager

router = APIRouter(tags=["Exercise & Analysis"])


@router.get("/exercises", response_model=list[ExerciseResponse])
def list_exercises(db: Session = Depends(get_db)):
    exercises = db.query(models.Exercise).order_by(models.Exercise.id).all()
    return exercises


@router.post("/select-exercise", response_model=SelectExerciseResponse)
def select_exercise(
    request: SelectExerciseRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    exercise = db.query(models.Exercise).filter(models.Exercise.id == request.exercise_id).first()
    if not exercise:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invalid exercise selection: exercise not found",
        )

    patient_id = request.patient_id or current_user.id
    if current_user.role == "patient" and patient_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Patients can only select exercises for themselves",
        )

    patient = db.query(models.User).filter(models.User.id == patient_id).first()
    if not patient:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")

    try:
        session_manager.select_exercise(
            exercise_id=exercise.id,
            exercise_name=exercise.name,
            session_id=0,
            patient_id=patient_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    session = models.Session(
        patient_id=patient_id,
        exercise_id=exercise.id,
        date=datetime.utcnow(),
        repetitions=0,
        accuracy_score=0.0,
    )
    db.add(session)
    db.commit()
    db.refresh(session)

    session_manager.active_session_id = session.id

    return SelectExerciseResponse(
        message=f"Exercise '{exercise.name}' selected",
        exercise=exercise.name,
        session_id=session.id,
    )


def _capture_keypoints():
    if not is_camera_running():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Camera is not running. Call GET /camera/start first.",
        )
    try:
        _, keypoints, _ = process_frame()
    except CameraError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    return keypoints


@router.get("/pose-data", response_model=PoseDataResponse)
def get_pose_data():
    keypoints = _capture_keypoints()
    if not keypoints:
        return PoseDataResponse(
            detected=False,
            keypoints={},
            message="No pose detected. Ensure full body is visible with good lighting.",
        )

    formatted = {
        name: {"x": data["x"], "y": data["y"], "confidence": data["confidence"]}
        for name, data in keypoints.items()
    }
    return PoseDataResponse(detected=True, keypoints=formatted)


@router.get("/joint-angles", response_model=JointAnglesResponse)
def get_joint_angles():
    if session_manager.analyzer is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No exercise selected. Call POST /select-exercise first.",
        )

    keypoints = _capture_keypoints()
    if not keypoints:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Missing keypoints: no pose detected in current frame",
        )

    result = session_manager.analyze(keypoints)
    return JointAnglesResponse(
        exercise=result["exercise"],
        angles=result["angles"],
        state=result["state"],
    )


@router.get("/exercise-result", response_model=ExerciseResultResponse)
def get_exercise_result(db: Session = Depends(get_db)):
    if session_manager.analyzer is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No exercise selected. Call POST /select-exercise first.",
        )

    keypoints = _capture_keypoints()
    if keypoints:
        result = session_manager.analyze(keypoints)
    else:
        result = session_manager.last_result or {
            "exercise": session_manager.active_exercise_name or "Unknown",
            "repetitions": 0,
            "accuracy": 0.0,
            "angles": {},
            "feedback": ["No pose detected in current frame"],
            "state": "unknown",
        }

    if session_manager.active_session_id:
        session = (
            db.query(models.Session)
            .filter(models.Session.id == session_manager.active_session_id)
            .first()
        )
        if session:
            session.repetitions = result["repetitions"]
            session.accuracy_score = result["accuracy"]
            for joint_name, angle in result.get("angles", {}).items():
                db.add(
                    models.JointData(
                        session_id=session.id,
                        joint_name=joint_name,
                        angle=float(angle),
                        timestamp=datetime.utcnow(),
                    )
                )
            db.commit()

    return ExerciseResultResponse(**result)
