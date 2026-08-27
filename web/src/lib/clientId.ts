// クォータ・連打防止用の安定 clientId。リロードで変わると無料枠がリセットされるため永続化する。

import { kv } from "./native/kv";

const KEY = "octobrain.clientId";

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `c-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

// 既存があればそれを返し、無ければ発行して保存する。
export async function loadOrCreateClientId(): Promise<string> {
  const existing = await kv.get(KEY);
  if (existing && existing.trim().length > 0) return existing.trim();
  const id = newId();
  await kv.set(KEY, id);
  return id;
}
