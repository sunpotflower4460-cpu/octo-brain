import { displayFor } from "../config/nodeDisplay";
import type { NodeView } from "../types";

// 「8つの視点を見る」折りたたみ。ノード結果を UI表示名+絵文字のカードで展開。
// timeout / parse_error / error のノードは暗転表示 (隠さない)。

const STATUS_LABEL: Record<string, string> = {
  timeout: "タイムアウト",
  parse_error: "解析失敗",
  error: "エラー",
  skipped: "未起動",
};

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
        <span className="text-sm font-semibold text-slate-200">
          {d.uiName}
        </span>
        {failed ? (
          <span className="ml-auto text-[10px] font-mono uppercase tracking-wider text-rose-400/80">
            {STATUS_LABEL[node.status] ?? node.status}
          </span>
        ) : (
          <span className="ml-auto text-[10px] font-mono text-slate-500">
            {Math.round(node.confidence * 100)}%
          </span>
        )}
      </div>

      {!failed && (
        <>
          <div className="h-1 w-full rounded bg-slate-800 overflow-hidden mb-2">
            <div
              className="h-full bg-gradient-to-r from-cyan-500 to-purple-500"
              style={{ width: `${Math.round(node.confidence * 100)}%` }}
            />
          </div>
          <ul className="space-y-1">
            {node.points.map((p, i) => (
              <li key={i} className="text-xs text-slate-300 leading-snug">
                ・{p}
              </li>
            ))}
            {node.points.length === 0 && (
              <li className="text-xs text-slate-500 italic">(要点なし)</li>
            )}
          </ul>
        </>
      )}
    </div>
  );
}

export default function NodePerspectives({ nodes }: { nodes: NodeView[] }) {
  if (nodes.length === 0) return null;
  return (
    <details className="mt-3 group">
      <summary className="cursor-pointer text-xs font-semibold text-purple-300/80 hover:text-purple-200 select-none">
        8つの視点を見る ({nodes.length})
      </summary>
      <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2">
        {nodes.map((n) => (
          <NodeCard key={n.id} node={n} />
        ))}
      </div>
    </details>
  );
}
