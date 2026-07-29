(() => {
  "use strict";

  // Native Cube Kubernetes Manifest Builder
  const form = document.querySelector("#generator-form");
  const output = document.querySelector("#manifest-output");
  const lineCount = document.querySelector("#line-count");
  const toast = document.querySelector("#toast");
  const sectionNames = ["basics", "container", "runtime", "advanced"];
  let activeSection = 0;
  let outputFormat = "yaml";
  let currentManifest = {};
  let currentText = "";
  let toastTimer;
  let previousName = "web-app";

  const byId = (id) => document.getElementById(id);
  const value = (id) => byId(id)?.value.trim() ?? "";
  const checked = (id) => Boolean(byId(id)?.checked);
  const numberValue = (id, fallback = undefined) => {
    const raw = value(id);
    if (raw === "") return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const splitList = (input) =>
    input
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

  function compact(valueToCompact) {
    if (Array.isArray(valueToCompact)) {
      return valueToCompact
        .map(compact)
        .filter((entry) => entry !== undefined && entry !== null);
    }

    if (valueToCompact && typeof valueToCompact === "object") {
      const result = {};
      Object.entries(valueToCompact).forEach(([key, entry]) => {
        const compacted = compact(entry);
        if (compacted === undefined || compacted === null || compacted === "") return;
        result[key] = compacted;
      });
      return result;
    }

    return valueToCompact;
  }

  function deepMerge(base, overlay) {
    if (Array.isArray(overlay)) return overlay.map((item) => compact(item));
    if (!overlay || typeof overlay !== "object") return overlay;

    const result =
      base && typeof base === "object" && !Array.isArray(base) ? { ...base } : {};

    Object.entries(overlay).forEach(([key, overlayValue]) => {
      if (
        overlayValue &&
        typeof overlayValue === "object" &&
        !Array.isArray(overlayValue)
      ) {
        result[key] = deepMerge(result[key], overlayValue);
      } else {
        result[key] = overlayValue;
      }
    });

    return result;
  }

  function rows(listName) {
    return [...document.querySelectorAll(`[data-list="${listName}"] .repeat-row`)].map(
      (row) => {
        const result = {};
        row.querySelectorAll("[data-field]").forEach((input) => {
          result[input.dataset.field] =
            input.type === "checkbox" ? input.checked : input.value.trim();
        });
        return result;
      },
    );
  }

  function keyValueObject(listName) {
    return rows(listName).reduce((result, row) => {
      if (row.key) result[row.key] = row.value;
      return result;
    }, {});
  }

  function resourceConstraintObject(field) {
    return rows("resourceLimits").reduce((result, row) => {
      if (row.key && row[field]) result[row.key] = row[field];
      return result;
    }, {});
  }

  function buildProbe(prefix) {
    if (!checked(`${prefix}Enabled`)) return undefined;

    const type = value(`${prefix}Type`);
    let handler;

    if (type === "httpGet") {
      handler = {
        httpGet: compact({
          path: value(`${prefix}Path`) || "/healthz",
          port: parseIntOrString(value(`${prefix}Port`) || "8080"),
          scheme: value(`${prefix}Scheme`) || "HTTP",
          httpHeaders: (() => {
            const headers = rows(`${prefix}Headers`)
              .filter((header) => header.name)
              .map((header) => ({ name: header.name, value: header.value }));
            return headers.length ? headers : undefined;
          })(),
        }),
      };
    } else if (type === "tcpSocket") {
      handler = {
        tcpSocket: { port: parseIntOrString(value(`${prefix}Port`) || "8080") },
      };
    } else if (type === "grpc") {
      handler = {
        grpc: compact({
          port: numberValue(`${prefix}Port`, 8080),
          service: value(`${prefix}GrpcService`),
        }),
      };
    } else {
      handler = {
        exec: {
          command: splitList(value(`${prefix}Command`) || "/bin/sh,-c,true"),
        },
      };
    }

    return compact({
      ...handler,
      initialDelaySeconds: numberValue(`${prefix}InitialDelay`, 0),
      periodSeconds: numberValue(`${prefix}Period`, 10),
      timeoutSeconds: numberValue(`${prefix}Timeout`, 1),
      successThreshold: numberValue(`${prefix}SuccessThreshold`, 1),
      failureThreshold: numberValue(`${prefix}FailureThreshold`, 3),
      terminationGracePeriodSeconds: numberValue(`${prefix}TerminationGrace`),
    });
  }

  function buildContainerSecurityContext() {
    const add = splitList(value("capabilitiesAdd"));
    const drop = splitList(value("capabilitiesDrop"));
    const context = compact({
      runAsUser: numberValue("containerRunAsUser"),
      runAsGroup: numberValue("containerRunAsGroup"),
      runAsNonRoot: checked("containerRunAsNonRoot") || undefined,
      privileged: checked("privileged") || undefined,
      allowPrivilegeEscalation: checked("allowPrivilegeEscalation") || undefined,
      readOnlyRootFilesystem: checked("readOnlyRootFilesystem") || undefined,
      capabilities:
        add.length || drop.length
          ? compact({
              add: add.length ? add : undefined,
              drop: drop.length ? drop : undefined,
            })
          : undefined,
    });

    return Object.keys(context).length ? context : undefined;
  }

  function buildPodSecurityContext() {
    const seccompType = value("podSeccompType");
    const context = compact({
      runAsUser: numberValue("podRunAsUser"),
      runAsGroup: numberValue("podRunAsGroup"),
      runAsNonRoot: checked("podRunAsNonRoot") || undefined,
      fsGroup: numberValue("fsGroup"),
      fsGroupChangePolicy: value("fsGroupChangePolicy"),
      supplementalGroups: (() => {
        const groups = splitList(value("supplementalGroups"))
          .map(Number)
          .filter(Number.isFinite);
        return groups.length ? groups : undefined;
      })(),
      seccompProfile: seccompType
        ? compact({
            type: seccompType,
            localhostProfile:
              seccompType === "Localhost" ? "profiles/default.json" : undefined,
          })
        : undefined,
    });

    return Object.keys(context).length ? context : undefined;
  }

  function buildEnvironment() {
    return rows("env")
      .filter((item) => item.name)
      .map((item) => {
        if (item.source === "value") {
          return { name: item.name, value: item.value };
        }
        return {
          name: item.name,
          valueFrom: {
            [item.source]: {
              name: item.value,
              key: item.key,
            },
          },
        };
      });
  }

  function buildEnvFrom() {
    return rows("envFrom")
      .filter((item) => item.name)
      .map((item) =>
        compact({
          prefix: item.prefix,
          [item.source]: {
            name: item.name,
            optional: item.optional || undefined,
          },
        }),
      );
  }

  function buildPorts() {
    return rows("ports")
      .filter((port) => port.containerPort)
      .map((port) =>
        compact({
          name: port.name,
          containerPort: Number(port.containerPort),
          protocol: port.protocol || "TCP",
          hostPort: port.hostPort ? Number(port.hostPort) : undefined,
        }),
      );
  }

  function buildVolumes() {
    const volumes = [];
    const mounts = [];

    rows("volumes")
      .filter((item) => item.name)
      .forEach((item) => {
        let source;
        if (item.type === "emptyDir") source = { emptyDir: {} };
        if (item.type === "configMap") source = { configMap: { name: item.source } };
        if (item.type === "secret") source = { secret: { secretName: item.source } };
        if (item.type === "persistentVolumeClaim") {
          source = {
            persistentVolumeClaim: {
              claimName: item.source,
              readOnly: item.readOnly || undefined,
            },
          };
        }
        if (item.type === "hostPath") {
          source = { hostPath: { path: item.source, type: "DirectoryOrCreate" } };
        }

        volumes.push({ name: item.name, ...source });
        if (item.mountPath) {
          mounts.push(
            compact({
              name: item.name,
              mountPath: item.mountPath,
              subPath: item.subPath,
              readOnly: item.readOnly || undefined,
            }),
          );
        }
      });

    return { volumes, mounts };
  }

  function buildTolerations() {
    return rows("tolerations")
      .filter((item) => item.key || item.operator === "Exists")
      .map((item) =>
        compact({
          key: item.key,
          operator: item.operator || "Equal",
          value: item.operator === "Exists" ? undefined : item.value,
          effect: item.effect,
          tolerationSeconds:
            item.effect === "NoExecute" && item.tolerationSeconds
              ? Number(item.tolerationSeconds)
              : undefined,
        }),
      );
  }

  function buildLifecycle() {
    const postStart = splitList(value("postStartCommand"));
    const preStop = splitList(value("preStopCommand"));
    const lifecycle = compact({
      postStart: postStart.length ? { exec: { command: postStart } } : undefined,
      preStop: preStop.length ? { exec: { command: preStop } } : undefined,
    });
    return Object.keys(lifecycle).length ? lifecycle : undefined;
  }

  function buildDaemonSetSpec(
    sharedSpec,
    strategyType,
    maxUnavailable,
    maxSurge,
  ) {
    return compact({
      ...sharedSpec,
      replicas: undefined,
      updateStrategy: {
        type: strategyType,
        rollingUpdate:
          strategyType === "RollingUpdate"
            ? {
                maxUnavailable: parseIntOrString(maxUnavailable || "1"),
                maxSurge: parseIntOrString(maxSurge || "0"),
              }
            : undefined,
      },
    });
  }

  function validateDaemonRollingUpdate(
    strategyType,
    maxUnavailable,
    maxSurge,
  ) {
    if (strategyType !== "RollingUpdate") return "";

    const validIntOrPercent = /^(?:0|[1-9]\d*)%?$/;
    const values = [maxUnavailable, maxSurge];
    if (values.some((entry) => entry && !validIntOrPercent.test(entry))) {
      return "Use non-negative whole numbers or percentages for DaemonSet rollout limits.";
    }

    const isZero = (entry) => /^0%?$/.test(entry);
    if (isZero(maxUnavailable || "1") && isZero(maxSurge || "0")) {
      return "Max unavailable and max surge cannot both be zero.";
    }

    return "";
  }

  function buildManifest() {
    const kind = form.elements.kind.value;
    const labels = keyValueObject("labels");
    const annotations = keyValueObject("annotations");
    const { volumes, mounts } = buildVolumes();

    if (kind === "StatefulSet" && checked("pvcEnabled") && value("pvcMountPath")) {
      mounts.unshift({
        name: value("pvcName") || "data",
        mountPath: value("pvcMountPath"),
      });
    }

    const requests = compact({
      ...resourceConstraintObject("request"),
      cpu: value("requestCpu"),
      memory: value("requestMemory"),
    });
    const limits = compact({
      ...resourceConstraintObject("limit"),
      cpu: value("limitCpu"),
      memory: value("limitMemory"),
    });
    const resources = compact({
      requests: Object.keys(requests).length ? requests : undefined,
      limits: Object.keys(limits).length ? limits : undefined,
    });

    const ports = buildPorts();
    const environment = buildEnvironment();
    const envFrom = buildEnvFrom();
    const command = splitList(value("command"));
    const args = splitList(value("args"));

    const container = compact({
      name: value("containerName") || "app",
      image: value("image"),
      imagePullPolicy: value("imagePullPolicy"),
      command: command.length ? command : undefined,
      args: args.length ? args : undefined,
      workingDir: value("workingDir"),
      ports: ports.length ? ports : undefined,
      env: environment.length ? environment : undefined,
      envFrom: envFrom.length ? envFrom : undefined,
      resources: Object.keys(resources).length ? resources : undefined,
      volumeMounts: mounts.length ? mounts : undefined,
      livenessProbe: buildProbe("liveness"),
      readinessProbe: buildProbe("readiness"),
      startupProbe: buildProbe("startup"),
      lifecycle: buildLifecycle(),
      securityContext: buildContainerSecurityContext(),
      terminationMessagePolicy: value("terminationMessagePolicy"),
    });

    const imagePullSecrets = splitList(value("imagePullSecrets")).map((name) => ({
      name,
    }));
    const tolerations = buildTolerations();

    const podSpec = compact({
      serviceAccountName: value("serviceAccountName"),
      automountServiceAccountToken: checked("automountToken") ? undefined : false,
      restartPolicy: "Always",
      terminationGracePeriodSeconds: numberValue("terminationGracePeriodSeconds", 30),
      dnsPolicy: value("dnsPolicy"),
      schedulerName: value("schedulerName"),
      hostname: value("hostname"),
      subdomain: value("subdomain"),
      hostNetwork: checked("hostNetwork") || undefined,
      hostPID: checked("hostPID") || undefined,
      hostIPC: checked("hostIPC") || undefined,
      shareProcessNamespace: checked("shareProcessNamespace") || undefined,
      enableServiceLinks: checked("enableServiceLinks") ? undefined : false,
      priorityClassName: value("priorityClassName"),
      runtimeClassName: value("runtimeClassName"),
      imagePullSecrets: imagePullSecrets.length ? imagePullSecrets : undefined,
      securityContext: buildPodSecurityContext(),
      nodeSelector:
        value("nodeSelectorKey") && value("nodeSelectorValue")
          ? { [value("nodeSelectorKey")]: value("nodeSelectorValue") }
          : undefined,
      tolerations: tolerations.length ? tolerations : undefined,
      topologySpreadConstraints:
        checked("topologyEnabled") && value("topologyKey")
          ? [
              {
                maxSkew: numberValue("maxSkew", 1),
                topologyKey: value("topologyKey"),
                whenUnsatisfiable: "ScheduleAnyway",
                labelSelector: { matchLabels: labels },
              },
            ]
          : undefined,
      containers: [container],
      volumes: volumes.length ? volumes : undefined,
    });

    const sharedSpec = {
      replicas: kind === "DaemonSet" ? undefined : numberValue("replicas", 1),
      selector: { matchLabels: labels },
      template: {
        metadata: compact({
          labels,
          annotations: Object.keys(annotations).length ? annotations : undefined,
        }),
        spec: podSpec,
      },
      minReadySeconds: numberValue("minReadySeconds", 0),
      revisionHistoryLimit: numberValue("revisionHistoryLimit", 10),
    };

    let workloadSpec;
    if (kind === "Deployment") {
      const strategyType = value("deploymentStrategy");
      workloadSpec = compact({
        ...sharedSpec,
        strategy: {
          type: strategyType,
          rollingUpdate:
            strategyType === "RollingUpdate"
              ? {
                  maxUnavailable: parseIntOrString(value("maxUnavailable") || "25%"),
                  maxSurge: parseIntOrString(value("maxSurge") || "25%"),
                }
              : undefined,
        },
        progressDeadlineSeconds: numberValue("progressDeadlineSeconds", 600),
        paused: checked("paused") || undefined,
      });
    } else if (kind === "StatefulSet") {
      const statefulStrategy = value("statefulStrategy");
      workloadSpec = compact({
        ...sharedSpec,
        serviceName: value("serviceName") || value("name"),
        podManagementPolicy: value("podManagementPolicy"),
        updateStrategy: {
          type: statefulStrategy,
          rollingUpdate:
            statefulStrategy === "RollingUpdate" && value("partition") !== ""
              ? { partition: numberValue("partition", 0) }
              : undefined,
        },
        ordinals: { start: numberValue("ordinalStart", 0) },
        persistentVolumeClaimRetentionPolicy: {
          whenDeleted: value("pvcWhenDeleted"),
          whenScaled: value("pvcWhenScaled"),
        },
        volumeClaimTemplates: checked("pvcEnabled")
          ? [
              {
                metadata: { name: value("pvcName") || "data" },
                spec: compact({
                  accessModes: [value("pvcAccessMode")],
                  volumeMode: value("pvcVolumeMode"),
                  storageClassName: value("pvcStorageClass"),
                  resources: {
                    requests: { storage: value("pvcStorage") || "10Gi" },
                  },
                }),
              },
            ]
          : undefined,
      });
    } else {
      workloadSpec = buildDaemonSetSpec(
        sharedSpec,
        value("daemonStrategy"),
        value("daemonMaxUnavailable"),
        value("daemonMaxSurge"),
      );
    }

    let manifest = compact({
      apiVersion: "apps/v1",
      kind,
      metadata: compact({
        name: value("name"),
        namespace: value("namespace"),
        labels,
        annotations: Object.keys(annotations).length ? annotations : undefined,
      }),
      spec: workloadSpec,
    });

    const custom = value("customFields");
    if (custom) {
      try {
        const parsed = JSON.parse(custom);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("Enter a JSON object.");
        }
        manifest = compact(deepMerge(manifest, parsed));
      } catch {
        // Validation shows the actionable parsing error; keep the base preview usable.
      }
    }

    return manifest;
  }

  function parseIntOrString(raw) {
    return /^-?\d+$/.test(raw) ? Number(raw) : raw;
  }

  function yamlScalar(input) {
    if (input === null) return "null";
    if (typeof input === "boolean" || typeof input === "number") return String(input);

    const string = String(input);
    const reserved =
      /^(?:null|~|true|false|yes|no|on|off|[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?|\.nan|\.inf|-\.inf)$/i;
    const unsafe =
      string === "" ||
      reserved.test(string) ||
      /^[!&*{}\[\],#|>@`"'%?:\-]/.test(string) ||
      /[:#]\s|\s#|\n|\r|\t|\s$|^\s/.test(string);

    return unsafe ? JSON.stringify(string) : string;
  }

  function toYaml(input, indent = 0) {
    const pad = " ".repeat(indent);

    if (Array.isArray(input)) {
      if (!input.length) return `${pad}[]`;
      return input
        .map((item) => {
          if (item && typeof item === "object") {
            if (Array.isArray(item)) {
              return `${pad}-\n${toYaml(item, indent + 2)}`;
            }
            const entries = Object.entries(item);
            if (!entries.length) return `${pad}- {}`;
            const [firstKey, firstValue] = entries[0];
            const first =
              firstValue && typeof firstValue === "object"
                ? `${pad}- ${yamlScalar(firstKey)}:\n${toYaml(firstValue, indent + 4)}`
                : `${pad}- ${yamlScalar(firstKey)}: ${yamlScalar(firstValue)}`;
            const rest = entries.slice(1).map(([key, entry]) => {
              if (entry && typeof entry === "object") {
                return `${" ".repeat(indent + 2)}${yamlScalar(key)}:\n${toYaml(entry, indent + 4)}`;
              }
              return `${" ".repeat(indent + 2)}${yamlScalar(key)}: ${yamlScalar(entry)}`;
            });
            return [first, ...rest].join("\n");
          }
          return `${pad}- ${yamlScalar(item)}`;
        })
        .join("\n");
    }

    if (input && typeof input === "object") {
      const entries = Object.entries(input);
      if (!entries.length) return `${pad}{}`;
      return entries
        .map(([key, entry]) => {
          if (entry && typeof entry === "object") {
            return `${pad}${yamlScalar(key)}:\n${toYaml(entry, indent + 2)}`;
          }
          return `${pad}${yamlScalar(key)}: ${yamlScalar(entry)}`;
        })
        .join("\n");
    }

    return `${pad}${yamlScalar(input)}`;
  }

  function validate() {
    const dnsSubdomain = /^[a-z0-9](?:[-a-z0-9.]*[a-z0-9])?$/;
    const dnsLabel = /^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/;
    const labelPart = /^[A-Za-z0-9](?:[-A-Za-z0-9_.]*[A-Za-z0-9])?$/;
    const labelValue = /^$|^(?:[A-Za-z0-9](?:[-A-Za-z0-9_.]*[A-Za-z0-9])?)$/;
    const labelRows = rows("labels").filter((label) => label.key || label.value);
    const labelKeys = labelRows.map((label) => label.key);
    const validLabelKey = (key) => {
      const parts = key.split("/");
      if (parts.length > 2) return false;
      const name = parts.pop();
      const prefix = parts[0];
      return (
        Boolean(name) &&
        name.length <= 63 &&
        labelPart.test(name) &&
        (!prefix ||
          (prefix.length <= 253 &&
            dnsSubdomain.test(prefix) &&
            prefix === prefix.toLowerCase()))
      );
    };

    let labelsError = "";
    if (!labelRows.length) {
      labelsError = "At least one label is required.";
    } else if (labelRows.some((label) => !validLabelKey(label.key))) {
      labelsError = "Every label needs a valid Kubernetes label key.";
    } else if (
      labelRows.some(
        (label) => label.value.length > 63 || !labelValue.test(label.value),
      )
    ) {
      labelsError = "Use valid Kubernetes label values (maximum 63 characters).";
    } else if (new Set(labelKeys).size !== labelKeys.length) {
      labelsError = "Label keys must be unique.";
    }

    const resourceLimitRows = rows("resourceLimits").filter(
      (resource) => resource.key || resource.request || resource.limit,
    );
    const resourceLimitKeys = resourceLimitRows.map((resource) => resource.key);
    let resourceLimitsError = "";
    if (resourceLimitRows.some((resource) => !resource.key)) {
      resourceLimitsError = "Every additional resource needs a key.";
    } else if (
      resourceLimitRows.some((resource) => !resource.request && !resource.limit)
    ) {
      resourceLimitsError = "Add a request, a limit, or both.";
    } else if (
      resourceLimitRows.some((resource) =>
        ["cpu", "memory"].includes(resource.key),
      )
    ) {
      resourceLimitsError = "Use the CPU and memory fields above.";
    } else if (
      resourceLimitRows.some((resource) => !validLabelKey(resource.key))
    ) {
      resourceLimitsError = "Enter a valid Kubernetes resource name.";
    } else if (new Set(resourceLimitKeys).size !== resourceLimitKeys.length) {
      resourceLimitsError = "Additional resource keys must be unique.";
    }

    const daemonRollingUpdateError =
      form.elements.kind.value === "DaemonSet"
        ? validateDaemonRollingUpdate(
            value("daemonStrategy"),
            value("daemonMaxUnavailable"),
            value("daemonMaxSurge"),
          )
        : "";

    const errors = {
      name:
        !value("name")
          ? "A resource name is required."
          : value("name").length > 253 || !dnsSubdomain.test(value("name"))
            ? "Use lowercase letters, numbers, dots, and hyphens."
            : "",
      namespace:
        value("namespace") &&
        (value("namespace").length > 63 || !dnsLabel.test(value("namespace")))
          ? "Enter a valid DNS label."
          : "",
      labels: labelsError,
      resourceLimits: resourceLimitsError,
      daemonRollingUpdate: daemonRollingUpdateError,
      image: value("image") ? "" : "A container image is required.",
      customFields: "",
    };

    if (value("customFields")) {
      try {
        const parsed = JSON.parse(value("customFields"));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          errors.customFields = "Enter a JSON object at the resource root.";
        }
      } catch (error) {
        errors.customFields = `Invalid JSON: ${error.message}`;
      }
    }

    Object.entries(errors).forEach(([id, message]) => {
      const target = byId(id);
      const error = document.querySelector(`[data-error-for="${id}"]`);
      if (target) target.setAttribute("aria-invalid", message ? "true" : "false");
      if (error) error.textContent = message;
    });

    return !Object.values(errors).some(Boolean);
  }

  function render() {
    const valid = validate();
    const validationStatus = byId("validation-status");
    validationStatus.classList.toggle("has-error", !valid);
    validationStatus.lastChild.textContent = valid ? " Ready" : " Needs attention";
    currentManifest = buildManifest();
    currentText =
      outputFormat === "json"
        ? JSON.stringify(currentManifest, null, 2)
        : `${toYaml(currentManifest)}\n`;
    output.value = currentText;

    const count = currentText.trimEnd().split("\n").length;
    lineCount.textContent = `${count} ${count === 1 ? "line" : "lines"}`;
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add("is-visible");
    toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 2200);
  }

  function addRow(type, initial = {}) {
    const templateMap = {
      labels: ["key-value-template", "labels-list"],
      annotations: ["key-value-template", "annotations-list"],
      resourceLimits: ["resource-limit-template", "resource-limits-list"],
      ports: ["port-template", "ports-list"],
      env: ["env-template", "env-list"],
      envFrom: ["envfrom-template", "envfrom-list"],
      volumes: ["volume-template", "volumes-list"],
      tolerations: ["toleration-template", "tolerations-list"],
    };
    const config = templateMap[type];
    if (!config) return;

    const fragment = byId(config[0]).content.cloneNode(true);
    const row = fragment.querySelector(".repeat-row");
    row.dataset.rowType = type;
    Object.entries(initial).forEach(([field, initialValue]) => {
      const input = row.querySelector(`[data-field="${field}"]`);
      if (!input) return;
      if (input.type === "checkbox") input.checked = Boolean(initialValue);
      else input.value = initialValue;
    });
    byId(config[1]).appendChild(fragment);
    updateDynamicRow(row);
    render();
  }

  function updateDynamicRow(row) {
    if (row.classList.contains("env-row")) {
      const source = row.querySelector('[data-field="source"]').value;
      const valueField = row.querySelector(".env-source-name");
      const keyField = row.querySelector(".env-source-key");
      valueField.querySelector("span").textContent =
        source === "value" ? "Value" : source === "secretKeyRef" ? "Secret name" : "ConfigMap name";
      valueField.querySelector("input").placeholder =
        source === "value" ? "info" : source === "secretKeyRef" ? "app-secrets" : "app-config";
      keyField.hidden = source === "value";
      row.classList.toggle("has-key-source", source !== "value");
    }

    if (row.classList.contains("volume-row")) {
      const type = row.querySelector('[data-field="type"]').value;
      const sourceField = row.querySelector(".volume-source");
      const sourceInput = sourceField.querySelector("input");
      sourceField.hidden = type === "emptyDir";
      const placeholders = {
        configMap: "ConfigMap name",
        secret: "Secret name",
        persistentVolumeClaim: "Claim name",
        hostPath: "/var/lib/app",
      };
      sourceInput.placeholder = placeholders[type] || "Source";
    }

    if (row.classList.contains("toleration-row")) {
      const operator = row.querySelector('[data-field="operator"]').value;
      const valueInput = row.querySelector('[data-field="value"]');
      valueInput.disabled = operator === "Exists";
      if (operator === "Exists") valueInput.value = "";
    }
  }

  function renderProbe(prefix, defaults) {
    const container = document.querySelector(`[data-probe="${prefix}"]`);
    container.innerHTML = `
      <div class="field-grid">
        <label class="field">
          <span>Probe type</span>
          <select id="${prefix}Type">
            <option value="httpGet">HTTP request</option>
            <option value="tcpSocket">TCP socket</option>
            <option value="exec">Exec command</option>
            <option value="grpc">gRPC</option>
          </select>
        </label>
        <label class="field probe-path">
          <span>Path</span>
          <input id="${prefix}Path" value="/healthz" />
        </label>
        <label class="field probe-port">
          <span>Port</span>
          <input id="${prefix}Port" value="8080" />
        </label>
        <label class="field probe-scheme">
          <span>Scheme</span>
          <select id="${prefix}Scheme"><option>HTTP</option><option>HTTPS</option></select>
        </label>
        <label class="field field-wide probe-command" hidden>
          <span>Command</span>
          <input id="${prefix}Command" value="/bin/sh, -c, true" />
        </label>
        <label class="field field-wide probe-grpc-service" hidden>
          <span>gRPC service</span>
          <input id="${prefix}GrpcService" placeholder="Optional" />
        </label>
        <label class="field">
          <span>Initial delay</span>
          <input id="${prefix}InitialDelay" type="number" min="0" value="${defaults.initialDelay}" />
        </label>
        <label class="field">
          <span>Period</span>
          <input id="${prefix}Period" type="number" min="1" value="10" />
        </label>
        <label class="field">
          <span>Timeout</span>
          <input id="${prefix}Timeout" type="number" min="1" value="1" />
        </label>
        <label class="field">
          <span>Success threshold</span>
          <input id="${prefix}SuccessThreshold" type="number" min="1" value="1" />
        </label>
        <label class="field">
          <span>Failure threshold</span>
          <input id="${prefix}FailureThreshold" type="number" min="1" value="${defaults.failureThreshold}" />
        </label>
        <label class="field">
          <span>Probe termination grace</span>
          <input id="${prefix}TerminationGrace" type="number" min="1" placeholder="Pod default" />
        </label>
      </div>
      <div class="subsection-heading nested-heading probe-headers-heading">
        <div><h4>HTTP headers</h4></div>
        <button class="add-button" type="button" data-add-probe-header="${prefix}">
          <span aria-hidden="true">+</span> Add header
        </button>
      </div>
      <div class="repeat-list" data-list="${prefix}Headers"></div>
    `;
    updateProbeFields(prefix);
  }

  function updateProbeFields(prefix) {
    const container = document.querySelector(`[data-probe="${prefix}"]`);
    const type = value(`${prefix}Type`);
    container.querySelector(".probe-path").hidden = type !== "httpGet";
    container.querySelector(".probe-scheme").hidden = type !== "httpGet";
    container.querySelector(".probe-command").hidden = type !== "exec";
    container.querySelector(".probe-grpc-service").hidden = type !== "grpc";
    container.querySelector(".probe-headers-heading").hidden = type !== "httpGet";
    container.querySelector(`[data-list="${prefix}Headers"]`).hidden = type !== "httpGet";
  }

  function addProbeHeader(prefix, initial = {}) {
    const fragment = byId("key-value-template").content.cloneNode(true);
    const row = fragment.querySelector(".repeat-row");
    row.querySelector('[data-field="key"]').dataset.field = "name";
    row.querySelector('[data-field="value"]').dataset.field = "value";
    row.querySelector('[data-field="name"]').placeholder = "Header name";
    row.querySelector('[data-field="value"]').placeholder = "Header value";
    if (initial.name) row.querySelector('[data-field="name"]').value = initial.name;
    if (initial.value) row.querySelector('[data-field="value"]').value = initial.value;
    document.querySelector(`[data-list="${prefix}Headers"]`).appendChild(fragment);
    render();
  }

  function syncKindUI() {
    const kind = form.elements.kind.value;
    const isDeployment = kind === "Deployment";
    const isStateful = kind === "StatefulSet";
    const isDaemon = kind === "DaemonSet";
    document.querySelectorAll(".stateful-only").forEach((element) => {
      element.hidden = !isStateful;
    });
    document.querySelectorAll(".deployment-only").forEach((element) => {
      element.hidden = !isDeployment;
    });
    document.querySelectorAll(".daemon-only").forEach((element) => {
      element.hidden = !isDaemon;
    });
    document.querySelectorAll(".replica-only").forEach((element) => {
      element.hidden = isDaemon;
    });
    byId("identity-title").textContent = isDaemon
      ? "Identity & placement"
      : "Identity & scale";
    byId("identity-copy").textContent = isDaemon
      ? "Name the resource; Kubernetes runs one pod on every matching node."
      : "Name the resource and choose how many pods it should manage.";
    updateStrategyUI();
  }

  function updateStrategyUI() {
    const rolling = value("deploymentStrategy") === "RollingUpdate";
    document.querySelectorAll(".rolling-update-only").forEach((element) => {
      element.hidden = !rolling;
    });
    const statefulRolling = value("statefulStrategy") === "RollingUpdate";
    document.querySelectorAll(".stateful-rolling-only").forEach((element) => {
      element.hidden = !statefulRolling;
    });
    const daemonRolling =
      form.elements.kind.value === "DaemonSet" &&
      value("daemonStrategy") === "RollingUpdate";
    document.querySelectorAll(".daemon-rolling-only").forEach((element) => {
      element.hidden = !daemonRolling;
    });
  }

  function showSection(index) {
    activeSection = Math.max(0, Math.min(sectionNames.length - 1, index));
    document.querySelectorAll(".form-section").forEach((section) => {
      const active = section.dataset.section === sectionNames[activeSection];
      section.classList.toggle("is-active", active);
      section.hidden = !active;
    });
    document.querySelectorAll(".section-tab").forEach((tab) => {
      const active = tab.dataset.sectionTarget === sectionNames[activeSection];
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
    });

    byId("previous-section").disabled = activeSection === 0;
    byId("next-section").textContent =
      activeSection === sectionNames.length - 1
        ? "Review manifest"
        : `Next: ${capitalize(sectionNames[activeSection + 1])}`;
  }

  function capitalize(input) {
    return input.charAt(0).toUpperCase() + input.slice(1);
  }

  function resetDefaults() {
    form.reset();
    document.querySelectorAll(".repeat-list").forEach((list) => {
      list.innerHTML = "";
    });
    addRow("labels", { key: "app", value: "web-app" });
    addRow("ports", { name: "http", containerPort: "8080", protocol: "TCP" });
    previousName = "web-app";
    outputFormat = "yaml";
    document.querySelectorAll(".format-button").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.format === "yaml");
    });
    syncKindUI();
    showSection(0);
    render();
    showToast("Defaults restored");
  }

  document.addEventListener("input", (event) => {
    if (event.target.id === "name") {
      const newName = event.target.value;
      const appLabelRow = [
        ...document.querySelectorAll('[data-list="labels"] .repeat-row'),
      ].find(
        (row) => row.querySelector('[data-field="key"]').value.trim() === "app",
      );
      const appLabelValue = appLabelRow?.querySelector('[data-field="value"]');
      if (appLabelValue && appLabelValue.value.trim() === previousName) {
        appLabelValue.value = newName;
      }
      if (value("serviceName") === previousName || !value("serviceName")) {
        byId("serviceName").value = newName;
      }
      previousName = newName;
    }
    render();
  });

  document.addEventListener("change", (event) => {
    const row = event.target.closest(".repeat-row");
    if (row) updateDynamicRow(row);

    if (event.target.name === "kind") syncKindUI();
    if (
      event.target.id === "deploymentStrategy" ||
      event.target.id === "statefulStrategy" ||
      event.target.id === "daemonStrategy"
    ) {
      updateStrategyUI();
    }
    if (event.target.id?.endsWith("Type") && event.target.closest(".probe-body")) {
      updateProbeFields(event.target.id.replace(/Type$/, ""));
    }
    render();
  });

  document.addEventListener("click", (event) => {
    const addButton = event.target.closest("[data-add-row]");
    if (addButton) addRow(addButton.dataset.addRow);

    const headerButton = event.target.closest("[data-add-probe-header]");
    if (headerButton) addProbeHeader(headerButton.dataset.addProbeHeader);

    const removeButton = event.target.closest(".remove-button");
    if (removeButton) {
      const row = removeButton.closest(".repeat-row");
      if (row.dataset.rowType === "labels") {
        const otherDefinedLabels = [
          ...document.querySelectorAll('[data-list="labels"] .repeat-row'),
        ].filter(
          (candidate) =>
            candidate !== row &&
            candidate.querySelector('[data-field="key"]').value.trim(),
        );
        if (!otherDefinedLabels.length) {
          showToast("Add another label before removing this one");
          return;
        }
      }
      row.remove();
      render();
    }
  });

  document.querySelectorAll(".section-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      showSection(sectionNames.indexOf(tab.dataset.sectionTarget));
    });
  });

  document.querySelectorAll(".format-button").forEach((button) => {
    button.addEventListener("click", () => {
      outputFormat = button.dataset.format;
      document.querySelectorAll(".format-button").forEach((candidate) => {
        candidate.classList.toggle("is-active", candidate === button);
      });
      render();
    });
  });

  byId("previous-section").addEventListener("click", () => showSection(activeSection - 1));
  byId("next-section").addEventListener("click", () => {
    if (activeSection === sectionNames.length - 1) {
      document.querySelector(".output-panel").scrollIntoView({ behavior: "smooth" });
    } else {
      showSection(activeSection + 1);
      if (window.matchMedia("(max-width: 680px)").matches) {
        form.scrollIntoView({ behavior: "smooth" });
      }
    }
  });

  byId("copy-button").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(currentText);
      showToast("Manifest copied to clipboard");
    } catch {
      output.focus();
      output.select();
      output.setSelectionRange(0, output.value.length);
      showToast("Manifest selected — press Ctrl/Cmd+C");
    }
  });

  byId("download-button").addEventListener("click", () => {
    const extension = outputFormat === "json" ? "json" : "yaml";
    const filename = `${value("name") || "manifest"}.${extension}`;
    const blob = new Blob([currentText], {
      type: outputFormat === "json" ? "application/json" : "application/yaml",
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
    showToast(`Downloaded ${filename}`);
  });

  byId("reset-button").addEventListener("click", resetDefaults);

  renderProbe("liveness", { initialDelay: 10, failureThreshold: 3 });
  renderProbe("readiness", { initialDelay: 5, failureThreshold: 3 });
  renderProbe("startup", { initialDelay: 0, failureThreshold: 30 });
  addRow("labels", { key: "app", value: "web-app" });
  addRow("ports", { name: "http", containerPort: "8080", protocol: "TCP" });
  syncKindUI();
  showSection(0);
  render();

  window.K8sGenerator = {
    buildDaemonSetSpec,
    buildManifest,
    compact,
    deepMerge,
    toYaml,
    validateDaemonRollingUpdate,
  };
})();
