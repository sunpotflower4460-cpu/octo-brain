import { useEffect } from "react";
import { ShieldCheck } from "lucide-react";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { PRIVACY_URL } from "../../config/appInfo";

// 外部AIへの送信同意 (App Review 5.1.2(i))。初回の送信前に、何をどこへ送るかを示す。
// 同意しなければ送信しない(入力は入力欄に残す)。
export default function ConsentSheet({
  onAccept,
  onDecline,
}: {
  onAccept: () => void;
  onDecline: () => void;
}) {
  const panelRef = useFocusTrap<HTMLDivElement>();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onDecline();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onDecline]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm"
      role="presentation"
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="consent-title"
        className="w-full sm:max-w-[440px] max-h-[90dvh] overflow-y-auto rounded-t-[var(--radius)] sm:rounded-[var(--radius)] bg-[var(--bg-depth)] border border-[var(--line-soft)] p-5 outline-none"
        style={{ paddingBottom: "calc(20px + var(--safe-bottom))" }}
      >
        <div className="flex items-center gap-2 text-[var(--cyan)]">
          <ShieldCheck className="w-5 h-5" aria-hidden />
          <h2 id="consent-title" className="text-base font-bold text-[var(--text-primary)]">
            入力内容の送信について
          </h2>
        </div>
        <ul className="mt-3 space-y-2 text-sm leading-relaxed text-[var(--text-secondary)] list-disc pl-5">
          <li>
            回答を作るため、入力した文章と会話の短い要約を、外部の AI サービス
            <strong className="text-[var(--text-primary)]"> DeepSeek(中国)</strong>
            に送信します。
          </li>
          <li>会話の履歴はこの端末にだけ保存し、OctoBrain のサーバーには残しません。</li>
          <li>
            <strong className="text-[var(--text-primary)]">
              氏名・連絡先・健康状態など、他人に知られたくない情報は入力しないでください。
            </strong>
          </li>
          <li>AI の回答は専門的な助言ではありません。大切な判断は専門家にもご相談ください。</li>
        </ul>
        <a
          href={PRIVACY_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-block text-sm text-[var(--cyan)] underline underline-offset-2"
        >
          プライバシーポリシーを読む
        </a>
        <p className="mt-2 text-xs text-[var(--text-muted)]">同意は「設定」からいつでも取り消せます。</p>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onDecline}
            className="flex-1 min-h-[44px] rounded-full text-sm text-[var(--text-secondary)] bg-[var(--surface-2)] border border-[var(--line-soft)]"
          >
            やめる
          </button>
          <button
            type="button"
            onClick={onAccept}
            className="flex-1 min-h-[44px] rounded-full text-sm font-semibold bg-gradient-to-r from-[var(--cyan)] to-[var(--violet)] text-[#04121a]"
          >
            同意して送信
          </button>
        </div>
      </div>
    </div>
  );
}
