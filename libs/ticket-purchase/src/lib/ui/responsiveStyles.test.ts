import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const stylesheet = await readFile(new URL('../../../styles.css', import.meta.url), 'utf8');
const mobileStyles =
  stylesheet.split('@media (max-width: 800px) {')[1]?.split('@media (max-width: 380px) {')[0] ?? '';
const narrowStyles = stylesheet.split('@media (max-width: 380px) {')[1] ?? '';

describe('purchase widget responsive shell', () => {
  it('hides the four-step progress indicator on mobile while retaining the shell title', () => {
    expect(mobileStyles).toMatch(/\.ticket-purchase \.tp-stepper\s*\{\s*display:\s*none;\s*\}/);
    expect(mobileStyles).not.toMatch(/\.ticket-purchase \.tp-layout__title\s*\{[^}]*display:\s*none/s);
  });

  it('keeps 20px horizontal shell padding at 360px viewport width', () => {
    expect(mobileStyles).toContain('padding: 24px 20px 48px;');
    expect(narrowStyles).not.toMatch(/\.ticket-purchase \.tp-layout\s*\{[^}]*padding-inline:\s*16px/s);
  });
});
