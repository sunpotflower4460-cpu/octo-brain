import type { ThoughtTrace } from "../../lib/cognition";
import type { AnalyzeMeta, NodeView } from "../../types";

export interface ResonateResult {
  label: string;
  answer: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sourceInput?: string; // この回答を生んだユーザー入力(深化・共鳴で使う)
  nodes?: NodeView[];
  meta?: AnalyzeMeta;
  trace?: ThoughtTrace;
  streaming?: boolean;
  errored?: boolean;
  errorMessage?: string;
  deepened?: { answer: string; axis: string };
  deepenError?: string;
  resonances?: ResonateResult[];
  resonateError?: string;
}
