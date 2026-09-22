import { describe, expect, it } from "vitest";
import { DICTIONARIES } from "./index";
import { en } from "./en";

// Every locale must have exactly the keys English has, with the same kind of
// value at each one (string vs. function, and the same arity for functions).
// The `Copy` type already enforces this at compile time for keys; this catches
// the shape drift TypeScript can't, like a function replaced by a string.
type Shape = { [key: string]: Shape } | string;

function shapeOf(value: unknown, path: string): Shape {
  if (typeof value === "string") return "string";
  if (typeof value === "function") return `function/${value.length}`;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, shapeOf(v, `${path}.${k}`)])
    );
  }
  throw new Error(`unexpected value at ${path}: ${String(value)}`);
}

function flatten(shape: Shape, prefix = ""): Record<string, string> {
  if (typeof shape === "string") return { [prefix]: shape };
  return Object.assign(
    {},
    ...Object.entries(shape).map(([k, v]) => flatten(v, prefix ? `${prefix}.${k}` : k))
  );
}

const reference = flatten(shapeOf(en, "en"));

describe("i18n dictionaries", () => {
  for (const [locale, dict] of Object.entries(DICTIONARIES)) {
    it(`${locale} has the same keys and value kinds as en`, () => {
      expect(flatten(shapeOf(dict, locale))).toEqual(reference);
    });

    it(`${locale} has no empty strings`, () => {
      const empty = Object.entries(flatten(shapeOf(dict, locale)))
        .filter(([, kind]) => kind === "string")
        .map(([key]) => key)
        .filter((key) => {
          const value = key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], dict);
          return String(value).trim() === "";
        });
      expect(empty).toEqual([]);
    });
  }

  it("function keys render without throwing", () => {
    for (const dict of Object.values(DICTIONARIES)) {
      expect(dict.common.pageOf(1, 3)).toContain("1");
      expect(dict.audit.keyGenLabel(2)).toContain("2");
      expect(dict.sendTransfer.simulationSuccess("0.000005", "1,234")).toContain("1,234");
    }
  });
});
