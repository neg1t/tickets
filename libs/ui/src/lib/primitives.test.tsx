import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Button, Dialog, Field, Menu } from './primitives.js';

describe('UI primitives', () => {
  it('keeps disabled button actions inert', () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>Publish</Button>);
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('connects a field label and error to its input', () => {
    render(<Field label="Hall name" error="Name is required" />);
    const input = screen.getByRole('textbox', { name: 'Hall name' });
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe(screen.getByText('Name is required').id);
  });

  it('closes a dialog with Escape and returns focus to its trigger', () => {
    function Example() {
      const [open, setOpen] = useState(false);
      return <><button onClick={() => setOpen(true)}>Open</button><Dialog open={open} title="Settings" onClose={() => setOpen(false)}><button>Save</button></Dialog></>;
    }
    render(<Example />);
    const trigger = screen.getByRole('button', { name: 'Open' });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Settings' }).contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('opens a menu by keyboard and closes it with Escape', () => {
    render(<Menu label="Actions"><button role="menuitem">Duplicate</button></Menu>);
    const trigger = screen.getByRole('button', { name: 'Actions' });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
