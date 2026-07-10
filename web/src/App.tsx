import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import { analyzeStream, deepen, resonate } from "./lib/api";
import { LENS_ORDER, armsForAxis, displayFor } from "./config/nodeDisplay";
import {
  createTrace,
  traceOnPhase,
  traceOnNode,
  traceOnDone,
  traceOnError,
  traceOnCancel,
  type ThoughtTrace,
  type UiPhase,
} from "./lib/cognition";
import { presentPhase } from "./lib/phasePresentation";
import { useReducedMotion } from "./hooks/useReducedMotion";
import { useAutoScroll } from "./hooks/useAutoScroll";
import LivingCore from "./features/cognition/LivingCore";
import Hero from "./features/chat/Hero";
import Conversation from "./features/chat/Conversation";
import Composer from "./features/chat/Composer";
import StatusAnnouncer from "./components/StatusAnnouncer";
import type { ChatMessage } from "./features/chat/message";
import type { NodeView, Plan, ResonancePair, SSEPhase } from "./types";

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `c-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [plan, setPlan] = useState<Plan>("light");
  const [busy, setBusy] = useState(false);
  const [deepeningId, setDeepeningId] = useState<string | null>(null);
  const [resonatingId, setResonatingId] = useState<string | null>(null);
  const [coreAction, setCoreAction] = useState<{
    kind: "tension" | "resonance";
    ids: string[];
  } | null>(null);

  const reducedMotion = useReducedMotion();
  const { scrollRef, sentinelRef, showJump, scrollToBottom, followIfAtBottom } =
    useAutoScroll(reducedMotion);

  const summaryRef = useRef("");
  const clientIdRef = useRef(uuid());
  const abortRef = useRef<AbortController | null>(null);
  const abortedByUserRef = useRef(false);

  const patch = (id: string, p: Partial<ChatMessage>) =>
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...p } : m)));

  const applyTrace = (id: string, fn: (t: ThoughtTrace) => ThoughtTrace) =>
    setMessages((prev) =>
      prev.map((m) => (m.id === id && m.trace ? { ...m, trace: fn(m.trace) } : m)),
    );

  // ---- 送信 ----
  const runAnalyze = async (text: string) => {
    const assistantId = uuid();
    setMessages((prev) => [
      ...prev,
      { id: uuid(), role: "user", content: text },
      {
        id: assistantId,
        role: "assistant",
        content: "",
        sourceInput: text,
        streaming: true,
        trace: createTrace(now()),
      },
    ]);
    setBusy(true);
    followIfAtBottom();
    setTimeout(() => scrollToBottom("auto"), 0);

    const ac = new AbortController();
    abortRef.current = ac;
    abortedByUserRef.current = false;

    // token バッファ + rAF フラッシュ (§6.6)
    let buffer = "";
    let acc = "";
    let scheduled = false;
    const flush = () => {
      scheduled = false;
      if (buffer.length === 0) return;
      acc += buffer;
      buffer = "";
      patch(assistantId, { content: acc });
      followIfAtBottom();
    };
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(flush);
    };

    await analyzeStream(
      { input: text, summary: summaryRef.current || undefined, plan, clientId: clientIdRef.current },
      {
        onPhase: (phase: SSEPhase, nodeIds?: string[]) =>
          applyTrace(assistantId, (t) => traceOnPhase(t, phase as UiPhase, nodeIds)),
        onNode: (node: NodeView) => applyTrace(assistantId, (t) => traceOnNode(t, node)),
        onToken: (tk: string) => {
          buffer += tk;
          schedule();
        },
        onDone: (payload) => {
          flush();
          summaryRef.current = payload.summary;
          patch(assistantId, {
            content: payload.answer,
            nodes: payload.nodes,
            meta: payload.meta,
            streaming: false,
          });
          applyTrace(assistantId, (t) => traceOnDone(t, now(), payload.meta.quorum));
        },
        onError: (message) => {
          flush();
          if (abortedByUserRef.current) {
            patch(assistantId, { streaming: false, content: acc });
            applyTrace(assistantId, (t) => traceOnCancel(t, now()));
          } else {
            patch(assistantId, {
              streaming: false,
              errored: true,
              content: acc,
              errorMessage: humanError(message),
            });
            applyTrace(assistantId, (t) => traceOnError(t));
          }
        },
      },
      ac.signal,
    );
    abortRef.current = null;
    setBusy(false);
  };

  const handleSubmit = () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    void runAnalyze(text);
  };

  const handleStop = () => {
    abortedByUserRef.current = true;
    abortRef.current?.abort();
  };

  const handleRetry = (msg: ChatMessage) => {
    if (busy || !msg.sourceInput) return;
    void runAnalyze(msg.sourceInput);
  };

  // ---- 深化 ----
  const handleDeepen = async (msg: ChatMessage) => {
    const tension = msg.meta?.tension;
    if (busy || !tension || !msg.sourceInput) return;
    const ids = armsForAxis(tension.axis).map((i) => LENS_ORDER[i]);
    setCoreAction({ kind: "tension", ids });
    setBusy(true);
    setDeepeningId(msg.id);
    try {
      const res = await deepen({
        input: msg.sourceInput,
        summary: summaryRef.current || undefined,
        tension: { axis: tension.axis },
        priorAnswer: msg.content,
        clientId: clientIdRef.current,
      });
      patch(msg.id, { deepened: { answer: res.answer, axis: res.meta.axis }, deepenError: undefined });
    } catch (err) {
      patch(msg.id, { deepenError: err instanceof Error ? err.message : String(err) });
    } finally {
      setDeepeningId(null);
      setCoreAction(null);
      setBusy(false);
    }
  };

  // ---- 共鳴 (AI提案 / ユーザー選択 同経路) ----
  const handleResonate = async (
    msg: ChatMessage,
    pair: { a: ResonancePair; b: ResonancePair },
  ) => {
    if (busy || !msg.sourceInput) return;
    setCoreAction({ kind: "resonance", ids: [pair.a.lens, pair.b.lens] });
    setBusy(true);
    setResonatingId(msg.id);
    const label = `${displayFor(pair.a.lens).uiName} × ${displayFor(pair.b.lens).uiName}`;
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
            ? { ...m, resonances: [...(m.resonances ?? []), { label, answer: res.answer }], resonateError: undefined }
            : m,
        ),
      );
    } catch (err) {
      patch(msg.id, { resonateError: err instanceof Error ? err.message : String(err) });
    } finally {
      setResonatingId(null);
      setCoreAction(null);
      setBusy(false);
    }
  };

  // ---- Living Core が映す trace ----
  const streamingMsg = messages.find((m) => m.streaming);
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  const coreTrace: ThoughtTrace | null = useMemo(() => {
    if (streamingMsg?.trace) return streamingMsg.trace;
    if (coreAction) {
      const phase: UiPhase = coreAction.kind === "tension" ? "deepening" : "resonating";
      return {
        phase,
        activeNodeIds: coreAction.ids,
        nodeStates: Object.fromEntries(coreAction.ids.map((id) => [id, "working" as const])),
        startedAt: 0,
      };
    }
    return lastAssistant?.trace ?? null;
  }, [streamingMsg, coreAction, lastAssistant]);
  const coreEmphasis = coreAction
    ? { ids: coreAction.ids, kind: coreAction.kind }
    : undefined;

  // ---- ステータス通知 (a11y) ----
  const statusMsg = useMemo(() => {
    const t = streamingMsg?.trace ?? (coreAction ? coreTrace : null);
    if (!t) return "";
    const p = presentPhase(t.phase);
    return `${p.name}: ${p.hint}`;
  }, [streamingMsg, coreAction, coreTrace]);

  useEffect(() => {
    followIfAtBottom();
  }, [messages, followIfAtBottom]);

  const empty = messages.length === 0;

  return (
    <div className="h-[100dvh] flex flex-col bg-[var(--bg-abyss)] text-[var(--text-primary)] overflow-hidden">
      <header
        className="flex-shrink-0 flex items-center justify-center border-b border-[var(--line-soft)] px-4"
        style={{ paddingTop: "calc(var(--safe-top) + 10px)", paddingBottom: 10 }}
      >
        <span className="text-sm font-semibold tracking-wide text-[var(--text-secondary)]">
          OctoBrain
        </span>
      </header>

      <main className="flex-1 min-h-0 flex">
        {/* 左: Living Core (desktop) */}
        <aside className="hidden lg:flex flex-col w-[var(--core-col)] flex-shrink-0 border-r border-[var(--line-soft)] p-5">
          <div className="sticky top-5">
            <LivingCore
              trace={coreTrace}
              reducedMotion={reducedMotion}
              emphasis={coreEmphasis}
              variant={empty && !busy ? "hero" : "working"}
            />
          </div>
        </aside>

        {/* 右: 会話 */}
        <div className="flex-1 min-w-0 flex flex-col relative">
          {/* モバイル: 処理中のみ Compact Core */}
          {(busy || coreAction) && (
            <div className="lg:hidden flex-shrink-0 border-b border-[var(--line-soft)] px-4 py-2">
              <LivingCore
                trace={coreTrace}
                reducedMotion={reducedMotion}
                emphasis={coreEmphasis}
                variant="compact"
              />
            </div>
          )}

          <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain">
            <div className="mx-auto w-full max-w-[var(--read-max)] px-4 md:px-6 py-6">
              {empty ? (
                <Hero onPick={(t) => setInput(t)} />
              ) : (
                <Conversation
                  messages={messages}
                  handlers={{
                    busy,
                    deepeningId,
                    resonatingId,
                    onStop: handleStop,
                    onRetry: handleRetry,
                    onDeepen: handleDeepen,
                    onResonate: handleResonate,
                  }}
                />
              )}
              <div ref={sentinelRef} className="h-2" />
            </div>
          </div>

          {showJump && !empty && (
            <button
              type="button"
              onClick={() => scrollToBottom()}
              className="absolute left-1/2 -translate-x-1/2 bottom-3 z-10 inline-flex items-center gap-1 min-h-[36px] px-3 rounded-full text-xs font-semibold bg-[var(--surface-3)] text-[var(--text-primary)] border border-[var(--line-strong)] shadow-lg"
            >
              <ArrowDown className="w-3.5 h-3.5" />
              新しい回答へ
            </button>
          )}

          <Composer
            value={input}
            onChange={setInput}
            onSubmit={handleSubmit}
            onStop={handleStop}
            busy={busy}
            plan={plan}
            onPlanChange={setPlan}
          />
        </div>
      </main>

      <StatusAnnouncer message={statusMsg} />
    </div>
  );
}

function humanError(_raw: string): string {
  // 生の HTTP 本文をユーザーへ出さない (§15.1)
  return "接続が途切れました。途中までの回答は残しています。";
}
