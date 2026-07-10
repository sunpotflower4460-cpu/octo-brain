import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, Check, X } from "lucide-react";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import type { ConversationMeta } from "../../lib/storage/db";

// 会話一覧 Drawer (P2.7 §5.7)。新規/選択/名前変更/削除(確認)。desktop=左Drawer, mobile=Sheet。
export default function ConversationList({
  metas,
  currentId,
  storageAvailable,
  onSelect,
  onNew,
  onRename,
  onDelete,
  onClose,
}: {
  metas: ConversationMeta[];
  currentId: string | null;
  storageAvailable: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const panelRef = useFocusTrap<HTMLDivElement>();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex" role="dialog" aria-modal="true" aria-label="会話一覧">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        tabIndex={-1}
        className="relative w-[86%] max-w-[320px] h-full bg-[var(--bg-depth)] border-r border-[var(--line-soft)] flex flex-col outline-none"
        style={{ paddingTop: "var(--safe-top)" }}
      >
        <div className="flex items-center gap-2 p-3 border-b border-[var(--line-soft)]">
          <span className="text-sm font-semibold text-[var(--text-secondary)]">会話</span>
          <button
            type="button"
            onClick={onNew}
            className="ml-auto inline-flex items-center gap-1 min-h-[40px] px-3 rounded-full text-xs font-semibold bg-[var(--surface-2)] text-[var(--text-primary)] hover:bg-[var(--surface-3)] transition-colors"
          >
            <Plus className="w-4 h-4" />
            新しい会話
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {metas.length === 0 && (
            <p className="p-3 text-xs text-[var(--text-muted)]">まだ会話がありません。</p>
          )}
          <ul className="space-y-1">
            {metas.map((m) => (
              <li key={m.id}>
                {editing === m.id ? (
                  <div className="flex items-center gap-1 p-1">
                    <input
                      autoFocus
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          onRename(m.id, draft.trim() || m.title);
                          setEditing(null);
                        }
                        if (e.key === "Escape") setEditing(null);
                      }}
                      className="flex-1 bg-[var(--surface-1)] border border-[var(--line-strong)] rounded px-2 py-1.5 text-sm text-[var(--text-primary)]"
                      aria-label="会話名"
                    />
                    <IconBtn label="決定" onClick={() => { onRename(m.id, draft.trim() || m.title); setEditing(null); }}>
                      <Check className="w-4 h-4" />
                    </IconBtn>
                    <IconBtn label="取消" onClick={() => setEditing(null)}>
                      <X className="w-4 h-4" />
                    </IconBtn>
                  </div>
                ) : confirmDel === m.id ? (
                  <div className="flex items-center gap-1.5 p-2 rounded-[var(--radius-sm)] bg-[var(--surface-1)]">
                    <span className="text-xs text-[var(--text-secondary)] flex-1">削除しますか?</span>
                    <button
                      type="button"
                      onClick={() => { onDelete(m.id); setConfirmDel(null); }}
                      className="min-h-[36px] px-2.5 rounded-full text-xs font-semibold text-[var(--danger)] border border-[var(--danger)]/40"
                    >
                      削除
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDel(null)}
                      className="min-h-[36px] px-2.5 rounded-full text-xs text-[var(--text-muted)]"
                    >
                      取消
                    </button>
                  </div>
                ) : (
                  <div
                    className={`group flex items-center gap-1 rounded-[var(--radius-sm)] ${
                      m.id === currentId ? "bg-[var(--surface-2)]" : "hover:bg-[var(--surface-1)]"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onSelect(m.id)}
                      className="flex-1 text-left min-h-[44px] px-2.5 text-sm text-[var(--text-primary)] truncate"
                    >
                      {m.title}
                    </button>
                    <IconBtn label="名前変更" onClick={() => { setEditing(m.id); setDraft(m.title); }}>
                      <Pencil className="w-3.5 h-3.5" />
                    </IconBtn>
                    <IconBtn label="削除" onClick={() => setConfirmDel(m.id)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </IconBtn>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>

        {!storageAvailable && (
          <p className="p-3 text-[11px] text-[var(--gold)] border-t border-[var(--line-soft)]">
            この環境では会話を保存できません(閲覧中のみ保持)。
          </p>
        )}
      </div>
    </div>
  );
}

function IconBtn({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex items-center justify-center w-9 h-9 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)]"
    >
      {children}
    </button>
  );
}
