// Synthesizer = 中央脳 (docs/01_depth_design.md §5, P1.6 共鳴)。
// 「まとめ」から「掘り」へ。8本の腕 = 4つの対角軸の報告を一つの深い理解に織り上げ、
// 共鳴を ---RESONANCE--- で、最緊張軸を ---TENSION--- で、更新版要約を ---SUMMARY--- で
// 機械可読に出力する。マーカー順: 本文 → ---RESONANCE---(任意) → ---TENSION--- → ---SUMMARY---

import { languageDirective } from "./language.js";
import { careDirective, detectCare } from "./care.js";
import { callModel } from "./callModel.js";
import { callModelStream } from "./callModelStream.js";
import {
  axisLabel,
  isNodeId,
  nodeDef,
  type NodeId,
  type Square,
} from "../config/nodes.js";
import { isUsableNode } from "./runNodes.js";
import type { ResearchSource } from "./research.js";
import type {
  CostSink,
  Env,
  Fact,
  NodeResult,
  Opinion,
  PerspectiveMap,
  Resonance,
  Tension,
} from "../types.js";

const RESONANCE_MARKER = "---RESONANCE---";
const MAP_MARKER = "---MAP---";
const TENSION_MARKER = "---TENSION---";
const SUMMARY_MARKER = "---SUMMARY---";
const SUMMARY_MAX_LEN = 300;
const CLAIM_MAX_LEN = 120;
const CONFIDENCE_FLOOR = 0.4;

