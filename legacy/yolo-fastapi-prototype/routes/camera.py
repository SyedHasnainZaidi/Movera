"""Camera streaming routes."""

from fastapi import APIRouter, HTTPException, Query, status

from camera.camera_stream import (
    CameraError,
    frame_to_base64,
    is_camera_running,
    process_frame,
    release_camera,
    start_camera,
)
from schemas import CameraFrameResponse, CameraStartResponse, MessageResponse

router = APIRouter(prefix="/camera", tags=["Camera"])


@router.get("/start", response_model=CameraStartResponse)
def camera_start(camera_index: int = Query(0, ge=0)):
    try:
        result = start_camera(camera_index)
        return CameraStartResponse(**result)
    except CameraError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc


@router.get("/frame", response_model=CameraFrameResponse)
def camera_frame():
    try:
        if not is_camera_running():
            raise CameraError("Camera is not running. Call /camera/start first.")

        _, _, annotated = process_frame()
        if annotated is None:
            raise CameraError("No frame available")

        return CameraFrameResponse(
            status="success",
            frame_base64=frame_to_base64(annotated),
        )
    except CameraError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc


@router.get("/stop", response_model=MessageResponse)
def camera_stop():
    result = release_camera()
    return MessageResponse(message=result["message"])
