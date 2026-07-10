import { useId, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";

// アクセシブルな開閉パネル (段階的開示)。details 相当だがフォーカス/aria を制御。
export default function Disclosure({
  summary,
  children,
  defaultOpen = false,
  tone = "muted",
}: {
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  tone?: "muted" | "accent";
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1 min-h-[44px] py-1 text-xs font-semibold select-none transition-colors ${
          tone === "accent"
            ? "text-[var(--violet)] hover:brightness-125"
            : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
        }`}
      >
        <ChevronRight
          className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-90" : ""}`}
          aria-hidden
        />
        {summary}
      </button>
      {open && (
        <div id={id} className="mt-1">
          {children}
        </div>
      )}
    </div>
  );
}