// §5 の「掘る版」手順(固定文)。
const SYNTH_PROCEDURE = `あなたはOctoBrainの中央脳。8本の腕 — 4つの対角軸 — からの報告を受け取るが、ただまとめる係ではない。腕の報告を材料に、あなた自身の判断を持って一つの深い理解に織り上げる。手順:
0. 回答はユーザーの入力と同じ言語で書く(英語の入力には英語で答える)
1. 入力が長い(3文以上)ときだけ、いちばん重みのある一句を一字一句そのまま「」で引用して始めてよい(入力全体を繰り返さない。腕の意見は引用しない)。短い入力は引用せず、本題から始める
2. 多くの腕が揃って言っていること(合意)を見つける(本文では「視点」と呼ぶ)
3. 合意を鵜呑みにしない。「本当にそうか?」と自分で検証する。腕はみな同じ入力文だけを見ているので、入力の言い方に引きずられた共通の思い込みや、どの腕も触れていない見落としがあり得る。検証の結果を、支持・修正・異論のいずれかとして、あなた自身の判断と根拠で述べる
4. 4つの軸(時/心/動/魂)それぞれで、対角の2報告が張り合っていないか見る
5. 最も張り詰めた軸をひとつ特定する。その緊張は、本人が迫られている本当の選択を指している — それを本人の言葉で言語化する。ただし入力に書かれていない感情・動機・葛藤(「焦っている」「目を背けている」など)を事実のように断定しない。推測は「〜かもしれません」と仮説として示す
6. 一般論を書いたら削除する。この人の状況にしか当てはまらない文だけを残す
7. weight<0.4のopinionは参考扱い、flagが立っている報告は除外する
8. 構成: 導入 → 腕たちの見立てとそれに対するあなたの判断 → 織り上げた理解(本人が迫られている選択を含む) → 見方が分かれる点(残る場合のみ) → 次の一歩
9. 最後に、本人がまだ言葉にしていない問いをひとつだけ置く
10. 軸をまたいで、遠いのに響き合う opinion の組がひとつだけあれば ${RESONANCE_MARKER} 行を出す(§共鳴)。基準: (a)異なる軸に属する (b)共通の根が一文で言える (c)組み合わせると新しい選択肢が生まれる。3つすべて満たすときだけ。無理に作らない。該当が無ければ出さない
- 相談ではなく作業の依頼(計算・文章の作成や改善・要約・アイデア出し・論点整理など)なら、依頼された成果物を先に、完全な形で出す。軸の緊張・次の一歩・問いは、成果物を良くするのに役立つ場合だけ短く添える
- 依頼と噛み合わない腕の提案(計算に対する「明日やる」など)は、わざわざ取り上げて否定せず、黙って捨てる
- 報告に world(その腕が立った世界)・experience(その世界の見方・経験)・facts(実際の情報と確からしさ sure)があるときは、同じ問いを違う世界から探求した結果として比べる: (a) 遠い世界どうしの経験が同じ方向を指すなら強い示唆として扱う (b) 経験(その世界の感覚)と facts(情報)が食い違うところは、どちらを信じるべきかをあなたが判断し根拠を示す (c) 違う世界の経験に共通して流れている本質(場面は違っても同じ理)を掴み、答えの芯にする。本質は相談者の状況の言葉で述べ、世界の名前や職業の例えは本文に出さない (d) 相談者の業界の常識では出てこない、遠い世界ならではの見方を答えに活かす。facts は sure が低いもの・具体的な数字を断定せず、確かめ方を添える
- ひとつの視点だけが指摘していて、他の視点が触れていないが見落とせない点(少数意見)があれば、まとまりを優先して捨てず、本文でも短く触れる
- 腕の意見に賛成して並べるだけの統合は禁止。少なくとも一か所、腕たちの見立てに対するあなた自身の判断(同意の理由・修正・異論)を根拠とともに示す
- 腕のIDや「ノード3によると」のような機械的引用は禁止。自然な文章に溶かす
- 「腕」「レンズ」「ノード」「報告」という内部の言葉は本文に書かない。触れるときは「いくつかの視点」「どの視点も」のように言う
- 「次の一歩:」「問い:」のような見出しやラベルは付けず、地の文で書く
- 重さのある相談(困っている・傷ついている・不当な扱い)では、冒頭の一文で相談者の状況を受け止めてから本題に入る(気持ちを決めつけず、書かれた事実に沿って)
- 本文では「時の軸」「心の軸」などの軸の名前を出さない。緊張は「〜したい気持ちと〜が引っ張り合っている」のように普通の言葉で書く(軸の名前は機械可読ブロックにだけ書く)
- 「いくつかの視点は」で毎回書き出さない。視点に触れるのは、それが答えを良くするときだけにし、言い回しも毎回変える
- 雑談・あいさつ・お礼・単純な事実や相場の質問には、視点・緊張・選択の話を持ち出さず、人と話すように自然に短く答える(問いで終える必要もない)
- 「疲れた」「無理」「どうしよう」のような短い吐露やあいまいな入力を、それだけで危機として扱わない。死や自傷の示唆がない限り、危険の確認から入らず、受け止めて何があったかを穏やかに聞く
- 希死念慮・自傷・他害の示唆がある場合は、分析や助言より本人に向き合うことを優先し、user 側の[寄り添いモード]の指示に従う(窓口を出すかどうかも含む)。その指示がない場合も、方法・計画・手段・切迫がうかがえ深刻だと判断したときだけ、窓口(日本なら よりそいホットライン 0120-279-338、差し迫った危険なら119番)を押しつけずに選択肢として添える。方法や手段に関する情報は一切出さない。この場合は軸の緊張などの分析の説明は省く
- 断定は根拠の強さに比例させる
- 本文は全角900字以内。長さより密度。本文の後の機械可読ブロックは必ず最後まで出し切る
- 相談への回答は、次の一歩(具体的な行動)→ まだ言葉にしていない問い(1文)の順で終える。字数が足りなければ中盤を削り、この2つは削らない(作業の依頼・雑談は除く)
- 実用の具体性を落とさない: 確かめるべき条件や数字は箇条書き(3〜5項目)で示してよい。誰かと話す場面があるなら、そのまま使える言い方の例を1つ添える。判断に欠けている情報があれば、何が分かれば判断できるかを具体的に示す`;

// フォールバック時 (クォーラム未達): ノード補助なしで単発直接回答。
const FALLBACK_PROCEDURE = `あなたはOctoBrainの中央脳です。分析腕の補助が得られなかったため、以下の入力にあなた自身の判断で誠実かつ具体的に直接回答せよ。一般論を避け、この人の状況に踏み込む。過剰な断定を避け、根拠の強さに応じた言い方をする。回答本文は全角700字以内に収める。希死念慮・自傷・他害の示唆がある場合は、本人に向き合うことを優先し、user 側の[寄り添いモード]の指示に従う。指示がない場合も、深刻だと判断したときだけ窓口(日本なら よりそいホットライン 0120-279-338、差し迫った危険なら119番)を選択肢として添える。方法や手段に関する情報は一切出さない。`;

