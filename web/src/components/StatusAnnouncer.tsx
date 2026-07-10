// スクリーンリーダー向けの進行通知 (a11y §16)。tokenごとには読まず、フェーズ変化のみ。
export default function StatusAnnouncer({ message }: { message: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="sr-only"
      style={{
        position: "absolute",
        width: 1,
        height: 1,
        padding: 0,
        margin: -1,
        overflow: "hidden",
        clip: "rect(0 0 0 0)",
        whiteSpace: "nowrap",
        border: 0,
      }}
    >
      {message}
    </div>
  );
}
