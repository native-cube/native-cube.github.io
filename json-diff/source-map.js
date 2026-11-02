(function (root) {
  "use strict";

  const pointer = (path, key) => `${path}/${String(key).replace(/~/g, "~0").replace(/\//g, "~1")}`;
  const decode = (key) => key.replace(/~1/g, "/").replace(/~0/g, "~");

  function jsonLocations(source) {
    const locations = new Map();
    let index = 0;
    const space = () => { while (index < source.length && /\s/.test(source[index])) index++; };
    function string() {
      const start = index++;
      while (index < source.length) {
        const char = source[index++];
        if (char === "\\") index++;
        else if (char === '"') break;
      }
      return JSON.parse(source.slice(start, index));
    }
    function walk(path, keyStart) {
      space();
      const start = index;
      if (source[index] === "{") {
        index++;
        space();
        while (source[index] !== "}") {
          const childStart = index;
          const key = string();
          space();
          index++;
          walk(pointer(path, key), childStart);
          space();
          if (source[index] !== ",") break;
          index++;
          space();
        }
        index++;
      } else if (source[index] === "[") {
        index++;
        space();
        let item = 0;
        while (source[index] !== "]") {
          walk(pointer(path, item++));
          space();
          if (source[index] !== ",") break;
          index++;
        }
        index++;
      } else if (source[index] === '"') string();
      else while (index < source.length && !/[\s,\]}]/.test(source[index])) index++;
      locations.set(path, { start, end: index, keyStart: keyStart ?? start });
    }
    walk("");
    return [locations];
  }

  function yamlLocations(source, yaml) {
    const stack = [];
    const roots = [];
    yaml.loadAll(source, null, {
      schema: yaml.JSON_SCHEMA,
      listener(event, state) {
        if (event === "open") stack.push({ start: state.position, children: [] });
        else {
          const node = stack.pop();
          Object.assign(node, { end: state.position, kind: state.kind, value: state.result });
          if (stack.length) stack[stack.length - 1].children.push(node);
          else roots.push(node);
        }
      },
    });
    function trimStart(start, end) {
      while (start < end) {
        if (/\s/.test(source[start])) start++;
        else if (source[start] === "#") {
          const newline = source.indexOf("\n", start);
          start = newline < 0 ? end : newline + 1;
        } else break;
      }
      return start;
    }
    return roots.map((node) => {
      const locations = new Map();
      function visit(current, path, keyStart) {
        const start = trimStart(current.start, current.end);
        let end = current.end;
        while (end > start && /\s/.test(source[end - 1])) end--;
        locations.set(path, { start, end, keyStart: keyStart ?? start, alias: current.kind === null });
        // js-yaml can wrap a flow collection while probing for a block mapping.
        let children = current.children;
        while (children.length === 1 && children[0].value === current.value && children[0].kind === current.kind) children = children[0].children;
        if (current.kind === "mapping") {
          for (let index = 0; index + 1 < children.length; index += 2) {
            const key = children[index];
            const value = children[index + 1];
            visit(value, pointer(path, String(key.value)), trimStart(key.start, key.end));
          }
        } else if (current.kind === "sequence") {
          children.forEach((child, index) => visit(child, pointer(path, index)));
        }
      }
      visit(node, "");
      return locations;
    });
  }

  // Build only after NativeDiff.parse has validated the input and its size limits.
  function build(source, parsed, yaml = root.jsyaml) {
    return parsed.format === "json" ? jsonLocations(source) : yamlLocations(source, yaml);
  }

  function locate(locations, parsed, change, side, options = {}) {
    if (!Object.prototype.hasOwnProperty.call(change, side)) return null;
    const segments = change.path ? change.path.slice(1).split("/").map(decode) : [];
    let documentIndex = 0;
    let sourcePath = "";
    let value = parsed.documents[0];
    if (options.documents === "kubernetes") {
      segments.shift();
      const identity = segments.shift();
      const array = parsed.documents.length === 1 && Array.isArray(value);
      const resources = array ? value : parsed.documents;
      const index = resources.findIndex((resource) => JSON.stringify([
        resource.apiVersion, resource.kind, resource.metadata.namespace || "", resource.metadata.name,
      ]) === identity);
      if (index < 0) return null;
      if (array) sourcePath = pointer("", index);
      else documentIndex = index;
      value = resources[index];
    } else if (segments[0] === "documents" && (parsed.documents.length > 1 || options.multipleDocuments)) {
      segments.shift();
      documentIndex = Number(segments.shift());
      value = parsed.documents[documentIndex];
    }
    const map = locations[documentIndex];
    if (!map) return null;
    let alias = map.get(sourcePath)?.alias ? map.get(sourcePath) : null;
    for (let key of segments) {
      if (Array.isArray(value)) {
        if (options.arrayMode === "keyed" && key.startsWith(`${options.arrayKey || "name"}=`)) {
          const field = options.arrayKey || "name";
          key = value.findIndex((item) => `${field}=${JSON.stringify(item[field])}` === key);
        }
        key = Number(key);
        if (!Number.isInteger(key) || key < 0 || key >= value.length) return null;
      } else if (!value || typeof value !== "object" || !Object.prototype.hasOwnProperty.call(value, key)) return null;
      sourcePath = pointer(sourcePath, key);
      value = value[key];
      if (map.get(sourcePath)?.alias) alias = map.get(sourcePath);
    }
    const range = map.get(sourcePath) || alias;
    return range ? { ...range, documentIndex, sourcePath } : null;
  }

  const api = { build, locate };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.NativeDiffSource = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
