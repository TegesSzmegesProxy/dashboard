import { createContext, useContext, type Dispatch } from 'react';
import type { AnalysisEndpoint, CompiledEndpoint, ReviewWarning, ToolDefinition } from '../../api';
import type { DraftAction, DraftState, Target } from '../../policy/draft';

export interface EditorCtx {
  tools: ToolDefinition[];
  tool: (id: string) => ToolDefinition | undefined;
  /** False in view mode: everything renders read-only. */
  editing: boolean;
  /** In view mode this holds the version itself. */
  draft: DraftState;
  dispatch: Dispatch<DraftAction>;
  /** Analysis facts per `METHOD path`, when the version has an analysis lineage. */
  facts: Map<string, AnalysisEndpoint>;
  warnings: (t: Target) => ReviewWarning[];
  /** Compiles the target's edited text; resolves null when the request failed. */
  compile: (t: Target) => Promise<CompiledEndpoint | null>;
}

export const EditorContext = createContext<EditorCtx | null>(null);

export function useEditor(): EditorCtx {
  const c = useContext(EditorContext);
  if (!c) throw new Error('useEditor outside PolicyEditor');
  return c;
}
