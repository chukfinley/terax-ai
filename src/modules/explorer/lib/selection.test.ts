import { describe, expect, it } from "vitest";
import { applySelection, rangeBetween } from "./selection";

const order = ["a", "b", "c", "d", "e"];

describe("rangeBetween", () => {
  it("returns the inclusive contiguous range, forward", () => {
    expect(rangeBetween(order, "b", "d")).toEqual(["b", "c", "d"]);
  });

  it("returns the inclusive range regardless of direction", () => {
    expect(rangeBetween(order, "d", "b")).toEqual(["b", "c", "d"]);
  });

  it("returns a single element when endpoints match", () => {
    expect(rangeBetween(order, "c", "c")).toEqual(["c"]);
  });

  it("falls back to just b when anchor is missing", () => {
    expect(rangeBetween(order, "z", "c")).toEqual(["c"]);
  });
});

describe("applySelection", () => {
  it("plain click selects only the clicked row and sets anchor", () => {
    const r = applySelection(order, new Set(["a", "b"]), "a", "d", {});
    expect([...r.selected]).toEqual(["d"]);
    expect(r.anchor).toBe("d");
    expect(r.active).toBe("d");
  });

  it("shift click selects the range from anchor to clicked", () => {
    const r = applySelection(order, new Set(["b"]), "b", "e", { shift: true });
    expect([...r.selected]).toEqual(["b", "c", "d", "e"]);
    expect(r.anchor).toBe("b");
    expect(r.active).toBe("e");
  });

  it("shift click without a valid anchor behaves as plain select", () => {
    const r = applySelection(order, new Set(["b"]), null, "d", { shift: true });
    expect([...r.selected]).toEqual(["d"]);
    expect(r.anchor).toBe("d");
  });

  it("toggle click adds a row without clearing the rest", () => {
    const r = applySelection(order, new Set(["a"]), "a", "c", { toggle: true });
    expect([...r.selected].sort()).toEqual(["a", "c"]);
    expect(r.anchor).toBe("c");
  });

  it("toggle click removes an already selected row", () => {
    const r = applySelection(order, new Set(["a", "c"]), "c", "c", {
      toggle: true,
    });
    expect([...r.selected]).toEqual(["a"]);
    expect(r.anchor).toBe("c");
  });
});
