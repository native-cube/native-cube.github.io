"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const yaml = require("../yaml-formatter/vendor/js-yaml.min.js");
const { parse, compare } = require("../json-diff/diff.js");
const sourceMap = require("../json-diff/source-map.js");
const examples = require("../json-diff/examples.js");
const json = (value) => parse(JSON.stringify(value), "json", yaml);
const yml = (source) => parse(source, "yaml", yaml);
const diff = (before, after, options) => compare(json(before), json(after), options);

test("ignores object key order and reports precise added, removed and changed paths", () => {
  assert.deepEqual(diff({ same: { b: 2, a: 1 }, removed: null, changed: 2 }, { changed: 3, added: false, same: { a: 1, b: 2 } }), [
    { type: "added", path: "/added", after: false },
    { type: "changed", path: "/changed", before: 2, after: 3 },
    { type: "removed", path: "/removed", before: null },
  ]);
});

test("preserves types, missing versus null, empty keys and root changes", () => {
  for (const [before, after] of [[null, {}], [3, "3"], [false, 0], [[], {}], ["", null]]) {
    assert.deepEqual(diff(before, after), [{ type: "changed", path: "", before, after }]);
  }
  assert.deepEqual(diff({}, { "": null }), [{ type: "added", path: "/", after: null }]);
  assert.deepEqual(diff({ x: null }, {}), [{ type: "removed", path: "/x", before: null }]);
});

test("escapes JSON Pointer paths and handles prototype-looking property names safely", () => {
  const before = parse('{"a/b~c":1,"__proto__":{"safe":true},"constructor":1}', "json");
  const after = parse('{"a/b~c":2,"__proto__":{"safe":false},"constructor":2}', "json");
  assert.deepEqual(compare(before, after).map((entry) => entry.path), ["/__proto__/safe", "/a~1b~0c", "/constructor"]);
  assert.equal({}.safe, undefined);
});

test("ordered arrays track positions and preserve added/removed container values", () => {
  assert.deepEqual(diff([1, 2], [2, 1, { x: 3 }]), [
    { type: "changed", path: "/0", before: 1, after: 2 },
    { type: "changed", path: "/1", before: 2, after: 1 },
    { type: "added", path: "/2", after: { x: 3 } },
  ]);
  assert.deepEqual(diff({ x: { a: 1, b: 2 } }, {}), [{ type: "removed", path: "/x", before: { a: 1, b: 2 } }]);
});

test("unordered arrays compare complete values recursively and retain duplicate counts", () => {
  const options = { arrayMode: "unordered" };
  assert.deepEqual(diff([{ b: [1, 2], a: 1 }, 2, 2], [2, { a: 1, b: [2, 1] }, 2], options), []);
  assert.deepEqual(diff([1, 1], [1], options), [{ type: "removed", path: "/1", before: 1 }]);
  assert.deepEqual(diff(["1"], [1], options), [
    { type: "removed", path: "/0", before: "1" },
    { type: "added", path: "/0", after: 1 },
  ]);
  assert.deepEqual(diff([{ id: 1, value: "old" }], [{ id: 1, value: "new" }], options).map((entry) => entry.type), ["removed", "added"]);
});

test("keyed arrays match reordered objects and preserve scalar identity types", () => {
  const options = { arrayMode: "keyed", arrayKey: "id" };
  const changes = diff([{ id: 1, x: 2 }, { id: "1", x: 3 }], [{ id: "1", x: 3 }, { id: 1, x: 4 }], options);
  assert.deepEqual(changes, [{ type: "changed", path: "/id=1/x", before: 2, after: 4 }]);
  assert.deepEqual(diff([1, 2], [2, 1], options).length, 2);
  assert.deepEqual(diff([], [], options), []);
  assert.throws(() => diff([{ id: 1 }, { id: 1 }], [], options), /Duplicate array key/);
  assert.throws(() => diff([{ x: 1 }], [{ id: 1 }], options), /unique.*id/);
});