// RESONANCE(任意)+ TENSION + SUMMARY 出力指示(固定文)。
// マーカー順を厳守: 本文 → RESONANCE(任意) → TENSION → SUMMARY。本文・要約に混ぜない。
const TENSION_SUMMARY_DIRECTIVE = `回答本文を出力し終えたら、機械可読ブロックを次の順で付ける(本文・要約には混ぜない):
1. 響き合う組がひとつだけ確実にあるときのみ "${RESONANCE_MARKER}" を置き、同じ行に {"a":{"lens":"<レンズID>","claim":"<元claimを引用>"},"b":{"lens":"<レンズID>","claim":"..."},"root":"共通の根を一文で"} を出力する(無ければこの行を省略)。lens は reason/emotion/risk/empathy/future/truth/step/values のいずれか。
2. "${TENSION_MARKER}" を置き、同じ行に {"axis":"時の軸|心の軸|動の軸|魂の軸 のいずれか","reason":"なぜその軸が最も張り詰めているかを一文で"} を出力する。
3. "${SUMMARY_MARKER}" を単独行で置き、その後に今回のやり取りを踏まえた${SUMMARY_MAX_LEN}字以内の更新版会話要約のみを出力する(見出し・前置き・箇条書き記号は付けない)。`;

// フォールバックは軸が無いので TENSION は出さず SUMMARY のみ。
const SUMMARY_ONLY_DIRECTIVE = `回答本文を出力し終えたら、"${SUMMARY_MARKER}" を単独行で置き、その後に今回のやり取りを踏まえた${SUMMARY_MAX_LEN}字以内の更新版会話要約のみを出力する(見出し・前置き・記号なし)。`;

const SYNTH_SYSTEM = `${SYNTH_PROCEDURE}\n\n${TENSION_SUMMARY_DIRECTIVE}`;
const FALLBACK_SYSTEM = `${FALLBACK_PROCEDURE}\n\n${SUMMARY_ONLY_DIRECTIVE}`;

export interface SynthOpts {
  env: Env;
  // この会話で寄り添いモードになった回数(寄り添い方の指示に使う)
  careTurns?: number;
  // 直前の回答(参照用)。「3つ目の案を英語に」など前の回答の中身を指す依頼に応えるため、
  // 統合脳にだけ渡す(8本の腕には渡さない=入力の複製を増やさない)
  prevAnswer?: string;
  // 公的・公開の情報源で確かめた資料(条文・百科事典・ウェブ)。腕の facts より優先させる
  research?: ResearchSource[];
  // 照合モード(法律・事実の質問を全腕で独立に確かめた)
  check?: boolean;
  collector?: CostSink;
  signal?: AbortSignal;
}

export interface SynthResult {
  answer: string;
  summary: string;
  tension: Tension | null;
  resonance: Resonance | null;
  // 視点の地図(合意・対立・少数意見)。無ければ null
  map?: PerspectiveMap | null;
  // 出力上限で打ち切られた(本文途中切れ・マーカー欠落の可能性)。meta.warnings に載せる
  truncated?: boolean;
  // 機械可読行(RESONANCE/TENSION)の後ろに本文の続きが書かれていたので本文へ戻した文字数。
  // 0 なら無し。meta.warnings に載せる(本文そのものはログに出さない)
  rescuedChars?: number;
}

// 中央脳に渡すレンズ報告。除外規則を適用済みの形。軸情報を含める(緊張検出のため)。
export interface SynthReport {
  lens: string; // uiName
  axis: string; // 軸ラベル
  square: Square;
  opinions: Opinion[];
  // 世界つきで探求したときだけ
  world?: string;
  experience?: string;
  facts?: Fact[];
  move?: string;
}

