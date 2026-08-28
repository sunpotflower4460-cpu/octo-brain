// 複数 AbortSignal を1つに合成する。Workers/Node 双方で AbortSignal.any が
// 無い環境でも動くよう手動合成する。

export function combineAbortSignals(...signals: AbortSignal[]): AbortSignal {
  const ctrl = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      ctrl.abort(s.reason);
      return ctrl.signal;
    }
    s.addEventListener(
      "abort",
      () => {
        if (!ctrl.signal.aborted) ctrl.abort(s.reason);
      },
      { once: true },
    );
  }
  return ctrl.signal;
}
