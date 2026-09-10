import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AssignmentDetail,
  SessionClosedData,
} from '../src/types/api';

/**
 * The session ends itself.
 *
 * The behaviour under test is the one a patient complained about: having
 * completed every prescribed repetition, the live screen kept running and they
 * had to work out for themselves that they were finished and press a button.
 * That is the app asking the patient a question it already knows the answer
 * to - and every session left open that way blocks their next one under the
 * one-live-session rule.
 *
 * So: when the pose service reports GOAL_REACHED, the page must finalize the
 * session and take them to their report, without being asked.
 */

// --- capture the pose socket's handlers so a close can be simulated --------
let closeHandler: ((data: SessionClosedData) => void) | null = null;
const disconnect = vi.fn();
const samplerStop = vi.fn();
const cameraStop = vi.fn();

vi.mock('../src/features/session/usePoseSocket', () => ({
  usePoseSocket: (options: {
    onClosed: (data: SessionClosedData) => void;
  }) => {
    // Re-captured on every render, exactly as the real hook stores handlers in
    // a ref - so the callback always closes over current state.
    closeHandler = options.onClosed;
    return {
      status: 'ready',
      error: null,
      connect: vi.fn(),
      disconnect,
      sendFrame: vi.fn(),
      isBusy: () => false,
      reset: vi.fn(),
    };
  },
}));

vi.mock('../src/features/session/useFrameSampler', () => ({
  useFrameSampler: () => ({
    start: vi.fn(),
    stop: samplerStop,
    config: { fps: 7, width: 480 },
  }),
}));

vi.mock('../src/features/camera/useCamera', () => ({
  useCamera: () => ({
    status: 'ready',
    videoRef: { current: null },
    attachVideo: vi.fn(),
    start: vi.fn(),
    stop: cameraStop,
    devices: [],
    activeDeviceId: null,
    switchDevice: vi.fn(),
    errorMessage: null,
  }),
}));

const navigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual =
    await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ assignmentId: 'assign-1' }),
    useNavigate: () => navigate,
  };
});

import { api } from '../src/api/client';
import { LiveSessionPage } from '../src/pages/patient/LiveSessionPage';

const ASSIGNMENT: AssignmentDetail = {
  id: 'assign-1',
  exercise: { slug: 'squat', name: 'Bodyweight Squat' },
  targetSets: 3,
  repsPerSet: 10,
  targetTotalReps: 30,
  goalType: 'REPS',
  holdSeconds: null,
  difficulty: 'MEDIUM',
  instructions: null,
  scheduledDays: [],
  startDate: '2026-08-01',
  endDate: null,
  status: 'ACTIVE',
  exerciseDetail: {
    slug: 'squat',
    name: 'Bodyweight Squat',
    description: 'A squat.',
    instructions: 'Stand and sit.',
    recommendedView: 'FRONT',
    framingInstructions: 'Stand back.',
    targetBodyArea: 'Knee, hip',
    goalType: 'REPS',
  },
  therapistName: 'Ayesha Khan',
  completedSessions: 0,
};

function goalReached(
  overrides: Partial<SessionClosedData> = {},
): SessionClosedData {
  return {
    sessionId: 'sess-1',
    reason: 'GOAL_REACHED',
    goalType: 'REPS',
    totalReps: 30,
    targetTotalReps: 30,
    heldSeconds: 0,
    targetHoldSeconds: 0,
    ...overrides,
  };
}

/** Drive the page to a live session, then hand back the close handler. */
async function startLiveSession(
  assignment: AssignmentDetail = ASSIGNMENT,
): Promise<void> {
  vi.spyOn(api, 'get').mockResolvedValue({ data: assignment } as never);
  vi.spyOn(api, 'post').mockImplementation((async (url: string) => {
    if (url.endsWith('/pose-ticket')) {
      return { data: { ticket: 't', expiresIn: 120 } };
    }
    if (url === '/sessions') {
      return {
        data: {
          id: 'sess-1',
          status: 'CREATED',
          exercise: assignment.exerciseDetail,
          goalType: assignment.goalType,
          targetSets: assignment.targetSets,
          repsPerSet: assignment.repsPerSet,
          targetTotalReps: assignment.targetTotalReps,
          targetHoldSec: assignment.holdSeconds,
          ruleConfigVersion: 1,
          startedAt: new Date().toISOString(),
        },
      };
    }
    return { data: {} };
  }) as never);

  render(
    <MemoryRouter>
      <LiveSessionPage />
    </MemoryRouter>,
  );

  // setup -> camera -> connecting. The mocked socket reports 'ready', but the
  // page waits for session:ready before going live, so it is delivered here.
  const enable = await screen.findByRole('button', { name: 'Enable camera' });
  enable.click();
  const start = await screen.findByRole('button', { name: 'Start session' });
  start.click();

  await waitFor(() => expect(closeHandler).not.toBeNull());
}

