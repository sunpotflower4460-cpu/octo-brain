import { useState } from "react";
import { Sparkles } from "lucide-react";
import { displayFor } from "../config/nodeDisplay";
import { canResonate, toggleSelection, type Selected } from "../lib/pairSelect";
import type { NodeView, Opinion, ResonancePair } from "../types";

// 「8つの視点を見る」折りたたみ。opinions(claim/weight/why)をカード表示。
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
            ? "bg-cyan-500/15 ring-1 ring-cyan-400/60"
            : "hover:bg-slate-800/50"
        }`}
      >
        <div className="flex items-start gap-1.5">
          <span
            className={`mt-1 h-2 w-2 flex-shrink-0 rounded-full border ${
              selected
                ? "border-cyan-300 bg-cyan-300"
                : "border-slate-500 bg-transparent"
            }`}
            style={selected ? {} : { opacity: 0.3 + op.weight * 0.7 }}
            title={`確信度 ${pct}%`}
          />
          <span className="text-xs text-slate-200 leading-snug">{op.claim}</span>
        </div>
        {op.why && (
          <div className="ml-3.5 text-[11px] text-slate-500">— {op.why}</div>
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
      className={`rounded-xl border p-3 backdrop-blur-sm transition-all ${
        failed
          ? "border-slate-800/60 bg-slate-900/40 opacity-40"
          : "border-purple-900/40 bg-slate-900/60"
      }`}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="text-lg" aria-hidden>
          {d.emoji}
        </span>
        <span className="text-sm font-semibold text-slate-200">{d.uiName}</span>
        {d.axisLabel && (
          <span className="text-[9px] font-mono text-slate-600">
            {d.axisLabel}
          </span>
        )}
        {failed && (
          <span className="ml-auto text-[10px] font-mono uppercase tracking-wider text-rose-400/80">
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
            <li className="text-xs text-slate-500 italic px-1.5">(意見なし)</li>
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
      <summary className="cursor-pointer text-xs font-semibold text-purple-300/80 hover:text-purple-200 select-none">
        {nodes.length}つの視点を見る
      </summary>

      {onResonate && (
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <span className="text-[11px] text-slate-500">
            2つの意見を選ぶと掛け合わせられます
          </span>
          <button
            type="button"
            onClick={fire}
            disabled={!ready}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold bg-gradient-to-r from-cyan-600 to-sky-600 hover:from-cyan-500 hover:to-sky-500 text-white shadow disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            <Sparkles className="w-3.5 h-3.5" />
            この2つを掛け合わせる
            {selected.length > 0 && ` (${selected.length}/2)`}
          </button>
          {hint && <span className="text-[11px] text-amber-400/80">{hint}</span>}
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
