import { useEffect } from "react";
import { X, Flag, Shield, FileText } from "lucide-react";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import {
  APP_VERSION,
  PRIVACY_URL,
  TERMS_URL,
  isConfiguredUrl,
  reportMailto,
} from "../../config/appInfo";
import type {
  CoreSetting,
  DetailSetting,
  MotionSetting,
  Settings,
} from "../../lib/settings";

// 設定パネル (P2.7 §5.8)。装飾より明快さ優先。値はローカル保存(呼び出し側)。
function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { v: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="py-2">
      <div className="text-[13px] text-[var(--text-secondary)] mb-1.5">{label}</div>
      <div className="flex gap-1" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.v}
            type="button"
            role="radio"
            aria-checked={value === o.v}
            onClick={() => onChange(o.v)}
            className={`min-h-[40px] px-3 rounded-[var(--radius-sm)] text-xs font-semibold transition-colors ${
              value === o.v
                ? "bg-[var(--surface-3)] text-[var(--text-primary)] ring-1 ring-[var(--line-strong)]"
                : "bg-[var(--surface-1)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function SettingsPanel({
  settings,
  onChange,
  onReshowOnboarding,
  onDeleteData,
  onClose,
}: {
  settings: Settings;
  onChange: (s: Settings) => void;
  onReshowOnboarding: () => void;
  onDeleteData: () => void;
  onClose: () => void;
}) {
  const panelRef = useFocusTrap<HTMLDivElement>();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-6" role="dialog" aria-modal="true" aria-label="設定">
      <div
        ref={panelRef}
        tabIndex={-1}
        className="w-full sm:max-w-[420px] bg-[var(--bg-depth)] border border-[var(--line-soft)] sm:rounded-[var(--radius)] rounded-t-[var(--radius)] p-4 outline-none"
        style={{ paddingBottom: "calc(16px + var(--safe-bottom))" }}
      >
        <div className="flex items-center mb-2">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">設定</h2>
          <button
            type="button"
            aria-label="閉じる"
            onClick={onClose}
            className="ml-auto w-9 h-9 flex items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <Segmented<MotionSetting>
          label="動き (Motion)"
          value={settings.motion}
          onChange={(v) => onChange({ ...settings, motion: v })}
          options={[
            { v: "system", label: "システムに従う" },
            { v: "reduce", label: "少なく" },
            { v: "normal", label: "通常" },
          ]}
        />
        <Segmented<CoreSetting>
          label="Living Core"
          value={settings.core}
          onChange={(v) => onChange({ ...settings, core: v })}
          options={[
            { v: "auto", label: "自動縮小" },
            { v: "always", label: "常に表示" },
          ]}
        />
        <Segmented<DetailSetting>
          label="処理の詳細"
          value={settings.detail}
          onChange={(v) => onChange({ ...settings, detail: v })}
          options={[
            { v: "standard", label: "標準" },
            { v: "detailed", label: "詳細" },
          ]}
        />

        <div className="mt-3 pt-3 border-t border-[var(--line-soft)] space-y-2">
          <button
            type="button"
            onClick={onReshowOnboarding}
            className="w-full text-left min-h-[44px] px-3 rounded-[var(--radius-sm)] text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-1)]"
          >
            オンボーディングをもう一度見る
          </button>
          <button
            type="button"
            onClick={onDeleteData}
            className="w-full text-left min-h-[44px] px-3 rounded-[var(--radius-sm)] text-sm text-[var(--danger)] hover:bg-[var(--surface-1)]"
          >
            ローカル会話データを削除
          </button>
        </div>

        {/* 報告導線・規約・バージョン (App Review ガイドライン1.2 / 情報) */}
        <div className="mt-3 pt-3 border-t border-[var(--line-soft)] space-y-1">
          <a
            href={reportMailto()}
            className="flex items-center gap-2 min-h-[44px] px-3 rounded-[var(--radius-sm)] text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-1)]"
          >
            <Flag className="w-4 h-4 flex-shrink-0" aria-hidden />
            問題を報告 / お問い合わせ
          </a>
          {isConfiguredUrl(PRIVACY_URL) && (
            <a
              href={PRIVACY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 min-h-[44px] px-3 rounded-[var(--radius-sm)] text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-1)]"
            >
              <Shield className="w-4 h-4 flex-shrink-0" aria-hidden />
              プライバシーポリシー
            </a>
          )}
          {isConfiguredUrl(TERMS_URL) && (
            <a
              href={TERMS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 min-h-[44px] px-3 rounded-[var(--radius-sm)] text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-1)]"
            >
              <FileText className="w-4 h-4 flex-shrink-0" aria-hidden />
              利用規約
            </a>
          )}
          <p className="px-3 pt-1 text-[11px] text-[var(--text-muted)]">
            OctoBrain v{APP_VERSION}
          </p>
        </div>
      </div>
    </div>
  );
}
