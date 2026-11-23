import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssignmentDetail, PoseUpdateData } from '../src/types/api';
import { FeedbackBanner } from '../src/features/session/SessionHud';
import { withSide } from '../src/lib/side';

/**
 * Choosing a side for a side-specific exercise.
 *
 * Left and right are separate sessions. The patient has to choose before the
 * camera starts, the choice is sent to the server (which decides which
 * landmarks are analysed), and exercises without a side are unchanged.
 */

const connect = vi.fn();

vi.mock('../src/features/session/usePoseSocket', () => ({
  usePoseSocket: () => ({
    status: 'ready',
    error: null,
    connect,
    disconnect: vi.fn(),
    sendFrame: vi.fn(),
    isBusy: () => false,
    reset: vi.fn(),
  }),
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

vi.mock('react-router-dom', async () => {
  const actual =
    await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ assignmentId: 'assign-knee' }),
    useNavigate: () => vi.fn(),
  };
});

import { api } from '../src/api/client';
import { LiveSessionPage } from '../src/pages/patient/LiveSessionPage';

function assignment(sideMode: 'LIMB' | 'NONE' | 'DIRECTION'): AssignmentDetail {
  return {
    id: 'assign-knee',
    exercise: { slug: 'knee-extension', name: 'Knee Extension' },
    targetSets: 3,
    repsPerSet: 10,
    targetTotalReps: 30,
    goalType: 'REPS',
    holdSeconds: null,
    difficulty: 'EASY',
    instructions: null,
    scheduledDays: [],
    startDate: '2026-11-01',
    endDate: null,
    status: 'ACTIVE',
    exerciseDetail: {
      slug: 'knee-extension',
      name: 'Knee Extension',
      description: 'Straighten the knee.',
      instructions: 'Sit and straighten.',
      recommendedView: 'SIDE',
      framingInstructions: 'Sit side-on.',
      targetBodyArea: 'Knee',
      goalType: 'REPS',
      sideMode,
    },
    therapistName: 'Ayesha Khan',
    completedSessions: 2,
    completedSessionsBySide: { LEFT: 2, RIGHT: 0 },
  };
}

function mockApi(detail: AssignmentDetail) {
  vi.spyOn(api, 'get').mockResolvedValue({ data: detail } as never);
  return vi.spyOn(api, 'post').mockImplementation((async (url: string) => {
    if (url.endsWith('/pose-ticket')) {
      return { data: { ticket: 't', expiresIn: 120 } };
    }
    if (url === '/sessions') {
      return {
        data: {
          id: 'sess-1',
          status: 'CREATED',
          resumed: false,
          exercise: detail.exerciseDetail,
          side: 'RIGHT',
          goalType: 'REPS',
          targetSets: 3,
          repsPerSet: 10,
          targetTotalReps: 30,
          targetHoldSec: null,
          ruleConfigVersion: 1,
          startedAt: new Date().toISOString(),
        },
      };
    }
    return { data: {} };
  }) as never);
}

function renderPage() {
  render(
    <MemoryRouter>
      <LiveSessionPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  connect.mockReset();
});

describe('Side selection', () => {
  it('requires a side before the camera can be enabled', async () => {
    mockApi(assignment('LIMB'));
    renderPage();

    const enable = await screen.findByRole('button', { name: 'Enable camera' });
    expect(enable).toHaveProperty('disabled', true);
    expect(screen.getByText('Which side are you exercising?')).toBeTruthy();
    expect(screen.getByText('Choose a side above to continue.')).toBeTruthy();
  });

  it('shows each side with its own completed-session count', async () => {
    mockApi(assignment('LIMB'));
    renderPage();

    const left = await screen.findByRole('radio', { name: /Left side/ });
    const right = screen.getByRole('radio', { name: /Right side/ });
    expect(left.textContent).toContain('2 completed sessions');
    // Doing the left leg twice does NOT count towards the right one.
    expect(right.textContent).toContain('0 completed sessions');
  });

  it('sends the chosen side when the session starts', async () => {
    const user = userEvent.setup();
    const post = mockApi(assignment('LIMB'));
    renderPage();

    await user.click(await screen.findByRole('radio', { name: /Right side/ }));
    expect(
      screen.getByRole('radio', { name: /Right side/ }).getAttribute('aria-checked'),
    ).toBe('true');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'Knee Extension (right)',
    );

    await user.click(screen.getByRole('button', { name: 'Enable camera' }));
    await user.click(await screen.findByRole('button', { name: 'Start session' }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/sessions', {
        assignmentId: 'assign-knee',
        side: 'RIGHT',
      }),
    );
    expect(connect).toHaveBeenCalledWith('t');
  });

  it('asks about direction for a neck bend', async () => {
    mockApi(assignment('DIRECTION'));
    renderPage();
    expect(await screen.findByText('Which way will you bend?')).toBeTruthy();
    expect(screen.getByRole('radio', { name: /Towards the left/ })).toBeTruthy();
  });

  it('leaves exercises without a side exactly as before', async () => {
    const user = userEvent.setup();
    const post = mockApi(assignment('NONE'));
    renderPage();

    const enable = await screen.findByRole('button', { name: 'Enable camera' });
    expect(enable).toHaveProperty('disabled', false);
    expect(screen.queryByRole('radiogroup')).toBeNull();

    await user.click(enable);
    await user.click(await screen.findByRole('button', { name: 'Start session' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/sessions', {
        assignmentId: 'assign-knee',
      }),
    );
  });
});

describe('Exercise-specific movement cues', () => {
  it('shows the exercise cue when there is nothing to correct', () => {
    render(
      <FeedbackBanner
        error={null}
        postureCorrect
        hasPose
        guidance="Keep bending forward - move further."
      />,
    );
    expect(screen.getByText('Keep bending forward - move further.')).toBeTruthy();
  });

  it('always lets a correction take priority over the cue', () => {
    const error: PoseUpdateData['errors'][number] = {
      code: 'WRONG_CAMERA_VIEW',
      severity: 'critical',
      message: 'Incorrect camera position - stand side-on. Counting is paused.',
    };
    render(
      <FeedbackBanner
        error={error}
        postureCorrect={false}
        hasPose
        guidance="Keep bending forward - move further."
      />,
    );
    expect(screen.getByText(/Incorrect camera position/)).toBeTruthy();
    expect(screen.queryByText('Keep bending forward - move further.')).toBeNull();
  });

  it('falls back to the generic encouragement without a cue', () => {
    render(<FeedbackBanner error={null} postureCorrect hasPose />);
    expect(screen.getByText('Good form - keep going.')).toBeTruthy();
  });
});

describe('withSide', () => {
  it('labels a sided session and leaves others alone', () => {
    expect(withSide('Elbow Extension', 'LEFT')).toBe('Elbow Extension (left)');
    expect(withSide('Bodyweight Squat', null)).toBe('Bodyweight Squat');
    expect(withSide('Bodyweight Squat', undefined)).toBe('Bodyweight Squat');
  });
});
