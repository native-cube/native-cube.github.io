("use strict");

(() => {
  const SAMPLE_APPLICATIONSET = `apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: regional-services
  namespace: argocd
spec:
  goTemplate: true
  goTemplateOptions:
    - missingkey=error
  generators:
    - matrix:
        generators:
          - list:
              elements:
                - team: payments
                  environment: development
                  revision: develop
                - team: payments
                  environment: production
                  revision: main
          - clusters:
              selector:
                matchLabels:
                  region: europe
  template:
    metadata:
      name: '{{ .team }}-{{ .environment }}-{{ .nameNormalized }}'
      labels:
        team: '{{ .team }}'
        environment: '{{ .environment }}'
    spec:
      project: '{{ .team }}'
      source:
        repoURL: https://github.com/native-cube/platform-apps.git
        targetRevision: '{{ .revision }}'
        path: 'services/{{ .team }}'
      destination:
        server: '{{ .server }}'
        namespace: '{{ .team }}-{{ .environment }}'
      syncPolicy:
        automated:
          enabled: true
          prune: true
          selfHeal: true
        syncOptions:
          - CreateNamespace=true
  syncPolicy:
    preserveResourcesOnDeletion: true
`;

  const SAMPLE_DATA = `clusters:
  - name: engineering-eu
    server: https://engineering-eu.example.com
    labels:
      region: europe
      tier: non-production
  - name: production-eu
    server: https://production-eu.example.com
    labels:
      region: europe
      tier: production
  - name: development-us
    server: https://development-us.example.com
    labels:
      region: americas
      tier: non-production

# Mock unsupported generators by type or generator path, for example:
# generatorResults:
#   pullRequest:
#     - branch: feature/demo
#       number: "42"
`;

  const SAMPLE_PROJECTS = `apiVersion: argoproj.io/v1alpha1
kind: AppProject
metadata:
  name: payments
  namespace: argocd
spec:
  description: Payment services managed through ApplicationSets
  sourceRepos:
    - https://github.com/native-cube/platform-apps.git
  destinations:
    - server: https://engineering-eu.example.com
      namespace: payments-*
    # Deliberately restrict production to demonstrate a guardrail finding.
    - server: https://production-eu.example.com
      namespace: payments-production
  clusterResourceWhitelist:
    - group: ""
      kind: Namespace
`;

  const GIT_DIRECTORY_APPLICATIONSET = `apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: monorepo-services
  namespace: argocd
spec:
  goTemplate: true
  goTemplateOptions:
    - missingkey=error
  generators:
    - git:
        repoURL: https://github.com/native-cube/platform-apps.git
        revision: main
        directories:
          - path: services/*
          - path: services/legacy-*
            exclude: true
        values:
          environment: development
  template:
    metadata:
      name: '{{ .path.basenameNormalized }}-{{ .values.environment }}'
      labels:
        discovered-by: git-directory
    spec:
      project: platform
      source:
        repoURL: https://github.com/native-cube/platform-apps.git
        targetRevision: main
        path: '{{ .path.path }}'
      destination:
        server: https://kubernetes.default.svc
        namespace: 'apps-{{ .path.basenameNormalized }}'
      syncPolicy:
        syncOptions:
          - CreateNamespace=true
  syncPolicy:
    preserveResourcesOnDeletion: true
`;

  const GIT_DIRECTORY_DATA = `gitDirectories:
  - services/catalog
  - services/checkout
  - services/notifications
  - services/legacy-billing
  - infrastructure/monitoring
`;

  const GIT_DIRECTORY_PROJECTS = `apiVersion: argoproj.io/v1alpha1
kind: AppProject
metadata:
  name: platform
  namespace: argocd
spec:
  sourceRepos:
    - https://github.com/native-cube/platform-apps.git
  destinations:
    - server: https://kubernetes.default.svc
      namespace: apps-*
`;

  const MERGE_APPLICATIONSET = `apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: environment-overrides
  namespace: argocd
spec:
  goTemplate: true
  goTemplateOptions:
    - missingkey=error
  generators:
    - merge:
        mergeKeys:
          - server
        generators:
          - list:
              elements:
                - environment: development
                  server: https://development.example.com
                  revision: develop
                  values:
                    replicas: "1"
                - environment: production
                  server: https://production.example.com
                  revision: main
                  values:
                    replicas: "2"
          - list:
              elements:
                - server: https://production.example.com
                  values:
                    replicas: "4"
  template:
    metadata:
      name: 'orders-{{ .environment }}'
      annotations:
        example.native-cube.com/replicas: '{{ .values.replicas }}'
    spec:
      project: workloads
      source:
        repoURL: https://github.com/native-cube/platform-apps.git
        targetRevision: '{{ .revision }}'
        path: services/orders
      destination:
        server: '{{ .server }}'
        namespace: 'orders-{{ .environment }}'
  syncPolicy:
    preserveResourcesOnDeletion: true
`;

  const MERGE_PROJECTS = `apiVersion: argoproj.io/v1alpha1
kind: AppProject
metadata:
  name: workloads
  namespace: argocd
spec:
  sourceRepos:
    - https://github.com/native-cube/platform-apps.git
  destinations:
    - server: https://development.example.com
      namespace: orders-development
    - server: https://production.example.com
      namespace: orders-production
`;

  const SCM_APPLICATIONSET = `apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: module-examples
  namespace: argocd
spec:
  goTemplate: true
  goTemplateOptions:
    - missingkey=error
  generators:
    - scmProvider:
        cloneProtocol: https
        github:
          organization: native-cube
        filters:
          - repositoryMatch: ^terraform-aws-.*
  template:
    metadata:
      name: '{{ .repository | normalize }}'
      labels:
        source: scm-provider
    spec:
      project: infrastructure
      source:
        repoURL: '{{ .url }}'
        targetRevision: '{{ .branch }}'
        path: examples/complete
      destination:
        server: https://kubernetes.default.svc
        namespace: 'infra-{{ .repository | normalize }}'
  syncPolicy:
    preserveResourcesOnDeletion: true
`;

  const SCM_DATA = `generatorResults:
  scmProvider:
    - repository: terraform-aws-eks
      url: https://github.com/native-cube/terraform-aws-eks.git
      branch: main
    - repository: terraform-aws-kms
      url: https://github.com/native-cube/terraform-aws-kms.git
      branch: main
    - repository: terraform-aws-vpc-flow-logs
      url: https://github.com/native-cube/terraform-aws-vpc-flow-logs.git
      branch: main
`;

  const SCM_PROJECTS = `apiVersion: argoproj.io/v1alpha1
kind: AppProject
metadata:
  name: infrastructure
  namespace: argocd
spec:
  sourceRepos:
    - https://github.com/native-cube/terraform-aws-*.git
  destinations:
    - server: https://kubernetes.default.svc
      namespace: infra-*
`;

  const EXAMPLES = {
    "regional-matrix": {
      label: "Regional matrix",
      source: SAMPLE_APPLICATIONSET,
      data: SAMPLE_DATA,
      projects: SAMPLE_PROJECTS,
    },
    "git-directory": {
      label: "Git directory discovery",
      source: GIT_DIRECTORY_APPLICATIONSET,
      data: GIT_DIRECTORY_DATA,
      projects: GIT_DIRECTORY_PROJECTS,
    },
    "merge-overrides": {
      label: "Merge overrides",
      source: MERGE_APPLICATIONSET,
      data: "",
      projects: MERGE_PROJECTS,
    },
    "scm-provider": {
      label: "Mocked SCM provider",
      source: SCM_APPLICATIONSET,
      data: SCM_DATA,
      projects: SCM_PROJECTS,
    },
  };

  const GENERATOR_KEYS = [
    "list",
    "clusters",
    "git",
    "matrix",
    "merge",
    "scmProvider",
    "pullRequest",
    "clusterDecisionResource",
    "plugin",
  ];

  const SUPPORTED_GENERATORS = new Set(["list", "clusters", "git", "matrix", "merge"]);
  const MISSING = Symbol("missing");
  const state = {
    applicationSet: null,
    applications: [],
    diagnostics: [],
    projects: new Map(),
    selectedName: "",
    baseline: null,
    changes: null,
    fidelity: {
      mocked: false,
      approximated: false,
      unsupportedExpressions: new Set(),
    },
    lastDialogFocus: null,
  };

  let toastTimer = 0;

  function byId(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function clone(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
  }

  function isObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function deepMerge(base, override) {
    if (!isObject(base) || !isObject(override)) return clone(override);
    const result = clone(base);
    Object.entries(override).forEach(([key, value]) => {
      result[key] = isObject(value) && isObject(result[key])
        ? deepMerge(result[key], value)
        : clone(value);
    });
    return result;
  }

  function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (!isObject(value)) return value;
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        result[key] = stableValue(value[key]);
        return result;
      }, {});
  }

  function stableStringify(value) {
    return JSON.stringify(stableValue(value));
  }

  function yamlDump(value) {
    return window.jsyaml.dump(value, {
      noRefs: true,
      lineWidth: 110,
      noCompatMode: true,
      quotingType: '"',
      forceQuotes: false,
    });
  }

  function parseDocuments(text, label, allowEmpty = false) {
    if (!text.trim()) {
      if (allowEmpty) return [];
      throw new Error(`${label} is empty.`);
    }
    const documents = [];
    try {
      window.jsyaml.loadAll(text, (document) => {
        if (document !== null && document !== undefined) documents.push(document);
      });
    } catch (error) {
      const location = error.mark
        ? ` at line ${error.mark.line + 1}, column ${error.mark.column + 1}`
        : "";
      throw new Error(`${label} is not valid YAML or JSON${location}: ${error.reason || error.message}`);
    }
    if (!allowEmpty && documents.length === 0) throw new Error(`${label} contains no documents.`);
    return documents;
  }

  function assertSafeDocuments(documents, label) {
    documents.forEach((document) => {
      if (isObject(document) && document.kind === "Secret") {
        throw new Error(`${label} contains a Secret. Remove credentials and provide only ApplicationSet or AppProject configuration.`);
      }
      if (
        isObject(document) &&
        Array.isArray(document.users) &&
        Array.isArray(document.contexts) &&
        Object.hasOwn(document, "current-context")
      ) {
        throw new Error(`${label} appears to contain a kubeconfig. Kubeconfig input is not accepted.`);
      }
    });
  }

  function parseGeneratorData(text) {
    const documents = parseDocuments(text, "Generator data", true);
    if (documents.length === 0) return {};
    if (documents.length > 1) throw new Error("Generator data must contain a single YAML or JSON document.");
    if (!isObject(documents[0])) throw new Error("Generator data must be an object.");
    return documents[0];
  }

  function addDiagnostic(severity, title, detail, options = {}) {
    state.diagnostics.push({
      severity,
      title,
      detail,
      code: options.code || title,
      application: options.application || "",
      generator: options.generator || "",
    });
  }

  function addDiagnosticOnce(severity, title, detail, options = {}) {
    const code = options.code || title;
    if (state.diagnostics.some((item) => item.code === code && item.application === (options.application || ""))) {
      return;
    }
    addDiagnostic(severity, title, detail, { ...options, code });
  }

  function normalizeName(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9.-]+/g, "-")
      .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "")
      .replace(/-+/g, "-")
      .slice(0, 253);
  }

  function slugify(value, maxLength = 63, smart = false) {
    let result = String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (result.length <= maxLength) return result;
    result = result.slice(0, maxLength);
    if (smart && result.includes("-")) result = result.replace(/-[^-]*$/, "");
    return result.replace(/-+$/g, "");
  }

  function pathParameters(path) {
    const clean = String(path || "").replace(/^\/+|\/+$/g, "");
    const segments = clean ? clean.split("/") : [];
    const basename = segments.at(-1) || "";
    return {
      path: clean,
      basename,
      basenameNormalized: normalizeName(basename),
      filename: basename,
      filenameNormalized: normalizeName(basename),
      segments,
    };
  }

  function getPath(source, rawPath) {
    if (source === null || source === undefined) return MISSING;
    let path = String(rawPath || "").trim();
    if (path === ".") return source;
    path = path.replace(/^\./, "");
    if (!path) return source;
    if (Object.hasOwn(source, path)) return source[path];
    const segments = path.split(".").filter(Boolean);
    let cursor = source;
    for (const segment of segments) {
      if (cursor === null || cursor === undefined || !Object.hasOwn(Object(cursor), segment)) return MISSING;
      cursor = cursor[segment];
    }
    return cursor;
  }

  function tokenize(expression) {
    const tokens = [];
    let current = "";
    let quote = "";
    for (let index = 0; index < expression.length; index += 1) {
      const character = expression[index];
      if (quote) {
        current += character;
        if (character === quote && expression[index - 1] !== "\\") quote = "";
      } else if (character === '"' || character === "'") {
        quote = character;
        current += character;
      } else if (/\s/.test(character)) {
        if (current) tokens.push(current);
        current = "";
      } else {
        current += character;
      }
    }
    if (current) tokens.push(current);
    return tokens;
  }

  function splitPipeline(expression) {
    const parts = [];
    let current = "";
    let quote = "";
    let depth = 0;
    for (let index = 0; index < expression.length; index += 1) {
      const character = expression[index];
      if (quote) {
        current += character;
        if (character === quote && expression[index - 1] !== "\\") quote = "";
      } else if (character === '"' || character === "'") {
        quote = character;
        current += character;
      } else if (character === "(") {
        depth += 1;
        current += character;
      } else if (character === ")") {
        depth = Math.max(0, depth - 1);
        current += character;
      } else if (character === "|" && depth === 0) {
        parts.push(current.trim());
        current = "";
      } else {
        current += character;
      }
    }
    if (current.trim()) parts.push(current.trim());
    return parts;
  }

  function literalOrPath(token, parameters) {
    if (token === undefined) return MISSING;
    const trimmed = token.trim().replace(/^\((.*)\)$/s, "$1").trim();
    if (
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
      return trimmed.slice(1, -1).replaceAll("\\\"", '"');
    }
    if (trimmed === "true") return true;
    if (trimmed === "false") return false;
    if (trimmed === "nil" || trimmed === "null") return null;
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
    return getPath(parameters, trimmed);
  }

  function applyTemplateFunction(name, args, pipedValue, parameters, context) {
    const values = args.map((token) => literalOrPath(token, parameters));
    const input = pipedValue !== MISSING
      ? pipedValue
      : name === "slugify" ? values.pop() : values.shift();
    switch (name) {
      case "normalize":
        return normalizeName(input);
      case "slugify": {
        const length = values.find((value) => typeof value === "number") || 63;
        const smart = values.find((value) => typeof value === "boolean") || false;
        return slugify(input, length, smart);
      }
      case "lower":
        return String(input === MISSING ? "" : input).toLowerCase();
      case "upper":
        return String(input === MISSING ? "" : input).toUpperCase();
      case "trim":
        return String(input === MISSING ? "" : input).trim();
      case "quote":
        return `"${String(input === MISSING ? "" : input).replaceAll('"', '\\"')}"`;
      case "toString":
        return input === MISSING || input === null ? "" : String(input);
      case "default": {
        const defaultValue = pipedValue !== MISSING ? values[0] : input;
        const candidate = pipedValue !== MISSING ? pipedValue : values[0];
        return candidate === MISSING || candidate === "" || candidate === null || candidate === false
          ? defaultValue
          : candidate;
      }
      case "required": {
        const message = pipedValue !== MISSING ? values[0] : input;
        const candidate = pipedValue !== MISSING ? pipedValue : values[0];
        if (candidate === MISSING || candidate === "" || candidate === null) {
          context.errors.push(String(message || "A required template value is missing."));
          return "";
        }
        return candidate;
      }
      default:
        state.fidelity.approximated = true;
        state.fidelity.unsupportedExpressions.add(name);
        context.unsupported.add(name);
        return input === MISSING ? "" : input;
    }
  }

  function evaluateExpression(expression, parameters, context) {
    const clean = expression.replace(/^-\s*|\s*-$/g, "").trim();
    if (!clean) return "";
    if (/^(if|range|with|end|else)\b/.test(clean)) {
      context.unsupported.add(clean.split(/\s/)[0]);
      state.fidelity.approximated = true;
      return "";
    }
    if (clean.includes("(") || clean.includes(")")) {
      context.unsupported.add("nested template expressions");
      state.fidelity.approximated = true;
      return "";
    }
    const pipeline = splitPipeline(clean);
    let value = MISSING;
    pipeline.forEach((part, index) => {
      const tokens = tokenize(part);
      if (tokens.length === 0) return;
      if (index === 0 && tokens[0] === "index") {
        const container = literalOrPath(tokens[1], parameters);
        const key = literalOrPath(tokens[2], parameters);
        value = container !== MISSING && container !== null && Object.hasOwn(Object(container), key)
          ? container[key]
          : MISSING;
      } else if (
        ["normalize", "slugify", "lower", "upper", "trim", "quote", "toString", "default", "required"].includes(tokens[0]) ||
        (index > 0 && !tokens[0].startsWith(".")) ||
        (index === 0 && tokens.length > 1 && !tokens[0].startsWith(".") && !tokens[0].startsWith('"') && !tokens[0].startsWith("'"))
      ) {
        value = applyTemplateFunction(tokens[0], tokens.slice(1), index > 0 ? value : MISSING, parameters, context);
      } else {
        value = literalOrPath(part, parameters);
      }
    });
    if (value === MISSING) {
      context.missing.add(clean);
      return "";
    }
    if (value === null || value === undefined) return "";
    if (isObject(value) || Array.isArray(value)) return JSON.stringify(value);
    return String(value);
  }

  function renderString(value, parameters, context) {
    if (!value.includes("{{")) return value;
    return value.replace(/{{(-)?([\s\S]*?)(-)?}}/g, (_match, _left, expression) =>
      evaluateExpression(expression, parameters, context));
  }

  function renderValue(value, parameters, context) {
    if (typeof value === "string") return renderString(value, parameters, context);
    if (Array.isArray(value)) return value.map((item) => renderValue(item, parameters, context));
    if (isObject(value)) {
      return Object.entries(value).reduce((result, [key, child]) => {
        result[key] = renderValue(child, parameters, context);
        return result;
      }, {});
    }
    return value;
  }

  function globRegExp(pattern, pathAware = false) {
    let expression = "^";
    const source = String(pattern || "");
    for (let index = 0; index < source.length; index += 1) {
      const character = source[index];
      if (character === "*") {
        if (source[index + 1] === "*") {
          expression += ".*";
          index += 1;
        } else {
          expression += pathAware ? "[^/]*" : ".*";
        }
      } else if (character === "?") {
        expression += pathAware ? "[^/]" : ".";
      } else {
        expression += character.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
      }
    }
    return new RegExp(`${expression}$`);
  }

  function matchesGlob(value, pattern, pathAware = false) {
    return globRegExp(pattern, pathAware).test(String(value || ""));
  }

  function selectorValue(parameters, key) {
    const direct = getPath(parameters, key);
    if (direct !== MISSING) return direct;
    const label = getPath(parameters, `metadata.labels.${key}`);
    return label !== MISSING ? label : MISSING;
  }

  function matchesSelector(parameters, selector) {
    if (!isObject(selector)) return true;
    const labels = selector.matchLabels || {};
    if (Object.entries(labels).some(([key, value]) => String(selectorValue(parameters, key)) !== String(value))) {
      return false;
    }
    return (selector.matchExpressions || []).every((expression) => {
      const actual = selectorValue(parameters, expression.key);
      const values = (expression.values || []).map(String);
      switch (expression.operator) {
        case "In":
          return actual !== MISSING && values.includes(String(actual));
        case "NotIn":
          return actual !== MISSING && !values.includes(String(actual));
        case "Exists":
          return actual !== MISSING;
        case "DoesNotExist":
          return actual === MISSING;
        default:
          return false;
      }
    });
  }

  function generatorType(generator) {
    return GENERATOR_KEYS.find((key) => Object.hasOwn(generator || {}, key)) || "unknown";
  }

  function normalizeCluster(cluster) {
    const name = cluster.name || cluster.cluster || "";
    const labels = clone(cluster.labels || cluster.metadata?.labels || {});
    const annotations = clone(cluster.annotations || cluster.metadata?.annotations || {});
    return {
      name,
      nameNormalized: normalizeName(name),
      server: cluster.server || cluster.url || "",
      project: cluster.project || "",
      metadata: { labels, annotations },
      values: clone(cluster.values || {}),
    };
  }

  function renderGeneratorValues(values, parameters, generatorPath) {
    if (!isObject(values)) return {};
    const context = { missing: new Set(), unsupported: new Set(), errors: [] };
    const rendered = renderValue(values, parameters, context);
    context.missing.forEach((expression) => {
      addDiagnosticOnce(
        "warning",
        "Generator value is missing",
        `The expression ${expression} could not be resolved while evaluating ${generatorPath}.`,
        { code: `generator-value-${generatorPath}-${expression}`, generator: generatorPath },
      );
    });
    return rendered;
  }

  function normalizeRows(rows, generator, path, type) {
    return rows
      .filter((row) => matchesSelector(row.params, generator.selector))
      .map((row) => ({
        ...row,
        trace: [`${path} ${type}`].concat(row.trace || []),
        template: generator.template ? deepMerge(row.template || {}, generator.template) : row.template,
      }));
  }

  function listRows(config, path) {
    let elements = config.elements;
    if (!elements && typeof config.elementsYaml === "string") {
      try {
        elements = window.jsyaml.load(config.elementsYaml);
      } catch (error) {
        addDiagnostic("error", "List elementsYaml is invalid", error.reason || error.message, { generator: path });
        return [];
      }
    }
    if (!Array.isArray(elements)) {
      addDiagnostic("error", "List generator has no elements", `${path} must define elements or elementsYaml as an array.`, { generator: path });
      return [];
    }
    return elements.map((element, index) => ({
      params: isObject(element) ? clone(element) : { value: element },
      trace: [`element ${index + 1}`],
      template: null,
    }));
  }

  function clusterRows(config, data, path) {
    state.fidelity.mocked = true;
    const clusters = Array.isArray(data.clusters) ? data.clusters : [];
    if (clusters.length === 0) {
      addDiagnostic("warning", "Cluster inventory is empty", `${path} requires local clusters in Generator data.`, { generator: path });
      return [];
    }
    return clusters
      .map(normalizeCluster)
      .filter((cluster) => matchesSelector(cluster, config.selector))
      .map((cluster) => ({
        params: {
          ...cluster,
          values: {
            ...cluster.values,
            ...renderGeneratorValues(config.values || {}, cluster, path),
          },
        },
        trace: [`mock cluster ${cluster.name || "unnamed"}`],
        template: null,
      }));
  }

  function matchingGitDirectories(config, data, path) {
    const entries = Array.isArray(data.gitDirectories) ? data.gitDirectories : [];
    const rules = Array.isArray(config.directories) ? config.directories : [];
    const normalized = entries.map((entry) => typeof entry === "string" ? { path: entry } : entry);
    const included = normalized.filter((entry) => {
      if (entry.repoURL && entry.repoURL !== config.repoURL) return false;
      if (entry.revision && config.revision && entry.revision !== config.revision) return false;
      const positive = rules.some((rule) => !rule.exclude && matchesGlob(entry.path, rule.path, true));
      const excluded = rules.some((rule) => rule.exclude && matchesGlob(entry.path, rule.path, true));
      return positive && !excluded;
    });
    const seen = new Set();
    return included.filter((entry) => {
      if (seen.has(entry.path)) return false;
      seen.add(entry.path);
      return true;
    }).map((entry) => {
      const params = {
        path: pathParameters(entry.path),
        values: clone(entry.values || {}),
      };
      params.values = {
        ...params.values,
        ...renderGeneratorValues(config.values || {}, params, path),
      };
      return { params, trace: [`mock directory ${entry.path}`], template: null };
    });
  }

  function matchingGitFiles(config, data, path) {
    const entries = Array.isArray(data.gitFiles) ? data.gitFiles : [];
    const rules = Array.isArray(config.files) ? config.files : [];
    return entries
      .filter((entry) => {
        if (!isObject(entry) || !entry.path) return false;
        if (entry.repoURL && entry.repoURL !== config.repoURL) return false;
        if (entry.revision && config.revision && entry.revision !== config.revision) return false;
        return rules.some((rule) => matchesGlob(entry.path, rule.path, true));
      })
      .map((entry) => {
        const supplied = isObject(entry.data) ? clone(entry.data) : {};
        const params = deepMerge(supplied, {
          path: pathParameters(entry.path),
          values: clone(entry.values || {}),
        });
        params.values = {
          ...(params.values || {}),
          ...renderGeneratorValues(config.values || {}, params, path),
        };
        return { params, trace: [`mock file ${entry.path}`], template: null };
      });
  }

  function gitRows(config, data, path) {
    state.fidelity.mocked = true;
    const rows = [];
    if (config.directories) rows.push(...matchingGitDirectories(config, data, path));
    if (config.files) rows.push(...matchingGitFiles(config, data, path));
    if (!config.directories && !config.files) {
      addDiagnostic("error", "Git generator has no files or directories", `${path} does not define a supported Git input.`, { generator: path });
    } else if (rows.length === 0) {
      addDiagnostic("warning", "Git generator produced no parameters", `No local Git paths matched ${path}. Add gitDirectories or gitFiles to Generator data.`, { generator: path });
    }
    return rows;
  }

  function mergeMatrixParameters(left, right, path) {
    const result = clone(left);
    Object.entries(right).forEach(([key, value]) => {
      if (Object.hasOwn(result, key) && stableStringify(result[key]) !== stableStringify(value)) {
        addDiagnosticOnce(
          "error",
          "Matrix parameter collision",
          `${path} produced conflicting values for ${key}. The preview shows the later value, but the controller may reject this combination.`,
          { code: `matrix-collision-${path}-${key}`, generator: path },
        );
      }
      result[key] = clone(value);
    });
    return result;
  }

  function matrixRows(config, data, path) {
    state.fidelity.approximated = true;
    const generators = Array.isArray(config.generators) ? config.generators : [];
    if (generators.length < 2) {
      addDiagnostic("error", "Matrix generator needs child generators", `${path} must combine at least two generators.`, { generator: path });
      return [];
    }
    let combinations = [{ params: {}, trace: [], template: null }];
    generators.forEach((child, index) => {
      const childRows = generateRows(child, data, `${path}.${index + 1}`);
      const next = [];
      combinations.forEach((left) => {
        childRows.forEach((right) => {
          next.push({
            params: mergeMatrixParameters(left.params, right.params, path),
            trace: left.trace.concat(right.trace),
            template: deepMerge(left.template || {}, right.template || {}),
          });
        });
      });
      combinations = next;
    });
    return combinations;
  }

  function mergeKey(parameters, keys) {
    const values = keys.map((key) => getPath(parameters, key));
    if (values.some((value) => value === MISSING)) return null;
    return stableStringify(values);
  }

  function mergeRows(config, data, path) {
    state.fidelity.approximated = true;
    const generators = Array.isArray(config.generators) ? config.generators : [];
    const keys = Array.isArray(config.mergeKeys) ? config.mergeKeys : [];
    if (generators.length < 2 || keys.length === 0) {
      addDiagnostic("error", "Merge generator is incomplete", `${path} requires at least two generators and one merge key.`, { generator: path });
      return [];
    }
    const baseRows = generateRows(generators[0], data, `${path}.1`);
    const result = baseRows.map((row) => clone(row));
    generators.slice(1).forEach((child, childIndex) => {
      const overrides = generateRows(child, data, `${path}.${childIndex + 2}`);
      const overrideMap = new Map();
      overrides.forEach((row) => {
        const key = mergeKey(row.params, keys);
        if (key !== null) overrideMap.set(key, row);
      });
      result.forEach((row) => {
        const key = mergeKey(row.params, keys);
        const override = key === null ? null : overrideMap.get(key);
        if (override) {
          row.params = deepMerge(row.params, override.params);
          row.trace = row.trace.concat(override.trace);
          row.template = deepMerge(row.template || {}, override.template || {});
        }
      });
    });
    return result;
  }

  function mockRows(type, data, path) {
    const mocks = data.generatorResults || {};
    const supplied = mocks[path] || mocks[type];
    if (!Array.isArray(supplied)) {
      addDiagnostic(
        "warning",
        `${type} generator needs mock results`,
        `This browser preview cannot call ${type}. Add generatorResults.${type} or generatorResults["${path}"] to Generator data.`,
        { generator: path },
      );
      state.fidelity.approximated = true;
      return [];
    }
    state.fidelity.mocked = true;
    return supplied.map((params, index) => ({
      params: isObject(params) ? clone(params) : { value: params },
      trace: [`mock ${type} result ${index + 1}`],
      template: null,
    }));
  }

  function generateRows(generator, data, path) {
    if (!isObject(generator)) {
      addDiagnostic("error", "Generator is not an object", `${path} cannot be evaluated.`, { generator: path });
      return [];
    }
    const type = generatorType(generator);
    let rows;
    switch (type) {
      case "list":
        rows = listRows(generator.list || {}, path);
        break;
      case "clusters":
        rows = clusterRows(generator.clusters || {}, data, path);
        break;
      case "git":
        rows = gitRows(generator.git || {}, data, path);
        break;
      case "matrix":
        rows = matrixRows(generator.matrix || {}, data, path);
        break;
      case "merge":
        rows = mergeRows(generator.merge || {}, data, path);
        break;
      case "unknown":
        addDiagnostic("error", "Unknown generator", `${path} does not contain a recognized generator type.`, { generator: path });
        return [];
      default:
        rows = mockRows(type, data, path);
    }
    return normalizeRows(rows, generator, path, type);
  }

  function renderApplication(applicationSet, row, index) {
    const template = deepMerge(applicationSet.spec?.template || {}, row.template || {});
    const context = { missing: new Set(), unsupported: new Set(), errors: [] };
    let rendered = renderValue(template, row.params, context);
    if (typeof applicationSet.spec?.templatePatch === "string") {
      const patchText = renderString(applicationSet.spec.templatePatch, row.params, context);
      if (patchText.trim()) {
        try {
          const parsedPatch = window.jsyaml.load(patchText);
          if (isObject(parsedPatch)) rendered = deepMerge(rendered, parsedPatch);
          else throw new Error("templatePatch did not render to an object");
        } catch (error) {
          addDiagnostic("error", "templatePatch could not be applied", error.reason || error.message, { generator: row.trace[0] });
        }
      }
      state.fidelity.approximated = true;
    }
    const name = rendered.metadata?.name || `unnamed-${index + 1}`;
    const missingIsError = (applicationSet.spec?.goTemplateOptions || []).includes("missingkey=error");
    context.missing.forEach((expression) => {
      addDiagnostic(
        missingIsError ? "error" : "warning",
        "Template value is missing",
        `${expression} could not be resolved while rendering ${name}.`,
        { code: `missing-${name}-${expression}`, application: name, generator: row.trace[0] },
      );
    });
    context.unsupported.forEach((expression) => {
      addDiagnosticOnce(
        "warning",
        "Template expression is approximated",
        `${expression} is outside the studio's supported template subset. Validate the result with the controller.`,
        { code: `unsupported-expression-${expression}` },
      );
    });
    context.errors.forEach((message) => {
      addDiagnostic("error", "Required template value is missing", message, { application: name, generator: row.trace[0] });
    });
    const application = {
      apiVersion: "argoproj.io/v1alpha1",
      kind: "Application",
      metadata: clone(rendered.metadata || {}),
      spec: clone(rendered.spec || {}),
    };
    return {
      name,
      application,
      params: clone(row.params),
      trace: row.trace,
      generator: row.trace[0] || "Generator",
    };
  }

  function dnsSubdomainIsValid(name) {
    return name.length <= 253 && /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(name);
  }

  function patternListAllows(value, patterns) {
    if (!Array.isArray(patterns) || patterns.length === 0) return false;
    const denied = patterns
      .filter((pattern) => String(pattern).startsWith("!"))
      .some((pattern) => matchesGlob(value, String(pattern).slice(1)));
    const allowed = patterns
      .filter((pattern) => !String(pattern).startsWith("!"))
      .some((pattern) => matchesGlob(value, pattern));
    return allowed && !denied;
  }

  function destinationAllowed(destination, project) {
    const destinations = project.spec?.destinations || [];
    return destinations.some((rule) => {
      const clusterMatches = rule.server
        ? matchesGlob(destination.server || "", rule.server)
        : matchesGlob(destination.name || "", rule.name || "");
      return clusterMatches && matchesGlob(destination.namespace || "", rule.namespace || "");
    });
  }

  function validateProject(item) {
    const application = item.application;
    const projectName = application.spec?.project || "default";
    const project = state.projects.get(projectName);
    if (!project) {
      if (state.projects.size > 0) {
        addDiagnostic(
          "warning",
          "AppProject was not supplied",
          `${item.name} references ${projectName}, but that project is not available for local guardrail checks.`,
          { code: `project-missing-${projectName}`, application: item.name },
        );
      }
      return;
    }
    const sources = Array.isArray(application.spec?.sources)
      ? application.spec.sources
      : application.spec?.source ? [application.spec.source] : [];
    sources.forEach((source) => {
      if (source.repoURL && !patternListAllows(source.repoURL, project.spec?.sourceRepos || [])) {
        addDiagnostic(
          "error",
          "Repository is outside the AppProject",
          `${source.repoURL} is not permitted by ${projectName}.spec.sourceRepos.`,
          { application: item.name, code: `repo-${item.name}-${source.repoURL}` },
        );
      }
    });
    const destination = application.spec?.destination || {};
    if (!destinationAllowed(destination, project)) {
      addDiagnostic(
        "error",
        "Destination is outside the AppProject",
        `${destination.name || destination.server || "The destination"}/${destination.namespace || ""} is not permitted by ${projectName}.`,
        { application: item.name, code: `destination-${item.name}` },
      );
    }
  }

  function validateApplication(item) {
    const application = item.application;
    const name = application.metadata?.name || "";
    if (!name) {
      addDiagnostic("error", "Application name is empty", "The template must render metadata.name.", { application: item.name });
    } else if (!dnsSubdomainIsValid(name)) {
      addDiagnostic(
        "error",
        "Application name is not a valid DNS subdomain",
        `${name} must contain lowercase letters, numbers, dots, or hyphens and be no longer than 253 characters.`,
        { application: item.name },
      );
    }
    if (stableStringify(application).includes("{{")) {
      addDiagnostic("error", "Application contains unresolved templates", "One or more template expressions remain in the rendered output.", { application: item.name });
    }
    const hasSource = isObject(application.spec?.source);
    const hasSources = Array.isArray(application.spec?.sources) && application.spec.sources.length > 0;
    if (!hasSource && !hasSources) {
      addDiagnostic("error", "Application source is missing", `${item.name} must define spec.source or spec.sources.`, { application: item.name });
    }
    if (hasSource && hasSources) {
      addDiagnostic("error", "Single and multiple sources are both configured", `${item.name} cannot define both spec.source and spec.sources.`, { application: item.name });
    }
    const destination = application.spec?.destination || {};
    if (!destination.server && !destination.name) {
      addDiagnostic("error", "Destination cluster is missing", `${item.name} must set destination.server or destination.name.`, { application: item.name });
    }
    if (!destination.namespace) {
      addDiagnostic("warning", "Destination namespace is empty", `${item.name} may only be able to deploy cluster-scoped resources.`, { application: item.name });
    }
    validateProject(item);
  }

  function validateApplicationSet(applicationSet) {
    const template = applicationSet.spec?.template;
    if (!isObject(template)) {
      addDiagnostic("error", "Application template is missing", "ApplicationSet spec.template must define the generated Application.", { code: "missing-template" });
      return;
    }
    const templateText = stableStringify(template);
    if (applicationSet.spec?.goTemplate !== true && /{{\s*\./.test(templateText)) {
      addDiagnostic(
        "error",
        "Go template syntax is not enabled",
        "The template uses dot-prefixed parameters, but spec.goTemplate is not true.",
        { code: "go-template-disabled" },
      );
    }
    if (typeof template.spec?.project === "string" && template.spec.project.includes("{{")) {
      addDiagnostic(
        "warning",
        "Project name is generated dynamically",
        "Only trusted administrators should be allowed to change generators that can select an AppProject.",
        { code: "dynamic-project" },
      );
    }
    if (!template.metadata?.name) {
      addDiagnostic("error", "Application template has no name", "spec.template.metadata.name is required for stable generated Applications.", { code: "template-name" });
    }
  }

  function addFleetDiagnostics() {
    const byName = new Map();
    const byTarget = new Map();
    state.applications.forEach((item) => {
      const names = byName.get(item.name) || [];
      names.push(item);
      byName.set(item.name, names);
      const spec = item.application.spec || {};
      const sources = spec.sources || (spec.source ? [spec.source] : []);
      const target = stableStringify({
        destination: spec.destination,
        sources: sources.map((source) => ({
          repoURL: source.repoURL,
          path: source.path,
          chart: source.chart,
          targetRevision: source.targetRevision,
        })),
      });
      const targets = byTarget.get(target) || [];
      targets.push(item.name);
      byTarget.set(target, targets);
    });
    byName.forEach((items, name) => {
      if (items.length > 1) {
        addDiagnostic("error", "Generated Application name collision", `${items.length} generator results render metadata.name as ${name}.`, { code: `duplicate-${name}`, application: name });
      }
    });
    byTarget.forEach((names) => {
      if (names.length > 1 && new Set(names).size > 1) {
        addDiagnostic("warning", "Multiple Applications share the same target", `${names.join(", ")} use the same source and destination combination.`, { code: `same-target-${stableStringify(names)}` });
      }
    });
    const automated = state.applications.filter((item) => item.application.spec?.syncPolicy?.automated?.enabled !== false && isObject(item.application.spec?.syncPolicy?.automated));
    const pruning = automated.filter((item) => item.application.spec.syncPolicy.automated.prune === true);
    const allowEmpty = automated.filter((item) => item.application.spec.syncPolicy.automated.allowEmpty === true);
    const forced = state.applications.filter((item) => (item.application.spec?.syncPolicy?.syncOptions || []).some((option) => /^(Force|Replace)=true$/i.test(option)));
    if (pruning.length) {
      addDiagnosticOnce("warning", "Automated pruning is enabled", `${pruning.length} Application${pruning.length === 1 ? "" : "s"} can remove live resources that disappear from the desired state.`, { code: "fleet-prune" });
    }
    if (allowEmpty.length) {
      addDiagnosticOnce("warning", "Empty applications may prune all resources", `${allowEmpty.length} Application${allowEmpty.length === 1 ? "" : "s"} combine automated sync with allowEmpty.`, { code: "fleet-allow-empty" });
    }
    if (forced.length) {
      addDiagnosticOnce("warning", "Destructive sync options are enabled", `${forced.length} Application${forced.length === 1 ? "" : "s"} use Force or Replace and may recreate resources.`, { code: "fleet-force-replace" });
    }
    if (state.applicationSet?.spec?.syncPolicy?.preserveResourcesOnDeletion !== true) {
      addDiagnosticOnce("warning", "Generated resources are not preserved on deletion", "Deleting the ApplicationSet may cascade through generated Applications and their managed resources.", { code: "preservation-policy" });
    }
  }

  function deduplicateDiagnostics() {
    const seen = new Set();
    state.diagnostics = state.diagnostics.filter((diagnostic) => {
      const key = stableStringify([
        diagnostic.severity,
        diagnostic.code,
        diagnostic.application,
        diagnostic.generator,
      ]);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function compareWithBaseline() {
    if (!state.baseline) {
      state.changes = null;
      return;
    }
    const previous = new Map(state.baseline.map((item) => [item.name, item]));
    const current = new Map(state.applications.map((item) => [item.name, item]));
    const added = [];
    const removed = [];
    const changed = [];
    current.forEach((item, name) => {
      if (!previous.has(name)) added.push(name);
      else if (stableStringify(item.application) !== stableStringify(previous.get(name).application)) {
        changed.push({ name, details: describeApplicationChange(previous.get(name).application, item.application) });
      }
    });
    previous.forEach((_item, name) => {
      if (!current.has(name)) removed.push(name);
    });
    state.changes = { added, removed, changed };
  }

  function describeApplicationChange(previous, current) {
    const changes = [];
    if (previous.spec?.project !== current.spec?.project) changes.push("project");
    if (stableStringify(previous.spec?.destination) !== stableStringify(current.spec?.destination)) changes.push("destination");
    if (stableStringify(previous.spec?.source) !== stableStringify(current.spec?.source) || stableStringify(previous.spec?.sources) !== stableStringify(current.spec?.sources)) changes.push("source");
    if (stableStringify(previous.spec?.syncPolicy) !== stableStringify(current.spec?.syncPolicy)) changes.push("sync policy");
    if (stableStringify(previous.metadata?.labels) !== stableStringify(current.metadata?.labels)) changes.push("labels");
    return changes.length ? changes : ["manifest"];
  }

  function analyze() {
    const status = byId("source-status");
    state.diagnostics = [];
    state.applications = [];
    state.projects = new Map();
    state.applicationSet = null;
    state.fidelity = { mocked: false, approximated: false, unsupportedExpressions: new Set() };
    try {
      const sourceDocuments = parseDocuments(byId("applicationset-source").value, "ApplicationSet input");
      assertSafeDocuments(sourceDocuments, "ApplicationSet input");
      const projectDocuments = parseDocuments(byId("project-source").value, "AppProject input", true);
      assertSafeDocuments(projectDocuments, "AppProject input");
      const applicationSets = sourceDocuments.filter((document) => document?.kind === "ApplicationSet");
      if (applicationSets.length === 0) throw new Error("No ApplicationSet resource was found.");
      if (applicationSets.length > 1) throw new Error("Provide one ApplicationSet at a time so the generated fleet is unambiguous.");
      state.applicationSet = clone(applicationSets[0]);
      if (state.applicationSet.apiVersion !== "argoproj.io/v1alpha1") {
        addDiagnostic("warning", "Unexpected ApplicationSet API version", `Found ${state.applicationSet.apiVersion || "no apiVersion"}; expected argoproj.io/v1alpha1.`);
      }
      [...sourceDocuments, ...projectDocuments]
        .filter((document) => document?.kind === "AppProject")
        .forEach((project) => {
          if (project.metadata?.name) state.projects.set(project.metadata.name, clone(project));
        });
      const generatorData = parseGeneratorData(byId("generator-data").value);
      validateApplicationSet(state.applicationSet);
      const generators = state.applicationSet.spec?.generators;
      if (!Array.isArray(generators) || generators.length === 0) {
        throw new Error("ApplicationSet spec.generators must contain at least one generator.");
      }
      const rows = generators.flatMap((generator, index) => generateRows(generator, generatorData, `G${index + 1}`));
      if (rows.length === 0) {
        addDiagnostic("warning", "No Applications were generated", "Review generator selectors and provide any required local simulation data.", { code: "empty-fleet" });
      }
      state.applications = rows.map((row, index) => renderApplication(state.applicationSet, row, index));
      state.applications.forEach(validateApplication);
      addFleetDiagnostics();
      deduplicateDiagnostics();
      compareWithBaseline();
      if (!state.selectedName || !state.applications.some((item) => item.name === state.selectedName)) {
        state.selectedName = state.applications[0]?.name || "";
      }
      const errorCount = state.diagnostics.filter((item) => item.severity === "error").length;
      status.className = `source-status ${errorCount ? "is-error" : "is-success"}`;
      status.textContent = `${state.applicationSet.metadata?.name || "ApplicationSet"} generated ${state.applications.length} Application${state.applications.length === 1 ? "" : "s"} with ${errorCount} error${errorCount === 1 ? "" : "s"}.`;
      renderAll();
    } catch (error) {
      status.className = "source-status is-error";
      status.textContent = error.message;
      addDiagnostic("error", "Preview could not be generated", error.message, { code: "preview-failed" });
      renderAll();
    }
  }

  function diagnosticSeverityForApplication(name) {
    const items = state.diagnostics.filter((diagnostic) => diagnostic.application === name);
    if (items.some((item) => item.severity === "error")) return "error";
    if (items.some((item) => item.severity === "warning")) return "warning";
    return "ok";
  }

  function applicationSearchText(item) {
    const spec = item.application.spec || {};
    const sources = spec.sources || (spec.source ? [spec.source] : []);
    return [
      item.name,
      spec.project,
      spec.destination?.name,
      spec.destination?.server,
      spec.destination?.namespace,
      ...sources.flatMap((source) => [source.repoURL, source.path, source.chart]),
      ...item.trace,
    ].filter(Boolean).join(" ").toLowerCase();
  }

  function renderApplicationList() {
    const container = byId("application-list");
    const query = byId("application-search").value.trim().toLowerCase();
    const applications = state.applications.filter((item) => applicationSearchText(item).includes(query));
    if (applications.length === 0) {
      container.className = "application-list empty-state";
      container.innerHTML = `<div><span class="empty-symbol" aria-hidden="true">◇</span><strong>${state.applications.length ? "No matching Applications" : "No Applications generated"}</strong><p>${state.applications.length ? "Try a different filter." : "Review generator data and diagnostics."}</p></div>`;
      byId("application-detail").classList.add("is-hidden");
      return;
    }
    container.className = "application-list";
    container.innerHTML = applications.map((item) => {
      const spec = item.application.spec || {};
      const destination = spec.destination || {};
      const severity = diagnosticSeverityForApplication(item.name);
      return `<button class="application-card${item.name === state.selectedName ? " is-selected" : ""}" type="button" data-application="${escapeHtml(item.name)}">
        <span>
          <strong>${escapeHtml(item.name)}</strong>
          <small>${escapeHtml(spec.project || "default")} · ${escapeHtml(destination.namespace || "cluster scoped")}</small>
        </span>
        <span class="status-dot${severity === "warning" ? " has-warning" : severity === "error" ? " has-error" : ""}" aria-label="${severity === "ok" ? "No application-specific issues" : `${severity} diagnostics`}"></span>
      </button>`;
    }).join("");
    renderApplicationDetail();
  }

  function flatParameterChips(parameters, prefix = "", depth = 0) {
    if (depth > 1 || !isObject(parameters)) return [];
    const chips = [];
    Object.entries(parameters).forEach(([key, value]) => {
      const label = prefix ? `${prefix}.${key}` : key;
      if (isObject(value) && depth < 1) chips.push(...flatParameterChips(value, label, depth + 1));
      else if (!Array.isArray(value) && !isObject(value)) chips.push(`${label}=${value}`);
    });
    return chips.slice(0, 18);
  }

  function renderApplicationDetail() {
    const detail = byId("application-detail");
    const selected = state.applications.find((item) => item.name === state.selectedName);
    if (!selected) {
      detail.classList.add("is-hidden");
      return;
    }
    detail.classList.remove("is-hidden");
    byId("detail-name").textContent = selected.name;
    byId("detail-generator").textContent = selected.generator;
    byId("application-yaml").textContent = yamlDump(selected.application);
    const chips = [...selected.trace, ...flatParameterChips(selected.params)];
    byId("parameter-trace").innerHTML = chips.map((chip) => `<span class="parameter-chip" title="${escapeHtml(chip)}">${escapeHtml(chip)}</span>`).join("");
  }

  function destinationKey(application) {
    const destination = application.spec?.destination || {};
    return destination.name || destination.server || "Unspecified destination";
  }

  function renderFleetMap() {
    const container = byId("fleet-map");
    if (state.applications.length === 0) {
      container.className = "fleet-map empty-state";
      container.innerHTML = `<div><span class="empty-symbol" aria-hidden="true">⌁</span><strong>No destinations to map</strong><p>Preview an ApplicationSet to see its fleet topology.</p></div>`;
      return;
    }
    const groups = new Map();
    state.applications.forEach((item) => {
      const key = destinationKey(item.application);
      const group = groups.get(key) || [];
      group.push(item);
      groups.set(key, group);
    });
    container.className = "fleet-map";
    container.innerHTML = [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([destination, items]) => {
      const namespaces = [...new Set(items.map((item) => item.application.spec?.destination?.namespace || "cluster scoped"))];
      return `<article class="destination-card">
        <header><h3 title="${escapeHtml(destination)}">${escapeHtml(destination)}</h3><span>${items.length}</span></header>
        <small>${escapeHtml(namespaces.join(", "))}</small>
        <div class="fleet-apps">${items.map((item) => `<span>${escapeHtml(item.name)}</span>`).join("")}</div>
      </article>`;
    }).join("");
  }

  function renderDiagnostics() {
    const container = byId("diagnostic-list");
    if (state.diagnostics.length === 0) {
      container.className = "diagnostic-list empty-state";
      container.innerHTML = `<div><span class="empty-symbol" aria-hidden="true">✓</span><strong>No issues detected</strong><p>The local preview passed its supported checks.</p></div>`;
      return;
    }
    const rank = { error: 0, warning: 1, info: 2 };
    const diagnostics = [...state.diagnostics].sort((left, right) => rank[left.severity] - rank[right.severity]);
    container.className = "diagnostic-list";
    container.innerHTML = diagnostics.map((diagnostic) => `<article class="diagnostic-card ${escapeHtml(diagnostic.severity)}">
      <span class="diagnostic-icon" aria-hidden="true">${diagnostic.severity === "error" ? "!" : diagnostic.severity === "warning" ? "△" : "i"}</span>
      <div>
        <strong>${escapeHtml(diagnostic.title)}</strong>
        <p>${escapeHtml(diagnostic.detail)}</p>
        ${diagnostic.application || diagnostic.generator ? `<span class="diagnostic-context">${escapeHtml([diagnostic.application, diagnostic.generator].filter(Boolean).join(" · "))}</span>` : ""}
      </div>
    </article>`).join("");
  }

  function renderChanges() {
    const container = byId("change-summary");
    if (!state.baseline || !state.changes) {
      container.className = "change-summary empty-state";
      container.innerHTML = `<div><span class="empty-symbol" aria-hidden="true">±</span><strong>No baseline saved</strong><p>Save a fleet baseline, then edit and preview again.</p></div>`;
      return;
    }
    const { added, removed, changed } = state.changes;
    container.className = "change-summary";
    const groups = [
      ["Added", added.map((name) => ({ name, className: "added" }))],
      ["Removed", removed.map((name) => ({ name, className: "removed" }))],
      ["Changed", changed.map((item) => ({ name: `${item.name} · ${item.details.join(", ")}`, className: "" }))],
    ];
    container.innerHTML = `<div class="change-counts">
      <div class="change-count"><span>Added</span><strong>${added.length}</strong></div>
      <div class="change-count"><span>Removed</span><strong>${removed.length}</strong></div>
      <div class="change-count"><span>Changed</span><strong>${changed.length}</strong></div>
    </div>${groups.map(([title, items]) => items.length ? `<section class="change-group"><h3>${title}</h3><div class="change-items">${items.map((item) => `<span class="change-item ${item.className}">${escapeHtml(item.name)}</span>`).join("")}</div></section>` : "").join("")}${!added.length && !removed.length && !changed.length ? `<div class="empty-state"><div><span class="empty-symbol" aria-hidden="true">✓</span><strong>No fleet changes</strong><p>The current preview matches the saved baseline.</p></div></div>` : ""}`;
  }

  function renderSummary() {
    const destinationCount = new Set(state.applications.map((item) => destinationKey(item.application))).size;
    const warningCount = state.diagnostics.filter((item) => item.severity === "warning").length;
    const errorCount = state.diagnostics.filter((item) => item.severity === "error").length;
    byId("application-count").textContent = String(state.applications.length);
    byId("destination-count").textContent = state.applications.length ? String(destinationCount) : "0";
    byId("warning-count").textContent = String(warningCount);
    byId("error-count").textContent = String(errorCount);
    byId("diagnostic-tab-count").textContent = String(state.diagnostics.length);
    byId("baseline-button").disabled = state.applications.length === 0;
    byId("export-button").disabled = !state.applicationSet;
    const badge = byId("fidelity-badge");
    badge.className = "fidelity-badge";
    if (!state.applicationSet) {
      badge.textContent = "Waiting";
    } else if (state.fidelity.mocked) {
      badge.textContent = state.fidelity.approximated ? "Mock + subset" : "Mock-assisted";
      badge.classList.add("is-mocked");
    } else if (state.fidelity.approximated) {
      badge.textContent = "Supported subset";
      badge.classList.add("is-mocked");
    } else {
      badge.textContent = "Local";
      badge.classList.add("is-local");
    }
  }

  function renderAll() {
    renderSummary();
    renderApplicationList();
    renderFleetMap();
    renderDiagnostics();
    renderChanges();
  }

  function setView(view) {
    document.querySelectorAll(".tab").forEach((tab) => {
      const selected = tab.dataset.view === view;
      tab.classList.toggle("is-active", selected);
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    document.querySelectorAll(".tab-view").forEach((panel) => {
      panel.classList.toggle("is-hidden", panel.id !== `${view}-view`);
    });
  }

  function showToast(message) {
    const toast = byId("toast");
    window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add("is-visible");
    toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 2600);
  }

  async function copyText(text, message) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (_error) {
      const helper = document.createElement("textarea");
      helper.value = text;
      helper.style.position = "fixed";
      helper.style.opacity = "0";
      document.body.append(helper);
      helper.select();
      document.execCommand("copy");
      helper.remove();
    }
    showToast(message);
  }

  function downloadText(text, filename, type = "text/plain") {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    showToast(`${filename} downloaded.`);
  }

  function baseFilename() {
    return normalizeName(state.applicationSet?.metadata?.name || "applicationset") || "applicationset";
  }

  function generatedYaml() {
    return state.applications.map((item) => yamlDump(item.application).trim()).join("\n---\n") + "\n";
  }

  function inventory() {
    return state.applications.map((item) => {
      const spec = item.application.spec || {};
      const sources = spec.sources || (spec.source ? [spec.source] : []);
      return {
        name: item.name,
        project: spec.project || "default",
        destination: clone(spec.destination || {}),
        sources: sources.map((source) => ({
          repoURL: source.repoURL || "",
          targetRevision: source.targetRevision || "",
          path: source.path || "",
          chart: source.chart || "",
        })),
        generator: item.generator,
      };
    });
  }

  function markdownReport() {
    const warnings = state.diagnostics.filter((item) => item.severity === "warning").length;
    const errors = state.diagnostics.filter((item) => item.severity === "error").length;
    const lines = [
      `# ApplicationSet review: ${state.applicationSet?.metadata?.name || "unnamed"}`,
      "",
      `- Generated Applications: ${state.applications.length}`,
      `- Destinations: ${new Set(state.applications.map((item) => destinationKey(item.application))).size}`,
      `- Errors: ${errors}`,
      `- Warnings: ${warnings}`,
      `- Preview fidelity: ${byId("fidelity-badge").textContent}`,
      "",
      "## Fleet inventory",
      "",
      "| Application | Project | Destination | Namespace | Generator |",
      "| --- | --- | --- | --- | --- |",
      ...state.applications.map((item) => {
        const spec = item.application.spec || {};
        return `| ${item.name} | ${spec.project || "default"} | ${destinationKey(item.application)} | ${spec.destination?.namespace || ""} | ${item.generator} |`;
      }),
      "",
      "## Diagnostics",
      "",
      ...(state.diagnostics.length ? state.diagnostics.map((item) => `- **${item.severity.toUpperCase()} — ${item.title}:** ${item.detail}${item.application ? ` (${item.application})` : ""}`) : ["No issues detected by the supported local checks."]),
      "",
      "## Change impact",
      "",
    ];
    if (state.changes) {
      lines.push(`- Added: ${state.changes.added.length ? state.changes.added.join(", ") : "none"}`);
      lines.push(`- Removed: ${state.changes.removed.length ? state.changes.removed.join(", ") : "none"}`);
      lines.push(`- Changed: ${state.changes.changed.length ? state.changes.changed.map((item) => item.name).join(", ") : "none"}`);
    } else {
      lines.push("No baseline was saved for this review.");
    }
    lines.push("", "> This report is a local simulation. Validate production configuration with the Argo CD ApplicationSet controller.", "");
    return lines.join("\n");
  }

  function openExportDialog() {
    state.lastDialogFocus = document.activeElement;
    byId("export-dialog").classList.remove("is-hidden");
    byId("close-export").focus();
  }

  function closeExportDialog() {
    byId("export-dialog").classList.add("is-hidden");
    if (state.lastDialogFocus) state.lastDialogFocus.focus();
  }

  function saveBaseline() {
    state.baseline = clone(state.applications);
    compareWithBaseline();
    renderChanges();
    byId("baseline-button").textContent = "Update baseline";
    showToast(`${state.baseline.length} Applications saved as the baseline.`);
  }

  function setInputView(view) {
    document.querySelectorAll(".source-tab").forEach((tab) => {
      const selected = tab.dataset.inputView === view;
      tab.classList.toggle("is-active", selected);
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    document.querySelectorAll(".source-tab-view").forEach((panel) => {
      panel.classList.toggle("is-hidden", panel.id !== `${view}-input-view`);
    });
  }

  function loadSample() {
    const example = EXAMPLES[byId("example-select").value] || EXAMPLES["regional-matrix"];
    byId("applicationset-source").value = example.source;
    byId("generator-data").value = example.data;
    byId("project-source").value = example.projects;
    byId("application-search").value = "";
    byId("source-format").textContent = "YAML";
    state.baseline = null;
    state.changes = null;
    byId("baseline-button").textContent = "Save baseline";
    setInputView("manifest");
    analyze();
    showToast(`${example.label} example generated.`);
  }

  function clearStudio() {
    byId("applicationset-source").value = "";
    byId("generator-data").value = "";
    byId("project-source").value = "";
    byId("application-search").value = "";
    state.applicationSet = null;
    state.applications = [];
    state.diagnostics = [];
    state.projects = new Map();
    state.selectedName = "";
    state.baseline = null;
    state.changes = null;
    state.fidelity = { mocked: false, approximated: false, unsupportedExpressions: new Set() };
    byId("baseline-button").textContent = "Save baseline";
    const status = byId("source-status");
    status.className = "source-status";
    status.textContent = "Choose an example or provide an ApplicationSet to begin.";
    renderAll();
    setInputView("manifest");
    byId("applicationset-source").focus();
  }

  async function loadFile(file) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      showToast("Choose a manifest smaller than 2 MB.");
      return;
    }
    const text = await file.text();
    byId("applicationset-source").value = text;
    byId("source-format").textContent = file.name.endsWith(".json") ? "JSON" : "YAML";
    setInputView("manifest");
    analyze();
  }

  function initializeEvents() {
    byId("preview-button").addEventListener("click", analyze);
    byId("sample-button").addEventListener("click", loadSample);
    byId("clear-button").addEventListener("click", clearStudio);
    byId("application-search").addEventListener("input", renderApplicationList);
    byId("baseline-button").addEventListener("click", saveBaseline);
    byId("export-button").addEventListener("click", openExportDialog);
    byId("close-export").addEventListener("click", closeExportDialog);
    byId("copy-application").addEventListener("click", () => {
      const selected = state.applications.find((item) => item.name === state.selectedName);
      if (selected) copyText(yamlDump(selected.application), `${selected.name} YAML copied.`);
    });
    byId("application-list").addEventListener("click", (event) => {
      const button = event.target.closest("[data-application]");
      if (!button) return;
      state.selectedName = button.dataset.application;
      renderApplicationList();
    });
    document.querySelectorAll(".tab").forEach((tab) => {
      tab.addEventListener("click", () => setView(tab.dataset.view));
      tab.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
        const tabs = [...document.querySelectorAll(".tab")];
        const current = tabs.indexOf(tab);
        const increment = event.key === "ArrowRight" ? 1 : -1;
        const next = tabs[(current + increment + tabs.length) % tabs.length];
        setView(next.dataset.view);
        next.focus();
      });
    });
    document.querySelectorAll(".source-tab").forEach((tab) => {
      tab.addEventListener("click", () => setInputView(tab.dataset.inputView));
      tab.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
        const tabs = [...document.querySelectorAll(".source-tab")];
        const current = tabs.indexOf(tab);
        const increment = event.key === "ArrowRight" ? 1 : -1;
        const next = tabs[(current + increment + tabs.length) % tabs.length];
        setInputView(next.dataset.inputView);
        next.focus();
      });
    });
    const fileInput = byId("applicationset-file");
    fileInput.addEventListener("change", () => loadFile(fileInput.files[0]));
    byId("export-dialog").addEventListener("click", (event) => {
      if (event.target === byId("export-dialog")) closeExportDialog();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !byId("export-dialog").classList.contains("is-hidden")) closeExportDialog();
    });
    byId("download-applicationset").addEventListener("click", () => downloadText(yamlDump(state.applicationSet), `${baseFilename()}.yaml`, "text/yaml"));
    byId("download-applications").addEventListener("click", () => downloadText(generatedYaml(), `${baseFilename()}-applications.yaml`, "text/yaml"));
    byId("download-inventory").addEventListener("click", () => downloadText(`${JSON.stringify(inventory(), null, 2)}\n`, `${baseFilename()}-inventory.json`, "application/json"));
    byId("download-report").addEventListener("click", () => downloadText(markdownReport(), `${baseFilename()}-review.md`, "text/markdown"));
  }

  function initialize() {
    if (!window.jsyaml) {
      byId("source-status").className = "source-status is-error";
      byId("source-status").textContent = "The local YAML parser could not be loaded.";
      byId("preview-button").disabled = true;
      return;
    }
    initializeEvents();
    loadSample();
  }

  initialize();
})();