test("YAML and JSON compare across formats, comments, anchors, booleans and dates", () => {
  assert.deepEqual(compare(yml("# config\ndate: 2026-11-02\non: true\nbase: &base\n  replicas: 2\ncopy: *base\n"), json({ copy: { replicas: 2 }, base: { replicas: 2 }, on: true, date: "2026-11-02" })), []);
  assert.deepEqual(compare(yml("null"), json(null)), []);
  assert.deepEqual(compare(yml("---\n"), json(null)), []);
});

test("automatic detection handles JSON scalars and YAML keys starting with literal words", () => {
  for (const source of ['{"x":1}', '[1]', '"hello"', 'true', 'false', 'null', '-1.25e2']) {
    assert.equal(parse(source, "auto", yaml).format, "json");
  }
  for (const source of ["trueValue: yes", "nullish: value", "2026: value", "name: service"]) {
    assert.equal(parse(source, "auto", yaml).format, "yaml");
  }
  assert.equal(yml("{name: service}").documents[0].name, "service");
  assert.throws(() => parse("{name: service}", "auto", yaml));
});

test("rejects malformed JSON and duplicate keys including escaped equivalent keys", () => {
  for (const source of ['{"x":1,}', '{"x":}', '[,]', '[1 2]', 'true false', '{"x":1,"x":2}', '{"a":1,"\\u0061":2}', '{"nested":[{"x":1,"x":2}]}']) {
    assert.throws(() => parse(source, "json"), undefined, source);
  }
  assert.deepEqual(parse('{"a":{"x":1},"b":{"x":2}}', "json").documents, [{ a: { x: 1 }, b: { x: 2 } }]);
  assert.equal(parse('{"string":"a\\\"b\\\\c","a":1}', "json").documents[0].string, 'a"b\\c');
});

test("rejects invalid YAML, duplicate mappings, custom tags and recursive aliases", () => {
  for (const source of ['x: [1', 'x: 1\nx: 2', 'x: !custom value', 'x: &x\n  child: *x', 'x: .inf', 'x: .nan']) {
    assert.throws(() => yml(source), undefined, source);
  }
  assert.throws(() => parse("x: 1", "yaml", null), /parser could not load/);
});

test("multi-document YAML reports document positions without conflating a JSON array", () => {
  assert.deepEqual(compare(yml("x: 1\n---\nx: 2"), yml("x: 1\n---\nx: 3\n---\nx: 4")), [
    { type: "changed", path: "/documents/1/x", before: 2, after: 3 },
    { type: "added", path: "/documents/2", after: { x: 4 } },
  ]);
  assert.notDeepEqual(compare(yml("x: 1\n---\nx: 2"), json([{ x: 1 }, { x: 2 }])), []);
});

const resource = (name, namespace, extra = {}) => ({ apiVersion: "v1", kind: "ConfigMap", metadata: { name, ...(namespace === undefined ? {} : { namespace }) }, ...extra });
test("Kubernetes mode matches reordered YAML documents and JSON resource arrays", () => {
  const first = resource("first", "production", { data: { x: "1" } });
  const second = resource("second", "production");
  const updated = resource("first", "production", { data: { x: "2" } });
  const before = yml([first, second].map((value) => yaml.dump(value)).join("---\n"));
  const changes = compare(before, json([second, updated]), { documents: "kubernetes" });
  assert.equal(changes.length, 1);
  assert.match(changes[0].path, /^\/resources\/.+\/data\/x$/);
  assert.deepEqual([changes[0].before, changes[0].after], ["1", "2"]);
  assert.deepEqual(compare(before, json([second, first]), { documents: "kubernetes" }), []);
});

