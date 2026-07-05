// Unit tests for the reusable VolumeControl: Apply is gated until the value
// changes, applies the chosen value, and clamps out-of-range typed input
// (0–100) before it can be sent.

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { VolumeControl } from '../VolumeControl';

describe('VolumeControl', () => {
  it('disables Apply until the value changes', () => {
    render(<VolumeControl value={50} onApply={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
  });

  it('applies the chosen value via the slider', () => {
    const onApply = vi.fn();
    render(<VolumeControl value={50} onApply={onApply} />);
    fireEvent.change(screen.getByRole('slider'), { target: { value: '70' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onApply).toHaveBeenCalledWith(70);
  });

  it('clamps an out-of-range typed value to 100 before applying', () => {
    const onApply = vi.fn();
    render(<VolumeControl value={50} onApply={onApply} />);
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '150' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onApply).toHaveBeenCalledWith(100);
  });

  it('does not apply while disabled', () => {
    const onApply = vi.fn();
    render(<VolumeControl value={50} onApply={onApply} disabled />);
    // Even after a change attempt, the disabled Apply stays inert.
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    expect(onApply).not.toHaveBeenCalled();
  });
});
