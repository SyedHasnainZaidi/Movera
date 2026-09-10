import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PatientsPage } from '../src/pages/therapist/PatientsPage';
import { PatientDetailPage } from '../src/pages/therapist/PatientDetailPage';
import { api } from '../src/api/client';
import type { CaseloadPatient } from '../src/types/api';

/**
 * Discharging a patient.
 *
 * The behaviour that matters is that the therapist is told the truth before
 * pressing it: nothing is deleted, but their ACCESS ends. Archived patients
 * stay visible as a record that the relationship existed, without being
 * clickable - the route behind them would only return 403.
 */

const navigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual =
    await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ patientId: 'patient-1' }),
    useNavigate: () => navigate,
  };
});

function archived(overrides: Partial<CaseloadPatient> = {}): CaseloadPatient {
  return {
    patientProfileId: 'p-old',
    name: 'Sana Malik',
    email: 'sana@example.com',
    conditionSummary: null,
    isPrimary: false,
    linkedAt: '2026-05-01T00:00:00.000Z',
    archivedAt: '2026-08-20T00:00:00.000Z',
    activePlan: null,
    totalSessions: 12,
    lastSessionAt: null,
    lastSessionScore: null,
    ...overrides,
  };
}

const page = <T,>(rows: T[]) => ({
  data: rows,
  meta: {
    page: 1,
    limit: 50,
    total: rows.length,
    totalPages: 1,
    hasNext: false,
  },
});

function renderWith(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  navigate.mockReset();
});

describe('Archived patients list', () => {
  function mockCaseload(activeRows: CaseloadPatient[], archivedRows: CaseloadPatient[]) {
    vi.spyOn(api, 'get').mockImplementation(async (url: string) => {
      if (url.includes('scope=archived')) {
        return { data: page(archivedRows) } as never;
      }
      return { data: page(activeRows) } as never;
    });
  }

  it('is hidden entirely when nothing is archived', async () => {
    mockCaseload([], []);
    renderWith(<PatientsPage />);

    await screen.findByText('Patients');
    expect(screen.queryByText(/Archived patients/)).toBeNull();
  });

  it('shows a collapsed count when patients are archived', async () => {
    mockCaseload([], [archived()]);
    renderWith(<PatientsPage />);

    expect(
      await screen.findByRole('button', { name: /Archived patients \(1\)/ }),
    ).toBeTruthy();
    // Collapsed: the name is not on screen yet.
    expect(screen.queryByText('Sana Malik')).toBeNull();
  });

  it('reveals name, retained sessions and discharge date when opened', async () => {
    const user = userEvent.setup();
    mockCaseload([], [archived()]);
    renderWith(<PatientsPage />);

    await user.click(
      await screen.findByRole('button', { name: /Archived patients \(1\)/ }),
    );

    expect(screen.getByText('Sana Malik')).toBeTruthy();
    expect(screen.getByText(/12 sessions kept/)).toBeTruthy();
    // The row's discharge date, not the section header - match on the date.
    expect(screen.getByText(/^Archived \d/)).toBeTruthy();
  });

  it('does not link through to an archived patient', async () => {
    const user = userEvent.setup();
    mockCaseload([], [archived()]);
    renderWith(<PatientsPage />);

    await user.click(
      await screen.findByRole('button', { name: /Archived patients \(1\)/ }),
    );

    // Access ended with the link, so offering the route would be misleading.
    const row = screen.getByText('Sana Malik').closest('a');
    expect(row).toBeNull();
  });
});

describe('Archiving a patient', () => {
  const DETAIL = {
    id: 'patient-1',
    firstName: 'Ahmed',
    lastName: 'Raza',
    email: 'ahmed@example.com',
    conditionSummary: null,
    activePlan: null,
  };

  function mockDetail() {
    vi.spyOn(api, 'get').mockImplementation(async (url: string) => {
      if (url.includes('/assignments')) return { data: [] } as never;
      if (url.includes('/sessions')) {
        return { data: page([]) } as never;
      }
      if (url.includes('/exercises')) return { data: [] } as never;
      return { data: DETAIL } as never;
    });
  }

  it('offers an Archive patient action', async () => {
    mockDetail();
    renderWith(<PatientDetailPage />);
    expect(
      await screen.findByRole('button', { name: 'Archive patient' }),
    ).toBeTruthy();
  });

  it('warns that access ends and that nothing is deleted', async () => {
    const user = userEvent.setup();
    mockDetail();
    renderWith(<PatientDetailPage />);

    await user.click(
      await screen.findByRole('button', { name: 'Archive patient' }),
    );

    const dialog = screen.getByRole('alertdialog');
    expect(dialog.textContent).toContain('Archive Ahmed Raza?');
    expect(dialog.textContent).toContain('nothing is deleted');
    expect(dialog.textContent).toContain('you lose access to their records');
    expect(dialog.textContent).toContain('invite code');
  });

  it('Cancel makes no request', async () => {
    const user = userEvent.setup();
    mockDetail();
    const del = vi.spyOn(api, 'delete');
    renderWith(<PatientDetailPage />);

    await user.click(
      await screen.findByRole('button', { name: 'Archive patient' }),
    );
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(del).not.toHaveBeenCalled();
  });

  it('confirming calls the unlink endpoint and returns to the caseload', async () => {
    const user = userEvent.setup();
    mockDetail();
    const del = vi
      .spyOn(api, 'delete')
      .mockResolvedValue({ data: { message: 'archived' } } as never);
    renderWith(<PatientDetailPage />);

    await user.click(
      await screen.findByRole('button', { name: 'Archive patient' }),
    );
    // The confirm button inside the dialog, not the one that opened it.
    await user.click(
      screen.getByRole('alertdialog').querySelector('button')!,
    );

    await waitFor(() =>
      expect(del).toHaveBeenCalledWith('/therapists/me/patients/patient-1'),
    );
    // Staying on a page whose data is no longer readable would only error.
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith('/therapist/patients', {
        replace: true,
      }),
    );
  });

  it('surfaces a refusal instead of navigating away', async () => {
    const user = userEvent.setup();
    mockDetail();
    vi.spyOn(api, 'delete').mockRejectedValue(
      Object.assign(new Error('nope'), {
        isAxiosError: true,
        response: {
          data: {
            code: 'LINK_NOT_FOUND',
            message: 'You are not linked to this patient.',
          },
        },
      }),
    );
    renderWith(<PatientDetailPage />);

    await user.click(
      await screen.findByRole('button', { name: 'Archive patient' }),
    );
    await user.click(
      screen.getByRole('alertdialog').querySelector('button')!,
    );

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();
  });
});
