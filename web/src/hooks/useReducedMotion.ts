import { useEffect, useState } from "react";

// OS の prefers-reduced-motion を購読する。設定でユーザーが上書きする場合は
// 呼び出し側で override する。
export function useReducedMotion(override?: "system" | "reduce" | "normal"): boolean {
  const [system, setSystem] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setSystem(mq.matches);
    const on = () => setSystem(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  if (override === "reduce") return true;
  if (override === "normal") return false;
  return system;
}
