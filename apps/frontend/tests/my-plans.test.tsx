import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../src/api/client';
import { MyPlansPage } from '../src/pages/patient/MyPlansPage';
import type { Assignment, RehabilitationPlan } from '../src/types/api';

/**
 * The patient's plan view.
 *
 * The thing under test is the STRUCTURE, not the styling: an exercise has to
 * appear underneath the plan it was prescribed in, a plan the therapist has
 * ended must not offer a way to start anything, and an exercise that predates
 * plans must still be reachable. That last one is the regression that would
 * hurt most - it would quietly remove work from a patient mid-programme.
 */

function plan(overrides: Partial<RehabilitationPlan> = {}): RehabilitationPlan {
  return {
    id: 'plan-1',
    title: 'Lower Limb Phase 2',
    goals: 'Restore knee flexion range.',
    startDate: '2026-09-01T00:00:00.000Z',
    endDate: null,
    status: 'ACTIVE',
    notes: null,
    therapistName: 'Dr Ayesha Khan',
    assignmentCount: 1,
    ...overrides,
  };
}

function assignment(overrides: Partial<Assignment> = {}): Assignment {
  return {
    id: 'assign-1',
    exercise: { slug: 'squat', name: 'Bodyweight Squat' },
    planId: 'plan-1',
    plan: { id: 'plan-1', title: 'Lower Limb Phase 2' },
    targetSets: 3,
    repsPerSet: 10,
    targetTotalReps: 30,
    goalType: 'REPS',
    holdSeconds: null,
    difficulty: 'MEDIUM',
    instructions: null,
    scheduledDays: [],
    startDate: '2026-09-01T00:00:00.000Z',
    endDate: null,
    status: 'ACTIVE',
    ...overrides,
  };
}

function mockApi(plans: RehabilitationPlan[], assignments: Assignment[]) {
  vi.spyOn(api, 'get').mockImplementation(async (url: string) => {
    if (url.includes('rehabilitation-plans')) {
      return { data: plans } as never;
    }
    return { data: assignments } as never;
  });
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <MyPlansPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('My plans', () => {
  it('nests each exercise under the plan it belongs to', async () => {
    mockApi(
      [plan(), plan({ id: 'plan-2', title: 'Shoulder Programme' })],
      [
        assignment(),
        assignment({
          id: 'assign-2',
          exercise: { slug: 'shoulder-abduction', name: 'Shoulder Abduction' },
          planId: 'plan-2',
          plan: { id: 'plan-2', title: 'Shoulder Programme' },
        }),
      ],
    );
    renderPage();

    const heading = await screen.findByText('Lower Limb Phase 2');
    // The exercise sits inside its own plan's card, not merely somewhere on
    // the page - which is the whole point of the regrouping.
    const card = heading.closest('div.rounded-card') as HTMLElement;
    expect(within(card).getByText('Bodyweight Squat')).toBeTruthy();
    expect(within(card).queryByText('Shoulder Abduction')).toBeNull();
  });

  it('shows the plan goal, so the patient knows what the exercises are for', async () => {
    mockApi([plan()], [assignment()]);
    renderPage();

    expect(await screen.findByText('Restore knee flexion range.')).toBeTruthy();
  });

  it('offers a way to start an active exercise', async () => {
    mockApi([plan()], [assignment()]);
    renderPage();

    const link = (await screen.findByText('Start session')).closest('a');
    expect(link?.getAttribute('href')).toBe('/patient/session/assign-1');
  });

  it('does not offer to start a paused exercise', async () => {
    mockApi([plan()], [assignment({ status: 'PAUSED' })]);
    renderPage();

    await screen.findByText('Bodyweight Squat');
    expect(screen.getByText('Paused')).toBeTruthy();
    expect(screen.queryByText('Start session')).toBeNull();
  });

  it('separates ended plans and offers no way to start them', async () => {
    mockApi(
      [plan({ status: 'COMPLETED' })],
      [assignment()],
    );
    renderPage();

    expect(await screen.findByText('Past plans')).toBeTruthy();
    expect(screen.getByText('Completed')).toBeTruthy();
    expect(screen.queryByText('Start session')).toBeNull();
  });

  it('still shows an exercise that has no plan behind it', async () => {
    mockApi([], [assignment({ planId: null, plan: null })]);
    renderPage();

    expect(await screen.findByText('Other exercises')).toBeTruthy();
    expect(screen.getByText('Bodyweight Squat')).toBeTruthy();
    expect(screen.getByText('Start session')).toBeTruthy();
  });

  it('hides cancelled exercises from the patient', async () => {
    mockApi([plan()], [assignment({ status: 'CANCELLED' })]);
    renderPage();

    await screen.findByText('Lower Limb Phase 2');
    expect(screen.queryByText('Bodyweight Squat')).toBeNull();
  });

  it('explains an empty plan rather than rendering a bare card', async () => {
    mockApi([plan({ assignmentCount: 0 })], []);
    renderPage();

    expect(
      await screen.findByText(/No exercises have been added to this plan yet/),
    ).toBeTruthy();
  });

  it('says so when there is no plan at all', async () => {
    mockApi([], []);
    renderPage();

    expect(await screen.findByText('No plan yet')).toBeTruthy();
  });
});
