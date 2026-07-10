import { useEffect, useRef } from "react";

// ダイアログ/Drawer 用のフォーカス管理 (a11y §16)。
// 開いたときパネル内へフォーカスを移し、Tab をパネル内に閉じ込め、
// 閉じたら元の要素へフォーカスを戻す。
const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function useFocusTrap<T extends HTMLElement>(active = true) {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!active) return;
    const node = ref.current;
    if (!node) return;

    const prev = document.activeElement as HTMLElement | null;

    const items = () =>
      Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null,
      );

    // 開いたら最初の操作要素(無ければパネル自身)へ移す
    const first = items()[0];
    if (first) first.focus();
    else node.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const list = items();
      if (list.length === 0) {
        e.preventDefault();
        node.focus();
        return;
      }
      const firstEl = list[0];
      const lastEl = list[list.length - 1];
      const activeEl = document.activeElement;
      if (e.shiftKey && (activeEl === firstEl || activeEl === node)) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && activeEl === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };

    node.addEventListener("keydown", onKeyDown);
    return () => {
      node.removeEventListener("keydown", onKeyDown);
      // 閉じたら元のトリガーへフォーカスを戻す
      if (prev && typeof prev.focus === "function") prev.focus();
    };
  }, [active]);

  return ref;
}