// §5 除外ルール: flag付き / opinions空 / 非ok は除外。weight<0.4 は本文側で参考扱い。
// 成功判定は runNodes.isUsableNode と同一基準(クォーラムと報告構築の齟齬を防ぐ)。
export function buildReports(nodes: NodeResult[]): SynthReport[] {
  return nodes.filter(isUsableNode).map((n) => {
    const d = nodeDef(n.id as NodeId);
    return {
      lens: d.uiName,
      axis: axisLabel(d.axis),
      square: d.square,
      opinions: n.opinions,
      ...(n.world ? { world: n.world } : {}),
      ...(n.experience ? { experience: n.experience } : {}),
      ...(n.facts && n.facts.length > 0 ? { facts: n.facts } : {}),
      ...(n.move ? { move: n.move } : {}),
    };
  });
}

// 共鳴の2腕が、今回実際に使えた(統合に入った)腕かを検証する。
// 統合脳が起動していないレンズIDを挙げた場合は null(非致命・warnings で可視化)。
export function validResonance(
  resonance: Resonance | null,
  nodes: NodeResult[],
): Resonance | null {
  if (!resonance) return null;
  const usable = new Set(nodes.filter(isUsableNode).map((n) => n.id));
  return usable.has(resonance.a.lens) && usable.has(resonance.b.lens) ? resonance : null;
}

// weight<0.4 の opinion だけを含むかどうか(テスト・可視化補助)。
export function hasPrimarySignal(report: SynthReport): boolean {
  return report.opinions.some((o) => o.weight >= CONFIDENCE_FLOOR);
}

export async function synthesize(
  input: string,
  summary: string,
  nodes: NodeResult[],
  opts: SynthOpts,
): Promise<SynthResult> {
  const reports = buildReports(nodes);
  const userText = buildSynthUserText(input, summary, reports, opts);
  const res = await callModel(
    "synth",
    [
      { role: "system", content: SYNTH_SYSTEM },
      { role: "user", content: userText },
    ],
    { env: opts.env, collector: opts.collector, signal: opts.signal },
  );
  return { ...splitAnswerTensionSummary(res.text, summary), truncated: res.truncated === true };
}

export async function synthesizeFallback(
  input: string,
  summary: string,
  opts: SynthOpts,
): Promise<SynthResult> {
  const userText = buildFallbackUserText(input, summary, opts);
  const res = await callModel(
    "synth",
    [
      { role: "system", content: FALLBACK_SYSTEM },
      { role: "user", content: userText },
    ],
    { env: opts.env, collector: opts.collector, signal: opts.signal },
  );
  return { ...splitAnswerTensionSummary(res.text, summary), truncated: res.truncated === true };
}

// user側: [会話要約(あれば)] + [今回の入力] + [軸ごとの報告(対角2腕の対話)] (§5)
export function buildSynthUserText(
  input: string,
  summary: string,
  reports: SynthReport[],
  ctx: { careTurns?: number; prevAnswer?: string; research?: ResearchSource[]; check?: boolean } = {},
): string {
  const byAxis = new Map<string, SynthReport[]>();
  for (const r of reports) {
    const arr = byAxis.get(r.axis) ?? [];
    arr.push(r);
    byAxis.set(r.axis, arr);
  }
  const dialogues = [...byAxis.entries()].map(([axis, rs]) => ({
    axis,
    lenses: rs.map((r) => ({
      lens: r.lens,
      ...(r.world ? { world: r.world } : {}),
      ...(r.experience ? { experience: r.experience } : {}),
      ...(r.facts ? { facts: r.facts } : {}),
      ...(r.move ? { move: r.move } : {}),
      opinions: r.opinions,
    })),
  }));

  const parts: string[] = [];
  if (summary.trim().length > 0) parts.push(`[会話要約]\n${summary.trim()}`);
  if (ctx.prevAnswer && ctx.prevAnswer.trim().length > 0) {
    parts.push(`[直前のあなたの回答(参照用。今回の入力が「3つ目の案」「さっきの」などで指しているときに使う)]\n${ctx.prevAnswer.trim()}`);
  }
  parts.push(`[今回の入力]\n${input}`);
  const lang = languageDirective(input);
  if (lang) parts.push(lang);
  const care = careDirective(detectCare(input), ctx.careTurns ?? 0);
  if (care) parts.push(care);
  const researchNote = researchBlock(ctx.research);
  if (researchNote) parts.push(researchNote);
  const worldsNote = ctx.check ? checkDirective(reports) : worldsDirective(reports);
  if (worldsNote) parts.push(worldsNote);
  parts.push(
    `[軸ごとの報告(対角の2腕が張り合う)]\n${JSON.stringify(dialogues)}`,
  );
  return parts.join("\n\n");
}

