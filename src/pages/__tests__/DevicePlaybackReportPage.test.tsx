import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// jsdom doesn't implement scrollIntoView; SearchableSelect calls it when its
// panel opens to keep the highlighted option in view.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

vi.mock('@hooks/useDeviceOptions', () => ({ useDeviceOptions: vi.fn() }));
vi.mock('@hooks/useDevicePlaybackReport', () => ({ useDevicePlaybackReport: vi.fn() }));

import { useDeviceOptions } from '@hooks/useDeviceOptions';
import { useDevicePlaybackReport } from '@hooks/useDevicePlaybackReport';
import type { PlaybackReportResponse } from '@api/resources/playbackReport';
import { DevicePlaybackReportPage } from '../DevicePlaybackReportPage';

type ReportResult = ReturnType<typeof useDevicePlaybackReport>;

const setHooks = (report: Partial<ReportResult>): void => {
  vi.mocked(useDeviceOptions).mockReturnValue({
    options: [{ value: 42, label: 'Lobby' }],
    isLoading: false,
    error: null,
    retry: vi.fn(),
  });
  vi.mocked(useDevicePlaybackReport).mockReturnValue({
    data: null,
    isLoading: false,
    error: null,
    notFound: false,
    retry: vi.fn(),
    ...report,
  });
};

const report = (over: Partial<PlaybackReportResponse> = {}): PlaybackReportResponse => ({
  scope: { type: 'DEVICE', id: 42, name: 'Lobby' },
  from: '',
  to: '',
  totalPlayCount: 720,
  totalDurationSeconds: 3661,
  durationComplete: true,
  perContent: [
    {
      contentFileId: 7,
      contentFileName: 'Summer Promo',
      playCount: 420,
      totalDurationSeconds: 12600,
      durationComplete: true,
    },
  ],
  ...over,
});

const renderPage = () =>
  render(
    <MemoryRouter>
      <DevicePlaybackReportPage />
    </MemoryRouter>,
  );

const TOOLTIP = 'Some plays did not report a duration; the total is a minimum.';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DevicePlaybackReportPage', () => {
  it('shows totals (H:MM:SS + minutes) and the per-content table', () => {
    setHooks({ data: report() });
    renderPage();

    expect(screen.getByText('720 plays total')).toBeInTheDocument();
    expect(screen.getByText(/Total time 1:01:01 \(61 min\)/)).toBeInTheDocument();
    expect(screen.getByText('Summer Promo')).toBeInTheDocument();
    expect(screen.getByText('420')).toBeInTheDocument();
    expect(screen.getByText('3:30:00')).toBeInTheDocument(); // 12600s
  });

  it('renders the empty state and zeroed totals for an empty window', () => {
    setHooks({
      data: report({ totalPlayCount: 0, totalDurationSeconds: 0, perContent: [] }),
    });
    renderPage();

    expect(screen.getByText('0 plays total')).toBeInTheDocument();
    expect(screen.getByText(/Total time 0:00 \(0 min\)/)).toBeInTheDocument();
    expect(screen.getByText('No playback in this range')).toBeInTheDocument();
  });

  it('marks incomplete durations with a ≥ tooltip (totals + row)', () => {
    setHooks({
      data: report({
        durationComplete: false,
        totalDurationSeconds: 0,
        perContent: [
          {
            contentFileId: 9,
            contentFileName: 'Store Hours',
            playCount: 300,
            totalDurationSeconds: 0,
            durationComplete: false,
          },
        ],
      }),
    });
    renderPage();

    expect(screen.getAllByTitle(TOOLTIP).length).toBeGreaterThanOrEqual(2);
  });

  it('renders the device-not-found message and no table on 404', () => {
    setHooks({ data: null, notFound: true });
    renderPage();

    expect(screen.getByText('Device not found.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('disables Apply (and fires no request) when the range is invalid', () => {
    setHooks({ data: null });
    const { container } = renderPage();

    // Pick a device so only the range gates Apply.
    fireEvent.focus(screen.getByRole('combobox'));
    fireEvent.mouseDown(screen.getByText('Lobby'));

    const applyBtn = screen.getByRole('button', { name: 'Apply' });
    expect(applyBtn).not.toBeDisabled();

    const fromInput = container.querySelector('#oa-playback-from') as HTMLInputElement;
    fireEvent.change(fromInput, { target: { value: '2099-01-01' } });
    expect(applyBtn).toBeDisabled();

    // The applied filter was never set, so the report hook only ever saw null.
    expect(vi.mocked(useDevicePlaybackReport).mock.calls.every((c) => c[0] === null)).toBe(true);
  });
});
