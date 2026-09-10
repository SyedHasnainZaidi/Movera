from datetime import datetime

from sqlalchemy import Column, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    email = Column(String(150), unique=True, index=True, nullable=False)
    password = Column(String(255), nullable=False)
    role = Column(String(20), nullable=False, default="patient")

    sessions = relationship("Session", back_populates="patient")


class Exercise(Base):
    __tablename__ = "exercises"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), unique=True, nullable=False)
    description = Column(Text, nullable=True)

    sessions = relationship("Session", back_populates="exercise")


class Session(Base):
    __tablename__ = "sessions"

    id = Column(Integer, primary_key=True, index=True)
    patient_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    exercise_id = Column(Integer, ForeignKey("exercises.id"), nullable=False)
    date = Column(DateTime, default=datetime.utcnow, nullable=False)
    repetitions = Column(Integer, default=0)
    accuracy_score = Column(Float, default=0.0)

    patient = relationship("User", back_populates="sessions")
    exercise = relationship("Exercise", back_populates="sessions")
    joint_data = relationship("JointData", back_populates="session", cascade="all, delete-orphan")


class JointData(Base):
    __tablename__ = "joint_data"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("sessions.id"), nullable=False)
    joint_name = Column(String(50), nullable=False)
    angle = Column(Float, nullable=False)
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False)

    session = relationship("Session", back_populates="joint_data")
