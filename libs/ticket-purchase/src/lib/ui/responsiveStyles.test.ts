import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const stylesheet = await readFile(new URL('../../../styles.css', import.meta.url), 'utf8');
const widgetRootStyles = stylesheet.match(/(?:^|\n)\.ticket-purchase\s*\{([^}]*)\}/)?.[1] ?? '';
const desktopStyles = stylesheet.split('@media (max-width: 800px) {')[0] ?? '';
const mobileStyles =
  stylesheet.split('@media (max-width: 800px) {')[1]?.split('@media (max-width: 380px) {')[0] ?? '';
const narrowStyles = stylesheet.split('@media (max-width: 380px) {')[1] ?? '';
const desktopLayoutStyles = desktopStyles.match(/\.ticket-purchase \.tp-layout\s*\{([^}]*)\}/)?.[1] ?? '';
const desktopSidebarStyles =
  desktopStyles.match(/\.ticket-purchase \.tp-layout__sidebar\s*\{([^}]*)\}/)?.[1] ?? '';
const desktopEventSummaryStyles =
  desktopStyles.match(/\.ticket-purchase \.tp-event-summary\s*\{([^}]*)\}/)?.[1] ?? '';
const mobileGridAreas = mobileStyles.match(/grid-template-areas:\s*([\s\S]*?);/)?.[1] ?? '';
const mobileLayoutStyles =
  mobileStyles.match(/\.ticket-purchase \.tp-layout\s*\{([^}]*)\}/)?.[1] ?? '';
const mobileBackStyles =
  mobileStyles.match(/\.ticket-purchase \.tp-layout__back\s*\{([^}]*)\}/)?.[1] ?? '';
const mobileEventSummaryStyles =
  mobileStyles.match(/\.ticket-purchase \.tp-event-summary\s*\{([^}]*)\}/)?.[1] ?? '';
const mobilePosterStyles =
  mobileStyles.match(/\.ticket-purchase \.tp-event-summary__poster\s*\{([^}]*)\}/)?.[1] ?? '';

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
    expect(mobileStyles).toMatch(/\.ticket-purchase \.tp-layout__sidebar\s*\{[^}]*grid-area:\s*summary;/s);
    expect(mobileStyles).toMatch(/\.ticket-purchase \.tp-stepper\s*\{\s*display:\s*none;\s*\}/);
  });

  it('uses one bordered desktop sidebar card for progress and the event summary', () => {
    expect(desktopLayoutStyles).toMatch(/'sidebar header'[\s\S]*'sidebar content'/);
    expect(desktopSidebarStyles).toMatch(/border:\s*1px solid var\(--tp-color-border\);/);
    expect(desktopEventSummaryStyles).toMatch(/border:\s*0;/);
    expect(desktopEventSummaryStyles).toMatch(/background:\s*transparent;/);
  });

  it('keeps a 272px inner event-summary width and 72x54 poster geometry at 360px', () => {
    expect(mobileLayoutStyles).toContain('padding: 48px 20px 48px;');
    expect(mobileEventSummaryStyles).toContain('gap: 20px;');
    expect(mobileEventSummaryStyles).toContain('padding: 24px;');
    expect(mobilePosterStyles).toContain('width: 72px;');
    expect(mobilePosterStyles).toContain('height: 54px;');
    expect(narrowStyles).not.toMatch(/\.ticket-purchase \.tp-event-summary\s*\{/);
  });
});
