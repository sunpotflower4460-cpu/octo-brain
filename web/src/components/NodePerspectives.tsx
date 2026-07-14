import { useState } from "react";
import { Sparkles } from "lucide-react";
import { displayFor } from "../config/nodeDisplay";
import { canResonate, toggleSelection, type Selected } from "../lib/pairSelect";
import type { NodeView, Opinion, ResonancePair } from "../types";

// 「8つの視点を見る」折りたたみ。opinions(claim/weight/why)をカード表示。
// 各レンズには初見向けの平易な意味(plain)を添える。P2.7 のデザイントークンに統一。
// P2.6: 各 opinion を選択可能にし、異なるレンズの2つを選ぶと掛け合わせ(共鳴)できる。
// timeout / parse_error / error は暗転表示(隠さない)。

const STATUS_LABEL: Record<string, string> = {
  timeout: "タイムアウト",
  parse_error: "解析失敗",
  error: "エラー",
  skipped: "未起動",
};

function OpinionRow({
  op,
  selected,
  onClick,
  disabled,
}: {
  op: Opinion;
  selected: boolean;
  onClick: () => void;
  disabled: boolean;
}) {
  const pct = Math.round(op.weight * 100);
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={`w-full text-left rounded-md px-1.5 py-1 transition-colors disabled:cursor-not-allowed ${
          selected
            ? "bg-[var(--cyan)]/15 ring-1 ring-[var(--cyan)]/60"
            : "hover:bg-[var(--surface-3)]/60"
        }`}
      >
        <div className="flex items-start gap-1.5">
          <span
            className={`mt-1 h-2 w-2 flex-shrink-0 rounded-full border ${
              selected
                ? "border-[var(--cyan)] bg-[var(--cyan)]"
                : "border-[var(--text-muted)] bg-transparent"
            }`}
            style={selected ? {} : { opacity: 0.3 + op.weight * 0.7 }}
            title={`確信度 ${pct}%`}
          />
          <span className="text-xs text-[var(--text-primary)] leading-snug">{op.claim}</span>
        </div>
        {op.why && (
          <div className="ml-3.5 text-[11px] text-[var(--text-muted)]">— {op.why}</div>
        )}
      </button>
    </li>
  );
}

function NodeCard({
  node,
  selectedKeys,
  onToggle,
  busy,
}: {
  node: NodeView;
  selectedKeys: Set<string>;
  onToggle: (node: NodeView, i: number) => void;
  busy: boolean;
}) {
  const d = displayFor(node.id);
  const failed = node.status !== "ok";
  return (
    <div
      className={`rounded-xl border p-3 transition-all ${
        failed
          ? "border-[var(--line-soft)] bg-[var(--surface-1)] opacity-45"
          : "border-[var(--line-soft)] bg-[var(--surface-2)]"
      }`}
    >
      <div className="flex items-baseline gap-2 mb-2">
        <span className="text-lg leading-none" aria-hidden>
          {d.emoji}
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-semibold text-[var(--text-primary)] whitespace-nowrap">
              {d.uiName}
            </span>
            {d.axisLabel && !failed && (
              <span className="text-[9px] font-mono text-[var(--text-muted)] whitespace-nowrap">
                {d.axisLabel}
              </span>
            )}
          </div>
          {/* 初見でも「何を見る腕か」が分かる平易な一言 */}
          {d.plain && (
            <div className="text-[10.5px] text-[var(--text-muted)] leading-tight">{d.plain}</div>
          )}
        </div>
        {failed && (
          <span className="ml-auto flex-shrink-0 text-[10px] font-mono tracking-wider text-[var(--danger)]/80 whitespace-nowrap">
            {STATUS_LABEL[node.status] ?? node.status}
          </span>
        )}
      </div>

      {!failed && (
        <ul className="space-y-1">
          {node.opinions.map((op, i) => (
            <OpinionRow
              key={i}
              op={op}
              selected={selectedKeys.has(`${node.id}:${i}`)}
              disabled={busy}
              onClick={() => onToggle(node, i)}
            />
          ))}
          {node.opinions.length === 0 && (
            <li className="text-xs text-[var(--text-muted)] italic px-1.5">(意見なし)</li>
          )}
        </ul>
      )}
    </div>
  );
}

export default function NodePerspectives({
  nodes,
  onResonate,
  busy = false,
}: {
  nodes: NodeView[];
  onResonate?: (pair: { a: ResonancePair; b: ResonancePair }) => void;
  busy?: boolean;
}) {
  const [selected, setSelected] = useState<Selected[]>([]);
  const [hint, setHint] = useState("");

  if (nodes.length === 0) return null;

  const toggle = (node: NodeView, i: number) => {
    if (busy) return;
    const candidate: Selected = {
      key: `${node.id}:${i}`,
      lens: node.id,
      claim: node.opinions[i]?.claim ?? "",
    };
    setSelected((prev) => {
      const res = toggleSelection(prev, candidate);
      setHint(res.rejected ? "同じレンズ同士は掛け合わせられません" : "");
      return res.selected;
    });
  };

  const ready = canResonate(selected) && !busy;
  const fire = () => {
    if (!ready || !onResonate) return;
    onResonate({
      a: { lens: selected[0].lens, claim: selected[0].claim },
      b: { lens: selected[1].lens, claim: selected[1].claim },
    });
    setSelected([]);
    setHint("");
  };

  const selectedKeys = new Set(selected.map((s) => s.key));

  return (
    <details className="mt-3 group">
      <summary className="cursor-pointer text-xs font-semibold text-[var(--violet)] hover:text-[var(--text-primary)] select-none">
        {nodes.length}つの視点を見る
      </summary>

      <p className="mt-1.5 text-[11px] text-[var(--text-muted)]">
        それぞれの腕が別々に出した見立てです。確信度が高いほど印が濃くなります。
      </p>

      {onResonate && (
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <span className="text-[11px] text-[var(--text-muted)]">
            違う腕の意見を2つ選ぶと、掛け合わせて第三の答えを出せます
          </span>
          <button
            type="button"
            onClick={fire}
            disabled={!ready}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold bg-gradient-to-r from-[var(--cyan)] to-[var(--violet)] text-[#04121a] shadow disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            <Sparkles className="w-3.5 h-3.5" />
            この2つを掛け合わせる
            {selected.length > 0 && ` (${selected.length}/2)`}
          </button>
          {hint && <span className="text-[11px] text-[var(--gold)]">{hint}</span>}
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2">
        {nodes.map((n) => (
          <NodeCard
            key={n.id}
            node={n}
            selectedKeys={selectedKeys}
            onToggle={toggle}
            busy={busy}
          />
        ))}
      </div>
    </details>
  );
}
