import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import ReleaseForm from '../ReleaseForm.jsx';

// Mock API module
vi.mock('../../api/releases.js', () => ({
  releasesApi: {
    create:  vi.fn(),
    update:  vi.fn(),
    getRisk: vi.fn(),
  },
}));

import { releasesApi } from '../../api/releases.js';

beforeEach(() => {
  vi.useFakeTimers();
  releasesApi.create.mockResolvedValue({ release_id: 'rel-001' });
  releasesApi.update.mockResolvedValue({ release_id: 'rel-001' });
  releasesApi.getRisk.mockRejectedValue({ response: { status: 404 } }); // not ready
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('ReleaseForm — create mode', () => {
  it('renders all fields', () => {
    render(<ReleaseForm />);
    expect(screen.getByLabelText(/Release name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Planned date/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Owner ID/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Create Release/i })).toBeInTheDocument();
  });

  it('pre-fills date from initialDate prop', () => {
    render(<ReleaseForm initialDate="2026-07-08" />);
    const dateInput = screen.getByLabelText(/Planned date/i);
    expect(dateInput.value).toBe('2026-07-08');
  });

  it('shows error for invalid owner UUID', async () => {
    render(<ReleaseForm />);
    fireEvent.change(screen.getByLabelText(/Release name/i),  { target: { value: 'My Release' } });
    fireEvent.change(screen.getByLabelText(/Planned date/i),  { target: { value: '2026-07-08' } });
    fireEvent.change(screen.getByLabelText(/Owner ID/i),      { target: { value: 'not-a-uuid' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Create Release/i }));
    });

    // Error is set synchronously in the submit handler — no real async needed
    expect(screen.getByRole('alert')).toHaveTextContent(/UUID/i);
    expect(releasesApi.create).not.toHaveBeenCalled();
  });

  it('calls create API and starts polling on valid submit', async () => {
    render(<ReleaseForm />);
    fireEvent.change(screen.getByLabelText(/Release name/i), { target: { value: 'Payments v2.3' } });
    fireEvent.change(screen.getByLabelText(/Planned date/i), { target: { value: '2026-07-08' } });
    fireEvent.change(screen.getByLabelText(/Owner ID/i),     {
      target: { value: '22222222-2222-2222-2222-222222222222' },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Create Release/i }));
    });

    expect(releasesApi.create).toHaveBeenCalledWith({
      name: 'Payments v2.3',
      planned_date: '2026-07-08',
      owner_id: '22222222-2222-2222-2222-222222222222',
    });
    expect(screen.getByText(/Evaluating regulatory risk/i)).toBeInTheDocument();
  });

  it('shows risk result when polling succeeds', async () => {
    // Use real timers for this test — polling uses setTimeout which interacts
    // poorly with fake timers + waitFor's internal polling
    vi.useRealTimers();

    releasesApi.getRisk.mockResolvedValue({
      level: 'BLOCKED', score: 82,
      reasons: [{ window_name: 'FCA Q3 Freeze', points: 40 }],
    });

    render(<ReleaseForm />);
    fireEvent.change(screen.getByLabelText(/Release name/i), { target: { value: 'Test' } });
    fireEvent.change(screen.getByLabelText(/Planned date/i), { target: { value: '2026-07-08' } });
    fireEvent.change(screen.getByLabelText(/Owner ID/i),     {
      target: { value: '22222222-2222-2222-2222-222222222222' },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Create Release/i }));
    });

    // Wait for polling to complete (POLL_INTERVAL_MS = 2000 ms + buffer)
    await waitFor(() => {
      expect(screen.getByTestId('risk-badge')).toBeInTheDocument();
    }, { timeout: 5000 });

    expect(screen.getByText(/FCA Q3 Freeze/)).toBeInTheDocument();
  }, 8000);

  it('calls onSuccess callback after create', async () => {
    const onSuccess = vi.fn();
    render(<ReleaseForm onSuccess={onSuccess} />);
    fireEvent.change(screen.getByLabelText(/Release name/i), { target: { value: 'Test' } });
    fireEvent.change(screen.getByLabelText(/Planned date/i), { target: { value: '2026-08-01' } });
    fireEvent.change(screen.getByLabelText(/Owner ID/i),     {
      target: { value: '22222222-2222-2222-2222-222222222222' },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Create Release/i }));
    });

    expect(onSuccess).toHaveBeenCalledWith('rel-001');
  });
});

describe('ReleaseForm — edit mode', () => {
  const existingRelease = {
    release_id: 'rel-001',
    name: 'Auth Service v1.1',
    planned_date: '2026-08-15',
    status: 'draft',
    risk: null,
  };

  it('renders edit mode without name field', () => {
    render(<ReleaseForm release={existingRelease} />);
    expect(screen.queryByLabelText(/Release name/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Planned date/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Status/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Update Release/i })).toBeInTheDocument();
  });

  it('shows existing risk result when release has risk', () => {
    const releaseWithRisk = {
      ...existingRelease,
      risk: { level: 'SAFE', score: 0, reasons: [] },
    };
    render(<ReleaseForm release={releaseWithRisk} />);
    expect(screen.getByTestId('risk-badge')).toBeInTheDocument();
  });

  it('calls onCancel when X button clicked', () => {
    const onCancel = vi.fn();
    render(<ReleaseForm release={existingRelease} onCancel={onCancel} />);
    fireEvent.click(screen.getByLabelText(/Close/i));
    expect(onCancel).toHaveBeenCalled();
  });
});
