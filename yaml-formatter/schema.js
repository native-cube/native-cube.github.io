(function (root) {
  "use strict";

  const coreSchemas = new WeakMap();
  const legacyInteger = /^[+-]?(?:0b[01_]*[01]|0o[0-7_]*[0-7]|0x[\da-fA-F_]*[\da-fA-F]|\d(?:[\d_]*\d)?)$/;
  const legacyFloat = /^[+-]?(?:\d[\d_]*(?:\.[\d_]*)?|\.[\d_]+)(?:[eE][+-]?\d+)?$/;

  function coreSchema(yaml) {
    if (coreSchemas.has(yaml)) return coreSchemas.get(yaml);
    // Keep the binary, signed-base, and separator forms accepted by js-yaml 4.
    const integer = {
      ...yaml.intCoreTag,
      resolve(source) {
        return legacyInteger.test(source) ? yaml.intCoreTag.resolve(source.replaceAll("_", ""), true) : yaml.NOT_RESOLVED;
      },
    };
    const float = {
      ...yaml.floatCoreTag,
      resolve(source, explicit, tagName) {
        if (source.includes("_") && !source.endsWith("_") && legacyFloat.test(source)) source = source.replaceAll("_", "");
        return yaml.floatCoreTag.resolve(source, explicit, tagName);
      },
    };
    const schema = yaml.CORE_SCHEMA.withTags(yaml.legacyMapTag, integer, float);
    coreSchemas.set(yaml, schema);
    return schema;
  }

  function configurationSchema(yaml) {
    const map = yaml.legacyMapTag;
    const set = {
      ...map,
      tagName: yaml.setTag.tagName,
      addPair(value, key, item) {
        if (item !== null) return "cannot resolve a set item";
        return map.addPair(value, key, item);
      },
      identify: () => false,
    };

    // Keep the formatter and RBAC explorer's js-yaml 4 configuration types.
    return coreSchema(yaml).withTags(yaml.mergeTag, yaml.timestampTag, yaml.binaryTag, yaml.omapTag, yaml.pairsTag, set);
  }

  const api = { coreSchema, configurationSchema };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.NativeCubeYaml = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
