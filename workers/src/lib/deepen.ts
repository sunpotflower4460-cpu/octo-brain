// 深化(深掘り)= タコの腕間結合 (docs/01_depth_design.md §6)。
// 最緊張軸の対角2腕に互いの元レポートを渡して再考させ、中央脳が織り直す。
// 1パス目(analyze)は独立並列のまま。深化だけ対角2本が実際に"対話"する。
// 全コールは callModel 経由・原価ログを通す(絶対ルール5)。

import { callModel } from "./callModel.js";
import {
  buildNodeUserText,
  parseNodeResponse,
} from "./runNodes.js";
import {
  axisByLabel,
  nodeDef,
  nodeSystemPrompt,
  type NodeId,
} from "../config/nodes.js";
import { pickNodeModel } from "../config/models.js";
import { CostCollector, logCost } from "./costlog.js";
import type { Env, NodeResult, Opinion } from "../types.js";

export interface DeepenInput {
  input: string;
  summary: string;
  tension: { axis: string };
  priorAnswer: string;
  clientId: string;
}

export interface DeepenDeps {
  env: Env;
  now: Date;
  requestId: string;
}

export interface DeepenResponse {
  answer: string;
  meta: {
    axis: string;
    calls: number;
    totalCost: number;
    ms: number;
  };
}

// tension.axis が既知の軸に解決できるか。index.ts のガードで使う。
export function resolveAxis(axisLabelText: string) {
  return axisByLabel(axisLabelText);
}

// 再考の1腕分(固定テンプレ。相手レポートは user 側)。
function reconsiderSystem(selfVerb: string): string {
  return `あなたはOctoBrainの分析レンズ。自分のタスクを保ちつつ、対角の相手の意見を読んで再考する。
あなたのタスク: ${selfVerb}
次を簡潔に述べよ: (a)相手を読んでも譲れない自分の核心 (b)相手を読んで見方が変わった点。
出力は次のJSONのみ。前置き禁止: {"keep":"80字以内","changed":"80字以内"}`;
}

const DEEPEN_SYNTH_SYSTEM = `あなたはOctoBrainの中央脳。ある緊張軸の対角2腕が、互いの意見を読んで再考した結果を受け取る。
それらを織り直し、以前の回答より一段深い——この人の状況にしか当てはまらない——回答を1つ生成せよ。
- 2腕がどこで譲らず、どこで歩み寄ったかを、緊張ごと一つの理解に溶かす
- 一般論は書かない。腕のIDや「腕Aによると」のような機械的引用もしない。自然な文章に溶かす
- 断定は根拠の強さに比例させる
- 最後に、次の一歩をひとつ置く`;

interface Reconsidered {
  keep: string;
  changed: string;
}

export async function runDeepen(
  req: DeepenInput,
  deps: DeepenDeps,
): Promise<DeepenResponse> {
  const started = deps.now.getTime();
  const axis = axisByLabel(req.tension.axis);
  if (!axis) {
    throw new Error(`unknown_axis: ${req.tension.axis}`);
  }
  const collector = new CostCollector();
  const [idA, idB] = axis.lenses;

  // 1. 対角2腕の元レポートを取得(この入力に対する各腕の意見)
  const [baseA, baseB] = await Promise.all([
    runLens(idA, req, deps.env, collector),
    runLens(idB, req, deps.env, collector),
  ]);

  // 2. 互いの意見を渡して再考(2コール・Flash)
  const [reconA, reconB] = await Promise.all([
    reconsider(idA, idB, baseB.opinions, req, deps.env, collector, 0),
    reconsider(idB, idA, baseA.opinions, req, deps.env, collector, 1),
  ]);

  // 3. 中央脳が2つの再考を受けて織り直す
  const answer = await weave(axis.label, reconA, reconB, idA, idB, req, deps.env, collector);

  // 原価ログ(絶対ルール5)
  try {
    await logCost(
      deps.env.OCTO_KV,
      deps.requestId,
      collector,
      { quorum: "deepen", fallback: false },
      deps.now,
    );
  } catch {
    // KV書き込み失敗は非致命(回答は返す)
  }

  return {
    answer,
    meta: {
      axis: axis.label,
      calls: collector.calls.length,
      totalCost: collector.totalCost(),
      ms: Date.now() - started,
    },
  };
}

async function runLens(
  id: NodeId,
  req: DeepenInput,
  env: Env,
  collector: CostCollector,
): Promise<NodeResult> {
  const def = nodeDef(id);
  try {
    const res = await callModel(
      "node",
      [
        { role: "system", content: nodeSystemPrompt(def) },
        { role: "user", content: buildNodeUserText(req.input, req.summary) },
      ],
      { env, collector },
    );
    return parseNodeResponse(id, res.text);
  } catch {
    return { id, status: "error", opinions: [], flag: null };
  }
}

async function reconsider(
  selfId: NodeId,
  partnerId: NodeId,
  partnerOpinions: Opinion[],
  req: DeepenInput,
  env: Env,
  collector: CostCollector,
  index: number,
): Promise<Reconsidered> {
  const selfDef = nodeDef(selfId);
  const partnerDef = nodeDef(partnerId);
  const parts: string[] = [];
  if (req.summary.trim().length > 0) parts.push(`[会話要約]\n${req.summary.trim()}`);
  parts.push(`[入力]\n${req.input}`);
  parts.push(
    `[対角(${partnerDef.uiName})の意見]\n${JSON.stringify(partnerOpinions)}`,
  );
  const res = await callModel(
    "node",
    [
      { role: "system", content: reconsiderSystem(selfDef.verb) },
      { role: "user", content: parts.join("\n\n") },
    ],
    { env, collector, modelOverride: pickNodeModel(index) },
  );
  return parseReconsidered(res.text);
}

function parseReconsidered(raw: string): Reconsidered {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      const o = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
      return {
        keep: typeof o.keep === "string" ? o.keep : "",
        changed: typeof o.changed === "string" ? o.changed : "",
      };
    } catch {
      /* fallthrough */
    }
  }
  // パース失敗時は生テキストを keep に入れる(情報を落とさない)
  return { keep: raw.trim().slice(0, 200), changed: "" };
}

async function weave(
  axisText: string,
  reconA: Reconsidered,
  reconB: Reconsidered,
  idA: NodeId,
  idB: NodeId,
  req: DeepenInput,
  env: Env,
  collector: CostCollector,
): Promise<string> {
  const nameA = nodeDef(idA).uiName;
  const nameB = nodeDef(idB).uiName;
  const parts: string[] = [];
  if (req.summary.trim().length > 0) parts.push(`[会話要約]\n${req.summary.trim()}`);
  parts.push(`[緊張軸]\n${axisText}`);
  parts.push(`[今回の入力]\n${req.input}`);
  parts.push(`[以前の回答]\n${req.priorAnswer}`);
  parts.push(
    `[${nameA}の再考]\n譲れない核心: ${reconA.keep}\n変わった点: ${reconA.changed}`,
  );
  parts.push(
    `[${nameB}の再考]\n譲れない核心: ${reconB.keep}\n変わった点: ${reconB.changed}`,
  );
  const res = await callModel(
    "synth",
    [
      { role: "system", content: DEEPEN_SYNTH_SYSTEM },
      { role: "user", content: parts.join("\n\n") },
    ],
    { env, collector },
  );
  return res.text.trim();
}
