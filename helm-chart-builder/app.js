(() => {
  "use strict";

  const BASE_EXAMPLE = Object.freeze({
    chartApiVersion: "v2",
    chartName: "web-application",
    chartVersion: "0.1.0",
    description: "A Helm chart for a web application",
    appVersion: "1.0.0",
    kubeVersion: ">=1.29.0-0",
    maintainerName: "",
    sourceUrl: "",
    workloadKind: "Deployment",
    imageRepository: "nginx",
    imageTag: "1.27-alpine",
    imagePullPolicy: "IfNotPresent",
    replicaCount: 2,
    containerPort: 80,
    environment: "",
    serviceEnabled: true,
    serviceType: "ClusterIP",
    servicePort: 80,
    serviceAnnotations: "",
    ingressEnabled: false,
    ingressHostEnabled: true,
    ingressClassName: "nginx",
    ingressHost: "chart-example.local",
    ingressPath: "/",
    ingressAnnotations: "",
    autoscalingEnabled: false,
    autoscalingMin: 2,
    autoscalingMax: 10,
    autoscalingCpu: 80,
    pdbEnabled: true,
    pdbMinAvailable: "1",
    serviceAccountCreate: true,
    serviceAccountAnnotations: "",
    cpuRequest: "100m",
    memoryRequest: "128Mi",
    cpuLimit: "500m",
    memoryLimit: "256Mi",
    readinessEnabled: true,
    livenessEnabled: true,
    probePath: "/",
  });

  const SEMVER_PATTERN =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
  const DNS_LABEL_PATTERN = /^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/;
  const ANNOTATION_NAME_PATTERN = /^[A-Za-z0-9](?:[-_.A-Za-z0-9]*[A-Za-z0-9])?$/;
  const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
  const IMAGE_TAG_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;
  const WORKLOAD_KINDS = new Set(["Deployment", "StatefulSet", "DaemonSet"]);
  const CHART_API_VERSIONS = new Set(["v2", "v3"]);
  const AUTO_REFRESH_DELAY = 2000;
  const encoder = new TextEncoder();

  function yamlString(value) {
    return JSON.stringify(String(value));
  }

  function yamlBoolean(value) {
    return value ? "true" : "false";
  }

  function availabilityValue(value) {
    const normalized = String(value).trim();
    return /^\d+$/.test(normalized) ? normalized : yamlString(normalized);
  }

  function parseEnvironment(source) {
    const entries = [];
    const errors = [];
    const seen = new Set();

    String(source ?? "")
      .split(/\r?\n/)
      .forEach((line, index) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) return;
        const separator = trimmed.indexOf("=");
        if (separator < 1) {
          errors.push(`Environment line ${index + 1} must use NAME=value.`);
          return;
        }

        const name = trimmed.slice(0, separator).trim();
        const value = trimmed.slice(separator + 1);
        if (!ENV_NAME_PATTERN.test(name)) {
          errors.push(`Environment line ${index + 1} has an invalid variable name.`);
          return;
        }
        if (seen.has(name)) {
          errors.push(`Environment variable ${name} is declared more than once.`);
          return;
        }

        seen.add(name);
        entries.push({ name, value });
      });

    return { entries, errors };
  }

  function validAnnotationKey(key) {
    const segments = key.split("/");
    if (segments.length > 2) return false;

    const name = segments.pop();
    if (!name || name.length > 63 || !ANNOTATION_NAME_PATTERN.test(name)) return false;
    if (!segments.length) return true;

    const prefix = segments[0];
    return Boolean(
      prefix &&
        prefix.length <= 253 &&
        prefix.split(".").every(
          (label) => label.length <= 63 && DNS_LABEL_PATTERN.test(label),
        ),
    );
  }

  function parseAnnotations(source) {
    const entries = [];
    const errors = [];
    const seen = new Set();

    String(source ?? "")
      .split(/\r?\n/)
      .forEach((line, index) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) return;
        const separator = trimmed.indexOf("=");
        if (separator < 1) {
          errors.push(`Annotation line ${index + 1} must use key=value.`);
          return;
        }

        const key = trimmed.slice(0, separator).trim();
        const value = trimmed.slice(separator + 1);
        if (!validAnnotationKey(key)) {
          errors.push(`Annotation line ${index + 1} has an invalid Kubernetes annotation key.`);
          return;
        }
        if (seen.has(key)) {
          errors.push(`Annotation ${key} is declared more than once.`);
          return;
        }

        seen.add(key);
        entries.push({ key, value });
      });

    return { entries, errors };
  }

  function annotationValueLines(source, indentation = "  ") {
    const entries = parseAnnotations(source).entries;
    if (!entries.length) return [`${indentation}annotations: {}`];
    return [
      `${indentation}annotations:`,
      ...entries.map(
        ({ key, value }) => `${indentation}  ${yamlString(key)}: ${yamlString(value)}`,
      ),
    ];
  }

  function validHttpUrl(value) {
    if (!value) return true;
    try {
      const parsed = new URL(value);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch (_error) {
      return false;
    }
  }

  function validateConfig(config) {
    const errors = [];
    const add = (field, message) => errors.push({ field, message });

    if (!CHART_API_VERSIONS.has(config.chartApiVersion)) {
      add("chart-api-version", "Select Helm chart API v2 or v3.");
    }
    if (
      !config.chartName ||
      config.chartName.length > 63 ||
      !DNS_LABEL_PATTERN.test(config.chartName)
    ) {
      add(
        "chart-name",
        "Chart name must be a lowercase DNS label of no more than 63 characters.",
      );
    }
    if (!SEMVER_PATTERN.test(config.chartVersion)) {
      add("chart-version", "Chart version must be a complete semantic version, such as 0.1.0.");
    }
    if (!config.description) {
      add("description", "Chart description is required.");
    }
    if (!WORKLOAD_KINDS.has(config.workloadKind)) {
      add("workload-kind", "Select a supported workload type.");
    }
    if (!config.imageRepository || /\s/.test(config.imageRepository)) {
      add("image-repository", "Image repository is required and cannot contain spaces.");
    }
    if (!IMAGE_TAG_PATTERN.test(config.imageTag || config.appVersion)) {
      add(
        "image-tag",
        "Default image tag, or the application version used as its fallback, is not a valid container image tag.",
      );
    }
    if (!Number.isInteger(config.containerPort) || config.containerPort < 1 || config.containerPort > 65535) {
      add("container-port", "Container port must be an integer from 1 to 65535.");
    }
    if (
      config.workloadKind !== "DaemonSet" &&
      (!Number.isInteger(config.replicaCount) || config.replicaCount < 1)
    ) {
      add("replica-count", "Replica count must be at least 1.");
    }
    if (!validHttpUrl(config.sourceUrl)) {
      add("source-url", "Source URL must start with http:// or https://.");
    }
    if (config.serviceEnabled) {
      if (!Number.isInteger(config.servicePort) || config.servicePort < 1 || config.servicePort > 65535) {
        add("service-port", "Service port must be an integer from 1 to 65535.");
      }
    }
    if (config.workloadKind === "StatefulSet" && !config.serviceEnabled) {
      add("service-enabled", "A StatefulSet base chart requires its governing Service.");
    }
    if (config.ingressEnabled && !config.serviceEnabled) {
      add("ingress-enabled", "Ingress requires the Service component.");
    }
    if (config.ingressEnabled) {
      if (
        config.ingressHostEnabled &&
        (!config.ingressHost || /\s/.test(config.ingressHost))
      ) {
        add("ingress-host", "Ingress host is required and cannot contain spaces.");
      }
      if (!config.ingressPath.startsWith("/")) {
        add("ingress-path", "Ingress path must start with a slash.");
      }
    }
    if (config.workloadKind !== "DaemonSet" && config.autoscalingEnabled) {
      if (!Number.isInteger(config.autoscalingMin) || config.autoscalingMin < 1) {
        add("autoscaling-min", "Minimum replicas must be at least 1.");
      }
      if (
        !Number.isInteger(config.autoscalingMax) ||
        config.autoscalingMax < config.autoscalingMin
      ) {
        add("autoscaling-max", "Maximum replicas must be greater than or equal to the minimum.");
      }
      if (
        !Number.isInteger(config.autoscalingCpu) ||
        config.autoscalingCpu < 1 ||
        config.autoscalingCpu > 100
      ) {
        add("autoscaling-cpu", "Target CPU utilization must be from 1 to 100.");
      }
    }
    if (config.workloadKind !== "DaemonSet" && config.pdbEnabled) {
      const percent = config.pdbMinAvailable.match(/^(\d+)%$/);
      if (
        !/^(?:\d+|\d+%)$/.test(config.pdbMinAvailable) ||
        (percent && Number(percent[1]) > 100)
      ) {
        add(
          "pdb-min-available",
          "Minimum available must be a non-negative integer or a percentage from 0% to 100%.",
        );
      }
    }
    if (
      (config.readinessEnabled || config.livenessEnabled) &&
      !config.probePath.startsWith("/")
    ) {
      add("probe-path", "Probe path must start with a slash.");
    }

    parseEnvironment(config.environment).errors.forEach((message) => {
      add("environment", message);
    });
    if (config.serviceEnabled) {
      parseAnnotations(config.serviceAnnotations).errors.forEach((message) => {
        add("service-annotations", message);
      });
    }
    if (config.ingressEnabled) {
      parseAnnotations(config.ingressAnnotations).errors.forEach((message) => {
        add("ingress-annotations", message);
      });
    }
    if (config.serviceAccountCreate) {
      parseAnnotations(config.serviceAccountAnnotations).errors.forEach((message) => {
        add("service-account-annotations", message);
      });
    }

    [
      ["cpu-request", config.cpuRequest, "CPU request"],
      ["memory-request", config.memoryRequest, "Memory request"],
      ["cpu-limit", config.cpuLimit, "CPU limit"],
      ["memory-limit", config.memoryLimit, "Memory limit"],
    ].forEach(([field, entry, label]) => {
      if (!entry || /\s/.test(entry)) add(field, `${label} is required and cannot contain spaces.`);
    });

    return errors;
  }

  function buildChartYaml(config) {
    const lines = [
      `apiVersion: ${config.chartApiVersion}`,
      `name: ${config.chartName}`,
      `description: ${yamlString(config.description)}`,
      "type: application",
      `version: ${config.chartVersion}`,
      `appVersion: ${yamlString(config.appVersion || config.imageTag || "latest")}`,
    ];

    if (config.kubeVersion) lines.push(`kubeVersion: ${yamlString(config.kubeVersion)}`);
    lines.push("keywords:", "  - kubernetes", "  - helm");
    if (config.sourceUrl) lines.push("sources:", `  - ${yamlString(config.sourceUrl)}`);
    if (config.maintainerName) {
      lines.push("maintainers:", `  - name: ${yamlString(config.maintainerName)}`);
    }
    lines.push("");
    return lines.join("\n");
  }

  function buildValuesYaml(config) {
    const environment = parseEnvironment(config.environment).entries;
    const serviceAccountAnnotationLines = annotationValueLines(
      config.serviceAccountAnnotations,
    );
    const serviceAnnotationLines = annotationValueLines(config.serviceAnnotations);
    const ingressAnnotationLines = annotationValueLines(config.ingressAnnotations);
    const ingressHost = config.ingressHostEnabled
      ? [`    - host: ${yamlString(config.ingressHost)}`, "      paths:"]
      : ["    - paths:"];
    const lines = [];

    if (config.workloadKind !== "DaemonSet") {
      lines.push("# Number of workload replicas when autoscaling is disabled.");
      lines.push(`replicaCount: ${config.replicaCount}`, "");
    }

    lines.push(
      "image:",
      `  repository: ${yamlString(config.imageRepository)}`,
      `  pullPolicy: ${config.imagePullPolicy}`,
      `  tag: ${yamlString(config.imageTag)}`,
      "",
      "imagePullSecrets: []",
      "nameOverride: \"\"",
      "fullnameOverride: \"\"",
      `containerPort: ${config.containerPort}`,
      "",
      "serviceAccount:",
      `  create: ${yamlBoolean(config.serviceAccountCreate)}`,
      "  automount: true",
      ...serviceAccountAnnotationLines,
      "  name: \"\"",
      "",
      "podAnnotations: {}",
      "podLabels: {}",
      "podSecurityContext: {}",
      "securityContext: {}",
      "",
      "service:",
      `  enabled: ${yamlBoolean(config.serviceEnabled)}`,
      ...serviceAnnotationLines,
      `  type: ${config.serviceType}`,
      `  port: ${config.servicePort}`,
      "  targetPort: http",
      "",
      "ingress:",
      `  enabled: ${yamlBoolean(config.ingressEnabled)}`,
      `  className: ${yamlString(config.ingressClassName)}`,
      ...ingressAnnotationLines,
      "  hosts:",
      ...ingressHost,
      `        - path: ${yamlString(config.ingressPath)}`,
      "          pathType: Prefix",
      "  tls: []",
      "",
    );

    if (config.workloadKind !== "DaemonSet") {
      lines.push(
        "autoscaling:",
        `  enabled: ${yamlBoolean(config.autoscalingEnabled)}`,
        `  minReplicas: ${config.autoscalingMin}`,
        `  maxReplicas: ${config.autoscalingMax}`,
        `  targetCPUUtilizationPercentage: ${config.autoscalingCpu}`,
        "",
        "pdb:",
        `  enabled: ${yamlBoolean(config.pdbEnabled)}`,
        `  minAvailable: ${availabilityValue(config.pdbMinAvailable)}`,
        "",
      );
    }

    lines.push(
      "resources:",
      "  limits:",
      `    cpu: ${yamlString(config.cpuLimit)}`,
      `    memory: ${yamlString(config.memoryLimit)}`,
      "  requests:",
      `    cpu: ${yamlString(config.cpuRequest)}`,
      `    memory: ${yamlString(config.memoryRequest)}`,
      "",
      "livenessProbe:",
      `  enabled: ${yamlBoolean(config.livenessEnabled)}`,
      "  httpGet:",
      `    path: ${yamlString(config.probePath)}`,
      "    port: http",
      "  initialDelaySeconds: 10",
      "  periodSeconds: 10",
      "",
      "readinessProbe:",
      `  enabled: ${yamlBoolean(config.readinessEnabled)}`,
      "  httpGet:",
      `    path: ${yamlString(config.probePath)}`,
      "    port: http",
      "  initialDelaySeconds: 5",
      "  periodSeconds: 10",
      "",
    );

    if (environment.length) {
      lines.push("env:");
      environment.forEach((entry) => {
        lines.push(`  - name: ${entry.name}`, `    value: ${yamlString(entry.value)}`);
      });
    } else {
      lines.push("env: []");
    }

    lines.push("", "nodeSelector: {}", "tolerations: []", "affinity: {}", "");
    return lines.join("\n");
  }

  function buildHelpersTemplate(config) {
    const name = config.chartName;
    return `{{/*
Expand the name of the chart.
*/}}
{{- define "${name}.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "${name}.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "${name}.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/* Common labels */}}
{{- define "${name}.labels" -}}
helm.sh/chart: {{ include "${name}.chart" . }}
{{ include "${name}.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/* Selector labels */}}
{{- define "${name}.selectorLabels" -}}
app.kubernetes.io/name: {{ include "${name}.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/* ServiceAccount name */}}
{{- define "${name}.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "${name}.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}
`;
  }

  function buildWorkloadTemplate(config) {
    const name = config.chartName;
    const kind = config.workloadKind;
    const lines = [
      "apiVersion: apps/v1",
      `kind: ${kind}`,
      "metadata:",
      `  name: {{ include "${name}.fullname" . }}`,
      "  labels:",
      `    {{- include "${name}.labels" . | nindent 4 }}`,
      "spec:",
    ];

    if (kind === "StatefulSet") {
      lines.push(`  serviceName: {{ include "${name}.fullname" . }}`);
    }
    if (kind !== "DaemonSet") {
      lines.push(
        "  {{- if not .Values.autoscaling.enabled }}",
        "  replicas: {{ .Values.replicaCount }}",
        "  {{- end }}",
      );
    }
    lines.push(
      "  selector:",
      "    matchLabels:",
      `      {{- include "${name}.selectorLabels" . | nindent 6 }}`,
    );
    if (kind === "Deployment") {
      lines.push(
        "  strategy:",
        "    type: RollingUpdate",
        "    rollingUpdate:",
        "      maxUnavailable: 0",
        "      maxSurge: 1",
      );
    } else {
      lines.push("  updateStrategy:", "    type: RollingUpdate");
    }
    lines.push(
      "  template:",
      "    metadata:",
      "      {{- with .Values.podAnnotations }}",
      "      annotations:",
      "        {{- toYaml . | nindent 8 }}",
      "      {{- end }}",
      "      labels:",
      `        {{- include "${name}.selectorLabels" . | nindent 8 }}`,
      "        {{- with .Values.podLabels }}",
      "        {{- toYaml . | nindent 8 }}",
      "        {{- end }}",
      "    spec:",
      "      {{- with .Values.imagePullSecrets }}",
      "      imagePullSecrets:",
      "        {{- toYaml . | nindent 8 }}",
      "      {{- end }}",
      `      serviceAccountName: {{ include "${name}.serviceAccountName" . }}`,
      "      securityContext:",
      "        {{- toYaml .Values.podSecurityContext | nindent 8 }}",
      "      containers:",
      `        - name: {{ .Chart.Name }}`,
      "          securityContext:",
      "            {{- toYaml .Values.securityContext | nindent 12 }}",
      `          image: "{{ .Values.image.repository }}:{{ .Values.image.tag | default .Chart.AppVersion }}"`,
      "          imagePullPolicy: {{ .Values.image.pullPolicy }}",
      "          ports:",
      "            - name: http",
      "              containerPort: {{ .Values.containerPort }}",
      "              protocol: TCP",
      "          {{- with .Values.env }}",
      "          env:",
      "            {{- toYaml . | nindent 12 }}",
      "          {{- end }}",
      "          {{- if .Values.livenessProbe.enabled }}",
      "          livenessProbe:",
      "            {{- omit .Values.livenessProbe \"enabled\" | toYaml | nindent 12 }}",
      "          {{- end }}",
      "          {{- if .Values.readinessProbe.enabled }}",
      "          readinessProbe:",
      "            {{- omit .Values.readinessProbe \"enabled\" | toYaml | nindent 12 }}",
      "          {{- end }}",
      "          resources:",
      "            {{- toYaml .Values.resources | nindent 12 }}",
      "      {{- with .Values.nodeSelector }}",
      "      nodeSelector:",
      "        {{- toYaml . | nindent 8 }}",
      "      {{- end }}",
      "      {{- with .Values.affinity }}",
      "      affinity:",
      "        {{- toYaml . | nindent 8 }}",
      "      {{- end }}",
      "      {{- with .Values.tolerations }}",
      "      tolerations:",
      "        {{- toYaml . | nindent 8 }}",
      "      {{- end }}",
      "",
    );
    return lines.join("\n");
  }

  function buildServiceTemplate(config) {
    const name = config.chartName;
    const statefulLines =
      config.workloadKind === "StatefulSet"
        ? ["  clusterIP: None", "  publishNotReadyAddresses: true"]
        : ["  type: {{ .Values.service.type }}"];

    return [
      "{{- if .Values.service.enabled }}",
      "apiVersion: v1",
      "kind: Service",
      "metadata:",
      `  name: {{ include "${name}.fullname" . }}`,
      "  labels:",
      `    {{- include "${name}.labels" . | nindent 4 }}`,
      "  {{- with .Values.service.annotations }}",
      "  annotations:",
      "    {{- toYaml . | nindent 4 }}",
      "  {{- end }}",
      "spec:",
      ...statefulLines,
      "  ports:",
      "    - port: {{ .Values.service.port }}",
      "      targetPort: {{ .Values.service.targetPort }}",
      "      protocol: TCP",
      "      name: http",
      "  selector:",
      `    {{- include "${name}.selectorLabels" . | nindent 4 }}`,
      "{{- end }}",
      "",
    ].join("\n");
  }

  function buildIngressTemplate(config) {
    const name = config.chartName;
    return `{{- if .Values.ingress.enabled -}}
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: {{ include "${name}.fullname" . }}
  labels:
    {{- include "${name}.labels" . | nindent 4 }}
  {{- with .Values.ingress.annotations }}
  annotations:
    {{- toYaml . | nindent 4 }}
  {{- end }}
spec:
  {{- with .Values.ingress.className }}
  ingressClassName: {{ . }}
  {{- end }}
  {{- with .Values.ingress.tls }}
  tls:
    {{- toYaml . | nindent 4 }}
  {{- end }}
  rules:
    {{- range .Values.ingress.hosts }}
    {{- if .host }}
    - host: {{ .host | quote }}
      http:
    {{- else }}
    - http:
    {{- end }}
        paths:
          {{- range .paths }}
          - path: {{ .path }}
            pathType: {{ .pathType }}
            backend:
              service:
                name: {{ include "${name}.fullname" $ }}
                port:
                  number: {{ $.Values.service.port }}
          {{- end }}
    {{- end }}
{{- end }}
`;
  }

  function buildServiceAccountTemplate(config) {
    const name = config.chartName;
    return `{{- if .Values.serviceAccount.create -}}
apiVersion: v1
kind: ServiceAccount
metadata:
  name: {{ include "${name}.serviceAccountName" . }}
  labels:
    {{- include "${name}.labels" . | nindent 4 }}
  {{- with .Values.serviceAccount.annotations }}
  annotations:
    {{- toYaml . | nindent 4 }}
  {{- end }}
automountServiceAccountToken: {{ .Values.serviceAccount.automount }}
{{- end }}
`;
  }

  function buildHpaTemplate(config) {
    const name = config.chartName;
    return `{{- if .Values.autoscaling.enabled }}
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: {{ include "${name}.fullname" . }}
  labels:
    {{- include "${name}.labels" . | nindent 4 }}
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: ${config.workloadKind}
    name: {{ include "${name}.fullname" . }}
  minReplicas: {{ .Values.autoscaling.minReplicas }}
  maxReplicas: {{ .Values.autoscaling.maxReplicas }}
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: {{ .Values.autoscaling.targetCPUUtilizationPercentage }}
{{- end }}
`;
  }

  function buildPdbTemplate(config) {
    const name = config.chartName;
    return `{{- if .Values.pdb.enabled }}
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: {{ include "${name}.fullname" . }}
  labels:
    {{- include "${name}.labels" . | nindent 4 }}
spec:
  minAvailable: {{ .Values.pdb.minAvailable }}
  selector:
    matchLabels:
      {{- include "${name}.selectorLabels" . | nindent 6 }}
{{- end }}
`;
  }

  function buildNotesTemplate(config) {
    const name = config.chartName;
    return `1. Check the ${config.workloadKind} rollout:

  kubectl rollout status ${config.workloadKind.toLowerCase()}/{{ include "${name}.fullname" . }} -n {{ .Release.Namespace }}

{{- if .Values.ingress.enabled }}
2. Inspect the configured Ingress:
  {{- range .Values.ingress.hosts }}
  {{- if .host }}
  http{{ if $.Values.ingress.tls }}s{{ end }}://{{ .host }}
  {{- else }}
  kubectl get ingress {{ include "${name}.fullname" $ }} -n {{ $.Release.Namespace }}
  {{- end }}
  {{- end }}
{{- else if .Values.service.enabled }}
2. Forward the Service locally:

  kubectl port-forward service/{{ include "${name}.fullname" . }} 8080:{{ .Values.service.port }} -n {{ .Release.Namespace }}
{{- end }}
`;
  }

  function buildTestTemplate(config) {
    const name = config.chartName;
    return `{{- if .Values.service.enabled }}
apiVersion: v1
kind: Pod
metadata:
  name: "{{ include "${name}.fullname" . }}-test-connection"
  labels:
    {{- include "${name}.labels" . | nindent 4 }}
  annotations:
    "helm.sh/hook": test
spec:
  restartPolicy: Never
  containers:
    - name: wget
      image: busybox:1.36
      command: ["wget"]
      args: ["http://{{ include "${name}.fullname" . }}:{{ .Values.service.port }}"]
{{- end }}
`;
  }

  function buildValuesSchema(config) {
    const properties = {
      image: {
        type: "object",
        additionalProperties: false,
        required: ["repository", "pullPolicy", "tag"],
        properties: {
          repository: { type: "string", minLength: 1 },
          pullPolicy: { enum: ["Always", "IfNotPresent", "Never"] },
          tag: { type: "string" },
        },
      },
      imagePullSecrets: { type: "array", items: { type: "object" } },
      nameOverride: { type: "string" },
      fullnameOverride: { type: "string" },
      containerPort: { type: "integer", minimum: 1, maximum: 65535 },
      serviceAccount: {
        type: "object",
        additionalProperties: false,
        required: ["create", "automount", "annotations", "name"],
        properties: {
          create: { type: "boolean" },
          automount: { type: "boolean" },
          annotations: { type: "object", additionalProperties: { type: "string" } },
          name: { type: "string" },
        },
      },
      podAnnotations: { type: "object", additionalProperties: { type: "string" } },
      podLabels: { type: "object", additionalProperties: { type: "string" } },
      podSecurityContext: { type: "object" },
      securityContext: { type: "object" },
      service: {
        type: "object",
        additionalProperties: false,
        required: ["enabled", "annotations", "type", "port", "targetPort"],
        properties: {
          enabled: { type: "boolean" },
          annotations: { type: "object", additionalProperties: { type: "string" } },
          type: { enum: ["ClusterIP", "NodePort", "LoadBalancer"] },
          port: { type: "integer", minimum: 1, maximum: 65535 },
          targetPort: { type: ["integer", "string"] },
        },
      },
      ingress: {
        type: "object",
        additionalProperties: false,
        required: ["enabled", "className", "annotations", "hosts", "tls"],
        properties: {
          enabled: { type: "boolean" },
          className: { type: "string" },
          annotations: { type: "object", additionalProperties: { type: "string" } },
          hosts: {
            type: "array",
            items: {
              type: "object",
              required: ["paths"],
              properties: {
                host: { type: "string", minLength: 1 },
                paths: {
                  type: "array",
                  items: {
                    type: "object",
                    required: ["path", "pathType"],
                    properties: {
                      path: { type: "string", pattern: "^/" },
                      pathType: { enum: ["Exact", "Prefix", "ImplementationSpecific"] },
                    },
                  },
                },
              },
            },
          },
          tls: { type: "array", items: { type: "object" } },
        },
      },
      resources: {
        type: "object",
        properties: {
          limits: { type: "object", additionalProperties: { type: ["string", "number"] } },
          requests: { type: "object", additionalProperties: { type: ["string", "number"] } },
        },
      },
      livenessProbe: { $ref: "#/$defs/httpProbe" },
      readinessProbe: { $ref: "#/$defs/httpProbe" },
      env: {
        type: "array",
        items: {
          type: "object",
          required: ["name", "value"],
          properties: { name: { type: "string" }, value: { type: "string" } },
        },
      },
      nodeSelector: { type: "object" },
      tolerations: { type: "array", items: { type: "object" } },
      affinity: { type: "object" },
    };

    if (config.workloadKind !== "DaemonSet") {
      properties.replicaCount = { type: "integer", minimum: 1 };
      properties.autoscaling = {
        type: "object",
        additionalProperties: false,
        required: ["enabled", "minReplicas", "maxReplicas", "targetCPUUtilizationPercentage"],
        properties: {
          enabled: { type: "boolean" },
          minReplicas: { type: "integer", minimum: 1 },
          maxReplicas: { type: "integer", minimum: 1 },
          targetCPUUtilizationPercentage: { type: "integer", minimum: 1, maximum: 100 },
        },
      };
      properties.pdb = {
        type: "object",
        additionalProperties: false,
        required: ["enabled", "minAvailable"],
        properties: {
          enabled: { type: "boolean" },
          minAvailable: {
            anyOf: [
              { type: "integer", minimum: 0 },
              { type: "string", pattern: "^[0-9]+%$" },
            ],
          },
        },
      };
    }

    const schema = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      title: `${config.chartName} values`,
      type: "object",
      additionalProperties: false,
      properties,
      required: Object.keys(properties),
      $defs: {
        httpProbe: {
          type: "object",
          additionalProperties: false,
          required: ["enabled", "httpGet", "initialDelaySeconds", "periodSeconds"],
          properties: {
            enabled: { type: "boolean" },
            httpGet: {
              type: "object",
              required: ["path", "port"],
              properties: {
                path: { type: "string", pattern: "^/" },
                port: { type: ["integer", "string"] },
              },
            },
            initialDelaySeconds: { type: "integer", minimum: 0 },
            periodSeconds: { type: "integer", minimum: 1 },
          },
        },
      },
    };

    return `${JSON.stringify(schema, null, 2)}\n`;
  }

  function markdownCell(value) {
    return String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
  }

  function buildReadme(config) {
    const components = [config.workloadKind, "ServiceAccount"];
    if (config.serviceEnabled) components.push("Service");
    if (config.ingressEnabled) components.push("Ingress");
    if (config.autoscalingEnabled && config.workloadKind !== "DaemonSet") components.push("HPA");
    if (config.pdbEnabled && config.workloadKind !== "DaemonSet") components.push("PDB");

    const replicaRow =
      config.workloadKind === "DaemonSet"
        ? ""
        : `| \`replicaCount\` | Workload replicas when autoscaling is disabled | \`${config.replicaCount}\` |\n`;
    const featureGate =
      config.chartApiVersion === "v3"
        ? "export HELM_EXPERIMENTAL_CHART_V3=1\n"
        : "";
    const apiNotice =
      config.chartApiVersion === "v3"
        ? "\n> **Experimental:** This chart uses Helm chart API v3. It requires a compatible Helm 4 release and `HELM_EXPERIMENTAL_CHART_V3=1`. Chart v3 behavior can change between Helm releases.\n"
        : "";

    return `# ${config.chartName}

${config.description}

This chart was generated locally with the [Native Cube Helm Chart Builder](https://native-cube.github.io/helm-chart-builder/).
${apiNotice}
**Chart API:** \`${config.chartApiVersion}\`

## Included resources

${components.map((component) => `- ${component}`).join("\n")}

## Install

\`\`\`sh
${featureGate}helm install my-release ./${config.chartName}
\`\`\`

## Configuration

| Value | Description | Default |
| --- | --- | --- |
${replicaRow}| \`image.repository\` | Container image repository | \`${markdownCell(config.imageRepository)}\` |
| \`image.tag\` | Container image tag | \`${markdownCell(config.imageTag)}\` |
| \`image.pullPolicy\` | Image pull policy | \`${config.imagePullPolicy}\` |
| \`containerPort\` | Named HTTP container port | \`${config.containerPort}\` |
| \`serviceAccount.annotations\` | ServiceAccount metadata annotations | See \`values.yaml\` |
| \`service.enabled\` | Create a Service | \`${config.serviceEnabled}\` |
| \`service.annotations\` | Service metadata annotations | See \`values.yaml\` |
| \`service.port\` | Service port | \`${config.servicePort}\` |
| \`ingress.enabled\` | Create an Ingress | \`${config.ingressEnabled}\` |
| \`ingress.annotations\` | Ingress metadata annotations | See \`values.yaml\` |
| \`ingress.hosts[0].host\` | Optional host match | ${config.ingressHostEnabled ? `\`${markdownCell(config.ingressHost)}\`` : "Omitted (matches any host)"} |
| \`resources\` | Container requests and limits | See \`values.yaml\` |
| \`livenessProbe.enabled\` | Enable the liveness probe | \`${config.livenessEnabled}\` |
| \`readinessProbe.enabled\` | Enable the readiness probe | \`${config.readinessEnabled}\` |

The complete value contract is defined in \`values.schema.json\`.

## Verify

\`\`\`sh
${featureGate}helm lint ./${config.chartName}
helm template example ./${config.chartName} --debug
helm test example
\`\`\`

Review the rendered manifests and security settings before deploying to a production cluster.
`;
  }

  function buildHelmIgnore() {
    return `# Patterns to ignore when building packages.
.DS_Store
.git/
.gitignore
.helmignore
.idea/
.project
.tmp/
.vscode/
*.swp
*.tmp
*.tgz
`;
  }

  function renderedLabels(config) {
    return [
      `app.kubernetes.io/name: ${config.chartName}`,
      `app.kubernetes.io/instance: example`,
      `app.kubernetes.io/version: ${yamlString(config.appVersion || config.imageTag)}`,
      "app.kubernetes.io/managed-by: Helm",
    ];
  }

  function buildRenderedPreview(config) {
    const name = `example-${config.chartName}`;
    const labels = renderedLabels(config);
    const selectorLabels = labels.slice(0, 2);
    const environment = parseEnvironment(config.environment).entries;
    const serviceAnnotations = parseAnnotations(config.serviceAnnotations).entries;
    const ingressAnnotations = parseAnnotations(config.ingressAnnotations).entries;
    const serviceAccountAnnotations = parseAnnotations(
      config.serviceAccountAnnotations,
    ).entries;
    const documents = [];

    if (config.serviceAccountCreate) {
      const serviceAccount = [
        "apiVersion: v1",
        "kind: ServiceAccount",
        "metadata:",
        `  name: ${name}`,
        "  labels:",
        ...labels.map((label) => `    ${label}`),
      ];
      if (serviceAccountAnnotations.length) {
        serviceAccount.push(
          "  annotations:",
          ...serviceAccountAnnotations.map(
            ({ key, value }) => `    ${yamlString(key)}: ${yamlString(value)}`,
          ),
        );
      }
      serviceAccount.push("automountServiceAccountToken: true");
      documents.push(serviceAccount.join("\n"));
    }

    const workload = [
      "apiVersion: apps/v1",
      `kind: ${config.workloadKind}`,
      "metadata:",
      `  name: ${name}`,
      "  labels:",
      ...labels.map((label) => `    ${label}`),
      "spec:",
    ];
    if (config.workloadKind === "StatefulSet") workload.push(`  serviceName: ${name}`);
    if (config.workloadKind !== "DaemonSet" && !config.autoscalingEnabled) {
      workload.push(`  replicas: ${config.replicaCount}`);
    }
    workload.push(
      "  selector:",
      "    matchLabels:",
      ...selectorLabels.map((label) => `      ${label}`),
      "  template:",
      "    metadata:",
      "      labels:",
      ...selectorLabels.map((label) => `        ${label}`),
      "    spec:",
      `      serviceAccountName: ${config.serviceAccountCreate ? name : "default"}`,
      "      containers:",
      `        - name: ${config.chartName}`,
      `          image: ${yamlString(`${config.imageRepository}:${config.imageTag || config.appVersion}`)}`,
      `          imagePullPolicy: ${config.imagePullPolicy}`,
      "          ports:",
      "            - name: http",
      `              containerPort: ${config.containerPort}`,
      "              protocol: TCP",
    );
    if (environment.length) {
      workload.push("          env:");
      environment.forEach((entry) => {
        workload.push(`            - name: ${entry.name}`, `              value: ${yamlString(entry.value)}`);
      });
    }
    if (config.livenessEnabled) {
      workload.push(
        "          livenessProbe:",
        "            httpGet:",
        `              path: ${yamlString(config.probePath)}`,
        "              port: http",
        "            initialDelaySeconds: 10",
        "            periodSeconds: 10",
      );
    }
    if (config.readinessEnabled) {
      workload.push(
        "          readinessProbe:",
        "            httpGet:",
        `              path: ${yamlString(config.probePath)}`,
        "              port: http",
        "            initialDelaySeconds: 5",
        "            periodSeconds: 10",
      );
    }
    workload.push(
      "          resources:",
      "            limits:",
      `              cpu: ${yamlString(config.cpuLimit)}`,
      `              memory: ${yamlString(config.memoryLimit)}`,
      "            requests:",
      `              cpu: ${yamlString(config.cpuRequest)}`,
      `              memory: ${yamlString(config.memoryRequest)}`,
    );
    documents.push(workload.join("\n"));

    if (config.serviceEnabled) {
      const service = [
        "apiVersion: v1",
        "kind: Service",
        "metadata:",
        `  name: ${name}`,
        "  labels:",
        ...labels.map((label) => `    ${label}`),
      ];
      if (serviceAnnotations.length) {
        service.push(
          "  annotations:",
          ...serviceAnnotations.map(
            ({ key, value }) => `    ${yamlString(key)}: ${yamlString(value)}`,
          ),
        );
      }
      service.push("spec:");
      if (config.workloadKind === "StatefulSet") {
        service.push("  clusterIP: None", "  publishNotReadyAddresses: true");
      } else {
        service.push(`  type: ${config.serviceType}`);
      }
      service.push(
        "  ports:",
        `    - port: ${config.servicePort}`,
        "      targetPort: http",
        "      protocol: TCP",
        "      name: http",
        "  selector:",
        ...selectorLabels.map((label) => `    ${label}`),
      );
      documents.push(service.join("\n"));
    }

    if (config.ingressEnabled) {
      const ingress = [
        "apiVersion: networking.k8s.io/v1",
        "kind: Ingress",
        "metadata:",
        `  name: ${name}`,
        "  labels:",
        ...labels.map((label) => `    ${label}`),
      ];
      if (ingressAnnotations.length) {
        ingress.push(
          "  annotations:",
          ...ingressAnnotations.map(
            ({ key, value }) => `    ${yamlString(key)}: ${yamlString(value)}`,
          ),
        );
      }
      ingress.push(
        "spec:",
        `  ingressClassName: ${config.ingressClassName}`,
        "  rules:",
      );
      if (config.ingressHostEnabled) {
        ingress.push(`    - host: ${yamlString(config.ingressHost)}`);
      } else {
        ingress.push("    - http:");
      }
      if (config.ingressHostEnabled) ingress.push("      http:");
      ingress.push(
        "        paths:",
        `          - path: ${yamlString(config.ingressPath)}`,
        "            pathType: Prefix",
        "            backend:",
        "              service:",
        `                name: ${name}`,
        "                port:",
        `                  number: ${config.servicePort}`,
      );
      documents.push(ingress.join("\n"));
    }

    if (config.workloadKind !== "DaemonSet" && config.autoscalingEnabled) {
      documents.push([
        "apiVersion: autoscaling/v2",
        "kind: HorizontalPodAutoscaler",
        "metadata:",
        `  name: ${name}`,
        "spec:",
        "  scaleTargetRef:",
        "    apiVersion: apps/v1",
        `    kind: ${config.workloadKind}`,
        `    name: ${name}`,
        `  minReplicas: ${config.autoscalingMin}`,
        `  maxReplicas: ${config.autoscalingMax}`,
        "  metrics:",
        "    - type: Resource",
        "      resource:",
        "        name: cpu",
        "        target:",
        "          type: Utilization",
        `          averageUtilization: ${config.autoscalingCpu}`,
      ].join("\n"));
    }

    if (config.workloadKind !== "DaemonSet" && config.pdbEnabled) {
      documents.push([
        "apiVersion: policy/v1",
        "kind: PodDisruptionBudget",
        "metadata:",
        `  name: ${name}`,
        "spec:",
        `  minAvailable: ${availabilityValue(config.pdbMinAvailable)}`,
        "  selector:",
        "    matchLabels:",
        ...selectorLabels.map((label) => `      ${label}`),
      ].join("\n"));
    }

    return `# Equivalent preview for release "example". This file is not included in the ZIP.\n${documents.join("\n---\n")}\n`;
  }

  function buildChart(config) {
    const workloadFile = `${config.workloadKind.toLowerCase()}.yaml`;
    const files = {
      "Chart.yaml": buildChartYaml(config),
      "values.yaml": buildValuesYaml(config),
      "values.schema.json": buildValuesSchema(config),
      ".helmignore": buildHelmIgnore(),
      "README.md": buildReadme(config),
      "templates/_helpers.tpl": buildHelpersTemplate(config),
      [`templates/${workloadFile}`]: buildWorkloadTemplate(config),
      "templates/service.yaml": buildServiceTemplate(config),
      "templates/ingress.yaml": buildIngressTemplate(config),
      "templates/serviceaccount.yaml": buildServiceAccountTemplate(config),
    };

    if (config.workloadKind !== "DaemonSet") {
      files["templates/hpa.yaml"] = buildHpaTemplate(config);
      files["templates/pdb.yaml"] = buildPdbTemplate(config);
    }

    files["templates/NOTES.txt"] = buildNotesTemplate(config);
    files["templates/tests/test-connection.yaml"] = buildTestTemplate(config);

    return {
      root: config.chartName,
      version: config.chartVersion,
      apiVersion: config.chartApiVersion,
      files,
      preview: buildRenderedPreview(config),
    };
  }

  function uint16(value) {
    const bytes = new Uint8Array(2);
    new DataView(bytes.buffer).setUint16(0, value, true);
    return bytes;
  }

  function uint32(value) {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, value >>> 0, true);
    return bytes;
  }

  function joinBytes(parts) {
    const length = parts.reduce((total, part) => total + part.length, 0);
    const result = new Uint8Array(length);
    let offset = 0;
    parts.forEach((part) => {
      result.set(part, offset);
      offset += part.length;
    });
    return result;
  }

  const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      }
      table[index] = value >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    bytes.forEach((byte) => {
      crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    });
    return (crc ^ 0xffffffff) >>> 0;
  }

  function dosTimestamp(date) {
    const year = Math.max(1980, date.getFullYear());
    const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
    const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    return { time, day };
  }

  function createZip(files, root, date = new Date()) {
    const localParts = [];
    const centralParts = [];
    const timestamp = dosTimestamp(date);
    let localOffset = 0;

    Object.entries(files).forEach(([path, content]) => {
      const fileName = encoder.encode(`${root}/${path}`);
      const data = encoder.encode(content);
      const crc = crc32(data);
      const localHeader = joinBytes([
        uint32(0x04034b50),
        uint16(20),
        uint16(0x0800),
        uint16(0),
        uint16(timestamp.time),
        uint16(timestamp.day),
        uint32(crc),
        uint32(data.length),
        uint32(data.length),
        uint16(fileName.length),
        uint16(0),
        fileName,
      ]);
      localParts.push(localHeader, data);

      centralParts.push(
        joinBytes([
          uint32(0x02014b50),
          uint16(20),
          uint16(20),
          uint16(0x0800),
          uint16(0),
          uint16(timestamp.time),
          uint16(timestamp.day),
          uint32(crc),
          uint32(data.length),
          uint32(data.length),
          uint16(fileName.length),
          uint16(0),
          uint16(0),
          uint16(0),
          uint16(0),
          uint32(0),
          uint32(localOffset),
          fileName,
        ]),
      );
      localOffset += localHeader.length + data.length;
    });

    const centralDirectory = joinBytes(centralParts);
    const end = joinBytes([
      uint32(0x06054b50),
      uint16(0),
      uint16(0),
      uint16(centralParts.length),
      uint16(centralParts.length),
      uint32(centralDirectory.length),
      uint32(localOffset),
      uint16(0),
    ]);
    return joinBytes([...localParts, centralDirectory, end]);
  }

  const HelmChartBuilder = {
    BASE_EXAMPLE,
    buildChart,
    createZip,
    parseAnnotations,
    parseEnvironment,
    validateConfig,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = HelmChartBuilder;
  }
  if (typeof document === "undefined") return;

  const form = document.querySelector("#builder-form");
  const fileList = document.querySelector("#file-list");
  const fileOutput = document.querySelector("#file-output");
  const validationSummary = document.querySelector("#validation-summary");
  const chartStatus = document.querySelector("#chart-status");
  const downloadButton = document.querySelector("#download-button");
  const copyButton = document.querySelector("#copy-button");
  const toast = document.querySelector("#toast");
  let currentChart = null;
  let selectedFile = "Chart.yaml";
  let refreshTimer;
  let toastTimer;

  const byId = (id) => document.getElementById(id);
  const checked = (id) => Boolean(byId(id)?.checked);
  const value = (id) => byId(id)?.value.trim() ?? "";
  const integerValue = (id) => Number.parseInt(value(id), 10);

  function configFromForm() {
    return {
      chartName: value("chart-name"),
      chartApiVersion: value("chart-api-version"),
      chartVersion: value("chart-version"),
      description: value("description"),
      appVersion: value("app-version"),
      kubeVersion: value("kube-version"),
      maintainerName: value("maintainer-name"),
      sourceUrl: value("source-url"),
      workloadKind:
        form.querySelector('input[name="workloadKind"]:checked')?.value ?? "Deployment",
      imageRepository: value("image-repository"),
      imageTag: value("image-tag"),
      imagePullPolicy: value("image-pull-policy"),
      replicaCount: integerValue("replica-count"),
      containerPort: integerValue("container-port"),
      environment: byId("environment").value,
      serviceEnabled: checked("service-enabled"),
      serviceType: value("service-type"),
      servicePort: integerValue("service-port"),
      serviceAnnotations: byId("service-annotations").value,
      ingressEnabled: checked("ingress-enabled"),
      ingressHostEnabled: checked("ingress-host-enabled"),
      ingressClassName: value("ingress-class-name"),
      ingressHost: value("ingress-host"),
      ingressPath: value("ingress-path"),
      ingressAnnotations: byId("ingress-annotations").value,
      autoscalingEnabled: checked("autoscaling-enabled"),
      autoscalingMin: integerValue("autoscaling-min"),
      autoscalingMax: integerValue("autoscaling-max"),
      autoscalingCpu: integerValue("autoscaling-cpu"),
      pdbEnabled: checked("pdb-enabled"),
      pdbMinAvailable: value("pdb-min-available"),
      serviceAccountCreate: checked("service-account-create"),
      serviceAccountAnnotations: byId("service-account-annotations").value,
      cpuRequest: value("cpu-request"),
      memoryRequest: value("memory-request"),
      cpuLimit: value("cpu-limit"),
      memoryLimit: value("memory-limit"),
      readinessEnabled: checked("readiness-enabled"),
      livenessEnabled: checked("liveness-enabled"),
      probePath: value("probe-path"),
    };
  }

  function fillForm(config) {
    Object.entries(config).forEach(([name, entry]) => {
      const controls = form.querySelectorAll(`[name="${name}"]`);
      controls.forEach((control) => {
        if (control.type === "radio") {
          control.checked = control.value === String(entry);
        } else if (control.type === "checkbox") {
          control.checked = Boolean(entry);
        } else {
          control.value = entry;
        }
      });
    });
    syncControls();
  }

  function syncOptionPanels() {
    document.querySelectorAll("[data-option-panel]").forEach((panel) => {
      const controller = byId(panel.dataset.optionPanel);
      panel.classList.toggle("is-hidden", !controller?.checked);
    });
  }

  function syncKindAvailability() {
    const kind = form.querySelector('input[name="workloadKind"]:checked')?.value;
    const isDaemonSet = kind === "DaemonSet";
    const isStatefulSet = kind === "StatefulSet";
    byId("replica-count").disabled = isDaemonSet;
    byId("replica-field").setAttribute("aria-disabled", String(isDaemonSet));
    byId("service-type").disabled = isStatefulSet;
    if (isStatefulSet) byId("service-type").value = "ClusterIP";

    [
      ["autoscaling-enabled", "autoscaling-option"],
      ["pdb-enabled", "pdb-option"],
    ].forEach(([controlId, cardId]) => {
      const control = byId(controlId);
      control.disabled = isDaemonSet;
      if (isDaemonSet) control.checked = false;
      byId(cardId).classList.toggle("is-unavailable", isDaemonSet);
    });
  }

  function syncControls() {
    syncKindAvailability();
    syncOptionPanels();
    const ingressHostEnabled = checked("ingress-host-enabled");
    byId("ingress-host").disabled = !ingressHostEnabled;
    byId("ingress-host-field").setAttribute(
      "aria-disabled",
      String(!ingressHostEnabled),
    );
    byId("chart-v3-warning").classList.toggle(
      "is-hidden",
      value("chart-api-version") !== "v3",
    );
  }

  function clearValidation() {
    form.querySelectorAll('[aria-invalid="true"]').forEach((control) => {
      control.removeAttribute("aria-invalid");
    });
    validationSummary.classList.add("is-hidden");
    validationSummary.replaceChildren();
  }

  function showValidation(errors, { focusFirst = true } = {}) {
    clearValidation();
    const strong = document.createElement("strong");
    strong.textContent = `Fix ${errors.length} issue${errors.length === 1 ? "" : "s"} to generate the chart.`;
    const list = document.createElement("ul");
    errors.forEach((error) => {
      const item = document.createElement("li");
      item.textContent = error.message;
      list.append(item);
      const control = byId(error.field);
      if (control) control.setAttribute("aria-invalid", "true");
    });
    validationSummary.append(strong, list);
    validationSummary.classList.remove("is-hidden");
    chartStatus.textContent = "Needs input";
    chartStatus.classList.add("has-error");
    chartStatus.classList.remove("is-pending");
    downloadButton.disabled = true;
    copyButton.disabled = true;
    if (focusFirst && errors[0]) byId(errors[0].field)?.focus();
  }

  function formatBytes(valueToFormat) {
    if (valueToFormat < 1024) return `${valueToFormat} B`;
    return `${(valueToFormat / 1024).toFixed(1)} KB`;
  }

  function displayFiles() {
    if (!currentChart) return {};
    return {
      ...currentChart.files,
      "[preview]/rendered-manifests.yaml": currentChart.preview,
    };
  }

  function selectFile(path) {
    const files = displayFiles();
    if (!Object.hasOwn(files, path)) return;
    selectedFile = path;
    fileOutput.textContent = files[path];
    byId("selected-file-name").textContent = path;
    byId("selected-file-size").textContent = formatBytes(encoder.encode(files[path]).length);
    fileList.querySelectorAll("button").forEach((button) => {
      button.setAttribute("aria-current", String(button.dataset.file === path));
    });
  }

  function renderChartBrowser() {
    const files = displayFiles();
    fileList.replaceChildren();
    Object.keys(files).forEach((path) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.file = path;
      button.textContent = path;
      button.title = path;
      button.setAttribute("aria-current", "false");
      button.addEventListener("click", () => selectFile(path));
      item.append(button);
      fileList.append(item);
    });

    byId("chart-root-name").textContent = `${currentChart.root}/`;
    byId("file-count").textContent = `${Object.keys(currentChart.files).length} chart files + preview`;
    byId("verify-command").textContent =
      currentChart.apiVersion === "v3"
        ? `HELM_EXPERIMENTAL_CHART_V3=1 helm lint ./${currentChart.root}`
        : `helm lint ./${currentChart.root}`;
    if (!Object.hasOwn(files, selectedFile)) selectedFile = "Chart.yaml";
    selectFile(selectedFile);
  }

  function cancelScheduledGeneration() {
    if (refreshTimer === undefined) return;
    window.clearTimeout(refreshTimer);
    refreshTimer = undefined;
  }

  function generateChart({ announce = false, focusErrors = true } = {}) {
    cancelScheduledGeneration();
    syncControls();
    const config = configFromForm();
    const errors = validateConfig(config);
    if (errors.length) {
      showValidation(errors, { focusFirst: focusErrors });
      return false;
    }

    clearValidation();
    currentChart = buildChart(config);
    renderChartBrowser();
    chartStatus.textContent = `Ready · ${config.chartApiVersion}`;
    chartStatus.classList.remove("has-error", "is-pending");
    downloadButton.disabled = false;
    copyButton.disabled = false;
    if (announce) showToast(`Generated ${currentChart.root} with ${Object.keys(currentChart.files).length} files.`);
    return true;
  }

  async function copyText(textToCopy) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(textToCopy);
      return;
    }
    const temporary = document.createElement("textarea");
    temporary.value = textToCopy;
    temporary.setAttribute("readonly", "");
    temporary.style.position = "fixed";
    temporary.style.opacity = "0";
    document.body.append(temporary);
    temporary.select();
    document.execCommand("copy");
    temporary.remove();
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add("is-visible");
    toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 2600);
  }

  function scheduleGeneration() {
    cancelScheduledGeneration();
    chartStatus.textContent = "Refresh in 2s";
    chartStatus.classList.remove("has-error");
    chartStatus.classList.add("is-pending");
    downloadButton.disabled = true;
    copyButton.disabled = true;
    refreshTimer = window.setTimeout(() => {
      refreshTimer = undefined;
      generateChart({ focusErrors: false });
    }, AUTO_REFRESH_DELAY);
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    generateChart({ announce: true });
  });

  form.addEventListener("input", (event) => {
    if (event.target.matches('input[type="checkbox"], input[type="radio"]')) syncControls();
    clearValidation();
    scheduleGeneration();
  });

  form.addEventListener("change", syncControls);

  byId("example-button").addEventListener("click", () => {
    fillForm(BASE_EXAMPLE);
    selectedFile = "Chart.yaml";
    generateChart();
    showToast("Base example generated and ready to download.");
  });

  copyButton.addEventListener("click", async () => {
    if (!currentChart) return;
    const content = displayFiles()[selectedFile];
    try {
      await copyText(content);
      showToast(`${selectedFile} copied.`);
    } catch (_error) {
      showToast("Copy failed. Select the file content and copy it manually.");
    }
  });

  byId("copy-command-button").addEventListener("click", async () => {
    if (!currentChart) return;
    const featureGate =
      currentChart.apiVersion === "v3"
        ? "export HELM_EXPERIMENTAL_CHART_V3=1\n"
        : "";
    const commands = `${featureGate}helm lint ./${currentChart.root}\nhelm template example ./${currentChart.root} --debug`;
    try {
      await copyText(commands);
      showToast("Verification commands copied.");
    } catch (_error) {
      showToast("Copy failed. Copy the command manually.");
    }
  });

  downloadButton.addEventListener("click", () => {
    if (!currentChart) return;
    const zip = createZip(currentChart.files, currentChart.root);
    const blob = new Blob([zip], { type: "application/zip" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${currentChart.root}-${currentChart.version}.zip`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(`${link.download} downloaded.`);
  });

  fillForm(BASE_EXAMPLE);
  generateChart();
})();
