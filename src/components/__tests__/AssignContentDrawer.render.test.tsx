// Render-level tests for the Assign-Content wizard. The pure exclusion math
// lives in AssignContentDrawer.test.ts; this file drives the real component
// (Drawer / Table / Button) through to the Schedule step to pin the bugs the
// unit test couldn't see — all of which only manifest once `previewQuery` goes
// null on step 4 and the live preview hook resets:
//
//   §1  all-across → Confirm ENABLED with count N (was disabled);
//       individual subset → confirm body carries the real exclusions
//       (previewed − chosen), never [] (was a silent full-scope fan-out).
//   §2  blank schedule POSTs the year-2100 sentinel endTime, not now+24h.
//   §3  a 0-item playlist surfaces a warning.
//   §4  a truncated preview offers a working "Select all N" CTA that reaches
//       an enabled Confirm.
//   §5b a stale 409 confirm error is cleared when the drawer closes.
//
// The data hooks and the http/notify boundaries are mocked; SearchableSelect is
// stubbed with a native <select> so target/playlist picking is a plain change
// event. useAssignmentPreview is stubbed to FAITHFULLY reproduce the real
// reset: populated while the query is non-null (step 3), empty once it's null
// (step 4) — which is exactly what broke the live path.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../ui/SearchableSelect', () => ({
  SearchableSelect: ({
    label,
    options,
    value,
    onChange,
  }: {
    label: string;
    options: readonly { value: string; label: string }[];
    value: string;
    onChange: (v: string) => void;
  }) => (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => {
        onChange(e.target.value);
      }}
    >
      <option value="">--</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}));

vi.mock('@hooks/usePlaylistOptions', () => ({
  usePlaylistOptions: () => ({
    playlists: [
      { id: 1, name: 'Has Items', itemCount: 3, totalDurationSeconds: 90 },
      { id: 2, name: 'Empty One', itemCount: 0, totalDurationSeconds: 0 },
    ],
    isLoading: false,
    error: null,
    retry: () => undefined,
  }),
}));

vi.mock('@hooks/useAssignmentTargets', () => ({
  useAssignmentTargets: () => ({
    targets: [{ id: '10', name: 'North Region', deviceCount: 4 }],
    isLoading: false,
    error: null,
    retry: () => undefined,
  }),
}));

vi.mock('@hooks/useAssignmentPreview', () => ({
  useAssignmentPreview: vi.fn(),
}));

