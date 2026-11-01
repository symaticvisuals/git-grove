import { InvalidInputError } from "../invalid-input.error.js";

export type LevelInput = {
  feature: string;
  branch: string | undefined;
  from: string | undefined;
  on: string | undefined;
  env: boolean;
  install: boolean;
  open: boolean;
};

function stringField(raw: object, key: string, shape: string): string | undefined {
  const value: unknown = key in raw ? Reflect.get(raw, key) : undefined;
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value === "") throw new InvalidInputError(shape);
  return value;
}

function booleanField(raw: object, key: string, shape: string, fallback: boolean): boolean {
  const value: unknown = key in raw ? Reflect.get(raw, key) : undefined;
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new InvalidInputError(shape);
  return value;
}

/**
 * Reads the input of `new` and `add-level`: `feature` (required), `branch`, `from` and `on` (strings), and `env`
 * (default true), `install` and `open` (default false). Throws InvalidInputError with `shape` for anything else.
 */
export function parseLevelInput(raw: unknown, shape: string): LevelInput {
  if (typeof raw !== "object" || raw === null) throw new InvalidInputError(shape);
  const feature = stringField(raw, "feature", shape);
  if (feature === undefined) throw new InvalidInputError(shape);
  return {
    feature,
    branch: stringField(raw, "branch", shape),
    from: stringField(raw, "from", shape),
    on: stringField(raw, "on", shape),
    env: booleanField(raw, "env", shape, true),
    install: booleanField(raw, "install", shape, false),
    open: booleanField(raw, "open", shape, false),
  };
}
