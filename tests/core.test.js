import test from "node:test";
import assert from "node:assert/strict";
import {
  analyze,
  parse,
  closure,
  keys,
  minimalCover,
  synthesize,
  bcnf,
  inspectDecomposition,
  subset,
  chase,
  example,
} from "../core.js";
const schema = (attributes, dependencies, decomposition = "") => ({
  attributes,
  dependencies,
  decomposition,
});
test("order study exposes its composite key and yields three-attribute line items", () => {
  const a = analyze(example);
  assert.deepEqual(a.original.keys, [3]);
  assert.equal(a.original.normalForm, "Below 3NF");
  assert.equal(a.third.chase.lossless, true);
  assert.equal(a.third.preserved, true);
  assert.equal(a.third.components.length, 4);
  assert(a.third.components.every((c) => c.normalForm === "BCNF"));
  assert.equal(a.custom.chase.lossless, true);
});
test("3NF can preserve a dependency that the BCNF split loses", () => {
  const a = analyze(schema("A, B, C", "A, B -> C\nC -> B"));
  assert.deepEqual(a.original.keys, [3, 5]);
  assert.equal(a.original.normalForm, "3NF");
  assert.equal(a.third.preserved, true);
  assert.equal(a.bcnf.preserved, false);
  assert.equal(a.bcnf.chase.lossless, true);
  assert(a.bcnf.components.every((c) => c.normalForm === "BCNF"));
  assert.deepEqual(
    a.bcnf.checks.filter((c) => !c.preserved).map((c) => [c.left, c.right]),
    [[3, 4]],
  );
});
test("lossy but dependency-preserving split produces a concrete counterexample tableau", () => {
  const a = analyze(schema("A, B, C, D", "A -> B\nC -> D", "A, B\nC, D"));
  assert.equal(a.custom.preserved, true);
  assert.equal(a.custom.chase.lossless, false);
  const rows = a.custom.chase.table;
  for (const fd of a.fds)
    for (const r of rows)
      for (const s of rows) {
        if (
          a.attributes.every((_, j) => !(fd.left & (1 << j)) || r[j] === s[j])
        )
          assert(
            a.attributes.every(
              (_, j) => !(fd.right & (1 << j)) || r[j] === s[j],
            ),
          );
      }
  // Distinguished tuple is absent, but each fragment has its projection.
  assert(!rows.some((r) => r.every((x, j) => x === j)));
  for (const relation of a.relations)
    assert(
      rows.some((r) => r.every((x, j) => !(relation & (1 << j)) || x === j)),
    );
});
test("chase needs transitive rounds and exposes an all-distinguished witness", () => {
  const a = analyze(
    schema("A, B, C, D", "C -> D\nB -> C\nA -> B", "A, B\nB, C\nC, D"),
  );
  assert.equal(a.custom.chase.lossless, true);
  assert(a.custom.chase.steps.length >= 3);
  assert.deepEqual(a.custom.chase.table[a.custom.chase.witness], [0, 1, 2, 3]);
});
test("empty determinants, no dependencies, and trivial dependencies are valid", () => {
  const a = analyze(schema("A, B", "{} -> A\nA -> B"));
  assert.deepEqual(a.original.keys, [0]);
  assert.equal(a.original.normalForm, "BCNF");
  assert(a.third.chase.lossless);
  const b = analyze(schema("A, B", ""));
  assert.deepEqual(b.original.keys, [3]);
  assert.deepEqual(b.third.relations, [3]);
  assert.deepEqual(minimalCover([{ left: 1, right: 1 }]), []);
});
test("minimal cover removes extraneous left attributes and redundant dependencies", () => {
  const { fds } = parse(schema("A, B, C", "A -> B\nA, B -> C\nA -> C\nB -> B"));
  const cover = minimalCover(fds);
  assert.equal(cover.length, 2);
  assert(cover.every((f) => f.left === 1));
  for (let x = 0; x < 8; x++) assert.equal(closure(x, cover), closure(x, fds));
});
test("projection includes implied dependencies through attributes outside a fragment", () => {
  const a = analyze(schema("A, B, C", "A -> B\nB -> C", "A, C\nA, B"));
  assert(
    a.custom.components[0].projected.some((f) => f.left === 1 && f.right === 4),
  );
  assert(a.custom.chase.lossless);
  assert.equal(a.custom.preserved, false);
});
let state = 181;
const random = (n) => {
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  state >>>= 0;
  return state % n;
};
test("300 random schemas: closure equals intersection of every legal two-row agreement set", () => {
  for (let trial = 0; trial < 300; trial++) {
    const fds = Array.from({ length: 1 + random(8) }, () => ({
      left: random(16),
      right: 1 << random(4),
    }));
    const legal = Array.from({ length: 16 }, (_, i) => i).filter((m) =>
      fds.every((f) => !subset(f.left, m) || subset(f.right, m)),
    );
    for (let seed = 0; seed < 16; seed++) {
      const expected = legal
        .filter((m) => subset(seed, m))
        .reduce((a, b) => a & b, 15);
      assert.equal(closure(seed, fds), expected);
    }
  }
});
test("200 random schemas: cover equivalence, minimality, synthesis and BCNF guarantees", () => {
  for (let trial = 0; trial < 200; trial++) {
    const fds = Array.from({ length: random(12) }, () => ({
      left: random(32),
      right: 1 << random(5),
    }));
    const cover = minimalCover(fds);
    for (let x = 0; x < 32; x++)
      assert.equal(closure(x, cover), closure(x, fds));
    for (let i = 0; i < cover.length; i++) {
      const f = cover[i];
      assert(
        !subset(
          f.right,
          closure(
            f.left,
            cover.filter((_, j) => i !== j),
          ),
        ),
      );
      for (let b = 1; b <= 16; b *= 2)
        if (f.left & b) assert(!subset(f.right, closure(f.left & ~b, cover)));
    }
    const third = inspectDecomposition(31, fds, synthesize(31, fds));
    assert(third.preserved);
    assert(third.chase.lossless);
    assert(third.components.every((c) => c.normalForm !== "Below 3NF"));
    const bc = inspectDecomposition(31, fds, bcnf(31, fds).relations);
    assert(bc.chase.lossless);
    assert(bc.components.every((c) => c.normalForm === "BCNF"));
  }
});
test("binary chase agrees with intersection-key theorem across random splits", () => {
  for (let trial = 0; trial < 300; trial++) {
    const fds = Array.from({ length: random(8) }, () => ({
      left: random(16),
      right: 1 << random(4),
    }));
    const r = 1 + random(15),
      s = (15 & ~r) | random(16);
    if (!s) continue;
    assert.equal(
      chase(15, fds, [r, s]).lossless,
      subset(r, closure(r & s, fds)) || subset(s, closure(r & s, fds)),
    );
  }
});
test("closure trace has executable premises and candidate keys are minimal", () => {
  const { all, fds } = parse(example),
    trace = [];
  const end = closure(3, fds, trace);
  assert.equal(end, all);
  for (const step of trace) {
    assert(subset(step.left, step.before));
    assert.equal(step.after, step.before | step.right);
  }
  for (const k of keys(all, fds))
    for (let bit = 1; bit <= all; bit *= 2)
      if (k & bit) assert.notEqual(closure(k & ~bit, fds), all);
});
test("bounded inputs reject ambiguity, unknown names, missing attributes, and duplicate fragments", () => {
  for (const input of [
    schema("A, A", ""),
    schema("A, B", "A -> C"),
    schema("A, B", "AB -> B"),
    schema("A, B", "A ->"),
    schema("A, B", "", "A"),
    schema("A, B", "", "A, B\nB, A"),
    schema("A, B, C, D, E, F, G, H, I", ""),
    schema("1A", ""),
    schema("A", "A -> A\n".repeat(41)),
  ])
    assert.throws(() => analyze(input));
});
