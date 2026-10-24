// Isolated bounded runtime probe; no network, credentials, or OOM attempt.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
const loaded = await import(pathToFileURL(process.argv[2]).href);
const z = loaded.z ?? loaded.default.z;
const patched = process.argv[3] === "patched";
const length = 32;
const observations = [];
for (const async of [false, true]) {
  for (const kind of ["array-max", "array-length", "set-max", "set-size"]) {
    for (const validElements of [false, true]) {
      let children = 0,
        outer = 0;
      const preprocess = async
        ? async (value) => {
            children++;
            await Promise.resolve();
            return value;
          }
        : (value) => {
            children++;
            return value;
          };
      const element = z.preprocess(
        preprocess,
        validElements ? z.number() : z.string(),
      );
      let bounded;
      if (kind === "array-max")
        bounded = z.array(element).max(2, "bounded-limit");
      if (kind === "array-length")
        bounded = z.array(element).length(2, "bounded-limit");
      if (kind === "set-max") bounded = z.set(element).max(2, "bounded-limit");
      if (kind === "set-size")
        bounded = z.set(element).size(2, "bounded-limit");
      const schema = z.object({
        items: bounded.refine(() => {
          outer++;
          return true;
        }),
      });
      const values = Array.from({ length }, (_, index) => index);
      const input = {
        items: kind.startsWith("array") ? values : new Set(values),
      };
      const result = async
        ? await schema.safeParseAsync(input)
        : schema.safeParse(input);
      assert.equal(result.success, false);
      assert.equal(children, patched ? 0 : length);
      assert.equal(outer, patched ? 0 : validElements ? 1 : 0);
      assert.equal(
        result.error.issues.length,
        patched || validElements ? 1 : length + 1,
      );
      const first = result.error.issues[0];
      assert.equal(first.code, "too_big");
      assert.equal(first.message, "bounded-limit");
      assert.deepEqual(first.path, ["items"]);
      assert.equal(first.maximum, 2);
      assert.equal(first.inclusive, true);
      observations.push({
        async,
        kind,
        validElements,
        children,
        outer,
        issues: result.error.issues.length,
      });
    }
  }
}
for (const async of [false, true]) {
  let children = 0;
  const element = z.preprocess(
    async
      ? async (value) => {
          children++;
          return value;
        }
      : (value) => {
          children++;
          return value;
        },
    z.string(),
  );
  const schema = z.array(element).max(2, "bounded-limit");
  const result = async
    ? await schema.safeParseAsync(new Array(length))
    : schema.safeParse(new Array(length));
  assert.equal(result.success, false);
  assert.equal(children, patched ? 0 : length);
  assert.equal(result.error.issues.length, patched ? 1 : length + 1);
  observations.push({
    kind: "sparse-array-max",
    async,
    children,
    issues: result.error.issues.length,
  });
}
const controls = {};
for (const [kind, schema, input] of [
  ["array-min-small", z.array(z.string()).min(2, "minimum"), [1]],
  ["array-exact-small", z.array(z.string()).length(2, "exact"), [1]],
  ["set-min-small", z.set(z.string()).min(2, "minimum"), new Set([1])],
  ["set-exact-small", z.set(z.string()).size(2, "exact"), new Set([1])],
  ["wrong-container", z.array(z.string()).max(2), {}],
]) {
  const result = schema.safeParse(input);
  assert.equal(result.success, false);
  controls[kind] = result.error.issues;
}
let validChildren = 0,
  refined = 0;
const valid = z
  .array(
    z.number().transform((value) => {
      validChildren++;
      return value + 1;
    }),
  )
  .min(1)
  .max(2)
  .refine(() => {
    refined++;
    return true;
  })
  .parse([1, 2]);
assert.deepEqual(valid, [2, 3]);
assert.equal(validChildren, 2);
assert.equal(refined, 1);
controls.valid = valid;
controls.optional = z
  .array(z.number())
  .max(2)
  .optional()
  .safeParse(undefined).success;
controls.default = z.array(z.number()).max(2).default([1]).parse(undefined);
controls.catch = z.array(z.number()).max(2).catch([]).parse([1, 2, 3]);
controls.readonly = Object.isFrozen(
  z.array(z.number()).max(2).readonly().parse([1, 2]),
);
controls.preprocess = z
  .preprocess((value) => value.slice(0, 2), z.array(z.number()).max(2))
  .parse([1, 2, 3]);
controls.unionFallback = z
  .union([z.array(z.string()).max(2), z.array(z.number())])
  .parse([1, 2, 3]);
let unboundedChildren = 0;
const unbounded = z
  .array(
    z.preprocess((value) => {
      unboundedChildren++;
      return value;
    }, z.string()),
  )
  .safeParse(Array(length).fill(1));
assert.equal(unboundedChildren, length);
assert.equal(unbounded.error.issues.length, length);
controls.unbounded = {
  children: unboundedChildren,
  issues: unbounded.error.issues.length,
};
let contradictoryChildren = 0;
const contradictory = z
  .array(
    z.preprocess((value) => {
      contradictoryChildren++;
      return value;
    }, z.number()),
  )
  .length(10)
  .max(2)
  .safeParse([1, 2, 3, 4, 5]);
assert.equal(contradictoryChildren, patched ? 0 : 5);
assert.deepEqual(
  contradictory.error.issues.map((issue) => issue.code),
  ["too_small", "too_big"],
);
observations.push({
  kind: "tight-bound-with-conflicting-exact-length",
  children: contradictoryChildren,
  issues: contradictory.error.issues.length,
});
console.log(JSON.stringify({ patched, length, observations, controls }));
