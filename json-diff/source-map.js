(function (root) {
  "use strict";

  const yamlSchemas = typeof module !== "undefined" && module.exports
    ? require("../yaml-formatter/schema.js")
    : root.NativeCubeYaml;
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

  function yamlMappingKeys(source, events, yaml) {
    const map = yaml.legacyMapTag;
    const maps = [];
    const keysByMap = new WeakMap();
    const recordingMap = {
      ...map,
      create(tagName) {
        const value = map.create(tagName);
        const keys = [];
        keysByMap.set(value, keys);
        maps.push(keys);
        return value;
      },
      addPair(value, key, item) {
        // Let the same tag used by the loader resolve numeric and alias keys.
        const field = Object.create(null);
        const error = map.addPair(field, key, null);
        if (error) return error;
        const [name] = Object.keys(field);
        keysByMap.get(value).push(name);
        return map.addPair(value, name, item);
      },
    };
    yaml.constructFromEvents(events, {
      source,
      schema: yamlSchemas.coreSchema(yaml).withTags(recordingMap),
    });
    return maps;
  }

  function yamlLocations(source, yaml) {
    const events = yaml.parseEvents(source);
    const maps = yamlMappingKeys(source, events, yaml);
    const type = yaml.EVENT_ID;
    const style = yaml.SCALAR_STYLE;
    const documents = [];
    let index = 0;
    let mapIndex = 0;
    let cursor = 0;

    function flowEnd(closer) {
      let index = cursor;
      while (index < source.length) {
        if (/[\s,]/.test(source[index])) index++;
        else if (source[index] === "#") {
          while (index < source.length && !/[\r\n]/.test(source[index])) index++;
        } else break;
      }
      return source[index] === closer ? index + 1 : cursor;
    }

    function scalarStart(event) {
      if (event.valueStart < 0) {
        if (event.tagStart >= 0) return event.tagStart;
        if (event.anchorStart >= 0) return event.anchorStart - 1;
        return cursor;
      }
      if (event.style === style.SINGLE_QUOTED || event.style === style.DOUBLE_QUOTED) return event.valueStart - 1;
      if (event.style === style.LITERAL_BLOCK || event.style === style.FOLDED_BLOCK) {
        let lineEnd = event.valueStart;
        while (lineEnd > 0 && /[\r\n]/.test(source[lineEnd - 1])) lineEnd--;
        const lineStart = Math.max(source.lastIndexOf("\n", lineEnd - 1), source.lastIndexOf("\r", lineEnd - 1)) + 1;
        const from = Math.max(cursor, lineStart, event.anchorEnd, event.tagEnd);
        const header = source.indexOf(event.style === style.LITERAL_BLOCK ? "|" : ">", from);
        if (header >= 0 && header < lineEnd) return header;
      }
      return event.valueStart;
    }

    function readNode(locations, path, keyStart) {
      const event = events[index++];
      let start;
      let end;
      if (event.type === type.ALIAS) {
        start = event.anchorStart - 1;
        end = event.anchorEnd;
      } else if (event.type === type.SCALAR) {
        start = scalarStart(event);
        const quoted = event.style === style.SINGLE_QUOTED || event.style === style.DOUBLE_QUOTED;
        end = event.valueEnd < 0 ? Math.max(start, event.anchorEnd, event.tagEnd) : event.valueEnd + Number(quoted);
      } else {
        start = event.start;
        const mapping = event.type === type.MAPPING;
        const keys = mapping ? maps[mapIndex++] : null;
        const opening = mapping ? "{" : "[";
        const flow = event.style === yaml.COLLECTION_STYLE.FLOW && source[start] === opening;
        cursor = Math.max(cursor, start + Number(flow));
        for (let item = 0; events[index].type !== type.POP; item++) {
          const key = mapping ? readNode(locations, null) : null;
          readNode(locations, path === null ? null : pointer(path, mapping ? keys[item] : item), key?.start);
        }
        index++;
        end = flow ? flowEnd(mapping ? "}" : "]") : cursor;
      }

      if (event.tagStart >= 0) start = Math.min(start, event.tagStart);
      if (event.anchorStart >= 0) start = Math.min(start, event.anchorStart - 1);
      cursor = Math.max(cursor, end);
      while (end > start && /\s/.test(source[end - 1])) end--;
      if (path !== null) locations.set(path, { start, end, keyStart: keyStart ?? start, alias: event.type === type.ALIAS });
      return { start, end };
    }

    while (index < events.length) {
      const document = events[index++];
      const root = events[index];
      if (document.explicitStart && root.type === type.SCALAR && root.valueStart < 0) {
        const marker = /(?:^|[\r\n])---(?=\s|$)/g;
        marker.lastIndex = Math.max(0, cursor - 1);
        if (marker.test(source)) cursor = marker.lastIndex;
      }
      const locations = new Map();
      readNode(locations, "");
      index++;
      documents.push(locations);
    }
    return documents;
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
