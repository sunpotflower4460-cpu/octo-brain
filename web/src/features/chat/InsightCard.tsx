import { Copy, RotateCcw, Share2, Check, Flag } from "lucide-react";
import { useState } from "react";
import Markdown from "../../components/Markdown";
import Disclosure from "../../components/Disclosure";
import IconButton from "../../components/IconButton";
import type { AnalyzeMeta } from "../../types";
import { SUPPORT_EMAIL, reportMailto } from "../../config/appInfo";

// OctoBrain の回答は通常の吹き出しではなく、静かで読みやすい Insight Card (§7.1)。
export default function InsightCard({
  content,
  streaming,
  verifying,
  cancelled,
  meta,
  onRetry,
}: {
  content: string;
  streaming?: boolean;
  verifying?: boolean;
  cancelled?: boolean;
  meta?: AnalyzeMeta;
  onRetry?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  // 報告: メールアプリを開く。開かない端末向けに宛先も表示する(1.2 報告導線)
  const [reported, setReported] = useState(false);
  const report = () => {
    setReported(true);
    window.location.href = reportMailto(content);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard 非対応時は無視 */
    }
  };

  const share = async () => {
    const nav = navigator as Navigator & { share?: (d: { text: string }) => Promise<void> };
    if (nav.share) {
      try {
        await nav.share({ text: content });
        return;
      } catch {
        /* キャンセル等 */
      }
    }
    void copy();
  };

  return (
    <article
      className="rounded-[var(--radius)] border border-[var(--line-soft)] bg-[var(--surface-2)] p-4 md:p-5"
      aria-busy={streaming}
    >
      {verifying && (
        <div className="mb-2 inline-flex items-center gap-1.5 text-[11px] text-[var(--gold)]">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--gold)]" aria-hidden />
          最終確認中
        </div>
      )}

      {content.length === 0 && !streaming && cancelled ? (
        <div className="flex items-center justify-between gap-3 text-sm text-[var(--text-muted)]">
          <span>停止しました。</span>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="min-h-[36px] px-3 rounded-full text-xs font-semibold text-[var(--text-secondary)] bg-[var(--surface-3)]"
            >
              もう一度考える
            </button>
          )}
        </div>
      ) : content.length === 0 && streaming ? (
        <div className="space-y-2" aria-hidden>
          <div className="h-3.5 w-3/4 rounded bg-[var(--surface-3)] animate-pulse" />
          <div className="h-3.5 w-5/6 rounded bg-[var(--surface-3)] animate-pulse" />
          <div className="h-3.5 w-2/3 rounded bg-[var(--surface-3)] animate-pulse" />
        </div>
      ) : (
        <div
          className="text-[15px] md:text-[16px] text-[var(--text-primary)]"
          style={{ lineHeight: 1.75 }}
        >
          <Markdown>{content}</Markdown>
          {streaming && (
            <span
              className="inline-block w-[2px] h-[1.1em] ml-0.5 align-[-2px] bg-[var(--violet)] animate-pulse"
              aria-hidden
            />
          )}
        </div>
      )}

      {!streaming && content.length > 0 && (
        <div className="mt-3 flex items-center gap-1 flex-wrap border-t border-[var(--line-soft)] pt-2">
          <IconButton
            icon={copied ? Check : Copy}
            label={copied ? "コピーしました" : "コピー"}
            onClick={copy}
          />
          <IconButton icon={Share2} label="共有" onClick={share} showLabel={false} />
          {onRetry && (
            <IconButton icon={RotateCcw} label="再試行" onClick={onRetry} showLabel={false} />
          )}
          <IconButton icon={Flag} label="この回答を報告" onClick={report} showLabel={false} />
          {meta && (
            <div className="ml-auto">
              <MetaDisclosure meta={meta} />
            </div>
          )}
        </div>
      )}

      {!streaming && content.length > 0 && reported && (
        <p className="mt-2 text-[12px] text-[var(--text-muted)] leading-snug" role="status">
          メールが開かない場合は {SUPPORT_EMAIL} までお送りください。
        </p>
      )}

      {!streaming && content.length > 0 && (
        <p className="mt-2 text-[11px] text-[var(--text-muted)] leading-snug">
          AI による生成です。誤りを含むことがあり、医療・法律・お金などの専門的な助言の代わりにはなりません。
        </p>
      )}

      {!streaming && meta?.economy && (
        <p className="mt-2 text-[11px] text-[var(--text-muted)] leading-snug">
          利用が集中しているため、軽いモードで回答しました。
        </p>
      )}

      {!streaming && meta?.fallback && (
        <p className="mt-2 text-[11px] text-[var(--text-muted)] leading-snug">
          一部の腕が戻れなかったため、中央脳だけで回答しました。
        </p>
      )}
    </article>
  );
}

function MetaDisclosure({ meta }: { meta: AnalyzeMeta }) {
  // quorum は "成功数/起動数"。観点は計画上の固定値ではなく実際の分母を使う。
  const launched = Number(meta.quorum.split("/")[1]) || (meta.plan === "deep" ? 8 : 4);
  const secs = (meta.ms / 1000).toFixed(1);
  return (
    <Disclosure summary={<span>処理の詳細</span>}>
      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px] text-[var(--text-secondary)] min-w-[220px]">
        <dt className="text-[var(--text-muted)]">使用モード</dt>
        <dd>{meta.plan === "deep" ? "ディープ" : "ライト"}</dd>
        <dt className="text-[var(--text-muted)]">観点</dt>
        <dd>{launched}</dd>
        <dt className="text-[var(--text-muted)]">統合に使えた腕</dt>
        <dd>{meta.quorum}{meta.fallback ? "（フォールバック）" : ""}</dd>
        <dt className="text-[var(--text-muted)]">応答時間</dt>
        <dd>{secs}秒</dd>
        <dt className="text-[var(--text-muted)]">検証</dt>
        <dd>{meta.verified === "modified" ? "表現を調整" : "そのまま"}</dd>
        {import.meta.env.DEV && (
          <>
            <dt className="text-[var(--text-muted)]">推定原価</dt>
            <dd>${meta.totalCost.toFixed(5)}</dd>
          </>
        )}
      </dl>
    </Disclosure>
  );
}
