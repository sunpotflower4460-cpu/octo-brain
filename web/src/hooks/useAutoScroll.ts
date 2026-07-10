import { useCallback, useEffect, useRef, useState } from "react";

// 自動スクロール制御 (P2.7 §10)。
// ユーザーが最下部付近にいるときだけ追従し、過去回答を読んでいる人の位置は奪わない。
// 下部 sentinel の可視性を IntersectionObserver で判定する。
export function useAutoScroll(reducedMotion: boolean) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const [showJump, setShowJump] = useState(false);

  useEffect(() => {
    const root = scrollRef.current;
    const sentinel = sentinelRef.current;
    if (!root || !sentinel) return;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries[0]?.isIntersecting ?? true;
        atBottomRef.current = visible;
        setShowJump(!visible);
      },
      { root, rootMargin: "0px 0px 120px 0px", threshold: 0 },
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, []);

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = "smooth") => {
      sentinelRef.current?.scrollIntoView({
        behavior: reducedMotion ? "auto" : behavior,
        block: "end",
      });
    },
    [reducedMotion],
  );

  // 新しい内容が来たとき: 最下部にいる場合のみ追従。
  const followIfAtBottom = useCallback(() => {
    if (atBottomRef.current) scrollToBottom("auto");
  }, [scrollToBottom]);

  return { scrollRef, sentinelRef, showJump, scrollToBottom, followIfAtBottom };
}
