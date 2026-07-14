import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, HelpCircle, Menu, Plus, Settings as SettingsIcon, WifiOff } from "lucide-react";
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
import { useOnlineStatus } from "./hooks/useOnlineStatus";
import {
  createStorage,
  titleFromInput,
  type ConversationMeta,
  type StorageAdapter,
  type StoredConversation,
} from "./lib/storage/db";
import {
  DEFAULT_SETTINGS,
  isOnboarded,
  loadSettings,
  saveSettings,
  setOnboarded,
  type Settings,
} from "./lib/settings";
import { initNativeShell } from "./lib/native/shell";
import LivingCore from "./features/cognition/LivingCore";
import Hero from "./features/chat/Hero";
import Conversation from "./features/chat/Conversation";
import Composer from "./features/chat/Composer";
import ConversationList from "./features/conversations/ConversationList";
import Onboarding from "./features/onboarding/Onboarding";
import SettingsPanel from "./features/settings/SettingsPanel";
import StatusAnnouncer from "./components/StatusAnnouncer";
import type { ChatMessage } from "./features/chat/message";
import type { NodeView, Plan, ResonancePair, SSEPhase } from "./types";

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `c-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
const wallNow = () => Date.now();

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

  // ---- Stage ④: 永続化 / 会話 / 設定 / オンボーディング / オフライン ----
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [convMetas, setConvMetas] = useState<ConversationMeta[]>([]);
  const [currentConvId, setCurrentConvId] = useState<string | null>(null);
  const [storageAvailable, setStorageAvailable] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const online = useOnlineStatus();

  const reducedMotion = useReducedMotion(settings.motion);
  const { scrollRef, sentinelRef, showJump, scrollToBottom, followIfAtBottom } =
    useAutoScroll(reducedMotion);

  const summaryRef = useRef("");
  const clientIdRef = useRef(uuid());
  const abortRef = useRef<AbortController | null>(null);
  const abortedByUserRef = useRef(false);

  // 同期アクセス用ミラー(永続化・会話切替で使う)
  const storageRef = useRef<StorageAdapter | null>(null);
  const messagesRef = useRef<ChatMessage[]>(messages);
  const inputRef = useRef(input);
  const currentConvIdRef = useRef<string | null>(currentConvId);
  const convCreatedAtRef = useRef(0);
  const convTitleRef = useRef("");
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  useEffect(() => {
    inputRef.current = input;
  }, [input]);
  useEffect(() => {
    currentConvIdRef.current = currentConvId;
  }, [currentConvId]);

  const patch = (id: string, p: Partial<ChatMessage>) =>
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...p } : m)));

  const applyTrace = (id: string, fn: (t: ThoughtTrace) => ThoughtTrace) =>
    setMessages((prev) =>
      prev.map((m) => (m.id === id && m.trace ? { ...m, trace: fn(m.trace) } : m)),
    );

  // ---- 永続化ヘルパー ----
  const refreshMetas = useCallback(async () => {
    const s = storageRef.current;
    if (!s) return;
    setConvMetas(await s.list());
  }, []);

  const buildStored = useCallback((): StoredConversation | null => {
    const id = currentConvIdRef.current;
    if (!id) return null;
    return {
      id,
      title: convTitleRef.current || "新しい会話",
      createdAt: convCreatedAtRef.current || wallNow(),
      updatedAt: wallNow(),
      messages: messagesRef.current,
      summary: summaryRef.current,
      draft: inputRef.current,
    };
  }, []);

  const persistNow = useCallback(async () => {
    const s = storageRef.current;
    const conv = buildStored();
    if (!s || !conv) return;
    await s.save(conv);
    // メタ一覧を楽観更新(並べ替えのため)
    setConvMetas((prev) => {
      const meta = { id: conv.id, title: conv.title, updatedAt: conv.updatedAt };
      const rest = prev.filter((m) => m.id !== conv.id);
      return [meta, ...rest].sort((a, b) => b.updatedAt - a.updatedAt);
    });
  }, [buildStored]);

  const schedulePersist = useCallback(() => {
    if (!currentConvIdRef.current) return;
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      void persistNow();
    }, 500);
  }, [persistNow]);

  const flushPersist = useCallback(async () => {
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
    await persistNow();
  }, [persistNow]);

  // ---- マウント: storage/設定/オンボーディングの初期化 ----
  useEffect(() => {
    let cancelled = false;
    void initNativeShell(); // ネイティブのみ StatusBar/Keyboard/Splash を整える(web は no-op)
    (async () => {
      const loaded = await loadSettings();
      if (!cancelled) setSettings(loaded);
      const s = await createStorage();
      if (cancelled) return;
      storageRef.current = s;
      setStorageAvailable(s.available);
      const metas = await s.list();
      if (cancelled) return;
      setConvMetas(metas);
      // 直近の会話を復元
      if (metas.length > 0) {
        const conv = await s.get(metas[0].id);
        if (!cancelled && conv) {
          setMessages(conv.messages);
          summaryRef.current = conv.summary;
          convCreatedAtRef.current = conv.createdAt;
          convTitleRef.current = conv.title;
          setCurrentConvId(conv.id);
          if (conv.draft) setInput(conv.draft);
        }
      }
      if (!cancelled && !(await isOnboarded())) setShowOnboarding(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 会話内容(回答完了・深化・共鳴結果)と draft を反応的に保存する。
  // 命令的な保存だと React の state 反映前に古い messagesRef を読み、完了trace が
  // 保存されず再読込で「停止」に化ける。effect にすることで最新描画後に保存できる。
  // ストリーム中は毎フレーム messages が変わるが debounce が末尾(=done)に集約する。
  useEffect(() => {
    schedulePersist();
  }, [messages, input, schedulePersist]);

  // ---- 会話ライフサイクル ----
  const ensureConversation = (firstInput: string) => {
    if (currentConvIdRef.current) return;
    const id = uuid();
    currentConvIdRef.current = id;
    convCreatedAtRef.current = wallNow();
    convTitleRef.current = titleFromInput(firstInput);
    setCurrentConvId(id);
  };

  const newConversation = async () => {
    await flushPersist();
    setMessages([]);
    setInput("");
    summaryRef.current = "";
    convCreatedAtRef.current = 0;
    convTitleRef.current = "";
    currentConvIdRef.current = null;
    setCurrentConvId(null);
    setDrawerOpen(false);
  };

  const selectConversation = async (id: string) => {
    if (id === currentConvIdRef.current) {
      setDrawerOpen(false);
      return;
    }
    await flushPersist();
    const s = storageRef.current;
    if (!s) return;
    const conv = await s.get(id);
    if (!conv) return;
    setMessages(conv.messages);
    summaryRef.current = conv.summary;
    convCreatedAtRef.current = conv.createdAt;
    convTitleRef.current = conv.title;
    currentConvIdRef.current = conv.id;
    setCurrentConvId(conv.id);
    setInput(conv.draft ?? "");
    setDrawerOpen(false);
  };

  const renameConversation = async (id: string, title: string) => {
    const s = storageRef.current;
    if (!s) return;
    if (id === currentConvIdRef.current) {
      convTitleRef.current = title;
      await persistNow();
      return;
    }
    const conv = await s.get(id);
    if (!conv) return;
    await s.save({ ...conv, title, updatedAt: wallNow() });
    await refreshMetas();
  };

  const removeConversation = async (id: string) => {
    const s = storageRef.current;
    if (!s) return;
    await s.remove(id);
    if (id === currentConvIdRef.current) {
      setMessages([]);
      setInput("");
      summaryRef.current = "";
      convCreatedAtRef.current = 0;
      convTitleRef.current = "";
      currentConvIdRef.current = null;
      setCurrentConvId(null);
    }
    await refreshMetas();
  };

  const deleteAllData = async () => {
    const s = storageRef.current;
    if (s) await s.clear();
    setConvMetas([]);
    setMessages([]);
    setInput("");
    summaryRef.current = "";
    convCreatedAtRef.current = 0;
    convTitleRef.current = "";
    currentConvIdRef.current = null;
    setCurrentConvId(null);
    setSettingsOpen(false);
  };

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
        onError: (message, info) => {
          flush();
          // ユーザー中断(停止ボタン or aborted コード)は失敗ではなく取り消し
          if (abortedByUserRef.current || info?.code === "aborted") {
            patch(assistantId, { streaming: false, content: acc });
            applyTrace(assistantId, (t) => traceOnCancel(t, now()));
          } else {
            // message は api クライアント側で既に平易化済み(429/504/5xx/ネットワーク)
            patch(assistantId, {
              streaming: false,
              errored: true,
              content: acc,
              errorMessage: message,
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
    submitText(input);
  };

  const submitText = (raw: string) => {
    const text = raw.trim();
    if (!text || busy) return;
    if (!online) {
      // オフライン時は送らず入力欄に載せるだけ(バナーで告知)
      setInput(text);
      return;
    }
    ensureConversation(text);
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

  // ---- 設定 ----
  const updateSettings = (s: Settings) => {
    setSettings(s);
    void saveSettings(s);
  };

  const finishOnboarding = () => {
    void setOnboarded(true);
    setShowOnboarding(false);
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
  const showMobileCore = busy || !!coreAction || (settings.core === "always" && !empty);

  return (
    <div className="h-[100dvh] flex flex-col bg-[var(--bg-abyss)] text-[var(--text-primary)] overflow-hidden">
      <header
        className="flex-shrink-0 flex items-center gap-1 border-b border-[var(--line-soft)] px-2 sm:px-4"
        style={{ paddingTop: "calc(var(--safe-top) + 10px)", paddingBottom: 10 }}
      >
        <button
          type="button"
          aria-label="会話一覧"
          onClick={() => setDrawerOpen(true)}
          className="w-9 h-9 flex items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--text-primary)]"
        >
          <Menu className="w-5 h-5" />
        </button>
        <span className="flex-1 text-center text-sm font-semibold tracking-wide text-[var(--text-secondary)]">
          OctoBrain
        </span>
        <button
          type="button"
          aria-label="使い方"
          onClick={() => setShowOnboarding(true)}
          className="w-9 h-9 flex items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--text-primary)]"
        >
          <HelpCircle className="w-5 h-5" />
        </button>
        <button
          type="button"
          aria-label="新しい会話"
          onClick={() => void newConversation()}
          className="w-9 h-9 flex items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--text-primary)]"
        >
          <Plus className="w-5 h-5" />
        </button>
        <button
          type="button"
          aria-label="設定"
          onClick={() => setSettingsOpen(true)}
          className="w-9 h-9 flex items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--text-primary)]"
        >
          <SettingsIcon className="w-5 h-5" />
        </button>
      </header>

      {!online && (
        <div
          className="flex-shrink-0 flex items-center justify-center gap-2 bg-[var(--gold)]/15 text-[var(--gold)] text-[12px] py-1.5 px-4"
          role="status"
        >
          <WifiOff className="w-3.5 h-3.5" aria-hidden />
          オフラインです。接続が戻ると送信できます。
        </div>
      )}

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
          {/* モバイル: Compact Core */}
          {showMobileCore && (
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
                <Hero onPick={submitText} onHowItWorks={() => setShowOnboarding(true)} />
              ) : (
                <Conversation
                  messages={messages}
                  detailOpen={settings.detail === "detailed"}
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

      {drawerOpen && (
        <ConversationList
          metas={convMetas}
          currentId={currentConvId}
          storageAvailable={storageAvailable}
          onSelect={(id) => void selectConversation(id)}
          onNew={() => void newConversation()}
          onRename={(id, title) => void renameConversation(id, title)}
          onDelete={(id) => void removeConversation(id)}
          onClose={() => setDrawerOpen(false)}
        />
      )}

      {settingsOpen && (
        <SettingsPanel
          settings={settings}
          onChange={updateSettings}
          onReshowOnboarding={() => {
            setSettingsOpen(false);
            setShowOnboarding(true);
          }}
          onDeleteData={() => void deleteAllData()}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {showOnboarding && (
        <Onboarding reducedMotion={reducedMotion} onDone={finishOnboarding} />
      )}

      <StatusAnnouncer message={statusMsg} />
    </div>
  );
}