// 調べて確かめた資料を統合脳に渡す。腕の facts(モデルの記憶)と食い違えばこちらを優先させる。
export function researchBlock(sources: ResearchSource[] | undefined): string | null {
  if (!sources || sources.length === 0) return null;
  const kind = { law: "法令・e-Gov", wiki: "百科事典", web: "ウェブ検索" } as const;
  const lines = sources.map((s, i) => `[S${i + 1}] (${kind[s.kind]}) ${s.title}: ${s.text}`);
  return `[調べて確かめた資料]
${lines.join("\n")}
- 視点の facts(記憶による情報)と食い違うときは、この資料を優先する。条文は現行のもの
- 使うときは、本文で出典を短く添える(「労働基準法第20条では」「Wikipediaによると」のように)。番号 [S1] は書かない
- 相談と関係のない資料は無視する。資料にないことを資料にあるように書かない`;
}

// 世界つきで探求したときだけ、統合の芯を「世界をまたぐ本質」に置くよう明示する。
// (システムプロンプトの長い手順に埋もれて使われなかったため、報告の直前に置く)
export function worldsDirective(reports: SynthReport[]): string | null {
  const worlds = [...new Set(reports.filter((r) => r.world && r.experience).map((r) => r.world as string))];
  if (worlds.length < 3) return null;
  return `[世界をまたぐ探求]
今回の各視点は、別々の世界(${worlds.join("、")})に立って、同じ相談を探求した。回答では次を必ず行う:
1. 違う世界の経験に共通して流れている本質(場面は違っても同じ理)を掴み、答えの芯にする。表面の言葉の一致ではなく原理を探す
2. 本質は、相談者の状況の言葉で述べる(「開業の前に、撤退する売上の基準と期限を決めておく」のように)。世界の名前や職業の例えは本文に出さない(どの世界から来たかは、画面の地図で別に示される)
3. その本質を、次の一歩の具体的な行動に落とす。相談者の状況に固有の条件・数字・手順を削ってまで本質を語らない
4. 世界の経験(感覚)と facts(情報)が食い違うところがあれば、どちらを重く見るかをあなたが判断する
5. 次の一歩は、視点が出した move(その世界の知恵から来た具体的な一手)のうち、違う世界から来た効くものを2〜3選び、相談者の状況に合わせて数字・期限・言い方を残したまま示す(箇条書き可)`;
}

// 照合モード: 法律・事実の質問を、全腕が独立に確かめた。違う意見ではなく、確かめの一致・食い違いで答えを固める
export function checkDirective(reports: SynthReport[]): string | null {
  if (reports.length < 2) return null;
  return `[照合]
この質問は、答えが法律・制度・手続き・事実で決まる。各視点は独立した確認役として事実(facts)と次の手順(move)を挙げた。回答では次を行う:
1. 複数の視点が独立に同じ事実を挙げていれば確かなものとして使う。1つの視点だけの事実や、視点どうしで食い違う事実は [調べて確かめた資料] で判定する。資料でも確かめられないものは断定せず「確認が必要」と書く
2. 結論を最初に一文で言う(「〜です」「〜とは限りません」)。相談者が不当な扱いを受けている・困っている場合は、その一文の前後で状況を受け止める
3. 結論を左右する条件・例外・期限・金額を、視点から漏れなく拾って箇条書きで示す(各視点が別々に見つけた条件を合わせることで、1人では漏れる条件を拾う)
4. 視点の move から、確認先・書面・期限・言い方を含む具体的な手順を選んで示す。相手に伝える場面があれば、そのまま使える言い方を1つ添える
5. 軸の緊張・本質・まだ言葉にしていない問いの話は不要(相談者が迷っている様子があるときだけ短く)。機械可読ブロックは出す`;
}

