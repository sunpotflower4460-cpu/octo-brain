import { describe, expect, it } from "vitest";
import { phaseToAppState } from "./phase";

describe("phaseToAppState", () => {
  it("nodes は processing_subs", () => {
    expect(phaseToAppState("nodes")).toBe("processing_subs");
  });

  it("routing は processing_subs (ノード起動前)", () => {
    expect(phaseToAppState("routing")).toBe("processing_subs");
  });

  it("synth は processing_main", () => {
    expect(phaseToAppState("synth")).toBe("processing_main");
  });

  it("verify は processing_main", () => {
    expect(phaseToAppState("verify")).toBe("processing_main");
  });
});
