import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeStream } from "./api";

// 監査 H2: done / error が届かないままストリームが閉じたら、streaming のまま
// 固まらないよう onError(network) を必ず呼ぶ。

function sseResponse(body: string): Response {
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

afterEach(() => vi.unstubAllGlobals());

describe("analyzeStream の終端処理", () => {
  it("done 無しで閉じたら onError(network)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse('event: phase\ndata: {"phase":"synth"}\n\nevent: token\ndata: {"t":"途中"}\n\n')));
    const onError = vi.fn();
    const onToken = vi.fn();
    await analyzeStream({ input: "x", clientId: "c1" }, { onError, onToken });
    expect(onToken).toHaveBeenCalledWith("途中");
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][1]).toEqual({ code: "network" });
  });

  it("末尾に空行が無い done も受け取り、エラーにしない", async () => {
    const done = { answer: "a", summary: "s", nodes: [], meta: { quorum: "4/4" } };
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse(`event: done\ndata: ${JSON.stringify(done)}`)));
    const onError = vi.fn();
    const onDone = vi.fn();
    await analyzeStream({ input: "x", clientId: "c1" }, { onError, onDone });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it("error イベントの後に閉じても二重に onError しない", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse('event: error\ndata: {"error":"timeout"}\n\n')));
    const onError = vi.fn();
    await analyzeStream({ input: "x", clientId: "c1" }, { onError });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][1]).toEqual({ code: "timeout" });
  });
});