function buildFallbackUserText(
  input: string,
  summary: string,
  ctx: { careTurns?: number; prevAnswer?: string; research?: ResearchSource[]; check?: boolean } = {},
): string {
  const parts: string[] = [];
  if (summary.trim().length > 0) parts.push(`[会話要約]\n${summary.trim()}`);
  if (ctx.prevAnswer && ctx.prevAnswer.trim().length > 0) {
    parts.push(`[直前のあなたの回答(参照用。今回の入力が「3つ目の案」「さっきの」などで指しているときに使う)]\n${ctx.prevAnswer.trim()}`);
  }
  parts.push(`[今回の入力]\n${input}`);
  const lang = languageDirective(input);
  if (lang) parts.push(lang);
  const care = careDirective(detectCare(input), ctx.careTurns ?? 0);
  if (care) parts.push(care);
  const researchNote = researchBlock(ctx.research);
  if (researchNote) parts.push(researchNote);
  return parts.join("\n\n");
}

// 本文 / RESONANCE / TENSION / SUMMARY を分離(一括版)。各マーカー欠落は非致命。
// マーカー順: 本文 → RESONANCE(任意) → TENSION → SUMMARY。
export function splitAnswerTensionSummary(
  text: string,
  oldSummary: string,
): SynthResult {
  const rIdx = text.indexOf(RESONANCE_MARKER);
  const mIdx = text.indexOf(MAP_MARKER);
  const tIdx = text.indexOf(TENSION_MARKER);
  const sIdx = text.indexOf(SUMMARY_MARKER);

  // 本文は最初に現れたマーカーの手前まで
  let answerEnd = text.length;
  for (const i of [rIdx, mIdx, tIdx, sIdx]) {
    if (i !== -1) answerEnd = Math.min(answerEnd, i);
  }
  let answer = text.slice(0, answerEnd).trim();
  // 機械可読行の後ろに書かれた本文の続き(モデルが順序を崩した場合)。捨てずに本文へ戻す
  const stray: string[] = [];

  // RESONANCE: rIdx から次のマーカー(TENSION/SUMMARY のうち rIdx より後で最小)まで
  let resonance: Resonance | null = null;
  if (rIdx !== -1) {
    const seg = text.slice(rIdx + RESONANCE_MARKER.length, nextMarkerEnd(text, rIdx, [mIdx, tIdx, sIdx]));
    resonance = parseResonance(seg);
    stray.push(strayText(seg));
  }

  // MAP: mIdx から次のマーカーまで
  let map: PerspectiveMap | null = null;
  if (mIdx !== -1) {
    const seg = text.slice(mIdx + MAP_MARKER.length, nextMarkerEnd(text, mIdx, [rIdx, tIdx, sIdx]));
    map = parseMap(seg);
    stray.push(strayText(seg));
  }

  // TENSION: tIdx から次のマーカー(SUMMARY のうち tIdx より後)まで
  let tension: Tension | null = null;
  if (tIdx !== -1) {
    const seg = text.slice(tIdx + TENSION_MARKER.length, nextMarkerEnd(text, tIdx, [mIdx, sIdx]));
    tension = parseTension(seg);
    stray.push(strayText(seg));
  }

  const rescued = stray.filter((t) => t.length >= STRAY_MIN_CHARS);
  if (rescued.length > 0) answer = [answer, ...rescued].join("\n\n");
  const rescuedChars = rescued.reduce((n, t) => n + t.length, 0);

  let summary = oldSummary;
  if (sIdx !== -1) {
    const raw = text.slice(sIdx + SUMMARY_MARKER.length).trim();
    if (raw.length > 0) summary = raw.slice(0, SUMMARY_MAX_LEN);
  }

  return { answer, summary, tension, resonance, map, rescuedChars };
}

