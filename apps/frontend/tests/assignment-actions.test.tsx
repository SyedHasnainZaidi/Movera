import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PatientDetailPage } from '../src/pages/therapist/PatientDetailPage';
import { api } from '../src/api/client';
import type { Assignment } from '../src/types/api';

/**
 * Therapist assignment management.
 *
 * The important behaviour is that the confirmation tells the TRUTH. Removing an
 * assignment that has recorded sessions archives it and keeps the history;
 * removing one with no sessions deletes it outright. Promising a deletion that
 * will not happen would be a lie the therapist acts on, so the wording is
 * pinned here rather than left to drift.
 */

vi.mock('react-router-dom', async () => {
  const actual =
    await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useParams: () => ({ patientId: 'patient-1' }) };
});

function assignment(overrides: Partial<Assignment> = {}): Assignment {
  return {
    id: 'a1',
    exercise: { slug: 'bicep-curl', name: 'Bicep Curl' } as Assignment['exercise'],
    targetSets: 3,
    repsPerSet: 12,
    targetTotalReps: 36,
    goalType: 'REPS',
    holdSeconds: null,
    difficulty: 'EASY' as Assignment['difficulty'],
    instructions: null,
    scheduledDays: [],
    startDate: '2026-08-01',
    endDate: null,
    status: 'ACTIVE',
    sessionCount: 0,
    ...overrides,
  };
}

const DETAIL = {
  id: 'patient-1',
  firstName: 'Ahmed',
  lastName: 'Raza',
  email: 'a@example.com',
  conditionSummary: null,
  activePlan: null,
};

function mockApi(assignments: Assignment[]) {
  vi.spyOn(api, 'get').mockImplementation(async (url: string) => {
    if (url.includes('/assignments')) return { data: assignments } as never;
    if (url.includes('/sessions')) {
      return { data: { data: [], meta: { total: 0 } } } as never;
    }
    if (url.includes('/exercises')) return { data: [] } as never;
    return { data: DETAIL } as never;
  });
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PatientDetailPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('Assignment actions', () => {
  it('offers Pause and Remove on an active assignment', async () => {
    mockApi([assignment()]);
    renderPage();

    expect(await screen.findByRole('button', { name: 'Pause' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy();
  });

  it('offers Resume on a paused assignment, so the same one can be reused', async () => {
    mockApi([assignment({ status: 'PAUSED' })]);
    renderPage();

    expect(await screen.findByRole('button', { name: 'Resume' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
  });

  it('collapses archived assignments out of the current list', async () => {
    mockApi([assignment({ status: 'CANCELLED', sessionCount: 4 })]);
    renderPage();

    // Hidden by default: "removing" an exercise that stays on screen would not
    // be much of a removal.
    expect(
      await screen.findByRole('button', { name: /1 archived exercise/ }),
    ).toBeTruthy();
    expect(screen.queryByText('Bicep Curl')).toBeNull();
  });

  it('offers only Reopen on an archived assignment', async () => {
    const user = userEvent.setup();
    mockApi([assignment({ status: 'CANCELLED', sessionCount: 4 })]);
    renderPage();

    await user.click(
      await screen.findByRole('button', { name: /1 archived exercise/ }),
    );

    expect(screen.getByText('Bicep Curl')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reopen' })).toBeTruthy();
    // Archiving is already done; pausing or removing again is meaningless.
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
  });

  it('reopening an archived assignment sets it back to ACTIVE', async () => {
    const user = userEvent.setup();
    mockApi([assignment({ status: 'CANCELLED', sessionCount: 4 })]);
    const patch = vi.spyOn(api, 'patch').mockResolvedValue({ data: {} } as never);
    renderPage();

    await user.click(
      await screen.findByRole('button', { name: /1 archived exercise/ }),
    );
    await user.click(screen.getByRole('button', { name: 'Reopen' }));

    // Same assignment id - the patient continues on it, keeping one record
    // rather than gaining a duplicate prescription.
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('/assignments/a1', {
        status: 'ACTIVE',
      }),
    );
  });

  it('keeps current and archived assignments apart', async () => {
    mockApi([
      assignment({ id: 'a1', status: 'ACTIVE' }),
      assignment({
        id: 'a2',
        status: 'CANCELLED',
        sessionCount: 9,
        exercise: {
          slug: 'squat',
          name: 'Bodyweight Squat',
        } as Assignment['exercise'],
      }),
    ]);
    renderPage();

    // The active one is listed; the archived one is behind the toggle.
    expect(await screen.findByText('Bicep Curl')).toBeTruthy();
    expect(screen.queryByText('Bodyweight Squat')).toBeNull();
    expect(
      screen.getByRole('button', { name: /1 archived exercise/ }),
    ).toBeTruthy();
  });

  it('says DELETE when the assignment has no recorded sessions', async () => {
    const user = userEvent.setup();
    mockApi([assignment({ sessionCount: 0 })]);
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Remove' }));

    const dialog = screen.getByRole('alertdialog');
    expect(dialog.textContent).toContain('Delete "Bicep Curl"?');
    expect(dialog.textContent).toContain('deleted outright');
    expect(dialog.textContent).toContain('Nothing is kept');
    expect(screen.getByRole('button', { name: 'Delete it' })).toBeTruthy();
  });

  it('says ARCHIVE when the assignment has recorded sessions', async () => {
    const user = userEvent.setup();
    mockApi([assignment({ sessionCount: 18 })]);
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Remove' }));

    const dialog = screen.getByRole('alertdialog');
    expect(dialog.textContent).toContain('Archive "Bicep Curl"?');
    expect(dialog.textContent).toContain('18 recorded sessions');
    expect(dialog.textContent).toContain('history is kept');
    expect(screen.getByRole('button', { name: 'Archive it' })).toBeTruthy();
    // Never promises deletion for something that will be retained.
    expect(dialog.textContent).not.toContain('Nothing is kept');
  });

  it('pluralises a single session correctly', async () => {
    const user = userEvent.setup();
    mockApi([assignment({ sessionCount: 1 })]);
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Remove' }));
    expect(screen.getByRole('alertdialog').textContent).toContain(
      '1 recorded session.',
    );
  });

  it('"Keep it" cancels without calling the API', async () => {
    const user = userEvent.setup();
    mockApi([assignment()]);
    const del = vi.spyOn(api, 'delete');
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Remove' }));
    await user.click(screen.getByRole('button', { name: 'Keep it' }));

    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(del).not.toHaveBeenCalled();
  });

  it('confirming issues the DELETE request', async () => {
    const user = userEvent.setup();
    mockApi([assignment()]);
    const del = vi
      .spyOn(api, 'delete')
      .mockResolvedValue({ data: { message: 'ok' } } as never);
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Remove' }));
    await user.click(screen.getByRole('button', { name: 'Delete it' }));

    await waitFor(() => expect(del).toHaveBeenCalledWith('/assignments/a1'));
  });

  it('surfaces a refusal instead of pretending it worked', async () => {
    const user = userEvent.setup();
    mockApi([assignment()]);
    vi.spyOn(api, 'delete').mockRejectedValue(
      Object.assign(new Error('live'), {
        isAxiosError: true,
        response: {
          data: {
            code: 'SESSION_ALREADY_LIVE',
            message: 'The patient is currently doing this exercise.',
          },
        },
      }),
    );
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Remove' }));
    await user.click(screen.getByRole('button', { name: 'Delete it' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
  });

  it('shows the session count on the row', async () => {
    mockApi([assignment({ sessionCount: 18 })]);
    renderPage();
    expect(await screen.findByText(/18 sessions recorded/)).toBeTruthy();
  });
});
