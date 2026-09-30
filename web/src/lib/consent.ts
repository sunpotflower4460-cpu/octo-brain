// 外部AIへの送信同意 (App Review 5.1.2(i))。
// 初回の送信前に、送信先(LLM プロバイダー)と送信内容を示して明示的な同意を得る。
// 送信先や内容が変わったら CONSENT_VERSION を上げて再同意を求める。

import { kv } from "./native/kv";

export const CONSENT_VERSION = "2026-09-30";
const KEY = "octobrain.aiConsent";

export async function hasAiConsent(): Promise<boolean> {
  return (await kv.get(KEY)) === CONSENT_VERSION;
}

export async function setAiConsent(granted: boolean): Promise<void> {
  if (granted) await kv.set(KEY, CONSENT_VERSION);
  else await kv.remove(KEY);
}
