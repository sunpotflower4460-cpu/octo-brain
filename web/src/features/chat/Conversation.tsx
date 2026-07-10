import { User } from "lucide-react";
import InsightCard from "./InsightCard";
import ProcessDock from "../cognition/ProcessDock";
import NodePerspectives from "../../components/NodePerspectives";
import NextThought from "../followups/NextThought";
import type { ChatMessage } from "./message";
import type { ResonancePair } from "../../types";

export interface ConversationHandlers {
  busy: boolean;
  deepeningId: string | null;
  resonatingId: string | null;
  onStop: () => void;
  onRetry: (msg: ChatMessage) => void;
  onDeepen: (msg: ChatMessage) => void;
  onResonate: (msg: ChatMessage, pair: { a: ResonancePair; b: ResonancePair }) => void;
}

export default function Conversation({
  messages,
  handlers,
}: {
  messages: ChatMessage[];
  handlers: ConversationHandlers;
}) {
  return (
    <div className="space-y-7">
      {messages.map((msg) =>
        msg.role === "user" ? (
          <div key={msg.id} className="flex justify-end gap-2">
            <div className="max-w-[85%] rounded-[var(--radius)] rounded-tr-sm bg-[var(--surface-3)] px-3.5 py-2.5 text-[15px] text-[var(--text-primary)] whitespace-pre-wrap">
              {msg.content}
            </div>
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[var(--surface-2)] border border-[var(--line-soft)] flex items-center justify-center">
              <User className="w-4 h-4 text-[var(--text-muted)]" aria-hidden />
            </div>
          </div>
        ) : (
          <div key={msg.id} className="max-w-full">
            {msg.trace && (
              <ProcessDock
                trace={msg.trace}
                onStop={msg.streaming ? handlers.onStop : undefined}
              />
            )}

            {msg.errored ? (
              <ErrorPanel msg={msg} onRetry={() => handlers.onRetry(msg)} />
            ) : (
              <InsightCard
                content={msg.content}
                streaming={msg.streaming}
                verifying={msg.trace?.phase === "verify"}
                meta={msg.meta}
                onRetry={
                  msg.sourceInput ? () => handlers.onRetry(msg) : undefined
                }
              />
            )}

            {msg.nodes && msg.nodes.length > 0 && (
              <div className="mt-2">
                <NodePerspectives
                  nodes={msg.nodes}
                  busy={handlers.busy}
                  onResonate={(pair) => handlers.onResonate(msg, pair)}
                />
              </div>
            )}

            <NextThought
              msg={msg}
              busy={handlers.busy}
              deepening={handlers.deepeningId === msg.id}
              resonating={handlers.resonatingId === msg.id}
              onDeepen={() => handlers.onDeepen(msg)}
              onResonateAI={(pair) => handlers.onResonate(msg, pair)}
            />
          </div>
        ),
      )}
    </div>
  );
}

function ErrorPanel({ msg, onRetry }: { msg: ChatMessage; onRetry: () => void }) {
  return (
    <div className="rounded-[var(--radius)] border border-[var(--danger)]/30 bg-[var(--surface-2)] p-4">
      {msg.content && (
        <div className="mb-2 text-[15px] text-[var(--text-primary)] whitespace-pre-wrap">
          {msg.content}
        </div>
      )}
      <p className="text-[13px] text-[var(--text-secondary)]">
        {msg.errorMessage ?? "接続が途切れました。途中までの回答は残しています。"}
      </p>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={onRetry}
          className="min-h-[40px] px-4 rounded-full text-xs font-semibold bg-[var(--surface-3)] text-[var(--text-primary)] hover:bg-[var(--surface-1)] transition-colors"
        >
          再試行
        </button>
      </div>
    </div>
  );
}