// マーカー行の JSON 以外に残った文字列。短い雑音(句読点・空白)は本文と見なさない。
const STRAY_MIN_CHARS = 20;
function strayText(segment: string): string {
  const start = segment.indexOf("{");
  const end = segment.lastIndexOf("}");
  const rest = start !== -1 && end > start ? segment.slice(0, start) + segment.slice(end + 1) : segment;
  return rest.trim();
}

// from より後にある候補マーカー位置の最小。無ければ末尾。
function nextMarkerEnd(text: string, from: number, candidates: number[]): number {
  let end = text.length;
  for (const c of candidates) {
    if (c !== -1 && c > from) end = Math.min(end, c);
  }
  return end;
}

// TENSION行の {...} を抽出してパース。失敗は null(非致命)。
function parseTension(raw: string): Tension | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const obj = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    const axis = typeof obj.axis === "string" ? obj.axis.trim() : "";
    if (axis.length === 0) return null;
    const reason = typeof obj.reason === "string" ? obj.reason : "";
    return { axis, reason };
  } catch {
    return null;
  }
}

// RESONANCE行の {...} を抽出・検証。lens が実在NodeIdでない・同一・root欠落は null(非致命)。
function parseResonance(raw: string): Resonance | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const obj = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    const a = pairOf(obj.a);
    const b = pairOf(obj.b);
    const root = typeof obj.root === "string" ? obj.root.trim() : "";
    if (a === null || b === null || root.length === 0) return null;
    if (a.lens === b.lens) return null; // 同一レンズは組にならない
    return { a, b, root };
  } catch {
    return null;
  }
}

// MAP行の {...} を抽出・形だけ検証(レンズが実在IDか、文字列が空でないか)。失敗は null(非致命)。
function parseMap(raw: string): PerspectiveMap | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const o = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, CLAIM_MAX_LEN) : "");
    let agree: PerspectiveMap["agree"] = null;
    const ag = o.agree as Record<string, unknown> | null;
    if (ag && typeof ag === "object" && Array.isArray(ag.lenses)) {
      const lenses = [...new Set(ag.lenses.filter(isNodeId))];
      if (str(ag.point) && lenses.length >= 2) agree = { point: str(ag.point), lenses };
    }
    let split: PerspectiveMap["split"] = null;
    const sp = o.split as Record<string, unknown> | null;
    if (sp && typeof sp === "object") {
      const a = pairOf(sp.a);
      const b = pairOf(sp.b);
      if (a && b && a.lens !== b.lens && str(sp.about)) split = { about: str(sp.about), a, b };
    }
    let lone: PerspectiveMap["lone"] = null;
    const lo = o.lone as Record<string, unknown> | null;
    if (lo && typeof lo === "object" && isNodeId(lo.lens) && str(lo.claim) && str(lo.why)) {
      lone = { lens: lo.lens, claim: str(lo.claim), why: str(lo.why) };
    }
    return agree || split || lone ? { agree, split, lone } : null;
  } catch {
    return null;
  }
}

// 地図に出てくる腕が、今回実際に使えた腕かを検証する(起動していない腕を数えない)。
// 合意は使えた腕だけに絞り2つ未満なら外す。対立・少数意見は両方/本人が使えた腕のときだけ残す。
export function validMap(map: PerspectiveMap | null | undefined, nodes: NodeResult[]): PerspectiveMap | null {
  if (!map) return null;
  const usable = new Set(nodes.filter(isUsableNode).map((n) => n.id as string));
  const agreeLenses = map.agree ? map.agree.lenses.filter((l) => usable.has(l)) : [];
  const agree = map.agree && agreeLenses.length >= 2 ? { ...map.agree, lenses: agreeLenses } : null;
  const split = map.split && usable.has(map.split.a.lens) && usable.has(map.split.b.lens) ? map.split : null;
  const lone = map.lone && usable.has(map.lone.lens) ? map.lone : null;
  let essence: PerspectiveMap["essence"] = null;
  if (map.essence) {
    const keep = map.essence.lenses.map((l, i) => [l, map.essence!.worlds[i]] as const).filter(([l]) => usable.has(l));
    if (keep.length >= 3) essence = { point: map.essence.point, lenses: keep.map(([l]) => l), worlds: keep.map(([, w]) => w) };
  }
  return agree || split || lone || essence ? { agree, split, lone, essence } : null;
}

