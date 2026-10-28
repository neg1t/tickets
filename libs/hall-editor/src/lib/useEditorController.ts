import { useState } from 'react';
import { useUnit } from 'effector-react';
import type { HallTarget } from '@hall-platform/renderer-core';
import { createEditorModel } from './editorModel.js';
import type { HallLayoutDraft } from './editorDraft.js';
import type { EditorTool } from './editorOperations.js';

/** Owns the isolated editor model and exposes its current controller state. */
export function useEditorController(initialValue: HallLayoutDraft) {
  const [model] = useState(() => createEditorModel(initialValue));
  const [state, selection, tool, zoneId, backgroundId] = useUnit([
    model.$state,
    model.$selection,
    model.$tool,
    model.$zoneId,
    model.$backgroundId,
  ]);

  return {
    model,
    state,
    draft: state.draft,
    selection: selection as readonly HallTarget[],
    tool: tool as EditorTool,
    zoneId: zoneId as string,
    backgroundId: backgroundId as string,
  };
}