test("Kubernetes matching rejects duplicates and distinguishes namespace and API version", () => {
  const r = resource("app");
  assert.throws(() => diff([r, r], [], { documents: "kubernetes" }), /Duplicate resource identity/);
  assert.throws(() => diff([{ kind: "Pod" }], [], { documents: "kubernetes" }), /apiVersion/);
  assert.equal(diff([r], [resource("app", "default")], { documents: "kubernetes" }).length, 2);
  assert.equal(diff([r], [{ ...r, apiVersion: "v2" }], { documents: "kubernetes" }).length, 2);
});

test("rejects oversized inputs, unsafe integers, deeply nested and excessive values", () => {
  assert.throws(() => parse(" "), /Paste a document/);
  assert.throws(() => parse('"' + 'x'.repeat(1024 * 1024) + '"', "json"), /1 MiB/);
  assert.throws(() => parse('"' + '😀'.repeat(300000) + '"', "json"), /1 MiB/);
  assert.throws(() => parse("9007199254740993", "json"), /safe range/);
  assert.throws(() => parse("1e999", "json"), /finite/);
  assert.equal(parse('"9007199254740993"', "json").documents[0], "9007199254740993");
  assert.throws(() => parse("[".repeat(82) + "0" + "]".repeat(82), "json"), /nesting depth/);
  assert.throws(() => json(Array(50000).fill(0)), /expanded values/);
  assert.throws(() => yml("text: &text " + "x".repeat(100000) + "\ncopies: [" + Array(50).fill("*text").join(",") + "]"), /Expanded YAML text/);
});

test("rejects reports over the change limit instead of presenting partial results", () => {
  assert.throws(() => diff(Array(2001).fill(1), Array(2001).fill(2)), /More than 2,000 changes/);
  assert.equal(diff(Array(2000).fill(1), Array(2000).fill(2)).length, 2000);
});

function locatedValues(original, updated, beforeFormat = "json", afterFormat = "json", options = {}) {
  const parsed = { before: parse(original, beforeFormat, yaml), after: parse(updated, afterFormat, yaml) };
  const sources = { before: original, after: updated };
  const maps = Object.fromEntries(Object.entries(parsed).map(([side, value]) => [side, sourceMap.build(sources[side], value, yaml)]));
  const settings = { ...options, multipleDocuments: Object.values(parsed).some((value) => value.documents.length > 1) };
  return compare(parsed.before, parsed.after, options).map((change) => ({
    path: change.path,
    ...Object.fromEntries(["before", "after"].map((side) => {
      const location = sourceMap.locate(maps[side], parsed[side], change, side, settings);
      if (Object.prototype.hasOwnProperty.call(change, side)) assert.ok(location, `Missing ${side} source location for ${change.path}`);
      return [side, location ? sources[side].slice(location.start, location.end) : null];
    })),
  }));
}

test("source highlights follow reordered JSON keys and distinguish repeated values", () => {
  assert.deepEqual(locatedValues('{"same":2,"nested":{"x":2},"other":2}', '{"other":2,"nested":{"x":3},"same":2}'), [
    { path: "/nested/x", before: "2", after: "3" },
  ]);
  assert.deepEqual(locatedValues('{"a/b~c":"hello😀"}', '{"a/b~c":"hello😁"}'), [
    { path: "/a~1b~0c", before: '"hello😀"', after: '"hello😁"' },
  ]);
});

test("source locations cover YAML blocks, flow collections, empty values and escaped keys", () => {
  const original = "items:\n  - [a,b]\n  - {x: 2, y: 2}\nempty:\n'key/with~escape': |\n  original\n";
  const updated = "items:\n  - [a,c]\n  - {x: 3, y: 2}\nempty: false\n'key/with~escape': |\n  updated\n";
  const values = locatedValues(original, updated, "yaml", "yaml");
  assert.deepEqual(values.map((item) => [item.path, item.before, item.after]), [
    ["/empty", "", "false"],
    ["/items/0/1", "b", "c"],
    ["/items/1/x", "2", "3"],
    ["/key~1with~0escape", "|\n  original", "|\n  updated"],
  ]);
});

