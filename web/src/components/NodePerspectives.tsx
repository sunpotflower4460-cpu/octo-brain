import { displayFor } from "../config/nodeDisplay";
import type { NodeView, Opinion } from "../types";

// 「8つの視点を見る」折りたたみ。レンズ結果を UI表示名+絵文字のカードで展開。
// opinions(claim/weight/why)を表示。timeout / parse_error / error は暗転表示(隠さない)。

const STATUS_LABEL: Record<string, string> = {
  timeout: "タイムアウト",
  parse_error: "解析失敗",
  error: "エラー",
  skipped: "未起動",
};

function OpinionRow({ op }: { op: Opinion }) {
  const pct = Math.round(op.weight * 100);
  return (
    <li className="text-xs leading-snug">
      <div className="flex items-start gap-1.5">
        <span
          className="mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-gradient-to-r from-cyan-400 to-purple-400"
          style={{ opacity: 0.3 + op.weight * 0.7 }}
          title={`確信度 ${pct}%`}
        />
        <span className="text-slate-200">{op.claim}</span>
      </div>
      {op.why && (
        <div className="ml-3 text-[11px] text-slate-500">— {op.why}</div>
      )}
    </li>
  );
}

function NodeCard({ node }: { node: NodeView }) {
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
        <ul className="space-y-1.5">
          {node.opinions.map((op, i) => (
            <OpinionRow key={i} op={op} />
          ))}
          {node.opinions.length === 0 && (
            <li className="text-xs text-slate-500 italic">(意見なし)</li>
          )}
        </ul>
      )}
    </div>
  );
}

export default function NodePerspectives({ nodes }: { nodes: NodeView[] }) {
  if (nodes.length === 0) return null;
  return (
    <details className="mt-3 group">
      <summary className="cursor-pointer text-xs font-semibold text-purple-300/80 hover:text-purple-200 select-none">
        {nodes.length}つの視点を見る
      </summary>
      <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2">
        {nodes.map((n) => (
          <NodeCard key={n.id} node={n} />
        ))}
      </div>
    </details>
  );
}
