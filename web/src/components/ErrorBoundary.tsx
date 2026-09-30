import { Component, type ErrorInfo, type ReactNode } from "react";

// 描画中の例外で真っ白な画面にしない最後の砦(App Review 2.1 のクラッシュ対策)。
// 保存済み会話の破損などで起動のたびに落ちる場合に備え、端末内データの削除も選べる。
export default class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("render error", error, info.componentStack);
  }

  private resetData = () => {
    if (!window.confirm("この端末の会話データを削除して再起動します。よろしいですか?")) return;
    try {
      indexedDB.deleteDatabase("octobrain");
    } finally {
      window.location.reload();
    }
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        role="alert"
        className="min-h-[100dvh] flex flex-col items-center justify-center gap-4 p-6 text-center bg-[var(--bg-abyss)] text-[var(--text-primary)]"
      >
        <h1 className="text-lg font-bold">表示中に問題が発生しました</h1>
        <p className="text-sm text-[var(--text-secondary)] max-w-[320px] leading-relaxed">
          再読み込みで直ることがあります。繰り返す場合は、この端末の会話データを削除してください。
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="min-h-[44px] px-6 rounded-full text-sm font-semibold bg-[var(--surface-2)] border border-[var(--line-strong)]"
        >
          再読み込み
        </button>
        <button
          type="button"
          onClick={this.resetData}
          className="min-h-[44px] px-4 text-sm text-[var(--danger)]"
        >
          会話データを削除して再起動
        </button>
      </div>
    );
  }
}
