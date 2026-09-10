"""End-to-end verification of the Movera physiotherapy platform.

Exercises the exact chain the FYP is graded on, plus the authorization
boundaries that must hold around it.

Assertions go through the public HTTP API and the internal service channel.
There is exactly ONE database touch, and only because email verification made
it unavoidable: a freshly registered account cannot sign in until it follows a
link that was emailed to it, and this script has no mailbox. `plant_and_verify`
therefore writes a known token hash to the user row and then presents the
matching plaintext to the REAL `POST /auth/verify-email` endpoint.

That substitutes for reading an inbox. It does not bypass a business rule: the
endpoint still performs its own lookup, expiry check and single-use
consumption, and every other assertion in this file is API-only.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import secrets
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

API = "http://127.0.0.1:3000/api/v1"
BACKEND_ENV = Path(r"D:\FYP\Physio therapy project\apps\backend\.env")
PSQL = os.environ.get("PSQL_PATH", r"C:\Program Files\PostgreSQL\18\bin\psql.exe")

PASSED: list[str] = []
FAILED: list[str] = []


def service_token() -> str:
    text = BACKEND_ENV.read_text(encoding="utf-8")
    return re.search(r"^POSE_SERVICE_TOKEN=(.+)$", text, re.M).group(1).strip()


def database_url() -> str:
    """The same connection string the backend uses, minus Prisma-only params.

    libpq rejects `?schema=public` outright, so it is stripped before the URL
    reaches psql.
    """
    text = BACKEND_ENV.read_text(encoding="utf-8")
    raw = re.search(r'^DATABASE_URL=(.+)$', text, re.M).group(1).strip().strip('"\'')
    return re.sub(r"[?&]schema=[^&]*", "", raw)


def psql(sql: str) -> None:
    result = subprocess.run(
        [PSQL, database_url(), "-v", "ON_ERROR_STOP=1", "-tAc", sql],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        raise SystemExit(
            f"\npsql failed. Is PostgreSQL reachable and is psql at:\n"
            f"  {PSQL}\n"
            f"Set PSQL_PATH to override.\n\n{result.stderr.strip()}\n"
        )


def plant_and_verify(email: str) -> None:
    """Complete email verification for a freshly registered account.

    Stands in for opening the verification email. Only a SHA-256 hash of the
    token is ever stored, so the plaintext that was emailed cannot be recovered
    from the database - a fresh token is written instead and its plaintext
    presented to the real endpoint.
    """
    token = base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b"=").decode()
    token_hash = hashlib.sha256(token.encode()).hexdigest()

    psql(
        f"""update users
            set "verificationTokenHash" = '{token_hash}',
                "verificationTokenExpiry" = now() + interval '1 hour'
            where email = '{email}';"""
    )

    response = call("POST", "/auth/verify-email", data={"token": token})
    if response.status != 200:
        raise SystemExit(
            f"Could not verify {email}: {response.status} {response.body}"
        )


class Response:
    def __init__(self, status: int, body, cookies: list[str]):
        self.status = status
        self.body = body
        self.cookies = cookies


def call(method: str, path: str, *, token=None, internal=False, data=None,
         cookie=None) -> Response:
    url = path if path.startswith("http") else API + path
    payload = json.dumps(data).encode() if data is not None else None
    request = urllib.request.Request(url, data=payload, method=method)
    request.add_header("Content-Type", "application/json")
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    if internal:
        request.add_header("x-internal-token", service_token())
    if cookie:
        request.add_header("Cookie", cookie)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read().decode()
            body = json.loads(raw) if raw else None
            return Response(response.status, body,
                            response.headers.get_all("Set-Cookie") or [])
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode()
        body = json.loads(raw) if raw else None
        return Response(exc.code, body, [])


def check(label: str, condition: bool, detail: str = "") -> bool:
    if condition:
        PASSED.append(label)
        print(f"  [PASS] {label}")
    else:
        FAILED.append(f"{label} :: {detail}")
        print(f"  [FAIL] {label}  {detail}")
    return condition


def register(role: str) -> tuple[str, str]:
    """Create a throwaway account, verify it, and sign in.

    A throwaway rather than the seeded patient2, because the first run links
    patient2 to the therapist and the "unlinked patient" assertions then stop
    holding. A verification script must be runnable any number of times.

    Registration no longer returns a session - the account is created
    unverified and login is refused until the emailed link is followed - so the
    account is taken through verification and a normal login here.
    """
    import random
    import string

    suffix = "".join(random.choices(string.ascii_lowercase + string.digits, k=8))
    email = f"verify.{role.lower()}.{suffix}@verify.test"
    response = call("POST", "/auth/register", data={
        "email": email,
        "password": "DevPassword123!",
        "firstName": "Verify",
        "lastName": role.title(),
        "role": role,
    })
    if response.status != 201:
        raise SystemExit(f"Could not register {role}: {response.status} {response.body}")
    if "accessToken" in response.body:
        raise SystemExit(
            "Registration returned an access token. Signup must NOT issue a "
            "session while the account is unverified."
        )

    plant_and_verify(email)
    return email, login(email)


def login(email: str) -> str:
    response = call("POST", "/auth/login",
                    data={"email": email, "password": "DevPassword123!"})
    if response.status == 429:
        # Not a failure: the login throttle allows 10 attempts per minute, so
        # two back-to-back runs of this script will legitimately hit it.
        raise SystemExit(
            "\nRate limited (HTTP 429).\n"
            "This is the login throttle working as intended - it allows 10\n"
            "attempts per minute. Wait about a minute and run again, or raise\n"
            "THROTTLE_LIMIT in apps/backend/.env for a verification session.\n"
        )
    if response.status != 200:
        raise SystemExit(f"Login failed for {email}: {response.status} {response.body}")
    return response.body["accessToken"]


def section(title: str) -> None:
    print(f"\n--- {title} ---")


def main() -> int:
    print("=" * 70)
    print("  END-TO-END VERIFICATION")
    print("=" * 70)

    # ------------------------------------------------------------------
    section("1. Authentication")
    therapist = login("therapist@example.com")
    patient1 = login("patient1@example.com")
    # A brand-new, deliberately UNLINKED patient. Created per run so the
    # isolation assertions below hold no matter how often this script runs.
    _, patient2 = register("PATIENT")
    check("Therapist, seeded patient and a fresh patient all sign in", True)

    me = call("GET", "/auth/me", token=patient1)
    check("Patient token resolves to a PATIENT profile",
          me.body.get("role") == "PATIENT" and me.body.get("patientProfileId"),
          str(me.body))
    patient1_profile_id = me.body["patientProfileId"]

    p2 = call("GET", "/auth/me", token=patient2)
    patient2_profile_id = p2.body["patientProfileId"]

    check("Password hash is never returned",
          "passwordHash" not in json.dumps(me.body))

    # ------------------------------------------------------------------
    section("2. Therapist sees only linked patients")
    caseload = call("GET", "/therapists/me/patients", token=therapist)
    ids = [row["patientProfileId"] for row in caseload.body["data"]]
    check("Linked patient1 appears in the caseload", patient1_profile_id in ids)
    check("Unlinked patient2 is absent from the caseload",
          patient2_profile_id not in ids)

    denied = call("GET", f"/patients/{patient2_profile_id}", token=therapist)
    check("Therapist reading an UNLINKED patient is refused",
          denied.status == 403
          and denied.body.get("code") == "THERAPIST_LINK_REQUIRED",
          f"got {denied.status} {denied.body}")

    allowed = call("GET", f"/patients/{patient1_profile_id}", token=therapist)
    check("Therapist reading a LINKED patient succeeds", allowed.status == 200)

    # ------------------------------------------------------------------
    section("3. Patient cannot read another patient")
    cross = call("GET", f"/patients/{patient1_profile_id}", token=patient2)
    check("Patient2 reading patient1's profile is refused",
          cross.status == 403
          and cross.body.get("code") == "PATIENT_ACCESS_DENIED",
          f"got {cross.status} {cross.body}")

    # ------------------------------------------------------------------
    section("4. Secure patient linking by invite")
    invite = call("POST", "/patients/me/link-invites", token=patient2)
    check("Patient2 can mint a single-use invite code",
          invite.status == 201 and len(invite.body.get("code", "")) == 8,
          str(invite.body))
    code = invite.body["code"]

    linked = call("POST", "/therapists/me/patients/link", token=therapist,
                  data={"inviteCode": code})
    check("Therapist redeems the invite and gains access", linked.status == 201,
          str(linked.body))

    replay = call("POST", "/therapists/me/patients/link", token=therapist,
                  data={"inviteCode": code})
    check("Replaying the same invite code is rejected",
          replay.status in (400, 409)
          and replay.body.get("code") in
          ("INVITE_ALREADY_USED", "ALREADY_LINKED"),
          f"got {replay.status} {replay.body}")

    bogus = call("POST", "/therapists/me/patients/link", token=therapist,
                 data={"inviteCode": "ZZZZZZZZ"})
    check("An unknown invite code is rejected",
          bogus.status == 400 and bogus.body.get("code") == "INVITE_INVALID")

    # ------------------------------------------------------------------
    section("5. Prescription")
    dashboard = call("GET", "/patients/me/dashboard", token=patient1)
    check("Patient dashboard loads with assignments",
          dashboard.status == 200 and len(dashboard.body["assignments"]) >= 3,
          str(dashboard.status))

    squat = next(a for a in dashboard.body["assignments"]
                 if a["exercise"]["slug"] == "squat")
    check("Squat prescription is 3 x 10 = 30 total repetitions",
          squat["targetSets"] == 3 and squat["repsPerSet"] == 10
          and squat["targetTotalReps"] == 30, str(squat))

    steal = call("POST", "/assignments", token=therapist, data={
        "patientId": patient1_profile_id,
        "exerciseId": "does-not-exist",
        "targetSets": 3, "repsPerSet": 10,
        "startDate": "2026-09-01",
    })
    check("Assigning a non-existent exercise is refused",
          steal.status == 404, f"got {steal.status}")

    # ------------------------------------------------------------------
    section("6. Session lifecycle")
    created = call("POST", "/sessions", token=patient1,
                   data={"assignmentId": squat["id"]})
    check("Patient starts a session (status CREATED)",
          created.status == 201 and created.body["status"] == "CREATED",
          str(created.body))
    session_id = created.body["id"]

    second = call("POST", "/sessions", token=patient1,
                  data={"assignmentId": squat["id"]})
    check("A second concurrent session is refused",
          second.status == 409
          and second.body.get("code") == "SESSION_ALREADY_LIVE",
          f"got {second.status} {second.body}")

    hijack = call("POST", "/sessions", token=patient2,
                  data={"assignmentId": squat["id"]})
    check("Patient2 cannot start a session on patient1's assignment",
          hijack.status == 403
          and hijack.body.get("code") == "RESOURCE_NOT_OWNED",
          f"got {hijack.status} {hijack.body}")

    ticket = call("POST", f"/sessions/{session_id}/pose-ticket", token=patient1)
    check("Pose ticket issued", ticket.status == 200 and ticket.body["ticket"],
          str(ticket.status))
    check("Pose ticket is short-lived (<= 5 minutes)",
          ticket.body["expiresIn"] <= 300, str(ticket.body.get("expiresIn")))

    # ------------------------------------------------------------------
    section("7. Internal pose-service channel")
    unauth = call("GET", f"/internal/sessions/{session_id}/analyzer-context")
    check("Internal endpoint rejects a request with no service token",
          unauth.status == 401
          and unauth.body.get("code") == "INTERNAL_AUTH_FAILED",
          f"got {unauth.status} {unauth.body}")

    as_user = call("GET", f"/internal/sessions/{session_id}/analyzer-context",
                   token=patient1)
    check("Internal endpoint rejects a normal user access token",
          as_user.status == 401, f"got {as_user.status}")

    ctx = call("GET", f"/internal/sessions/{session_id}/analyzer-context",
               internal=True)
    check("Analyzer context returned to the pose service", ctx.status == 200,
          str(ctx.status))
    check("Context carries authoritative prescription, not client input",
          ctx.body["targetTotalReps"] == 30 and ctx.body["targetSets"] == 3)
    check("Context carries the rule config and its landmarks",
          len(ctx.body["ruleConfig"]["requiredLandmarks"]) == 8,
          str(ctx.body["ruleConfig"].get("requiredLandmarks")))
    check("Rule thresholds are labelled as unvalidated prototype values",
          ctx.body["ruleConfig"]["validationStatus"]
          == "PROTOTYPE_DEFAULT_REQUIRES_PHYSIOTHERAPIST_REVIEW")
    check("Resume counter starts at 0 for a fresh session",
          ctx.body["currentPersistedRepCount"] == 0)

    activated = call("POST", f"/internal/sessions/{session_id}/activate",
                     internal=True)
    check("Pose service activates the session (-> ACTIVE)",
          activated.status == 200 and activated.body["status"] == "ACTIVE",
          str(activated.body))

    again = call("POST", f"/internal/sessions/{session_id}/activate",
                 internal=True)
    check("Re-activating is idempotent, not an error", again.status == 200)

    # ------------------------------------------------------------------
    section("8. Repetition ingestion")

    def rep_payload(number: int, correct: bool, score: float):
        return {
            "ingestKey": f"{session_id}:{number}",
            "repNumber": number,
            "setNumber": min(3, (number - 1) // 10 + 1),
            "startedAt": "2026-08-28T09:00:00.000Z",
            "completedAt": "2026-08-28T09:00:03.500Z",
            "correct": correct,
            "score": score,
            "trackingConfidence": 0.93,
            "angleSummary": {"knee": {"min": 92.0, "max": 171.0, "mean": 130.0}},
            "errors": ([] if correct
                       else [{"code": "TRUNK_LEAN", "occurrences": 4}]),
        }

    ingested = 0
    for number in range(1, 13):
        correct = number % 4 != 0          # 9 correct, 3 incorrect
        score = 88.0 if correct else 58.0
        response = call("POST", f"/internal/sessions/{session_id}/reps",
                        internal=True, data=rep_payload(number, correct, score))
        if response.status == 201:
            ingested += 1
    check("12 repetitions ingested", ingested == 12, f"got {ingested}")

    duplicate = call("POST", f"/internal/sessions/{session_id}/reps",
                     internal=True, data=rep_payload(5, True, 88.0))
    check("Replaying a repetition is idempotent, not duplicated",
          duplicate.status in (200, 201)
          and duplicate.body.get("duplicate") is True,
          f"got {duplicate.status} {duplicate.body}")

    out_of_range = call("POST", f"/internal/sessions/{session_id}/reps",
                        internal=True, data=rep_payload(999, True, 88.0))
    check("A repetition beyond the prescription is refused",
          out_of_range.status == 400
          and out_of_range.body.get("code") == "REP_OUT_OF_RANGE",
          f"got {out_of_range.status}")

    bad_code = rep_payload(13, False, 60.0)
    bad_code["errors"] = [{"code": "MADE_UP_CODE", "occurrences": 1}]
    bad = call("POST", f"/internal/sessions/{session_id}/reps",
               internal=True, data=bad_code)
    check("An unknown error code is refused",
          bad.status == 400
          and bad.body.get("code") == "REP_UNKNOWN_ERROR_CODE",
          f"got {bad.status} {bad.body}")

    resume = call("GET", f"/internal/sessions/{session_id}/analyzer-context",
                  internal=True)
    check("Resume counter now reflects persisted repetitions (12)",
          resume.body["currentPersistedRepCount"] == 12,
          str(resume.body.get("currentPersistedRepCount")))

    # ------------------------------------------------------------------
    section("9. Completion and report generation")
    completed = call("POST", f"/sessions/{session_id}/complete", token=patient1)
    check("Session completes and returns a report", completed.status == 200,
          str(completed.status))

    results = completed.body["results"]
    check("Backend computed totalReps = 12 from stored repetitions",
          results["totalReps"] == 12, str(results))
    check("Backend computed correctReps = 9", results["correctReps"] == 9,
          str(results))
    check("Backend computed incorrectReps = 3", results["incorrectReps"] == 3,
          str(results))
    expected_score = round((9 * 88.0 + 3 * 58.0) / 12, 1)
    check(f"Performance score is the mean of rep scores ({expected_score})",
          abs(results["performanceScore"] - expected_score) < 0.05,
          f"got {results['performanceScore']}")
    check("Completion ratio is 12/30 = 40%",
          abs(results["completionRatio"] - 40.0) < 0.05,
          str(results["completionRatio"]))
    check("Report aggregates angle statistics",
          "knee" in completed.body["angleStats"],
          str(completed.body["angleStats"]))
    check("Report aggregates the most common detected issue",
          completed.body["commonErrors"]
          and completed.body["commonErrors"][0]["code"] == "TRUNK_LEAN",
          str(completed.body["commonErrors"]))
    check("Report carries the clinical disclaimer",
          "physiotherapist" in completed.body["disclaimer"].lower())

    again = call("POST", f"/sessions/{session_id}/complete", token=patient1)
    check("Completing twice is idempotent (same report, no duplicate)",
          again.status == 200
          and again.body["results"]["totalReps"] == 12,
          f"got {again.status}")

    late = call("POST", f"/internal/sessions/{session_id}/reps",
                internal=True, data=rep_payload(13, True, 90.0))
    check("A repetition arriving AFTER completion is refused",
          late.status == 409
          and late.body.get("code") == "SESSION_NOT_ACTIVE",
          f"got {late.status} {late.body}")

    # ------------------------------------------------------------------
    section("10. Report visibility")
    patient_report = call("GET", f"/sessions/{session_id}/report", token=patient1)
    check("Patient can read their own report", patient_report.status == 200)

    therapist_report = call("GET", f"/sessions/{session_id}/report",
                            token=therapist)
    check("Linked therapist can read the same report",
          therapist_report.status == 200
          and therapist_report.body["results"]["totalReps"] == 12)

    stranger = call("GET", f"/sessions/{session_id}/report", token=patient2)
    check("An unrelated patient CANNOT read that report",
          stranger.status == 403, f"got {stranger.status} {stranger.body}")

    reps = call("GET", f"/sessions/{session_id}/reps", token=patient1)
    check("Per-repetition breakdown is retrievable",
          reps.status == 200 and len(reps.body) == 12,
          f"got {len(reps.body) if reps.status == 200 else reps.status}")

    # ------------------------------------------------------------------
    section("11. Progress aggregation")
    progress = call("GET", "/patients/me/progress", token=patient1)
    check("Progress endpoint returns a session timeline",
          progress.status == 200 and len(progress.body["timeline"]) >= 13,
          str(len(progress.body.get("timeline", []))))
    check("Progress is labelled deterministic, not machine learning",
          "not machine-learning" in progress.body["methodology"],
          progress.body.get("methodology", ""))
    check("Recurring issues are aggregated by error code",
          len(progress.body["recurringIssues"]) > 0,
          str(progress.body.get("recurringIssues")))

    therapist_dash = call("GET", "/therapists/me/dashboard", token=therapist)
    check("Therapist dashboard aggregates the caseload",
          therapist_dash.status == 200
          and therapist_dash.body["caseload"] >= 2,
          str(therapist_dash.body.get("caseload")))

    # ------------------------------------------------------------------
    print("\n" + "=" * 70)
    print(f"  PASSED: {len(PASSED)}    FAILED: {len(FAILED)}")
    print("=" * 70)
    if FAILED:
        print("\nFailures:")
        for failure in FAILED:
            print(f"  - {failure}")
        return 1
    print("\n  Full end-to-end chain verified.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
