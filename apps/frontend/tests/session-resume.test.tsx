import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssignmentDetail, SessionReadyData } from '../src/types/api';

/**
 * Getting back into a session you were already doing.
 *
 * The reported bug: a patient switches to another tab or window mid-exercise,
 * comes back, and is thrown out of the session. Every attempt to rejoin is
 * then refused with "you already have a session in progress" - and nothing in
 * the app could finish or cancel it, so logging out and back in changed
 * nothing and the exercise stayed unreachable until a two-hour sweep.
 *
 * Two behaviours close that trap, and both are tested here:
 *   * returning to the SAME exercise resumes the running session;
 *   * a session on a DIFFERENT exercise is named, with a way out of it.
 */

let readyHandler: ((data: SessionReadyData) => void) | null = null;
let socketStatus: 'idle' | 'connecting' | 'ready' | 'closed' | 'error' =
  'ready';
const connect = vi.fn();

vi.mock('../src/features/session/usePoseSocket', () => ({
  usePoseSocket: (options: {
    onSessionReady: (data: SessionReadyData) => void;
  }) => {
    readyHandler = options.onSessionReady;
    return {
      status: socketStatus,
      error: null,
      connect,
      disconnect: vi.fn(),
      sendFrame: vi.fn(),
      isBusy: () => false,
      reset: vi.fn(),
    };
  },
}));

vi.mock('../src/features/session/useFrameSampler', () => ({
  useFrameSampler: () => ({
    start: vi.fn(),
    stop: vi.fn(),
    config: { fps: 7, width: 480 },
  }),
}));

vi.mock('../src/features/camera/useCamera', () => ({
  useCamera: () => ({
    status: 'ready',
    videoRef: { current: null },
    attachVideo: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
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

function createdSession(resumed: boolean) {
  return {
    id: 'sess-1',
    status: resumed ? 'ACTIVE' : 'CREATED',
    resumed,
    exercise: ASSIGNMENT.exerciseDetail,
    goalType: 'REPS',
    targetSets: 3,
    repsPerSet: 10,
    targetTotalReps: 30,
    targetHoldSec: null,
    ruleConfigVersion: 1,
    startedAt: new Date().toISOString(),
  };
}

function conflict(details: Record<string, string> | undefined) {
  return Object.assign(new Error('conflict'), {
    isAxiosError: true,
    response: {
      status: 409,
      data: {
        code: 'SESSION_ALREADY_LIVE',
        message: 'You have a session in progress on Bicep Curl.',
        details,
      },
    },
  });
}

function readyData(resumedFromRep: number): SessionReadyData {
  return {
    sessionId: 'sess-1',
    exercise: 'squat',
    goalType: 'REPS',
    targetTotalReps: 30,
    targetSets: 3,
    repsPerSet: 10,
    targetHoldSeconds: 0,
    resumedFromHeldSeconds: 0,
    resumedFromRep,
    ruleConfigVersion: 1,
    framingInstructions: 'Stand side-on to the camera.',
    recommendedView: 'SIDE',
  };
}

/** Walk the page from setup to the point where POST /sessions is made. */
async function startUpTo(user: ReturnType<typeof userEvent.setup>) {
  render(
    <MemoryRouter>
      <LiveSessionPage />
    </MemoryRouter>,
  );
  await user.click(await screen.findByRole('button', { name: 'Enable camera' }));
  await user.click(await screen.findByRole('button', { name: 'Start session' }));
}

beforeEach(() => {
  vi.restoreAllMocks();
  navigate.mockReset();
  connect.mockReset();
  readyHandler = null;
  socketStatus = 'ready';
});

describe('Resuming a session', () => {
  it('says the count was picked up rather than starting from zero', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'get').mockResolvedValue({ data: ASSIGNMENT } as never);
    vi.spyOn(api, 'post').mockImplementation((async (url: string) => {
      if (url.endsWith('/pose-ticket')) {
        return { data: { ticket: 't', expiresIn: 120 } };
      }
      if (url === '/sessions') return { data: createdSession(true) };
      return { data: {} };
    }) as never);

    await startUpTo(user);
    await waitFor(() => expect(readyHandler).not.toBeNull());
    readyHandler!(readyData(6));

    // The patient must be told WHY the counter reads 6 and not 0.
    expect(
      await screen.findByText(/Picking up where you left off/),
    ).toBeTruthy();
    expect(screen.getByText(/6 repetitions already counted/)).toBeTruthy();
  });

  it('does not claim a resume on a genuinely new session', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'get').mockResolvedValue({ data: ASSIGNMENT } as never);
    vi.spyOn(api, 'post').mockImplementation((async (url: string) => {
      if (url.endsWith('/pose-ticket')) {
        return { data: { ticket: 't', expiresIn: 120 } };
      }
      if (url === '/sessions') return { data: createdSession(false) };
      return { data: {} };
    }) as never);

    await startUpTo(user);
    await waitFor(() => expect(readyHandler).not.toBeNull());
    readyHandler!(readyData(0));

    expect(screen.queryByText(/Picking up where you left off/)).toBeNull();
  });
});

describe('A session on another exercise is in the way', () => {
  function mockConflict(details: Record<string, string> | undefined) {
    vi.spyOn(api, 'get').mockResolvedValue({ data: ASSIGNMENT } as never);
    const post = vi.fn(async (url: string) => {
      if (url === '/sessions') throw conflict(details);
      return { data: {} };
    });
    vi.spyOn(api, 'post').mockImplementation(post as never);
    return post;
  }

  const DETAILS = {
    sessionId: 'sess-other',
    assignmentId: 'assign-other',
    exerciseName: 'Bicep Curl',
    status: 'ACTIVE',
    startedAt: '2026-09-12T09:15:00.000Z',
  };

  it('names the exercise that is blocking, instead of a dead end', async () => {
    const user = userEvent.setup();
    mockConflict(DETAILS);
    await startUpTo(user);

    expect(await screen.findByText('A session is already running')).toBeTruthy();
    expect(screen.getByText('Bicep Curl')).toBeTruthy();
  });

  it('offers a way back into the blocking session', async () => {
    const user = userEvent.setup();
    mockConflict(DETAILS);
    await startUpTo(user);

    await user.click(
      await screen.findByRole('button', { name: /Go back to Bicep Curl/ }),
    );
    expect(navigate).toHaveBeenCalledWith('/patient/session/assign-other', {
      replace: true,
    });
  });

  it('cancels the blocking session and then starts this one', async () => {
    const user = userEvent.setup();
    const post = mockConflict(DETAILS);
    await startUpTo(user);

    await screen.findByText('A session is already running');

    // Once cancelled, the retry must be allowed to succeed.
    post.mockImplementation(async (url: string) => {
      if (url === '/sessions') return { data: createdSession(false) };
      if (url.endsWith('/pose-ticket')) {
        return { data: { ticket: 't', expiresIn: 120 } };
      }
      return { data: {} };
    });

    await user.click(
      screen.getByRole('button', { name: 'Cancel it and start this one' }),
    );

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/sessions/sess-other/cancel'),
    );
    await waitFor(() => expect(connect).toHaveBeenCalled());
  });

  it('falls back to a plain error when the server sends no details', async () => {
    const user = userEvent.setup();
    mockConflict(undefined);
    await startUpTo(user);

    // No details means no safe action to offer, so it must not pretend to
    // have one - it degrades to the ordinary error screen.
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText('A session is already running')).toBeNull();
  });
});
