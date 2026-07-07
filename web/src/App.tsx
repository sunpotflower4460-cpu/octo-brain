import { useEffect, useRef, useState } from "react";
import { Send, Bot, User, Cpu, Sparkles, BrainCircuit } from "lucide-react";
import OctopusCanvas from "./components/OctopusCanvas";
import NodePerspectives from "./components/NodePerspectives";
import { analyzeStream } from "./lib/api";
import { phaseToAppState } from "./lib/phase";
import type { AnalyzeMeta, AppState, NodeView } from "./types";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  nodes?: NodeView[];
  meta?: AnalyzeMeta;
  streaming?: boolean;
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
        "起動完了。私は「OctoBrain」。8基のエッジノードによる多角分析と、メインコアによる統合処理がオンラインです。分析したい対象を入力してください。",
    },
  ]);
  const [input, setInput] = useState("");
  const [appState, setAppState] = useState<AppState>("idle");

  // ローリング要約 (done で更新し、次のリクエストで送る)。リロードで消えてよい。
  const summaryRef = useRef("");
  // クライアント識別子 (フロント生成UUID)。セッション内で固定。
  const clientIdRef = useRef(uuid());
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, appState]);

  const patchMessage = (id: string, patch: Partial<ChatMessage>) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const currentInput = input.trim();
    if (!currentInput || appState !== "idle") return;

    const userMsg: ChatMessage = {
      id: uuid(),
      role: "user",
      content: currentInput,
    };
    const assistantId = uuid();
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      nodes: [],
      streaming: true,
    };
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput("");
    setAppState("processing_subs");

    // 逐次更新はローカル変数で保持し、setState に反映する
    let answer = "";
    const nodes: NodeView[] = [];

    await analyzeStream(
      {
        input: currentInput,
        summary: summaryRef.current || undefined,
        clientId: clientIdRef.current,
        mode: "auto",
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
    // ストリームが done/error を出さずに終わった場合の保険
    setAppState("idle");
  };

  return (
    <div className="relative min-h-screen bg-slate-950 text-slate-200 font-sans selection:bg-cyan-500/30 overflow-hidden flex flex-col">
      <OctopusCanvas appState={appState} />

      <header className="relative z-10 p-5 flex justify-center items-center backdrop-blur-md bg-slate-950/40 border-b border-slate-800/60 shadow-lg shadow-black/50">
        <div className="flex items-center gap-3">
          <BrainCircuit className="w-8 h-8 text-purple-400 drop-shadow-[0_0_8px_rgba(168,85,247,0.5)]" />
          <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 via-blue-500 to-purple-500 tracking-wider">
            OctoBrain AI
          </h1>
        </div>
      </header>

      <main className="relative z-10 flex-1 overflow-y-auto p-4 md:p-8 space-y-6 flex flex-col pt-10 pb-40 scroll-smooth">
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

              {msg.role === "assistant" && msg.nodes && (
                <NodePerspectives nodes={msg.nodes} />
              )}

              {msg.role === "assistant" && msg.meta && (
                <p className="mt-2 text-[11px] font-mono text-slate-500 tracking-wide">
                  route: {msg.meta.route} / quorum: {msg.meta.quorum} /{" "}
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
          {appState === "processing_subs" && (
            <div className="flex items-center gap-3 text-cyan-400 animate-pulse bg-cyan-950/60 px-5 py-2.5 rounded-full border border-cyan-500/40 backdrop-blur-lg shadow-[0_0_15px_rgba(6,182,212,0.3)]">
              <Cpu className="w-5 h-5" />
              <span className="text-sm md:text-base font-semibold tracking-wide">
                8基のエッジノードが並列解析中...
              </span>
            </div>
          )}
          {appState === "processing_main" && (
            <div className="flex items-center gap-3 text-purple-400 animate-pulse bg-purple-950/60 px-5 py-2.5 rounded-full border border-purple-500/40 backdrop-blur-lg shadow-[0_0_15px_rgba(168,85,247,0.3)]">
              <Sparkles className="w-5 h-5" />
              <span className="text-sm md:text-base font-semibold tracking-wide">
                メイン頭脳が結果を統合・生成中...
              </span>
            </div>
          )}
        </div>

        <div ref={messagesEndRef} className="h-4" />
      </main>

      <footer className="absolute bottom-0 left-0 right-0 z-20 p-4 md:p-6 bg-gradient-to-t from-slate-950 via-slate-950/90 to-transparent">
        <div className="max-w-4xl mx-auto">
          <form
            onSubmit={handleSubmit}
            className={`relative flex items-center bg-slate-900/80 backdrop-blur-2xl border-2 rounded-full shadow-2xl transition-all duration-500 overflow-hidden ${
              appState === "idle"
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
              disabled={appState !== "idle"}
              placeholder="OctoBrainに分析を依頼する..."
              className="flex-1 bg-transparent border-none py-4 px-2 text-slate-100 placeholder-slate-500 focus:outline-none disabled:opacity-60 text-base"
            />
            <button
              type="submit"
              disabled={!input.trim() || appState !== "idle"}
              className="m-2 p-3 bg-gradient-to-r from-cyan-600 to-purple-600 hover:from-cyan-500 hover:to-purple-500 disabled:from-slate-800 disabled:to-slate-800 text-white rounded-full transition-all duration-300 disabled:opacity-50 shadow-lg"
            >
              <Send className="w-5 h-5" />
            </button>
          </form>
          <p className="text-center text-xs font-mono text-slate-600 mt-3 tracking-widest">
            OCTOBRAIN ARCHITECTURE: 1 MAIN_CORE + 8 EDGE_NODES
          </p>
        </div>
      </footer>
    </div>
  );
}
