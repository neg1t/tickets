import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { backgroundSchema, worldPointSchema } from '@hall-platform/domain';
import { ToolsPanel } from './ToolsPanel.js';
import { LayersPanel } from './LayersPanel.js';
import { PropertiesPanel, PropertyField } from './PropertiesPanel.js';
import { HallEditor } from '../HallEditor.js';
import { PdfHallViewer } from '../PdfHallViewer.js';
import { createEmptyDraft } from '../editorDraft.js';
import { createObjectAt } from '../editorOperations.js';
import { applyEditorCommand, createEditorState } from '../editorCommands.js';
import {
  RowGenerationControls,
  TableGenerationControls,
} from './GenerationControls.js';
import { EditorLocaleContext } from './editorI18n.js';

describe('editor panel localization', () => {
  it('renders English action and panel names', () => {
    const tools = renderToStaticMarkup(
      createElement(ToolsPanel, {
        activeTool: 'select',
        readonly: false,
        locale: 'en',
        onSelect: () => undefined,
      }),
    );
    const layers = renderToStaticMarkup(
      createElement(LayersPanel, {
        mobilePanel: 'tools',
        locale: 'en',
        onClose: () => undefined,
        children: 'Floor',
      }),
    );
    const properties = renderToStaticMarkup(
      createElement(PropertiesPanel, {
        mobileOpen: true,
        locale: 'en',
        onClose: () => undefined,
        children: 'Seat',
      }),
    );
    expect(tools).toContain('aria-label="Select"');
    expect(layers).toContain('>Tools</h3>');
    expect(properties).toContain('>Properties</h3>');
  });

  it('renders the editor shell in English when locale is en', () => {
    const draft = createEmptyDraft('Demo');
    const markup = renderToStaticMarkup(
      createElement(HallEditor, {
        value: {
          ...draft,
          snapshot: {
            ...draft.snapshot,
            floors: draft.snapshot.floors.map((floor) => ({
              ...floor,
              name: 'Ground',
            })),
          },
        },
        locale: 'en',
        onChange: () => undefined,
      }),
    );
    expect(markup).toContain('aria-label="Hall editor Demo"');
    expect(markup).toContain('>Undo</button>');
    expect(markup).toContain('>Floors</h3>');
    expect(markup.match(/.{0,40}[А-Яа-я].{0,40}/g)).toEqual(null);
  });

  it('keeps Russian labels when locale is omitted', () => {
    const markup = renderToStaticMarkup(
      createElement(HallEditor, {
        value: createEmptyDraft('Demo'),
        onChange: () => undefined,
      }),
    );
    expect(markup).toContain('>Отменить</button>');
    expect(markup).toContain('>Этажи</h3>');
  });

  it('localizes the PDF background loading status', () => {
    const draft = createEmptyDraft('Demo');
    const background = backgroundSchema.parse({
      id: 'background-1',
      floorId: draft.snapshot.floors[0]?.id,
      order: 0,
      position: worldPointSchema.parse({ x: 0, y: 0 }),
      scale: 1,
      rotationRadians: 0,
      opacity: 1,
      visible: true,
      locked: false,
      source: { kind: 'pdf' as const, assetId: 'plan', pageNumber: 1 },
    });
    const withPdf = {
      ...draft,
      snapshot: {
        ...draft.snapshot,
        backgrounds: [background],
      },
    };
    const markup = renderToStaticMarkup(
      createElement(PdfHallViewer, { draft: withPdf, locale: 'en' }),
    );
    expect(markup).toContain('Background: loading…');
    expect(markup).not.toContain('Подложка');
  });

  it('renders row and table generation controls in English', () => {
    let state = createEditorState(createEmptyDraft('Demo'));
    state = applyEditorCommand(
      state,
      createObjectAt(state.draft, 'row-line', { x: 0, y: 0 }).command,
    );
    state = applyEditorCommand(
      state,
      createObjectAt(state.draft, 'table-circle', { x: 0, y: 0 }).command,
    );
    const row = state.draft.snapshot.rows[0];
    const table = state.draft.snapshot.tables[0];
    if (!row || !table) throw new Error('Missing furniture');
    const rowMarkup = renderToStaticMarkup(
      createElement(EditorLocaleContext.Provider, {
        value: 'en',
        children: createElement(RowGenerationControls, {
          row,
          seatCount: 8,
          readonly: false,
          onPreview: () => undefined,
          onApply: () => undefined,
        }),
      }),
    );
    const tableMarkup = renderToStaticMarkup(
      createElement(EditorLocaleContext.Provider, {
        value: 'en',
        children: createElement(TableGenerationControls, {
          table,
          readonly: false,
          onPreview: () => undefined,
          onApply: () => undefined,
        }),
      }),
    );
    expect(rowMarkup).toContain('>Seat generation</legend>');
    expect(rowMarkup).toContain('aria-label="Seats in row"');
    expect(tableMarkup).toContain('>Table seats</legend>');
    expect(rowMarkup).not.toMatch(/[А-Яа-я]/);
    expect(tableMarkup).not.toMatch(/[А-Яа-я]/);
  });

  it('translates selected-object property labels and mixed values', () => {
    const markup = renderToStaticMarkup(
      createElement(EditorLocaleContext.Provider, {
        value: 'en',
        children: createElement(PropertyField, {
          label: 'Ширина зоны',
          value: null,
          onCommit: () => undefined,
        }),
      }),
    );
    expect(markup).toContain('aria-label="Zone width"');
    expect(markup).toContain('placeholder="Mixed values"');
  });
});
