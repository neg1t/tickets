import { useCallback, useEffect, useMemo, useState } from 'react';
import type { HallLayoutDraft } from '../editorDraft.js';
import {
  validateLayoutImmediate,
  type LayoutIssue,
} from './validateLayout.js';
import {
  createLayoutValidationController,
  validateLatestDraft,
} from './validationController.js';

type LayoutDiagnosticsOptions = Readonly<{
  onError?: (error: Error) => void;
  getLatestDraft: () => HallLayoutDraft;
}>;

/** Owns debounced diagnostics and latest-draft publication validation. */
export function useLayoutDiagnostics(
  draft: HallLayoutDraft,
  { onError, getLatestDraft }: LayoutDiagnosticsOptions,
) {
  const [controller] = useState(() => createLayoutValidationController());
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fullValidation, setFullValidation] = useState<{
    draft: HallLayoutDraft;
    issues: LayoutIssue[];
  } | null>(null);
  const immediateIssues = useMemo(
    () => validateLayoutImmediate(draft),
    [draft],
  );
  const hasCurrentFullValidation = fullValidation?.draft === draft;
  const issues = hasCurrentFullValidation
    ? fullValidation.issues
    : immediateIssues;
  const report = useCallback(
    (cause: unknown) => {
      const failure = cause instanceof Error ? cause : new Error(String(cause));
      setErrorMessage(failure.message);
      onError?.(failure);
    },
    [onError],
  );
  const clearError = useCallback(() => setErrorMessage(null), []);

  useEffect(() => {
    controller.activate();
    controller.schedule(draft, setFullValidation, report);
  }, [controller, draft, report]);

  useEffect(() => () => controller.dispose(), [controller]);

  return {
    errorMessage,
    report,
    clearError,
    issues,
    hasCurrentFullValidation,
    validationPending: !hasCurrentFullValidation,
    hasBlockingIssues: issues.some((issue) => issue.severity === 'error'),
    hasWarnings: issues.some((issue) => issue.severity === 'warning'),
    validateLatest: () => validateLatestDraft(controller, getLatestDraft),
  };
}
