"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const yaml = require("../yaml-formatter/vendor/js-yaml.min.js");
const { configurationSchema } = require("../yaml-formatter/schema.js");

const schema = configurationSchema(yaml);

test("configuration YAML preserves merges, dates, and numeric forms", () => {
  const values = yaml.load(`defaults: &defaults {count: 1_000, flags: 0b101}
config: {<<: *defaults, estimate: 1_2.3_4, enabled: yes}
date: 2025-01-01`, { schema });
  assert.deepEqual(values.config, { count: 1000, flags: 5, estimate: 12.34, enabled: "yes" });
  assert.equal(values.date.toISOString(), "2025-01-01T00:00:00.000Z");
  assert.deepEqual(yaml.load(yaml.dump(values, { schema }), { schema }), values);
});

test("explicit YAML collection and binary tags remain JSON-convertible", () => {
  const documents = yaml.loadAll(`checks: !!set {one: null, two: null}
---
pairs: !!pairs [weight: 1]
ordered: !!omap [{one: 1}, {two: 2}]
---
bytes: !!binary AAEC`, { schema });
  assert.deepEqual(documents, [
    { checks: { one: null, two: null } },
    { pairs: [["weight", 1]], ordered: [{ one: 1 }, { two: 2 }] },
    { bytes: new Uint8Array([0, 1, 2]) },
  ]);
});

test("the embedded ApplicationSet parser decodes YAML line separators", () => {
  const page = fs.readFileSync(path.join(__dirname, "../argocd-applicationset-studio/index.html"), "utf8");
  const [, runtime] = page.match(/<script id="yaml-runtime-v1">\n([\s\S]*?)\n    <\/script>/);
  const context = vm.createContext({});
  vm.runInContext(runtime, context);
  const source = "\"first\\Nsecond\"";
  assert.equal(context.jsyaml.load(source), "first\u0085second");
  assert.equal(context.jsyaml.load(source), yaml.load(source));
});