vi.mock('@api/http', () => ({
  http: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

vi.mock('@api/notify', () => ({
  notify: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
  onToast: vi.fn(() => () => undefined),
}));

import { AssignContentDrawer } from '../AssignContentDrawer';
import { useAssignmentPreview } from '@hooks/useAssignmentPreview';
import { http } from '@api/http';
import { notify } from '@api/notify';

const device = (id: string, offline = false) => ({
  id,
  name: `Device ${id}`,
  serialNumber: `SN-${id}`,
  status: offline ? 'offline' : 'online',
  offline,
  currentAssignmentId: null,
  currentPlaylistId: null,
});

const DEVICES = [device('1'), device('2'), device('3'), device('4')];

const EMPTY_PREVIEW = {
  devices: [],
  totalDevices: 0,
  returnedCount: 0,
  truncated: false,
  isLoading: false,
  error: null,
  retry: () => undefined,
};
const POPULATED_PREVIEW = {
  devices: DEVICES,
  totalDevices: 4,
  returnedCount: 4,
  truncated: false,
  isLoading: false,
  error: null,
  retry: () => undefined,
};
// 500 in scope, only 4 visible — the truncation case.
const TRUNCATED_PREVIEW = {
  ...POPULATED_PREVIEW,
  totalDevices: 500,
  returnedCount: 4,
  truncated: true,
};

// Reproduce the real hook's reset: live data on step 3 (query non-null),
// empty on step 4 (query null).
const usePreviewWith = (populated: typeof POPULATED_PREVIEW) => {
  vi.mocked(useAssignmentPreview).mockImplementation((q) => (q == null ? EMPTY_PREVIEW : populated));
};

const make409 = (message: string): unknown =>
  Object.assign(new Error('Request failed with status code 409'), {
    isAxiosError: true,
    response: { status: 409, data: { message } },
  });

// A 409 carrying the structured overlap envelope the backend now returns.
const make409Details = (message: string, details: unknown): unknown =>
  Object.assign(new Error('Request failed with status code 409'), {
    isAxiosError: true,
    response: { status: 409, data: { message, details } },
  });

// A genuine overlap 409 with a COMPLETE GlobalExceptionHandler envelope (so
// extractApiMessage WOULD return the raw `message`) whose only conflict row is
// malformed → parseOverlapDetails returns { code, conflicts: [] } (non-null,
// empty). Used to prove the confirm path still hides the id-leaking prose in
// that degraded/drift case.
const make409CompleteOverlapNoConflicts = (message: string): unknown =>
  Object.assign(new Error('Request failed with status code 409'), {
    isAxiosError: true,
    response: {
      status: 409,
      data: {
        status: 409,
        error: 'Conflict',
        message,
        correlationId: 'corr-overlap',
        timestamp: '2026-06-04T00:00:00Z',
        fieldErrors: null,
        details: { code: 'ASSIGNMENT_TIME_OVERLAP', conflicts: [{ id: 'not-a-number' }] },
      },
    },
  });

const make404 = (): unknown =>
  Object.assign(new Error('Request failed with status code 404'), {
    isAxiosError: true,
    response: { status: 404, data: { message: 'Assignment not found' } },
  });

// All POST .../confirm bodies, in call order (the normal confirm + any replace
// re-confirm). `draftBody`/`confirmBody` above find the FIRST match; these tests
// need to inspect every confirm.
const confirmBodies = (): Record<string, unknown>[] =>
  vi
    .mocked(http.post)
    .mock.calls.filter(([url]) => String(url).endsWith('/confirm'))
    .map(([, body]) => body as Record<string, unknown>);

const renderDrawer = (isOpen = true) =>
  render(<AssignContentDrawer isOpen={isOpen} onClose={() => undefined} />);

const continueBtn = () => screen.getByRole('button', { name: 'Continue' });
const confirmBtn = () => screen.getByRole('button', { name: 'Confirm' });

// On the Schedule step, opt into the explicit "start now" + "no end date"
// window — the deliberate replacement for the old silent now→2100 default.
const chooseStartNowNoEnd = () => {
  fireEvent.click(screen.getByLabelText('Start now'));
  fireEvent.click(screen.getByLabelText('No end date (run indefinitely)'));
};

// Type explicit local datetimes into the Start/End pickers (toggles left off).
const setSchedule = (startLocal: string, endLocal: string) => {
  fireEvent.change(screen.getByLabelText('Start'), { target: { value: startLocal } });
  fireEvent.change(screen.getByLabelText('End'), { target: { value: endLocal } });
};

// Step 1 (pick playlist) → 2 (pick target) → 3 (Devices).
const driveToDevices = (playlistValue = '1') => {
  fireEvent.change(screen.getByLabelText('Choose playlist'), { target: { value: playlistValue } });
  fireEvent.click(continueBtn());
  fireEvent.change(screen.getByLabelText('Choose region'), { target: { value: '10' } });
  fireEvent.click(continueBtn());
};

// Drive all the way to the Schedule step using a "Select all N" (all-across).
const driveToScheduleAllAcross = (selectAllLabel = 'Select all 4') => {
  driveToDevices();
  fireEvent.click(screen.getByRole('button', { name: selectAllLabel }));
  fireEvent.click(continueBtn());
};

// Drive to the Schedule step with an INDIVIDUAL subset (checks the given ids).
const driveToScheduleIndividual = (ids: readonly string[]) => {
  driveToDevices();
  for (const id of ids) fireEvent.click(screen.getByLabelText(`Select ${id}`));
  fireEvent.click(continueBtn());
};

const confirmBody = (): Record<string, unknown> | undefined => {
  const call = vi.mocked(http.post).mock.calls.find(([url]) => String(url).endsWith('/confirm'));
  return call?.[1] as Record<string, unknown> | undefined;
};
const draftBody = (): Record<string, unknown> | undefined => {
  const call = vi.mocked(http.post).mock.calls.find(([url]) => url === '/api/assignments');
  return call?.[1] as Record<string, unknown> | undefined;
};

beforeEach(() => {
  vi.clearAllMocks();
  usePreviewWith(POPULATED_PREVIEW);
  vi.mocked(http.post).mockResolvedValue({ data: { id: 123 } } as never);
  vi.mocked(http.delete).mockResolvedValue({ data: undefined } as never);
});

describe('AssignContentDrawer — §1 device selection survives the step 3 → 4 transition', () => {
  it('all-across: count survives to Schedule; an explicit window enables Confirm (fixes check-all → disabled)', async () => {
    renderDrawer();
    driveToScheduleAllAcross();

    expect(screen.getByText('4 devices')).toBeInTheDocument();
    // Blank schedule no longer silently submits — Confirm stays disabled until
    // the operator makes an explicit window choice.
    expect(confirmBtn()).toBeDisabled();
    chooseStartNowNoEnd();
    expect(confirmBtn()).toBeEnabled();

    fireEvent.click(confirmBtn());

    await waitFor(() => {
      expect(notify.success).toHaveBeenCalledWith('Assigned to 4 devices.');
    });
    // Whole scope, no exclusions.
    expect(confirmBody()).toEqual({ excludedDeviceIds: [] });
  });

  it('individual subset of k: confirm sends the chosen devices as includedDeviceIds (device-aware scope)', async () => {
    renderDrawer();
    driveToDevices();

    // Pick devices 1, 2, 3 — leave 4 unchecked.
    fireEvent.click(screen.getByLabelText('Select 1'));
    fireEvent.click(screen.getByLabelText('Select 2'));
    fireEvent.click(screen.getByLabelText('Select 3'));
    fireEvent.click(continueBtn());

    expect(screen.getByText('3 devices')).toBeInTheDocument();
    chooseStartNowNoEnd();
    expect(confirmBtn()).toBeEnabled();

    fireEvent.click(confirmBtn());
    await waitFor(() => {
      expect(notify.success).toHaveBeenCalledWith('Assigned to 3 devices.');
    });

    const body = confirmBody();
    const included = body?.includedDeviceIds as number[];
    expect(included).toEqual([1, 2, 3]); // exactly the chosen devices (k = 3)
    expect(included).toHaveLength(3);
    // The chosen subset reaches the backend as an inclusion list, never an
    // exclusion list — so the device-aware overlap check scopes correctly.
    expect('excludedDeviceIds' in (body ?? {})).toBe(false);
  });

  it('all-across with an unchecked row sends the non-empty exclusion list end-to-end', async () => {
    // Pins the all-across round-trip through the step 3→4 snapshot freeze and
    // postConfirm: a deliberately-excluded device must survive as
    // excludedDeviceIds:[id], never get dropped to [] (a silent full-scope
    // fan-out — the exact bug this device-scoping prevents).
    renderDrawer();
    driveToDevices();
    fireEvent.click(screen.getByRole('button', { name: 'Select all 4' })); // → all-across
    fireEvent.click(screen.getByLabelText('Select 3')); // uncheck device 3
    fireEvent.click(continueBtn());

    expect(screen.getByText('3 devices')).toBeInTheDocument();
    chooseStartNowNoEnd();
    fireEvent.click(confirmBtn());

    await waitFor(() => {
      expect(notify.success).toHaveBeenCalledWith('Assigned to 3 devices.');
    });
    expect(confirmBody()).toEqual({ excludedDeviceIds: [3] });
    expect('includedDeviceIds' in (confirmBody() ?? {})).toBe(false);
  });
});

describe('AssignContentDrawer — §2 explicit window (no silent now→2100 default)', () => {
  it('blocks Confirm with a guidance message and fires no request when both times are blank', async () => {
    renderDrawer();
    driveToScheduleAllAcross();

    // The old silent default is gone: blank required fields surface guidance
    // and Confirm is disabled, so a click can never POST.
    expect(screen.getByText(/Set a start time, or turn on/i)).toBeInTheDocument();
    expect(confirmBtn()).toBeDisabled();

    fireEvent.click(confirmBtn());
    await Promise.resolve();
    expect(http.post).not.toHaveBeenCalled();
  });

  it('only sends the year-2100 sentinel endTime when "No end date" is explicitly chosen', async () => {
    renderDrawer();
    driveToScheduleAllAcross();
    chooseStartNowNoEnd();

    fireEvent.click(confirmBtn());
    await waitFor(() => {
      expect(http.post).toHaveBeenCalledWith(
        '/api/assignments',
        expect.anything(),
        expect.anything(),
      );
    });

    const body = draftBody();
    expect(body?.endTime).toBe('2100-01-01T00:00:00.000Z');
    // "Start now" sends a concrete instant, not the sentinel.
    expect(typeof body?.startTime).toBe('string');
    expect(body?.startTime).not.toBe('2100-01-01T00:00:00.000Z');
  });
});

describe('AssignContentDrawer — §2b local datetime serializes to the correct UTC instant', () => {
  it('keeps the toISOString() conversion: 10:30 local (UTC+5) → 05:30Z', async () => {
    renderDrawer();
    driveToScheduleAllAcross();

    // Explicit future window, toggles off. The test worker runs in Asia/Tashkent
    // (UTC+5), mirroring a real user's browser.
    setSchedule('2030-06-04T10:30', '2030-06-04T12:30');
    expect(confirmBtn()).toBeEnabled();

    fireEvent.click(confirmBtn());
    await waitFor(() => {
      expect(http.post).toHaveBeenCalledWith(
        '/api/assignments',
        expect.anything(),
        expect.anything(),
      );
    });

    const body = draftBody();
    expect(body?.startTime).toBe('2030-06-04T05:30:00.000Z');
    expect(body?.endTime).toBe('2030-06-04T07:30:00.000Z');
  });
});

describe('AssignContentDrawer — §3 empty-playlist guard', () => {
  it('warns when the chosen playlist has 0 items', () => {
    renderDrawer();
    fireEvent.change(screen.getByLabelText('Choose playlist'), { target: { value: '2' } });
    expect(screen.getByText(/This playlist has 0 items/i)).toBeInTheDocument();
  });

  it('does not warn for a playlist that has items', () => {
    renderDrawer();
    fireEvent.change(screen.getByLabelText('Choose playlist'), { target: { value: '1' } });
    expect(screen.queryByText(/This playlist has 0 items/i)).not.toBeInTheDocument();
  });
});

describe('AssignContentDrawer — §4 truncated check-all does not dead-end', () => {
  it('offers a "Select all N" CTA in the truncation banner that reaches an enabled Confirm', () => {
    usePreviewWith(TRUNCATED_PREVIEW);
    renderDrawer();
    driveToDevices();

    // The banner CTA (distinct from the toolbar button by its trailing copy).
    const bannerCta = screen.getByRole('button', { name: /Select all 500 \(assign to the whole scope\)/i });
    fireEvent.click(bannerCta);

    // all-across clears the individual-subset block → Continue is enabled.
    expect(continueBtn()).toBeEnabled();
    fireEvent.click(continueBtn());

    expect(screen.getByText('500 devices')).toBeInTheDocument();
    // The truncation path is not dead-ended: an explicit window enables Confirm.
    chooseStartNowNoEnd();
    expect(confirmBtn()).toBeEnabled();
  });
});

describe('AssignContentDrawer — §5 overlap 409 falls back to a friendly message', () => {
  // The selected target is North Region (TARGET_TYPES default 'region'). The
  // raw developer string must never reach the user.
  const RAW = 'Time overlap with existing assignment(s) [3, 4] for REGION:1';

  it('falls back to a generic friendly message (not the raw string) when details are absent', async () => {
    vi.mocked(http.post).mockImplementation((url: string) =>
      url.endsWith('/confirm')
        ? Promise.reject(make409(RAW))
        : Promise.resolve({ data: { id: 123 } } as never),
    );

    const onClose = vi.fn();
    const { rerender } = render(<AssignContentDrawer isOpen onClose={onClose} />);
    driveToScheduleAllAcross();
    chooseStartNowNoEnd();
    fireEvent.click(confirmBtn());

    // Generic-but-friendly, never the raw developer string.
    const friendly = await screen.findByText(/already has overlapping content scheduled/i);
    expect(friendly).toBeInTheDocument();
    expect(screen.queryByText(RAW)).not.toBeInTheDocument();

    // §5b: close + reopen must clear the stale confirm error.
    rerender(<AssignContentDrawer isOpen={false} onClose={onClose} />);
    rerender(<AssignContentDrawer isOpen onClose={onClose} />);

    vi.mocked(http.post).mockResolvedValue({ data: { id: 123 } } as never);
    driveToScheduleAllAcross();
    expect(screen.queryByText(/already has overlapping content scheduled/i)).not.toBeInTheDocument();
  });

  it('hides the id-leaking prose even when a complete overlap envelope has no usable conflicts', async () => {
    // Degraded/drift case: a real ASSIGNMENT_TIME_OVERLAP 409 with a full
    // envelope (extractApiMessage would return RAW) but conflict rows the FE
    // parser drops → parseOverlapDetails returns { code, conflicts: [] }. The
    // confirm path must keep the generic copy, never the raw "[3, 4]" prose.
    vi.mocked(http.post).mockImplementation((url: string) =>
      url.endsWith('/confirm')
        ? Promise.reject(make409CompleteOverlapNoConflicts(RAW))
        : Promise.resolve({ data: { id: 123 } } as never),
    );

    render(<AssignContentDrawer isOpen onClose={() => undefined} />);
    driveToScheduleAllAcross();
    chooseStartNowNoEnd();
    fireEvent.click(confirmBtn());

    expect(
      await screen.findByText(/already has overlapping content scheduled/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(RAW)).not.toBeInTheDocument();
    expect(screen.queryByText(/Time overlap/i)).not.toBeInTheDocument();
  });
});

describe('AssignContentDrawer — §6 Replace existing & assign', () => {
  // REGION:1 is blocked by open-ended assignment #6 (Korzinka promo, end =
  // year-2100 sentinel). 14:37Z → 19:37 Tashkent (UTC+5).
  const CONFLICT = {
    id: 6,
    playlistId: 9,
    playlistName: 'Korzinka promo',
    status: 'CONFIRMED',
    startTime: '2026-06-04T14:37:00Z',
    endTime: '2100-01-01T00:00:00.000Z',
  };
  const DETAILS = {
    code: 'ASSIGNMENT_TIME_OVERLAP',
    targetType: 'REGION',
    targetId: 10,
    conflicts: [CONFLICT],
  };
  const RAW = 'Time overlap with existing assignment(s) [6] for REGION:1';

  // First confirm always 409s with the enriched conflict; the replace re-confirm
  // (no flag) is governed by `reconfirmOk`, the atomic confirm by `atomicOk`.
  const wireOverlap = (opts: { atomicOk?: boolean; reconfirmOk?: boolean } = {}) => {
    let noFlagConfirms = 0;
    vi.mocked(http.post).mockImplementation((url: string, body?: unknown) => {
      if (url === '/api/assignments') return Promise.resolve({ data: { id: 123 } } as never);
      if (url.endsWith('/confirm')) {
        const b = (body ?? {}) as Record<string, unknown>;
        if (b.replaceConflicting === true) {
          return opts.atomicOk
            ? Promise.resolve({ data: { id: 123 } } as never)
            : Promise.reject(make409Details(RAW, DETAILS));
        }
        noFlagConfirms += 1;
        // 1st no-flag confirm = the original (409); a later one = the fallback
        // re-confirm after cancelling, which succeeds when reconfirmOk.
        return noFlagConfirms === 1 || !opts.reconfirmOk
          ? Promise.reject(make409Details(RAW, DETAILS))
          : Promise.resolve({ data: { id: 123 } } as never);
      }
      return Promise.resolve({ data: {} } as never);
    });
  };

  const driveToPanel = async () => {
    driveToScheduleAllAcross();
    chooseStartNowNoEnd();
    fireEvent.click(confirmBtn());
    await screen.findByText('Korzinka promo');
  };

  const openReplaceDialog = async () => {
    fireEvent.click(screen.getByRole('button', { name: /Replace existing/i }));
    return screen.findByRole('button', { name: 'Replace & assign' });
  };

  it('renders each conflict (playlist name + localized window) and both actions; hides the raw string', async () => {
    wireOverlap();
    renderDrawer();
    await driveToPanel();

    expect(screen.getByText('Korzinka promo')).toBeInTheDocument();
    // 14:37Z → 19:37 Tashkent; the year-2100 sentinel renders as "No end date".
    const windowEl = screen.getByText(/19:37/);
    expect(windowEl).toHaveTextContent('No end date');
    expect(screen.getByRole('button', { name: /Replace existing/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Choose a different time/i })).toBeInTheDocument();
    // Raw developer string never shown.
    expect(screen.queryByText(RAW)).not.toBeInTheDocument();
    expect(screen.queryByText(/Time overlap/i)).not.toBeInTheDocument();
  });

  it('requires an explicit confirmation naming what is removed and what replaces it', async () => {
    wireOverlap({ atomicOk: true });
    renderDrawer();
    await driveToPanel();
    await openReplaceDialog();

    expect(screen.getByText(/This will remove the existing booking/i)).toBeInTheDocument();
    // Conflict name (removed) and the new playlist (replacement), both in the dialog.
    expect(screen.getByText('Korzinka promo', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByText('Has Items', { selector: 'strong' })).toBeInTheDocument();
  });

  it('atomic path: confirms with replaceConflicting:true and never cancels', async () => {
    wireOverlap({ atomicOk: true });
    const onClose = vi.fn();
    render(<AssignContentDrawer isOpen onClose={onClose} />);
    await driveToPanel();
    fireEvent.click(await openReplaceDialog());

    await waitFor(() => {
      expect(notify.success).toHaveBeenCalledWith(
        'Replaced existing content — assigned to 4 devices.',
      );
    });
    expect(confirmBodies().some((b) => b.replaceConflicting === true)).toBe(true);
    expect(http.delete).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('fallback path: cancels the conflict then re-confirms when the atomic flag is not honored', async () => {
    wireOverlap({ atomicOk: false, reconfirmOk: true });
    const onClose = vi.fn();
    render(<AssignContentDrawer isOpen onClose={onClose} />);
    await driveToPanel();
    fireEvent.click(await openReplaceDialog());

    await waitFor(() => {
      expect(notify.success).toHaveBeenCalledWith(
        'Replaced existing content — assigned to 4 devices.',
      );
    });
    // cancelAssignment(6) was issued, and a fresh (no-flag) confirm followed.
    expect(http.delete).toHaveBeenCalledWith('/api/assignments/6', expect.anything());
    expect(confirmBodies().filter((b) => b.replaceConflicting !== true).length).toBe(2);
    expect(onClose).toHaveBeenCalled();
  });

  it('completes the assign even if cancelling the conflict 404s (already removed)', async () => {
    wireOverlap({ atomicOk: false, reconfirmOk: true });
    vi.mocked(http.delete).mockRejectedValue(make404() as never);
    const onClose = vi.fn();
    render(<AssignContentDrawer isOpen onClose={onClose} />);
    await driveToPanel();
    fireEvent.click(await openReplaceDialog());

    await waitFor(() => {
      expect(notify.success).toHaveBeenCalledWith(
        'Replaced existing content — assigned to 4 devices.',
      );
    });
    expect(http.delete).toHaveBeenCalledWith('/api/assignments/6', expect.anything());
    // 404 swallowed → the re-confirm still ran and the assign completed.
    expect(onClose).toHaveBeenCalled();
  });

  it('"Choose a different time" dismisses the overlap and keeps the wizard on scheduling', async () => {
    wireOverlap();
    renderDrawer();
    await driveToPanel();

    fireEvent.click(screen.getByRole('button', { name: /Choose a different time/i }));

    expect(screen.queryByText('Korzinka promo')).not.toBeInTheDocument();
    // Schedule choice (start-now / no-end) is intact, so Confirm is usable again.
    expect(confirmBtn()).toBeEnabled();
  });
});

describe('AssignContentDrawer — §7 device-aware overlap', () => {
  // A conflict that names WHICH of the operator's selected devices clash.
  const deviceAwareDetails = {
    code: 'ASSIGNMENT_TIME_OVERLAP',
    targetType: 'REGION',
    targetId: 10,
    conflicts: [
      {
        id: 6,
        playlistId: 9,
        playlistName: 'Korzinka toshkent',
        status: 'CONFIRMED',
        startTime: '2026-06-04T14:37:00Z', // 19:37 Tashkent
        endTime: '2100-01-01T00:00:00.000Z', // sentinel → "No end date"
        conflictingDeviceIds: [1, 2], // 2 of the 3 selected devices
      },
    ],
  };
  const RAW = 'Time overlap with existing assignment(s) [6] for REGION:1';

  it('names how many of the selected devices clash, with the playlist + localized window', async () => {
    vi.mocked(http.post).mockImplementation((url: string) =>
      url.endsWith('/confirm')
        ? Promise.reject(make409Details(RAW, deviceAwareDetails))
        : Promise.resolve({ data: { id: 123 } } as never),
    );

    renderDrawer();
    driveToScheduleIndividual(['1', '2', '3']); // individual → M = 3 concrete devices
    chooseStartNowNoEnd();
    fireEvent.click(confirmBtn());

    // Device-aware header: 2 of the 3 selected devices clash.
    expect(
      await screen.findByText(/2 of your 3 selected devices already have content scheduled/i),
    ).toBeInTheDocument();
    expect(screen.getByText('Korzinka toshkent')).toBeInTheDocument();
    expect(screen.getByText(/19:37/)).toHaveTextContent('No end date');
    // Raw developer string still never reaches the user.
    expect(screen.queryByText(/Time overlap/i)).not.toBeInTheDocument();
    // Both actions remain available.
    expect(screen.getByRole('button', { name: /Replace existing/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Choose a different time/i })).toBeInTheDocument();
  });

  it('disjoint subset confirms (200) → success and the drawer closes', async () => {
    // Default mock resolves confirm: a subset disjoint from existing
    // assignments simply succeeds (no device-aware overlap).
    const onClose = vi.fn();
    render(<AssignContentDrawer isOpen onClose={onClose} />);
    driveToScheduleIndividual(['1', '2', '3']);
    chooseStartNowNoEnd();
    fireEvent.click(confirmBtn());

    await waitFor(() => {
      expect(notify.success).toHaveBeenCalledWith('Assigned to 3 devices.');
    });
    expect(onClose).toHaveBeenCalled();
    // The chosen subset was sent as an inclusion list.
    expect(confirmBody()).toEqual({ includedDeviceIds: [1, 2, 3] });
  });

  it('denominator M is the SELECTED count, not the target total', async () => {
    // Select only 2 of the 4 previewed devices; conflict hits 1 of them. M must
    // read 2 (the chosen scope), never 4 (target total) or 3.
    const details = {
      ...deviceAwareDetails,
      conflicts: [{ ...deviceAwareDetails.conflicts[0], conflictingDeviceIds: [1] }],
    };
    vi.mocked(http.post).mockImplementation((url: string) =>
      url.endsWith('/confirm')
        ? Promise.reject(make409Details(RAW, details))
        : Promise.resolve({ data: { id: 123 } } as never),
    );

    renderDrawer();
    driveToScheduleIndividual(['1', '2']); // M = 2 selected (of 4 previewed)
    chooseStartNowNoEnd();
    fireEvent.click(confirmBtn());

    expect(
      await screen.findByText(/1 of your 2 selected devices already has content scheduled/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/of your 4 selected/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/of your 3 selected/i)).not.toBeInTheDocument();
  });

  it('all-across with conflicting devices drops the (unreliable) denominator', async () => {
    // All-across selectedCount counts unseen devices, so the header must NOT
    // print "of your N selected devices" — just the clash count.
    vi.mocked(http.post).mockImplementation((url: string) =>
      url.endsWith('/confirm')
        ? Promise.reject(make409Details(RAW, deviceAwareDetails)) // conflictingDeviceIds [1,2]
        : Promise.resolve({ data: { id: 123 } } as never),
    );

    renderDrawer();
    driveToScheduleAllAcross();
    chooseStartNowNoEnd();
    fireEvent.click(confirmBtn());

    expect(
      await screen.findByText(/2 of your selected devices already have content scheduled/i),
    ).toBeInTheDocument();
    // No numeric denominator in all-across mode.
    expect(screen.queryByText(/of your \d+ selected devices/i)).not.toBeInTheDocument();
  });

  it('counts the DEDUPED union of conflicting devices across multiple conflicts', async () => {
    // Two conflicts share device 2: {1,2} ∪ {2,3} = {1,2,3} → 3, not a naive
    // 2+2=4 sum.
    const details = {
      code: 'ASSIGNMENT_TIME_OVERLAP',
      targetType: 'REGION',
      targetId: 10,
      conflicts: [
        {
          id: 6,
          playlistName: 'Morning Loop',
          startTime: '2026-06-04T14:37:00Z',
          endTime: '2026-06-04T18:00:00Z',
          conflictingDeviceIds: [1, 2],
        },
        {
          id: 7,
          playlistName: 'Evening Loop',
          startTime: '2026-06-04T14:37:00Z',
          endTime: '2100-01-01T00:00:00.000Z',
          conflictingDeviceIds: [2, 3],
        },
      ],
    };
    vi.mocked(http.post).mockImplementation((url: string) =>
      url.endsWith('/confirm')
        ? Promise.reject(make409Details(RAW, details))
        : Promise.resolve({ data: { id: 123 } } as never),
    );

    renderDrawer();
    driveToScheduleIndividual(['1', '2', '3']); // M = 3
    chooseStartNowNoEnd();
    fireEvent.click(confirmBtn());

    expect(
      await screen.findByText(/3 of your 3 selected devices already have content scheduled/i),
    ).toBeInTheDocument();
    // A naive per-conflict sum would read "4 of your 3" — must not happen.
    expect(screen.queryByText(/4 of your/i)).not.toBeInTheDocument();
    // Both conflicting playlists are listed.
    expect(screen.getByText('Morning Loop')).toBeInTheDocument();
    expect(screen.getByText('Evening Loop')).toBeInTheDocument();
  });
});

describe('AssignContentDrawer — DS-4 preview status labels share the device mapping', () => {
  it('renders NO_CONTENT and UNREGISTERED preview devices with distinct labels (not a catch-all)', () => {
    // The preview API emits the real Device.Status enum names; the drawer must
    // route them through the shared mapper, same as the device list/detail.
    usePreviewWith({
      ...POPULATED_PREVIEW,
      devices: [
        { ...device('1'), status: 'NO_CONTENT', offline: false },
        { ...device('2'), status: 'UNREGISTERED', offline: false },
      ],
      totalDevices: 2,
      returnedCount: 2,
    });
    renderDrawer();
    driveToDevices();

    expect(screen.getByText('No content')).toBeInTheDocument();
    expect(screen.getByText('Unregistered')).toBeInTheDocument();
    // The invented 'degraded' label must never appear.
    expect(screen.queryByText('Degraded')).not.toBeInTheDocument();
  });
});
