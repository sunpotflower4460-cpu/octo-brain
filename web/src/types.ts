// バックエンド契約に対応する型 (フロント側)。docs/01_depth_design.md / 00_architecture.md §9。

export type AppState = "idle" | "processing_subs" | "processing_main";

export type SSEPhase = "routing" | "nodes" | "synth" | "verify";

export type NodeStatus = "ok" | "timeout" | "parse_error" | "error" | "skipped";

export type Plan = "light" | "deep";

// ノードの意見 (opinions形式, §4.1)
export interface Opinion {
  claim: string;
  weight: number;
  why: string;
}

export interface NodeView {
  id: string;
  status: NodeStatus;
  opinions: Opinion[];
}

// 最緊張軸 (§5)
export interface Tension {
  axis: string;
  reason: string;
}

export interface AnalyzeMeta {
  plan: Plan;
  domain: string;
  quorum: string;
  fallback: boolean;
  tension: Tension | null;
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
  plan?: Plan;
  clientId: string;
}

// 深化 (P1.5 §6)
export interface DeepenRequestBody {
  input: string;
  summary?: string;
  tension: { axis: string };
  priorAnswer: string;
  clientId: string;
}

export interface DeepenResponse {
  answer: string;
  meta: { axis: string; calls: number; totalCost: number; ms: number };
}
