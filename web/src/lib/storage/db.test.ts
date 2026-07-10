import { describe, expect, it } from "vitest";
import { createStorage, titleFromInput, type StoredConversation } from "./db";
import type { ChatMessage } from "../../features/chat/message";

// Node 環境では indexedDB が無いためメモリ・アダプタへフォールバックする。
// ここではフォールバック経路の CRUD / 並べ替え / stale trace 正規化を検証する。

function conv(id: string, updatedAt: number, messages: ChatMessage[] = []): StoredConversation {
  return {
    id,
    title: `t-${id}`,
    createdAt: 1,
    updatedAt,
    messages,
    summary: "",
    draft: "",
  };
}

describe("titleFromInput", () => {
  it("空白を畳んで24字で丸める", () => {
    expect(titleFromInput("  こんにちは   世界  ")).toBe("こんにちは 世界");
    const long = "あ".repeat(40);
    expect(titleFromInput(long)).toBe(`${"あ".repeat(24)}…`);
  });

  it("空文字は既定タイトル", () => {
    expect(titleFromInput("   ")).toBe("新しい会話");
  });
});

describe("memory storage adapter (fallback)", () => {
  it("indexedDB 不在時は available=false でフォールバック", async () => {
    const s = await createStorage();
    expect(s.available).toBe(false);
  });

  it("save/get/remove/clear が機能する", async () => {
    const s = await createStorage();
    await s.save(conv("a", 100));
    await s.save(conv("b", 200));
    expect(await s.get("a")).not.toBeNull();
    expect((await s.get("a"))?.title).toBe("t-a");

    await s.remove("a");
    expect(await s.get("a")).toBeNull();

    await s.clear();
    expect(await s.get("b")).toBeNull();
    expect(await s.list()).toEqual([]);
  });

  it("list は updatedAt 降順", async () => {
    const s = await createStorage();
    await s.save(conv("old", 100));
    await s.save(conv("new", 300));
    await s.save(conv("mid", 200));
    const ids = (await s.list()).map((m) => m.id);
    expect(ids).toEqual(["new", "mid", "old"]);
  });

  it("get は処理中 trace を cancelled へ正規化し streaming=false にする", async () => {
    const s = await createStorage();
    const stale: ChatMessage = {
      id: "m1",
      role: "assistant",
      content: "途中",
      streaming: true,
      trace: {
        phase: "nodes",
        activeNodeIds: ["reason"],
        nodeStates: { reason: "working" },
        startedAt: 0,
      },
    };
    await s.save(conv("c", 100, [stale]));
    const loaded = await s.get("c");
    const m = loaded!.messages[0];
    expect(m.streaming).toBe(false);
    expect(m.trace?.phase).toBe("cancelled");
    expect(m.trace?.cancelled).toBe(true);
  });

  it("done の trace はそのまま保持する", async () => {
    const s = await createStorage();
    const doneMsg: ChatMessage = {
      id: "m2",
      role: "assistant",
      content: "完了",
      streaming: false,
      trace: {
        phase: "done",
        activeNodeIds: ["reason"],
        nodeStates: { reason: "done" },
        startedAt: 0,
        completedAt: 10,
      },
    };
    await s.save(conv("d", 100, [doneMsg]));
    const loaded = await s.get("d");
    expect(loaded!.messages[0].trace?.phase).toBe("done");
  });
});
