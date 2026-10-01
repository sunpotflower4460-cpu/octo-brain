import { displayFor } from "../../config/nodeDisplay";
import type { NodeView, PerspectiveMap } from "../../types";

// 視点の地図。1つのモデルが最善の答えに畳むと見えなくなる「視点の分かれ方」を見せる
// (OctoBrain にしかできない部分: 合意の強さ・割れたところ・ひとつだけの指摘)。
function Lens({ id, world }: { id: string; world?: string }) {
  const d = displayFor(id);
  return (
    <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--text-secondary)]">
      <span aria-hidden>{d.emoji}</span>
      {d.uiName}
      {world && <span className="font-normal text-[var(--text-muted)]">・{world}</span>}
    </span>
  );
}

export default function PerspectiveMapCard({
  map,
  nodes,
  check = false,
}: {
  map: PerspectiveMap;
  nodes?: NodeView[];
  // 照合モード(法律・事実の質問): 視点の「意見の分かれ方」ではなく「確かめの一致・食い違い」として見せる
  check?: boolean;
}) {
  const label = check
    ? { title: "照合の地図", lead: "それぞれの視点が別々に確かめた結果の、一致と食い違いです。", lone: "ひとつの視点だけが挙げた条件", split: "食い違ったところ(要確認)", agree: "一致した事実" }
    : { title: "視点の地図", lead: "ひとつの答えにまとめると見えなくなる、視点の分かれ方です。", lone: "ひとつの視点だけが指摘", split: "割れたところ", agree: "そろった見方" };
  // 分母は「実際に意見を出せた視点」の数(起動していない・降りた腕は数えない)
  const usable = (nodes ?? []).filter((n) => n.status === "ok" && n.opinions.length > 0 && !n.flag).length;
  return (
    <section
      aria-label={label.title}
      className="mt-3 rounded-[var(--radius)] border border-[var(--line-soft)] bg-[var(--surface-1)] p-4 space-y-4"
    >
      <div>
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">{label.title}</h3>
        <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">{label.lead}</p>
      </div>

      {map.essence && (
        <div className="rounded-[var(--radius-sm)] border border-[var(--cyan)]/40 bg-[var(--cyan)]/10 p-3">
          <span className="text-[11px] font-semibold text-[var(--cyan)]">世界をまたぐ本質</span>
          <p className="mt-1.5 text-[14px] leading-relaxed text-[var(--text-primary)]">{map.essence.point}</p>
          <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--text-muted)]">
            {map.essence.worlds.join("・")} — 違う世界の経験が、同じところを指していました
          </p>
        </div>
      )}

      {map.lone && (
        <div className="rounded-[var(--radius-sm)] border border-[var(--violet)]/40 bg-[var(--violet)]/10 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold text-[var(--violet)]">{label.lone}</span>
            <Lens id={map.lone.lens} world={map.lone.world} />
          </div>
          <p className="mt-1.5 text-[14px] leading-relaxed text-[var(--text-primary)]">{map.lone.claim}</p>
          <p className="mt-1 text-[12px] leading-relaxed text-[var(--text-muted)]">{map.lone.why}</p>
        </div>
      )}

      {map.split && (
        <div>
          <div className="text-[11px] font-semibold text-[var(--text-muted)]">
            {label.split}・{map.split.about}
          </div>
          <div className="mt-1.5 grid grid-cols-1 sm:grid-cols-2 gap-2">
            {[map.split.a, map.split.b].map((p) => (
              <div key={p.lens} className="rounded-[var(--radius-sm)] bg-[var(--surface-2)] p-2.5">
                <Lens id={p.lens} world={p.world} />
                <p className="mt-1 text-[13px] leading-relaxed text-[var(--text-primary)]">{p.claim}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {map.agree && (
        <div>
          <div className="text-[11px] font-semibold text-[var(--text-muted)]">
            {label.agree}{usable > 0 ? `・${usable}つ中${map.agree.lenses.length}つ` : ""}
          </div>
          <p className="mt-1 text-[13px] leading-relaxed text-[var(--text-primary)]">{map.agree.point}</p>
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
            {map.agree.lenses.map((l) => (
              <Lens key={l} id={l} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
