(function (root) {
  "use strict";

  const MAX_SOURCE = 1024 * 1024;
  const MAX_DEPTH = 80;
  const MAX_NODES = 50000;
  const MAX_CHANGES = 2000;
  const MAX_EXPANDED_TEXT = 4 * 1024 * 1024;
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const pointer = (path, key) => `${path}/${String(key).replace(/~/g, "~0").replace(/\//g, "~1")}`;
  const kind = (value) => value === null ? "null" : Array.isArray(value) ? "array" : typeof value;

  // JSON.parse silently accepts duplicate keys. Check them before parsing values.
  function parseJson(source) {
    let index = 0;
    const space = () => { while (/\s/.test(source[index] || "") && index < source.length) index++; };
    function string() {
      const start = index++;
      while (index < source.length) {
        const char = source[index++];
        if (char === "\\") index++;
        else if (char === '"') return JSON.parse(source.slice(start, index));
      }
      throw new Error("Unterminated JSON string.");
    }
    function walk(depth) {
      if (depth > MAX_DEPTH) throw new Error(`Maximum nesting depth is ${MAX_DEPTH}.`);
      space();
      if (source[index] === "{") {
        index++;
        space();
        const keys = new Set();
        if (source[index] === "}") { index++; return; }
        while (index < source.length) {
          if (source[index] !== '"') break;
          const key = string();
          if (keys.has(key)) throw new Error(`Duplicate JSON key ${JSON.stringify(key)}.`);
          keys.add(key);
          space();
          if (source[index++] !== ":") break;
          walk(depth + 1);
          space();
          if (source[index] === "}") { index++; return; }
          if (source[index++] !== ",") break;
          space();
        }
      } else if (source[index] === "[") {
        index++;
        space();
        if (source[index] === "]") { index++; return; }
        while (index < source.length) {
          walk(depth + 1);
          space();
          if (source[index] === "]") { index++; return; }
          if (source[index++] !== ",") break;
        }
      } else if (source[index] === '"') {
        string();
      } else {
        while (index < source.length && !/[\s,\]}]/.test(source[index])) index++;
      }
    }
    walk(0);
    return JSON.parse(source);
  }

  function validate(documents) {
    let nodes = 0;
    let textSize = 0;
    const ancestors = new Set();
    function visit(value, depth) {
      if (typeof value === "string") textSize += value.length;
      if (value && typeof value === "object") textSize += Object.keys(value).join("").length;
      if (textSize > MAX_EXPANDED_TEXT) throw new Error("Expanded YAML text exceeds 4 MiB. Reduce aliases or repeated values.");
      if (++nodes > MAX_NODES) throw new Error(`Input exceeds ${MAX_NODES.toLocaleString("en-US")} expanded values. Reduce the document or YAML aliases.`);
      if (depth > MAX_DEPTH) throw new Error(`Maximum nesting depth is ${MAX_DEPTH}.`);
      if (typeof value === "number" && (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))) {
        throw new Error("Numbers must be finite and integers must be within JavaScript's safe range. Quote large identifiers to compare them exactly.");
      }
      if (value === null || ["string", "boolean", "number"].includes(typeof value)) return;
      if (typeof value !== "object") throw new Error("Only JSON-compatible YAML values are supported.");
      if (ancestors.has(value)) throw new Error("Recursive YAML aliases cannot be compared.");
      ancestors.add(value);
      Object.values(value).forEach((child) => visit(child, depth + 1));
      ancestors.delete(value);
    }
    documents.forEach((value) => visit(value, 0));
  }

  function parse(source, format = "auto", yaml = root.jsyaml) {
    if (!source.trim()) throw new Error("Paste a document or open a file first. Use null, {} or [] for an empty value.");
    if (source.length > MAX_SOURCE || new TextEncoder().encode(source).length > MAX_SOURCE) throw new Error("Each input is limited to 1 MiB.");
    const detected = format === "auto" ? (/^[{\["]/.test(source.trimStart()) || /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)$/.test(source.trim()) ? "json" : "yaml") : format;
    let documents;
    if (detected === "json") {
      documents = [parseJson(source)];
    } else {
      if (!yaml) throw new Error("The YAML parser could not load. Reload this page to try again.");
      documents = yaml.loadAll(source, null, {
        schema: yaml.JSON_SCHEMA,
        onWarning(warning) { throw warning; },
      });
      if (!documents.length) throw new Error("No YAML document found.");
      // An empty YAML document has the same value as an explicit null.
      documents = documents.map((value) => value === undefined ? null : value);
    }
    validate(documents);
    return { documents, format: detected };
  }

  function canonical(value, unordered) {
    if (Array.isArray(value)) {
      const items = value.map((item) => canonical(item, unordered));
      if (unordered) items.sort();
      return `[${items.join(",")}]`;
    }
    if (value !== null && typeof value === "object") {
      return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key], unordered)}`).join(",")}}`;
    }
    return JSON.stringify(value);
  }

  function resourceKey(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Kubernetes matching requires resource objects in every document.");
    const { apiVersion, kind: resourceKind, metadata } = value;
    if (typeof apiVersion !== "string" || typeof resourceKind !== "string" || !metadata || typeof metadata.name !== "string" || (metadata.namespace !== undefined && typeof metadata.namespace !== "string")) {
      throw new Error("Each Kubernetes document needs apiVersion, kind and metadata.name, plus a string namespace if supplied.");
    }
    return JSON.stringify([apiVersion, resourceKind, metadata.namespace || "", metadata.name]);
  }

  function keyed(items, keyFor, label) {
    const values = new Map();
    items.forEach((item) => {
      const key = keyFor(item);
      if (values.has(key)) throw new Error(`Duplicate ${label}: ${key}. Keys must be unique for matching.`);
      values.set(key, item);
    });
    return values;
  }

  function compare(before, after, options = {}) {
    validate(before.documents);
    validate(after.documents);
    const changes = [];
    const arrayMode = options.arrayMode || "ordered";
    const arrayKey = options.arrayKey || "name";
    function add(type, path, oldValue, newValue) {
      if (changes.length >= MAX_CHANGES) throw new Error(`More than ${MAX_CHANGES.toLocaleString("en-US")} changes. Compare smaller inputs to see a complete report.`);
      const entry = { type, path };
      if (type !== "added") entry.before = oldValue;
      if (type !== "removed") entry.after = newValue;
      changes.push(entry);
    }
    function compareMaps(left, right, path) {
      [...new Set([...left.keys(), ...right.keys()])].sort().forEach((key) => {
        const childPath = pointer(path, key);
        if (!left.has(key)) add("added", childPath, undefined, right.get(key));
        else if (!right.has(key)) add("removed", childPath, left.get(key));
        else visit(left.get(key), right.get(key), childPath);
      });
    }
    function visit(left, right, path) {
      if (left === right) return;
      if (kind(left) !== kind(right) || left === null || typeof left !== "object") {
        add("changed", path, left, right);
      } else if (Array.isArray(left)) {
        if (arrayMode === "unordered") {
          const remaining = new Map();
          right.forEach((item, index) => {
            const key = canonical(item, true);
            if (!remaining.has(key)) remaining.set(key, []);
            remaining.get(key).push(index);
          });
          const matched = new Set();
          left.forEach((item, index) => {
            const candidates = remaining.get(canonical(item, true));
            if (candidates?.length) matched.add(candidates.pop());
            else add("removed", pointer(path, index), item);
          });
          right.forEach((item, index) => {
            if (!matched.has(index)) add("added", pointer(path, index), undefined, item);
          });
        } else if (arrayMode === "keyed" && [...left, ...right].every((item) => kind(item) === "object")) {
          const getKey = (item) => {
            if (!own(item, arrayKey) || !["string", "number", "boolean"].includes(typeof item[arrayKey])) throw new Error(`Object arrays at ${path || "(root)"} need a unique string, number or boolean '${arrayKey}' field in every item.`);
            return `${arrayKey}=${JSON.stringify(item[arrayKey])}`;
          };
          compareMaps(keyed(left, getKey, "array key"), keyed(right, getKey, "array key"), path);
        } else {
          for (let index = 0; index < Math.max(left.length, right.length); index++) {
            if (index >= left.length) add("added", pointer(path, index), undefined, right[index]);
            else if (index >= right.length) add("removed", pointer(path, index), left[index]);
            else visit(left[index], right[index], pointer(path, index));
          }
        }
      } else {
        compareMaps(new Map(Object.entries(left)), new Map(Object.entries(right)), path);
      }
    }

    if (options.documents === "kubernetes") {
      const resources = (docs) => docs.length === 1 && Array.isArray(docs[0]) ? docs[0] : docs;
      compareMaps(keyed(resources(before.documents), resourceKey, "resource identity"), keyed(resources(after.documents), resourceKey, "resource identity"), "/resources");
    } else if (before.documents.length === 1 && after.documents.length === 1) {
      visit(before.documents[0], after.documents[0], "");
    } else {
      const left = before.documents;
      const right = after.documents;
      for (let index = 0; index < Math.max(left.length, right.length); index++) {
        const path = pointer("/documents", index);
        if (index >= left.length) add("added", path, undefined, right[index]);
        else if (index >= right.length) add("removed", path, left[index]);
        else visit(left[index], right[index], path);
      }
    }
    return changes;
  }

  const api = { parse, compare, MAX_SOURCE };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.NativeDiff = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