test("source highlights respect keyed arrays and unordered duplicate counts", () => {
  assert.deepEqual(locatedValues('[{"id":1,"x":2},{"id":2,"x":2}]', '[{"id":2,"x":2},{"id":1,"x":3}]', "json", "json", { arrayMode: "keyed", arrayKey: "id" }), [
    { path: "/id=1/x", before: "2", after: "3" },
  ]);
  assert.deepEqual(locatedValues('[1,1,2]', '[2,1]', "json", "json", { arrayMode: "unordered" }), [
    { path: "/1", before: "1", after: null },
  ]);
});

test("source locations follow reordered Kubernetes documents across YAML and JSON", () => {
  const first = resource("first", "production", { data: { x: "old" } });
  const second = resource("second", "production");
  const original = [first, second].map((value) => yaml.dump(value)).join("---\n");
  const updated = JSON.stringify([second, { ...first, data: { x: "new" } }], null, 2);
  const values = locatedValues(original, updated, "yaml", "json", { documents: "kubernetes" });
  assert.equal(values.length, 1);
  assert.deepEqual([values[0].before, values[0].after], ["old", '"new"']);
});

test("source highlights use alias references for inherited fields and preserve empty documents", () => {
  const values = locatedValues('base: &base\n  x: 1\ncopy: *base\n', 'base: &base\n  x: 2\ncopy: *base\n', "yaml", "yaml");
  assert.deepEqual(values, [
    { path: "/base/x", before: "1", after: "2" },
    { path: "/copy/x", before: "*base", after: "*base" },
  ]);
  assert.deepEqual(locatedValues('---\n---\nx: 1\n', '---\n---\nx: 2\n', "yaml", "yaml"), [
    { path: "/documents/1/x", before: "1", after: "2" },
  ]);
});

test("source highlights retain direct property names that resemble internal document paths", () => {
  assert.deepEqual(locatedValues('{"documents":[1]}', '{"documents":[2]}'), [
    { path: "/documents/0", before: "1", after: "2" },
  ]);
});

test("all category examples demonstrate the intended changes with valid source highlights", () => {
  const expected = {
    json: { added: 2, removed: 1, changed: 2 },
    "json-records": { added: 1, removed: 1, changed: 1 },
    "json-unordered": { added: 1, removed: 1, changed: 0 },
    "json-types": { added: 1, removed: 2, changed: 2 },
    "json-cross-format": { added: 0, removed: 0, changed: 0 },
    yaml: { added: 1, removed: 1, changed: 2 },
    "yaml-compose": { added: 2, removed: 1, changed: 3 },
    "yaml-helm": { added: 1, removed: 0, changed: 5 },
    "yaml-anchors": { added: 0, removed: 0, changed: 3 },
    "yaml-equivalent": { added: 0, removed: 0, changed: 0 },
    kubernetes: { added: 0, removed: 0, changed: 2 },
    "kubernetes-config": { added: 1, removed: 1, changed: 2 },
    "kubernetes-containers": { added: 0, removed: 0, changed: 2 },
    "kubernetes-ingress": { added: 1, removed: 0, changed: 3 },
    "kubernetes-resources": { added: 0, removed: 0, changed: 4 },
  };
  assert.deepEqual(Object.keys(examples).sort(), Object.keys(expected).sort());
  for (const category of ["json", "yaml", "kubernetes"]) {
    assert.equal(Object.values(examples).filter((example) => example.category === category).length, 5);
  }
  for (const [id, example] of Object.entries(examples)) {
    const [before, after] = example.sources.map((source, index) => parse(source, example.formats[index], yaml));
    const changes = compare(before, after, example.options);
    const counts = { added: 0, removed: 0, changed: 0 };
    changes.forEach((change) => counts[change.type]++);
    assert.deepEqual(counts, expected[id], id);
    // Each demonstrated edit must also be reachable in the editable inputs.
    locatedValues(...example.sources, ...example.formats, example.options);
  }
});