function pairOf(v: unknown): { lens: NodeId; claim: string } | null {
  if (v === null || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (!isNodeId(o.lens)) return null;
  const claim = typeof o.claim === "string" ? o.claim.trim() : "";
  if (claim.length === 0) return null;
  return { lens: o.lens, claim: claim.slice(0, CLAIM_MAX_LEN) };
}

// ---------------------------------------------------------------------------
// ストリーミング: 本文だけを逐次 emit し、RESONANCE/TENSION/SUMMARY 以降は流さない。
// マーカーがチャンク分割をまたいでも漏れないよう末尾を保持する。
// ---------------------------------------------------------------------------
export class DepthStreamCutter {
  static readonly MARKERS = [RESONANCE_MARKER, MAP_MARKER, TENSION_MARKER, SUMMARY_MARKER];
  private static readonly HOLD =
    Math.max(...DepthStreamCutter.MARKERS.map((m) => m.length)) - 1;

  private full = "";
  private emitted = 0;
  private stopped = false;

  push(delta: string): string {
    this.full += delta;
    if (this.stopped) return "";

    const idx = firstMarkerIndex(this.full);
    if (idx !== -1) {
      this.stopped = true;
      const out = this.full.slice(this.emitted, idx);
      this.emitted = idx;
      return out;
    }
    let safeEnd = this.full.length - DepthStreamCutter.HOLD;
    // 絵文字などのサロゲートペアを2回の送信に分けない(途中で「?」が一瞬出るのを防ぐ)
    if (isHighSurrogate(this.full.charCodeAt(safeEnd - 1))) safeEnd -= 1;
    if (safeEnd <= this.emitted) return "";
    const out = this.full.slice(this.emitted, safeEnd);
    this.emitted = safeEnd;
    return out;
  }

  flushRemaining(): string {
    const idx = firstMarkerIndex(this.full);
    const answerEnd = idx === -1 ? this.full.length : idx;
    if (answerEnd <= this.emitted) return "";
    const out = this.full.slice(this.emitted, answerEnd);
    this.emitted = answerEnd;
    return out;
  }

  result(oldSummary: string): SynthResult {
    return splitAnswerTensionSummary(this.full, oldSummary);
  }
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function firstMarkerIndex(s: string): number {
  let idx = -1;
  for (const m of DepthStreamCutter.MARKERS) {
    const i = s.indexOf(m);
    if (i !== -1 && (idx === -1 || i < idx)) idx = i;
  }
  return idx;
}

export async function synthesizeStream(
  input: string,
  summary: string,
  nodes: NodeResult[],
  opts: SynthOpts,
  onToken: (t: string) => void,
): Promise<SynthResult> {
  const reports = buildReports(nodes);
  const userText = buildSynthUserText(input, summary, reports, opts);
  return streamAndCut(SYNTH_SYSTEM, userText, summary, opts, onToken);
}

export async function synthesizeFallbackStream(
  input: string,
  summary: string,
  opts: SynthOpts,
  onToken: (t: string) => void,
): Promise<SynthResult> {
  const userText = buildFallbackUserText(input, summary, opts);
  return streamAndCut(FALLBACK_SYSTEM, userText, summary, opts, onToken);
}

async function streamAndCut(
  system: string,
  userText: string,
  oldSummary: string,
  opts: SynthOpts,
  onToken: (t: string) => void,
): Promise<SynthResult> {
  const cutter = new DepthStreamCutter();
  let truncated = false;
  for await (const delta of callModelStream(
    "synth",
    [
      { role: "system", content: system },
      { role: "user", content: userText },
    ],
    {
      env: opts.env,
      collector: opts.collector,
      signal: opts.signal,
      onStreamEnd: (info) => {
        truncated = info.truncated;
      },
    },
  )) {
    const out = cutter.push(delta);
    if (out.length > 0) onToken(out);
  }
  const tail = cutter.flushRemaining();
  if (tail.length > 0) onToken(tail);
  return { ...cutter.result(oldSummary), truncated };
}