beforeEach(() => {
  vi.restoreAllMocks();
  navigate.mockReset();
  disconnect.mockReset();
  samplerStop.mockReset();
  cameraStop.mockReset();
  closeHandler = null;
});

describe('Automatic completion', () => {
  it('finalizes the session and opens the report without being asked', async () => {
    await startLiveSession();
    const post = api.post as unknown as ReturnType<typeof vi.fn>;
    post.mockClear();

    closeHandler!(goalReached());

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/sessions/sess-1/complete'),
    );
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith(
        '/patient/sessions/sess-1/report',
        { replace: true },
      ),
    );
  });

  it('stops the camera and the frame stream before finalizing', async () => {
    // Order matters: a repetition ingested after the totals are computed
    // would be silently dropped, so capture must stop first.
    await startLiveSession();
    closeHandler!(goalReached());

    await waitFor(() => expect(samplerStop).toHaveBeenCalled());
    expect(disconnect).toHaveBeenCalled();
    expect(cameraStop).toHaveBeenCalled();
  });

  it('tells the patient what happened rather than just vanishing', async () => {
    await startLiveSession();
    closeHandler!(goalReached());

    expect(await screen.findByText('Session complete')).toBeInTheDocument();
    expect(
      screen.getByText(/completed all 30 prescribed repetitions/i),
    ).toBeInTheDocument();
  });

  it('reports a held session in seconds, not repetitions', async () => {
    await startLiveSession();
    closeHandler!(
      goalReached({
        goalType: 'HOLD',
        totalReps: 0,
        targetTotalReps: 1,
        heldSeconds: 60,
        targetHoldSeconds: 60,
      }),
    );

    expect(await screen.findByText('Session complete')).toBeInTheDocument();
    const message = screen.getByRole('status');
    expect(message.textContent).toContain('held correct alignment for 1m');
    expect(message.textContent).not.toMatch(/repetition/i);
  });

  it('ignores a repeated close instead of finishing twice', async () => {
    // Frames keep arriving until the camera is actually down, so a second
    // GOAL_REACHED must not restart a teardown already in progress.
    await startLiveSession();
    const post = api.post as unknown as ReturnType<typeof vi.fn>;
    post.mockClear();

    closeHandler!(goalReached());
    closeHandler!(goalReached());
    closeHandler!(goalReached());

    await waitFor(() => expect(navigate).toHaveBeenCalled());
    const completes = post.mock.calls.filter(
      (call) => call[0] === '/sessions/sess-1/complete',
    );
    expect(completes).toHaveLength(1);
  });

  it('does nothing for a close that is not the goal being met', async () => {
    await startLiveSession();
    const post = api.post as unknown as ReturnType<typeof vi.fn>;
    post.mockClear();

    closeHandler!(goalReached({ reason: 'SOMETHING_ELSE' }));

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(post).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('offers a retry, and keeps the session, when finalizing fails', async () => {
    await startLiveSession();
    const post = api.post as unknown as ReturnType<typeof vi.fn>;
    post.mockRejectedValueOnce(
      Object.assign(new Error('nope'), {
        isAxiosError: true,
        response: { data: { message: 'Server unavailable.' } },
      }),
    );

    closeHandler!(goalReached());

    // Still on the completion screen - NOT dropped back to a camera view that
    // has already been torn down.
    expect(await screen.findByText('Session complete')).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Your session is saved/i,
    );
    expect(navigate).not.toHaveBeenCalled();

    screen.getByRole('button', { name: /try again/i }).click();
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith(
        '/patient/sessions/sess-1/report',
        { replace: true },
      ),
    );
  });
});
