import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { createEmptyDraft, HallEditor } from '@hall-platform/hall-editor';

vi.mock('@hall-platform/renderer-konva', () => ({
  HallViewer: (props: {
    onCanvasClick?: (point: { x: number; y: number }, target: null) => void;
    onObjectsMove?: () => void;
  }) => (
    <div>
      <button
        type="button"
        onClick={() => props.onCanvasClick?.({ x: 1, y: 1 }, null)}
      >
        Canvas tap
      </button>
      <span>{props.onObjectsMove ? 'Drag enabled' : 'Drag blocked'}</span>
    </div>
  ),
}));

describe('readonly editor interaction', () => {
  it('blocks canvas creation and drag even when a creation tool was already active', () => {
    const draft = createEmptyDraft('Readonly hall');
    const onChange = vi.fn();
    const { rerender } = render(
      <HallEditor value={draft} onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^Место$/ }));
    rerender(<HallEditor value={draft} readonly onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Canvas tap' }));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText('Drag blocked')).toBeTruthy();
  });
});
