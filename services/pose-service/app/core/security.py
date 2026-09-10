"""Pose-ticket verification.

The browser cannot set custom headers on a WebSocket handshake, so the ticket
travels as a query parameter. That is acceptable only because of how the ticket
is scoped:

* it expires in ~2 minutes - long enough to open a connection, useless if
  captured from a log later;
* it authorises exactly ONE session id, so it cannot be pointed at another
  patient's session;
* it carries `scope: "pose-session"` and is signed with POSE_TICKET_SECRET,
  which is a different secret from the backend's user access tokens - so a
  ticket cannot authenticate against the API and an access token cannot open a
  frame stream;
* full WebSocket URLs are never logged (see logging.py).

Production must run over WSS - documented in docs/DEPLOYMENT.md.
"""

from __future__ import annotations

from dataclasses import dataclass

import jwt


class InvalidTicketError(ValueError):
    """The ticket is missing, malformed, expired, or wrongly scoped."""


@dataclass(frozen=True, slots=True)
class PoseTicket:
    user_id: str
    session_id: str
    patient_profile_id: str
    jti: str


def verify_pose_ticket(token: str, secret: str) -> PoseTicket:
    if not token:
        raise InvalidTicketError("No pose ticket supplied")

    try:
        claims = jwt.decode(
            token,
            secret,
            algorithms=["HS256"],
            options={"require": ["exp", "sub"]},
        )
    except jwt.ExpiredSignatureError as exc:
        raise InvalidTicketError("Pose ticket has expired") from exc
    except jwt.InvalidTokenError as exc:
        raise InvalidTicketError("Pose ticket is not valid") from exc

    if claims.get("scope") != "pose-session":
        # An application access token would land here.
        raise InvalidTicketError("Token is not scoped for pose sessions")

    session_id = claims.get("sessionId")
    patient_profile_id = claims.get("patientProfileId")
    if not session_id or not patient_profile_id:
        raise InvalidTicketError("Pose ticket is missing session claims")

    return PoseTicket(
        user_id=str(claims["sub"]),
        session_id=str(session_id),
        patient_profile_id=str(patient_profile_id),
        jti=str(claims.get("jti", "")),
    )
