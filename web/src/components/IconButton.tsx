import type { ComponentType, ReactNode } from "react";

// 44px 以上のタップ領域を保証するアイコン+ラベルボタン (a11y §16)。
export default function IconButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  showLabel = true,
  tone = "neutral",
  type = "button",
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  showLabel?: boolean;
  tone?: "neutral" | "accent" | "danger";
  type?: "button" | "submit";
}): ReactNode {
  const toneCls =
    tone === "accent"
      ? "text-[var(--cyan-soft)] hover:bg-[var(--surface-2)]"
      : tone === "danger"
        ? "text-[var(--danger)] hover:bg-[var(--surface-2)]"
        : "text-[var(--text-secondary)] hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]";
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={`inline-flex items-center gap-1.5 min-h-[44px] px-2.5 rounded-[var(--radius-sm)] text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${toneCls}`}
    >
      <Icon className="w-4 h-4" />
      {showLabel && <span>{label}</span>}
    </button>
  );
}
