import { describe, expect, it } from "vitest";
import { SSEParser } from "./sse";

describe("SSEParser", () => {
  it("1チャンクに複数イベントが連結されていても分割する", () => {
    const p = new SSEParser();
    const evts = p.push(
      'event: phase\ndata: {"phase":"nodes"}\n\nevent: token\ndata: {"t":"あ"}\n\n',
    );
    expect(evts).toHaveLength(2);
    expect(evts[0]).toEqual({ event: "phase", data: '{"phase":"nodes"}' });
    expect(evts[1]).toEqual({ event: "token", data: '{"t":"あ"}' });
  });

  it("イベントがチャンク境界をまたいでも連結して復元する", () => {
    const p = new SSEParser();
    expect(p.push("event: token\nda")).toHaveLength(0);
    expect(p.push('ta: {"t":"X"}')).toHaveLength(0); // まだ \n\n が来ていない
    const evts = p.push("\n\n");
    expect(evts).toHaveLength(1);
    expect(evts[0]).toEqual({ event: "token", data: '{"t":"X"}' });
  });

  it("途中で切断された(末尾に \\n\\n が無い)場合はイベントを emit しない", () => {
    const p = new SSEParser();
    const evts = p.push('event: done\ndata: {"answer":"未完');
    expect(evts).toHaveLength(0);
  });

  it("event 行が無ければ既定の message になる", () => {
    const p = new SSEParser();
    const evts = p.push("data: hello\n\n");
    expect(evts[0]).toEqual({ event: "message", data: "hello" });
  });

  it("複数 data 行は改行で連結する", () => {
    const p = new SSEParser();
    const evts = p.push("data: line1\ndata: line2\n\n");
    expect(evts[0].data).toBe("line1\nline2");
  });

  it("コメント行(:始まり)は無視する", () => {
    const p = new SSEParser();
    const evts = p.push(": keepalive\ndata: ok\n\n");
    expect(evts[0]).toEqual({ event: "message", data: "ok" });
  });
});
