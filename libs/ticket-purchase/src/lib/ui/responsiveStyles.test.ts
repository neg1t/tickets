import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const stylesheet = await readFile(new URL('../../../styles.css', import.meta.url), 'utf8');
const widgetRootStyles = stylesheet.match(/(?:^|\n)\.ticket-purchase\s*\{([^}]*)\}/)?.[1] ?? '';
const mobileStyles =
  stylesheet.split('@media (max-width: 800px) {')[1]?.split('@media (max-width: 380px) {')[0] ?? '';
const narrowStyles = stylesheet.split('@media (max-width: 380px) {')[1] ?? '';
const mobileGridAreas = mobileStyles.match(/grid-template-areas:\s*([\s\S]*?);/)?.[1] ?? '';
const mobileLayoutStyles =
  mobileStyles.match(/\.ticket-purchase \.tp-layout\s*\{([^}]*)\}/)?.[1] ?? '';
const mobileBackStyles =
  mobileStyles.match(/\.ticket-purchase \.tp-layout__back\s*\{([^}]*)\}/)?.[1] ?? '';

describe('purchase widget responsive shell', () => {
  it('sets a white surface on the widget root without styling the host page', () => {
    expect(widgetRootStyles).toMatch(/background:\s*var\(--tp-color-surface\);/);
    expect(stylesheet).not.toMatch(/(?:^|\n)\s*(?:body|html|:root)\s*\{/);
  });

  it('hides the four-step progress indicator on mobile while retaining the shell title', () => {
    expect(mobileStyles).toMatch(/\.ticket-purchase \.tp-stepper\s*\{\s*display:\s*none;\s*\}/);
    expect(mobileStyles).not.toMatch(/\.ticket-purchase \.tp-layout__title\s*\{[^}]*display:\s*none/s);
  });

  it('keeps 20px side padding and 48px top spacing at 360px viewport width', () => {
    expect(mobileLayoutStyles).toContain('padding: 48px 20px 48px;');
    expect(narrowStyles).not.toMatch(/\.ticket-purchase \.tp-layout\s*\{[^}]*padding-inline:\s*16px/s);
  });

  it('centers the mobile back link with 16px regular text', () => {
    expect(mobileBackStyles).toMatch(/justify-content:\s*center;/);
    expect(mobileBackStyles).toMatch(/font-size:\s*16px;/);
    expect(mobileBackStyles).toMatch(/font-weight:\s*400;/);
  });

  it('removes the sidebar grid row on mobile while retaining the event summary', () => {
    expect(mobileGridAreas).not.toContain('sidebar');
    expect(mobileGridAreas).toContain('summary');
    expect(mobileStyles).toMatch(/\.ticket-purchase \.tp-layout__sidebar\s*\{[^}]*display:\s*none/s);
  });
});
