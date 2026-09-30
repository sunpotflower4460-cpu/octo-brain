import { describe, expect, it } from "vitest";
import { buildMapperInput, mapperItems, parseMapperOutput } from "../src/lib/mapper.js";
import type { NodeResult } from "../src/types.js";

const node = (id: string, claims: string[], flag: string | null = null) =>
  ({ id, status: "ok", opinions: claims.map((c) => ({ claim: c, weight: 0.8, why: "w" })), flag }) as NodeResult;

const nodes = [
  node("reason", ["収入の継続性が不明"]),
  node("risk", ["全額投入は引き返せない", "少額で記録を続けるべき"]),
  node("step", ["まず1か月休む"]),
  node("truth", ["反対を理由に先送りしている"]),
  node("future", ["除外される"], "insufficient_input"),
];

describe("視点の地図(mapper)", () => {
  it("使えた腕の意見だけを番号付きで渡す(flag付きは除外)", () => {
    const items = mapperItems(nodes);
    expect(items.map((i) => i.lens)).toEqual(["reason", "risk", "risk", "step", "truth"]);
    const text = buildMapperInput("相談", items);
    expect(text).toContain("[1] (reason) 収入の継続性が不明");
    expect(text).not.toContain("除外される");
  });

  it("番号の回答を元の腕・元の文に戻す(引用は捏造されない)", () => {
    const items = mapperItems(nodes);
    const m = parseMapperOutput(
      '{"agree":{"point":"急がない方がよい","ids":[1,2,4]},"split":{"about":"次の動き","a":3,"b":4},"lone":{"id":5,"why":"決断の主語がずれている"}}',
      items,
    );
    expect(m?.agree?.lenses).toEqual(["reason", "risk", "step"]);
    expect(m?.split?.a).toEqual({ lens: "risk", claim: "少額で記録を続けるべき" });
    expect(m?.split?.b).toEqual({ lens: "step", claim: "まず1か月休む" });
    expect(m?.lone).toEqual({ lens: "truth", claim: "反対を理由に先送りしている", why: "決断の主語がずれている" });
  });

  it("範囲外の番号・同じ腕どうしの対立・壊れた JSON は捨てる", () => {
    const items = mapperItems(nodes);
    expect(parseMapperOutput('{"split":{"about":"x","a":2,"b":3},"lone":{"id":99,"why":"y"}}', items)).toBeNull();
    expect(parseMapperOutput("地図は作れません", items)).toBeNull();
  });
});
