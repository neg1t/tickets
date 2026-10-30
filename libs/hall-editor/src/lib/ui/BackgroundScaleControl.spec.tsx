// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BackgroundScaleControl } from './BackgroundScaleControl.js';

describe('BackgroundScaleControl', () => {
  it('commits a percentage from the range as one change', () => {
    const onCommit = vi.fn();
    const onPreview = vi.fn();
    render(<BackgroundScaleControl value={100} disabled={false} onCommit={onCommit} onPreview={onPreview} />);
    const range = screen.getByRole('slider', { name: 'Масштаб подложки' });
    expect(range).toHaveAttribute('min', '10');
    fireEvent.change(range, { target: { value: '200' } });
    expect(onPreview).toHaveBeenCalledWith(200);
    fireEvent.pointerUp(range);
    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit).toHaveBeenCalledWith(200);
    expect(onPreview).toHaveBeenLastCalledWith(null);
  });

  it('cancels a dragged preview without adding an undoable change', () => {
    const onCommit = vi.fn();
    const onPreview = vi.fn();
    render(<BackgroundScaleControl value={100} disabled={false} onCommit={onCommit} onPreview={onPreview} />);
    const range = screen.getByRole('slider', { name: 'Масштаб подложки' });
    fireEvent.change(range, { target: { value: '250' } });
    fireEvent.pointerCancel(range);
    expect(onCommit).not.toHaveBeenCalled();
    expect(onPreview).toHaveBeenLastCalledWith(null);
  });

  it('supports a precise value outside the initial range', () => {
    const onCommit = vi.fn();
    render(<BackgroundScaleControl value={100} disabled={false} onCommit={onCommit} />);
    const input = screen.getByRole('spinbutton', { name: 'Масштаб подложки' });
    fireEvent.change(input, { target: { value: '1250.5' } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith(1250.5);
    expect(screen.getByRole('slider')).toHaveAttribute('max', '1300');
  });

  it('commits an Enter submission only once', () => {
    const onCommit = vi.fn();
    render(<BackgroundScaleControl value={100} disabled={false} onCommit={onCommit} />);
    const input = screen.getByRole('spinbutton', { name: 'Масштаб подложки' });
    fireEvent.change(input, { target: { value: '150' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit).toHaveBeenCalledWith(150);
  });

  it('disables all controls for locked backgrounds', () => {
    render(<BackgroundScaleControl value={100} disabled onCommit={vi.fn()} />);
    expect(screen.getByRole('slider')).toBeDisabled();
    expect(screen.getByRole('spinbutton')).toBeDisabled();
  });
});
