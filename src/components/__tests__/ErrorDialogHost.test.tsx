// Render tests for ErrorDialogHost — the modal sibling of the Toaster that
// surfaces global business-error dialogs. Drives the real errorDialog channel
// (the host subscribes to it in a useEffect) so the wiring is covered end to end.

import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

import { ErrorDialogHost } from '../ErrorDialogHost';
import { errorDialog } from '@api/errorDialog';

describe('ErrorDialogHost', () => {
  it('renders nothing until an error is emitted', () => {
    render(<ErrorDialogHost />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the backend message, status and correlation id, then dismisses', () => {
    render(<ErrorDialogHost />);

    act(() => {
      errorDialog.show({
        status: 409,
        title: "This action can't be completed",
        message: 'Device 9 is not assigned to any playlist — assign a playlist first.',
        correlationId: '49259d97-7392-409c',
      });
    });

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/Device 9 is not assigned to any playlist/)).toBeInTheDocument();
    expect(screen.getByText('Error 409')).toBeInTheDocument();
    expect(screen.getByText(/Ref: 49259d97-7392-409c/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('omits the reference line when there is no correlation id', () => {
    render(<ErrorDialogHost />);
    act(() => {
      errorDialog.show({ status: 422, title: 'T', message: 'no-ref-case', correlationId: null });
    });
    expect(screen.getByText('Error 422')).toBeInTheDocument();
    expect(screen.queryByText(/Ref:/)).not.toBeInTheDocument();
  });

  it('queues multiple errors and shows them one at a time', () => {
    render(<ErrorDialogHost />);

    act(() => {
      errorDialog.show({ status: 409, title: 'First', message: 'first conflict', correlationId: null });
      errorDialog.show({ status: 422, title: 'Second', message: 'second problem', correlationId: null });
    });

    expect(screen.getByText('first conflict')).toBeInTheDocument();
    expect(screen.queryByText('second problem')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(screen.getByText('second problem')).toBeInTheDocument();
    expect(screen.queryByText('first conflict')).not.toBeInTheDocument();
  });
});
