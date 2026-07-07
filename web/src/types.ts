// バックエンド §9 契約に対応する型 (フロント側)。

export type AppState = "idle" | "processing_subs" | "processing_main";

export type SSEPhase = "routing" | "nodes" | "synth" | "verify";

export type NodeStatus = "ok" | "timeout" | "parse_error" | "error" | "skipped";

export interface NodeView {
  id: string;
  status: NodeStatus;
  points: string[];
  confidence: number;
}

export interface AnalyzeMeta {
  route: "simple" | "normal" | "complex";
  quorum: string;
  fallback: boolean;
  verified: "pass" | "modified";
  totalCost: number;
  ms: number;
  quotaUsed: number | null;
  warnings?: string[];
}

export interface DonePayload {
  answer: string;
  summary: string;
  nodes: NodeView[];
  meta: AnalyzeMeta;
}

export interface AnalyzeRequestBody {
  input: string;
  summary?: string;
  mode?: "auto" | "simple" | "normal" | "complex";
  clientId: string;
}
