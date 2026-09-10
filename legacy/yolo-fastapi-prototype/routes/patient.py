"""Patient history routes."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

import models
from auth_utils import require_user
from database import get_db
from schemas import PatientHistoryResponse, SessionHistoryItem

router = APIRouter(prefix="/patient", tags=["Patient"])


@router.get("/history", response_model=PatientHistoryResponse)
def get_patient_history(
    patient_id: int | None = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_user),
):
    target_id = patient_id or current_user.id

    if current_user.role == "patient" and target_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Patients can only view their own history",
        )

    patient = db.query(models.User).filter(models.User.id == target_id).first()
    if not patient:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")

    sessions = (
        db.query(models.Session)
        .filter(models.Session.patient_id == target_id)
        .order_by(models.Session.date.desc())
        .all()
    )

    history = [
        SessionHistoryItem(
            session_id=s.id,
            exercise_name=s.exercise.name if s.exercise else "Unknown",
            date=s.date,
            repetitions=s.repetitions,
            accuracy_score=s.accuracy_score,
        )
        for s in sessions
    ]

    return PatientHistoryResponse(
        patient_id=patient.id,
        patient_name=patient.name,
        sessions=history,
    )
