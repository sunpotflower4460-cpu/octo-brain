// ローカル会話永続化 (P2.7 §5.7)。IndexedDB を基本に、失敗/プライベートブラウズでは
// メモリへフォールバック(チャット本体は止めない)。Storage Adapter 経由で使う。

import { openDB, type IDBPDatabase } from "idb";
import type { ChatMessage } from "../../features/chat/message";
import { normalizeStaleTrace } from "../cognition";

export interface StoredConversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  summary: string;
  draft: string;
}

export interface ConversationMeta {
  id: string;
  title: string;
  updatedAt: number;
}

export interface StorageAdapter {
  available: boolean; // false ならメモリfオールバック(非致命通知に使う)
  list(): Promise<ConversationMeta[]>;
  get(id: string): Promise<StoredConversation | null>;
  save(conv: StoredConversation): Promise<void>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
}

const DB_NAME = "octobrain";
const STORE = "conversations";

// 再起動時: 保存済み会話の処理中trace(SSE中断)を cancelled へ正規化 (§5.7)。
function normalizeConversation(c: StoredConversation): StoredConversation {
  return {
    ...c,
    messages: c.messages.map((m) =>
      m.trace
        ? { ...m, streaming: false, trace: normalizeStaleTrace(m.trace) }
        : { ...m, streaming: false },
    ),
  };
}

function metaOf(c: StoredConversation): ConversationMeta {
  return { id: c.id, title: c.title, updatedAt: c.updatedAt };
}

function createMemoryAdapter(available: boolean): StorageAdapter {
  const mem = new Map<string, StoredConversation>();
  return {
    available,
    async list() {
      return [...mem.values()].map(metaOf).sort((a, b) => b.updatedAt - a.updatedAt);
    },
    async get(id) {
      const c = mem.get(id);
      return c ? normalizeConversation(c) : null;
    },
    async save(conv) {
      mem.set(conv.id, conv);
    },
    async remove(id) {
      mem.delete(id);
    },
    async clear() {
      mem.clear();
    },
  };
}

export async function createStorage(): Promise<StorageAdapter> {
  if (typeof indexedDB === "undefined") return createMemoryAdapter(false);
  let db: IDBPDatabase;
  try {
    db = await openDB(DB_NAME, 1, {
      upgrade(d) {
        if (!d.objectStoreNames.contains(STORE)) {
          d.createObjectStore(STORE, { keyPath: "id" });
        }
      },
    });
  } catch {
    // プライベートブラウズ等で開けない → メモリへ
    return createMemoryAdapter(false);
  }

  return {
    available: true,
    async list() {
      try {
        const all = (await db.getAll(STORE)) as StoredConversation[];
        return all.map(metaOf).sort((a, b) => b.updatedAt - a.updatedAt);
      } catch {
        return [];
      }
    },
    async get(id) {
      try {
        const c = (await db.get(STORE, id)) as StoredConversation | undefined;
        return c ? normalizeConversation(c) : null;
      } catch {
        return null;
      }
    },
    async save(conv) {
      try {
        await db.put(STORE, conv);
      } catch {
        /* 保存失敗は非致命 */
      }
    },
    async remove(id) {
      try {
        await db.delete(STORE, id);
      } catch {
        /* 非致命 */
      }
    },
    async clear() {
      try {
        await db.clear(STORE);
      } catch {
        /* 非致命 */
      }
    },
  };
}

// 最終ユーザー入力からローカルで短い初期タイトルを作る(LLM不使用 §5.7)。
export function titleFromInput(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length > 24 ? `${t.slice(0, 24)}…` : t || "新しい会話";
}
