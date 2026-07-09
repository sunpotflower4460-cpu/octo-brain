import { useEffect, useRef, useState } from "react";
import { Send, Bot, User, Cpu, Sparkles, BrainCircuit, Waypoints, Link2 } from "lucide-react";
import OctopusCanvas from "./components/OctopusCanvas";
import NodePerspectives from "./components/NodePerspectives";
import { analyzeStream, deepen, resonate } from "./lib/api";
import { phaseToAppState } from "./lib/phase";
import { armsForAxis, armsForLenses, displayFor } from "./config/nodeDisplay";
import type { AnalyzeMeta, AppState, NodeView, Plan, ResonancePair } from "./types";

interface ResonateResult {
  label: string;
  answer: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sourceInput?: string; // この回答を生んだユーザー入力(深化・共鳴で使う)
  nodes?: NodeView[];
  meta?: AnalyzeMeta;
  streaming?: boolean;
  deepened?: { answer: string; axis: string }; // 深化結果
  deepenError?: string;
  resonances?: ResonateResult[]; // 共鳴(掛け算)結果。AI提案・ユーザー選択の両方
  resonateError?: string;
}

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `c-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "greeting",
      role: "assistant",
      content:
        "起動完了。私は「OctoBrain」。八芒星に配した8つのレンズが多角に観て感じ、中央脳がその緊張ごと一つの理解に織り上げます。分析したい対象を入力してください。",
    },
  ]);
  const [input, setInput] = useState("");
  const [plan, setPlan] = useState<Plan>("light");
  const [appState, setAppState] = useState<AppState>("idle");
  // 深化中に光らせる対角2腕(null=通常)
  const [deepenArms, setDeepenArms] = useState<number[] | null>(null);
  const [deepeningId, setDeepeningId] = useState<string | null>(null);
  // 共鳴中に呼応させる2腕(null=通常)
  const [resonanceArms, setResonanceArms] = useState<number[] | null>(null);
  const [resonatingId, setResonatingId] = useState<string | null>(null);

  const summaryRef = useRef("");
  const clientIdRef = useRef(uuid());
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const busy = appState !== "idle";

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, appState]);

  const patchMessage = (id: string, patch: Partial<ChatMessage>) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const currentInput = input.trim();
    if (!currentInput || busy) return;

    const userMsg: ChatMessage = { id: uuid(), role: "user", content: currentInput };
    const assistantId = uuid();
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      sourceInput: currentInput,
      nodes: [],
      streaming: true,
    };
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput("");
    setAppState("processing_subs");

    let answer = "";
    const nodes: NodeView[] = [];

    await analyzeStream(
      {
        input: currentInput,
        summary: summaryRef.current || undefined,
        plan,
        clientId: clientIdRef.current,
      },
      {
        onPhase: (phase) => setAppState(phaseToAppState(phase)),
        onNode: (node) => {
          nodes.push(node);
          patchMessage(assistantId, { nodes: [...nodes] });
        },
        onToken: (t) => {
          answer += t;
          patchMessage(assistantId, { content: answer });
        },
        onDone: (payload) => {
          summaryRef.current = payload.summary;
          patchMessage(assistantId, {
            content: payload.answer,
            nodes: payload.nodes,
            meta: payload.meta,
            streaming: false,
          });
          setAppState("idle");
        },
        onError: (message) => {
          patchMessage(assistantId, {
            content:
              answer.length > 0
                ? answer
                : `システムエラー：ニューラルネットワークの同期に失敗しました。\n(${message})`,
            streaming: false,
          });
          setAppState("idle");
        },
      },
    );
    setAppState("idle");
  };

  // 深化(腕間結合): 最緊張軸の対角2腕を再考させ、中央脳が織り直す。
  const handleDeepen = async (msg: ChatMessage) => {
    const tension = msg.meta?.tension;
    if (busy || !tension || !msg.sourceInput) return;

    const arms = armsForAxis(tension.axis);
    setDeepenArms(arms.length > 0 ? arms : null);
    setAppState("processing_main");
    setDeepeningId(msg.id);
    try {
      const res = await deepen({
        input: msg.sourceInput,
        summary: summaryRef.current || undefined,
        tension: { axis: tension.axis },
        priorAnswer: msg.content,
        clientId: clientIdRef.current,
      });
      patchMessage(msg.id, {
        deepened: { answer: res.answer, axis: res.meta.axis },
        deepenError: undefined,
      });
    } catch (err) {
      patchMessage(msg.id, {
        deepenError: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setDeepeningId(null);
      setDeepenArms(null);
      setAppState("idle");
    }
  };

  // 共鳴(掛け算): 一見遠い2意見を掛け合わせ第三の選択肢を生む。
  // AI提案ペア(meta.resonance)でも、ユーザー選択ペアでも同じ経路。
  const handleResonate = async (
    msg: ChatMessage,
    pair: { a: ResonancePair; b: ResonancePair },
  ) => {
    if (busy || !msg.sourceInput) return;

    const arms = armsForLenses([pair.a.lens, pair.b.lens]);
    setResonanceArms(arms.length > 0 ? arms : null);
    setAppState("processing_subs");
    setResonatingId(msg.id);

    const label = `共鳴: ${displayFor(pair.a.lens).uiName} × ${displayFor(pair.b.lens).uiName}`;
    try {
      const res = await resonate({
        input: msg.sourceInput,
        summary: summaryRef.current || undefined,
        resonance: pair,
        priorAnswer: msg.content,
        clientId: clientIdRef.current,
      });
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msg.id
            ? {
                ...m,
                resonances: [...(m.resonances ?? []), { label, answer: res.answer }],
                resonateError: undefined,
              }
            : m,
        ),
      );
    } catch (err) {
      patchMessage(msg.id, {
        resonateError: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setResonatingId(null);
      setResonanceArms(null);
      setAppState("idle");
    }
  };

  return (
    <div className="relative min-h-screen bg-slate-950 text-slate-200 font-sans selection:bg-cyan-500/30 overflow-hidden flex flex-col">
      <OctopusCanvas
        appState={appState}
        deepenArms={deepenArms}
        resonanceArms={resonanceArms}
      />

      <header className="relative z-10 p-5 flex justify-center items-center backdrop-blur-md bg-slate-950/40 border-b border-slate-800/60 shadow-lg shadow-black/50">
        <div className="flex items-center gap-3">
          <BrainCircuit className="w-8 h-8 text-purple-400 drop-shadow-[0_0_8px_rgba(168,85,247,0.5)]" />
          <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 via-blue-500 to-purple-500 tracking-wider">
            OctoBrain AI
          </h1>
        </div>
      </header>

      <main className="relative z-10 flex-1 overflow-y-auto p-4 md:p-8 space-y-6 flex flex-col pt-10 pb-44 scroll-smooth">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex gap-4 max-w-4xl w-full ${
              msg.role === "user" ? "ml-auto flex-row-reverse" : "mr-auto"
            } animate-in fade-in slide-in-from-bottom-4 duration-500`}
          >
            <div
              className={`flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center border-2 shadow-lg ${
                msg.role === "user"
                  ? "bg-cyan-950/60 border-cyan-500/50 shadow-cyan-500/20"
                  : "bg-purple-950/60 border-purple-500/50 shadow-purple-500/20"
              }`}
            >
              {msg.role === "user" ? (
                <User className="w-6 h-6 text-cyan-300" />
              ) : (
                <BrainCircuit className="w-6 h-6 text-purple-300" />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div
                className={`p-5 rounded-2xl backdrop-blur-xl shadow-2xl text-sm md:text-base leading-relaxed whitespace-pre-wrap ${
                  msg.role === "user"
                    ? "bg-cyan-900/30 border border-cyan-800/50 rounded-tr-sm text-cyan-50"
                    : "bg-slate-900/70 border border-purple-900/40 rounded-tl-sm text-slate-100"
                }`}
              >
                {msg.content}
                {msg.streaming && msg.content.length === 0 && (
                  <span className="text-slate-500">…</span>
                )}
                {msg.streaming && msg.content.length > 0 && (
                  <span className="inline-block w-2 h-4 ml-0.5 bg-purple-400/70 animate-pulse align-middle" />
                )}
              </div>

              {msg.role === "assistant" && msg.meta?.fallback && (
                <p className="mt-2 text-xs text-amber-400/80">
                  シンプルモードで応答しました
                </p>
              )}

              {/* 最緊張軸 + 深化ボタン(TENSIONがあるときだけ) */}
              {msg.role === "assistant" && !msg.streaming && msg.meta?.tension && (
                <div className="mt-3 rounded-xl border border-fuchsia-800/40 bg-fuchsia-950/20 p-3">
                  <div className="flex items-center gap-2 text-xs text-fuchsia-200/90">
                    <Waypoints className="w-4 h-4 text-fuchsia-400" />
                    <span>
                      この回答は<b className="text-fuchsia-300">
                        {msg.meta.tension.axis}
                      </b>
                      が張っています
                    </span>
                  </div>
                  {msg.meta.tension.reason && (
                    <p className="mt-1 text-[11px] text-slate-400">
                      {msg.meta.tension.reason}
                    </p>
                  )}

                  {msg.deepened ? (
                    <div className="mt-3 rounded-lg border border-fuchsia-700/40 bg-slate-900/60 p-3">
                      <div className="text-[11px] font-semibold text-fuchsia-300 mb-1">
                        🐙 深掘り({msg.deepened.axis})
                      </div>
                      <div className="text-sm text-slate-100 whitespace-pre-wrap leading-relaxed">
                        {msg.deepened.answer}
                      </div>
                    </div>
                  ) : deepeningId === msg.id ? (
                    <div className="mt-3 flex items-center gap-2 text-xs text-fuchsia-300 animate-pulse">
                      <Waypoints className="w-4 h-4" />
                      対角の2本の腕が対話中...
                    </div>
                  ) : (
                    <button
                      onClick={() => handleDeepen(msg)}
                      disabled={busy}
                      className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-semibold bg-gradient-to-r from-fuchsia-600 to-purple-600 hover:from-fuchsia-500 hover:to-purple-500 text-white shadow-lg shadow-fuchsia-500/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Waypoints className="w-4 h-4" />
                      この緊張を深く掘る
                    </button>
                  )}

                  {msg.deepenError && (
                    <p className="mt-2 text-[11px] text-rose-400/80">
                      深化に失敗しました({msg.deepenError})
                    </p>
                  )}
                </div>
              )}

              {/* 共鳴カード(AI提案): meta.resonance があるとき。深化(⚡緊張)と区別し ✨響き合い */}
              {msg.role === "assistant" && !msg.streaming && msg.meta?.resonance && (
                <div className="mt-3 rounded-xl border border-cyan-800/40 bg-cyan-950/20 p-3">
                  <div className="flex items-center gap-2 text-xs text-cyan-200/90">
                    <Sparkles className="w-4 h-4 text-cyan-400" />
                    <span>
                      離れた2つの視点が<b className="text-cyan-300">響き合って</b>います
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                    <span className="rounded bg-slate-800/60 border border-slate-700/50 px-2 py-1 text-slate-200">
                      {displayFor(msg.meta.resonance.a.lens).emoji}{" "}
                      {displayFor(msg.meta.resonance.a.lens).uiName}:{" "}
                      {msg.meta.resonance.a.claim}
                    </span>
                    <span className="inline-flex items-center gap-1 text-cyan-400/90">
                      <Link2 className="w-3 h-3" />
                      {msg.meta.resonance.root}
                    </span>
                    <span className="rounded bg-slate-800/60 border border-slate-700/50 px-2 py-1 text-slate-200">
                      {displayFor(msg.meta.resonance.b.lens).emoji}{" "}
                      {displayFor(msg.meta.resonance.b.lens).uiName}:{" "}
                      {msg.meta.resonance.b.claim}
                    </span>
                  </div>
                  <button
                    onClick={() =>
                      msg.meta?.resonance &&
                      handleResonate(msg, {
                        a: msg.meta.resonance.a,
                        b: msg.meta.resonance.b,
                      })
                    }
                    disabled={busy}
                    className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-semibold bg-gradient-to-r from-cyan-600 to-sky-600 hover:from-cyan-500 hover:to-sky-500 text-white shadow-lg shadow-cyan-500/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Sparkles className="w-4 h-4" />
                    掛け合わせる
                  </button>
                </div>
              )}

              {msg.role === "assistant" && msg.nodes && (
                <NodePerspectives
                  nodes={msg.nodes}
                  busy={busy}
                  onResonate={(pair) => handleResonate(msg, pair)}
                />
              )}

              {/* 共鳴中インジケータ(AI提案・ユーザー選択どちらでも) */}
              {resonatingId === msg.id && (
                <div className="mt-2 flex items-center gap-2 text-xs text-cyan-300 animate-pulse">
                  <Link2 className="w-4 h-4" />
                  2本の腕が響き合っています...
                </div>
              )}

              {/* 共鳴結果 */}
              {msg.role === "assistant" &&
                msg.resonances?.map((r, i) => (
                  <div
                    key={i}
                    className="mt-3 rounded-lg border border-cyan-700/40 bg-slate-900/60 p-3"
                  >
                    <div className="text-[11px] font-semibold text-cyan-300 mb-1">
                      ✨ {r.label}
                    </div>
                    <div className="text-sm text-slate-100 whitespace-pre-wrap leading-relaxed">
                      {r.answer}
                    </div>
                  </div>
                ))}
              {msg.role === "assistant" && msg.resonateError && (
                <p className="mt-2 text-[11px] text-rose-400/80">
                  共鳴に失敗しました({msg.resonateError})
                </p>
              )}

              {msg.role === "assistant" && msg.meta && (
                <p className="mt-2 text-[11px] font-mono text-slate-500 tracking-wide">
                  {msg.meta.plan} / {msg.meta.domain} / quorum: {msg.meta.quorum} /{" "}
                  {msg.meta.ms}ms
                  {import.meta.env.DEV && (
                    <> / cost: ${msg.meta.totalCost.toFixed(5)}</>
                  )}
                </p>
              )}
            </div>
          </div>
        ))}

        <div className="h-10 flex items-center justify-center transition-all duration-300">
          {resonanceArms !== null && (
            <div className="flex items-center gap-3 text-cyan-200 animate-pulse bg-cyan-950/60 px-5 py-2.5 rounded-full border border-cyan-400/40 backdrop-blur-lg shadow-[0_0_15px_rgba(103,232,249,0.3)]">
              <Link2 className="w-5 h-5" />
              <span className="text-sm md:text-base font-semibold tracking-wide">
                2本の腕が呼応し、響き合っています...
              </span>
            </div>
          )}
          {deepenArms !== null && (
            <div className="flex items-center gap-3 text-fuchsia-300 animate-pulse bg-fuchsia-950/60 px-5 py-2.5 rounded-full border border-fuchsia-500/40 backdrop-blur-lg shadow-[0_0_15px_rgba(217,70,239,0.3)]">
              <Waypoints className="w-5 h-5" />
              <span className="text-sm md:text-base font-semibold tracking-wide">
                対角の2本の腕が対話し、緊張を掘っています...
              </span>
            </div>
          )}
          {deepenArms === null && resonanceArms === null && appState === "processing_subs" && (
            <div className="flex items-center gap-3 text-cyan-400 animate-pulse bg-cyan-950/60 px-5 py-2.5 rounded-full border border-cyan-500/40 backdrop-blur-lg shadow-[0_0_15px_rgba(6,182,212,0.3)]">
              <Cpu className="w-5 h-5" />
              <span className="text-sm md:text-base font-semibold tracking-wide">
                八芒星のレンズが並列解析中...
              </span>
            </div>
          )}
          {deepenArms === null && resonanceArms === null && appState === "processing_main" && (
            <div className="flex items-center gap-3 text-purple-400 animate-pulse bg-purple-950/60 px-5 py-2.5 rounded-full border border-purple-500/40 backdrop-blur-lg shadow-[0_0_15px_rgba(168,85,247,0.3)]">
              <Sparkles className="w-5 h-5" />
              <span className="text-sm md:text-base font-semibold tracking-wide">
                中央脳が緊張ごと織り上げ中...
              </span>
            </div>
          )}
        </div>

        <div ref={messagesEndRef} className="h-4" />
      </main>

      <footer className="absolute bottom-0 left-0 right-0 z-20 p-4 md:p-6 bg-gradient-to-t from-slate-950 via-slate-950/90 to-transparent">
        <div className="max-w-4xl mx-auto">
          {/* プラン切替(無料ライト2軸 / 有料ディープ4軸) */}
          <div className="flex items-center justify-center gap-1 mb-3">
            {(["light", "deep"] as Plan[]).map((p) => (
              <button
                key={p}
                onClick={() => !busy && setPlan(p)}
                disabled={busy}
                className={`px-3 py-1 rounded-full text-xs font-semibold transition-all disabled:opacity-50 ${
                  plan === p
                    ? "bg-purple-600/70 text-white shadow shadow-purple-500/30"
                    : "bg-slate-800/60 text-slate-400 hover:text-slate-200"
                }`}
              >
                {p === "light" ? "ライト (2軸4腕)" : "ディープ (4軸8腕)"}
              </button>
            ))}
          </div>

          <form
            onSubmit={handleSubmit}
            className={`relative flex items-center bg-slate-900/80 backdrop-blur-2xl border-2 rounded-full shadow-2xl transition-all duration-500 overflow-hidden ${
              resonanceArms !== null
                ? "border-cyan-400/50 shadow-cyan-400/20"
                : deepenArms !== null
                  ? "border-fuchsia-500/50 shadow-fuchsia-500/20"
                  : appState === "idle"
                  ? "border-slate-700/60 focus-within:border-cyan-500/60 focus-within:shadow-cyan-500/20"
                  : appState === "processing_subs"
                    ? "border-cyan-500/50 shadow-cyan-500/20"
                    : "border-purple-500/50 shadow-purple-500/20"
            }`}
          >
            <div className="pl-5 pr-2 text-slate-400">
              <Bot className="w-6 h-6" />
            </div>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={busy}
              placeholder="OctoBrainに分析を依頼する..."
              className="flex-1 bg-transparent border-none py-4 px-2 text-slate-100 placeholder-slate-500 focus:outline-none disabled:opacity-60 text-base"
            />
            <button
              type="submit"
              disabled={!input.trim() || busy}
              className="m-2 p-3 bg-gradient-to-r from-cyan-600 to-purple-600 hover:from-cyan-500 hover:to-purple-500 disabled:from-slate-800 disabled:to-slate-800 text-white rounded-full transition-all duration-300 disabled:opacity-50 shadow-lg"
            >
              <Send className="w-5 h-5" />
            </button>
          </form>
          <p className="text-center text-xs font-mono text-slate-600 mt-3 tracking-widest">
            OCTOBRAIN ARCHITECTURE: 8 LENSES · 4 TENSION AXES · 1 CENTRAL BRAIN
          </p>
        </div>
      </footer>
    </div>
  );
}
