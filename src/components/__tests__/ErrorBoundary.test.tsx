// VG-13 / FE-09: before this boundary existed, ANY render error unmounted the whole tree and
// left a blank white page — no navigation, nothing to click, indistinguishable from an outage.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ErrorBoundary } from '../ErrorBoundary';

const Boom = ({ error }: { error: Error }) => {
  throw error;
};

const Fine = () => <p>working</p>;

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // React logs the caught error itself; silence it so a passing run stays readable.
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  consoleError.mockRestore();
  vi.restoreAllMocks();
});

describe('ErrorBoundary', () => {
  it('renders its children when nothing throws', () => {
    render(
      <ErrorBoundary>
        <Fine />
      </ErrorBoundary>,
    );

    expect(screen.getByText('working')).toBeInTheDocument();
  });

  it('shows a way out instead of a blank page when a child throws', () => {
    render(
      <ErrorBoundary>
        <Boom error={new Error('render exploded')} />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reload/i })).toBeInTheDocument();
    expect(screen.queryByText('working')).not.toBeInTheDocument();
  });

  it('names the real cause when the tab is running a version that was replaced', () => {
    // The most likely trigger in production: a deploy swaps the hashed chunks under an open tab,
    // and the first lazily-loaded route rejects. An apology would be wrong — a reload fixes it.
    const stale = new Error('Failed to fetch dynamically imported module: /assets/Remote-a1b2.js');
    render(
      <ErrorBoundary>
        <Boom error={stale} />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(/new version/i);
  });

  it('reloads the page when asked', () => {
    const reload = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload },
    });

    render(
      <ErrorBoundary>
        <Boom error={new Error('boom')} />
      </ErrorBoundary>,
    );
    fireEvent.click(screen.getByRole('button', { name: /reload/i }));

    expect(reload).toHaveBeenCalled();
  });

  it('clears itself when the operator navigates somewhere else', () => {
    const { rerender } = render(
      <ErrorBoundary resetKey="/devices/1">
        <Boom error={new Error('boom')} />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();

    // Same boundary instance, new route: the next page must get a chance to render, or the
    // operator would be stuck on the error until a full reload.
    rerender(
      <ErrorBoundary resetKey="/content">
        <Fine />
      </ErrorBoundary>,
    );

    expect(screen.getByText('working')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('logs the failure so it is recoverable from the browser console', () => {
    render(
      <ErrorBoundary>
        <Boom error={new Error('diagnosable')} />
      </ErrorBoundary>,
    );

    expect(consoleError).toHaveBeenCalledWith(
      'Unhandled render error',
      expect.objectContaining({ message: 'diagnosable' }),
      expect.anything(),
    );
  });
});
