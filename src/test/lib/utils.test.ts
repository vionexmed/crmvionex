import { describe, it, expect } from "vitest";
import { cn, initials } from "@/lib/utils";

describe("cn()", () => {
  it("returns a single class unchanged", () => {
    expect(cn("flex")).toBe("flex");
  });

  it("merges multiple classes", () => {
    expect(cn("flex", "items-center", "gap-2")).toBe("flex items-center gap-2");
  });

  it("ignores falsy values", () => {
    expect(cn("flex", false, null, undefined, "gap-2")).toBe("flex gap-2");
  });

  it("applies conditional classes when true", () => {
    const active = true;
    expect(cn("base", active && "active")).toBe("base active");
  });

  it("skips conditional classes when false", () => {
    const active = false;
    expect(cn("base", active && "active")).toBe("base");
  });

  it("resolves Tailwind conflicts — last wins", () => {
    expect(cn("p-4", "p-2")).toBe("p-2");
  });

  it("resolves conflicting text colors", () => {
    expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500");
  });

  it("handles object syntax", () => {
    expect(cn({ flex: true, hidden: false })).toBe("flex");
  });

  it("handles array syntax", () => {
    expect(cn(["flex", "gap-2"])).toBe("flex gap-2");
  });

  it("returns empty string for no inputs", () => {
    expect(cn()).toBe("");
  });

  it("does not duplicate classes", () => {
    const result = cn("flex", "flex");
    expect(result.split(" ").filter((c) => c === "flex")).toHaveLength(1);
  });
});

describe("initials()", () => {
  it("takes first and last initial from a full name", () => {
    expect(initials("Ana Prado")).toBe("AP");
  });

  it("uses the LAST term, not the second — nomes compostos", () => {
    expect(initials("Ana Maria Prado")).toBe("AP");
  });

  it("returns a single letter for a single term", () => {
    expect(initials("Ana")).toBe("A");
  });

  it("uppercases", () => {
    expect(initials("ana prado")).toBe("AP");
  });

  it("collapses extra whitespace", () => {
    expect(initials("  Ana   Prado ")).toBe("AP");
  });

  it("falls back to ? for empty, whitespace, null and undefined", () => {
    expect(initials("")).toBe("?");
    expect(initials("   ")).toBe("?");
    expect(initials(null)).toBe("?");
    expect(initials(undefined)).toBe("?");
  });
});
