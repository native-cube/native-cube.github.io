(() => {
  "use strict";

  if (typeof document === "undefined") return;

  const SUPPORTED_KINDS = new Set([
    "Role",
    "ClusterRole",
    "RoleBinding",
    "ClusterRoleBinding",
  ]);
  const BLOCKED_KINDS = new Set(["Secret"]);
  const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 };
  const MAP_LIMIT = 24;
  const SAMPLE = `# Example only — no cluster credentials or Secrets
apiVersion: v1
kind: ServiceAccount
metadata:
  name: catalog-api
  namespace: production
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: catalog-reader
  namespace: production
rules:
  - apiGroups: [""]
    resources: ["configmaps"]
    verbs: ["get", "list", "watch"]
  - apiGroups: [""]
    resources: ["pods/log"]
    verbs: ["get"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: catalog-reader
  namespace: production
subjects:
  - kind: ServiceAccount
    name: catalog-api
    namespace: production
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: catalog-reader
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: deployment-operator
rules:
  - apiGroups: ["apps"]
    resources: ["deployments"]
    verbs: ["get", "list", "watch", "patch", "update"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: deployment-operator
  namespace: production
subjects:
  - kind: Group
    name: platform-team
    apiGroup: rbac.authorization.k8s.io
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: deployment-operator
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: emergency-debugger
rules:
  - apiGroups: [""]
    resources: ["pods/exec"]
    verbs: ["create"]
  - apiGroups: [""]
    resources: ["secrets"]
    verbs: ["get", "list"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: emergency-debugger
subjects:
  - kind: Group
    name: on-call-engineers
    apiGroup: rbac.authorization.k8s.io
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: emergency-debugger
`;

  const byId = (id) => document.getElementById(id);
  const source = byId("rbac-source");
  const comparisonSource = byId("comparison-source");
  const sourceStatus = byId("source-status");
  const toast = byId("toast");
  let currentAnalysis = null;
  let showAllMap = false;
  let generatedYaml = "";
  let toastTimer;

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function array(value) {
    if (Array.isArray(value)) return value;
    return value === undefined || value === null ? [] : [value];
  }

  function unique(values) {
    return [...new Set(values)];
  }

  function plural(count, singular, pluralValue = `${singular}s`) {
    return count === 1 ? singular : pluralValue;
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2200);
  }

  function setSourceStatus(state, message) {
    sourceStatus.className = `source-status${state ? ` is-${state}` : ""}`;
    sourceStatus.textContent = message;
  }

  function parseDocuments(text) {
    if (!text.trim()) throw new Error("Paste or choose RBAC YAML or JSON first.");
    if (!window.jsyaml) throw new Error("The local YAML parser could not be loaded.");

    const parsed = [];
    try {
      window.jsyaml.loadAll(text, (documentValue) => {
        if (documentValue !== undefined && documentValue !== null) parsed.push(documentValue);
      });
    } catch (error) {
      const location = error.mark
        ? ` at line ${error.mark.line + 1}, column ${error.mark.column + 1}`
        : "";
      throw new Error(`${error.reason || error.message}${location}`);
    }

    if (!parsed.length) throw new Error("No YAML or JSON documents were found.");

    const flattened = [];
    parsed.forEach((documentValue) => {
      if (Array.isArray(documentValue)) {
        flattened.push(...documentValue);
      } else if (
        documentValue?.kind === "List" &&
        Array.isArray(documentValue.items)
      ) {
        flattened.push(...documentValue.items);
      } else {
        flattened.push(documentValue);
      }
    });

    const invalid = flattened.find(
      (item) => !item || typeof item !== "object" || Array.isArray(item),
    );
    if (invalid) throw new Error("Each document must be a Kubernetes object.");

    const blocked = flattened.find((item) => BLOCKED_KINDS.has(item.kind));
    if (blocked) {
      throw new Error(
        "Secret input is blocked. Export only RBAC objects; never paste credentials or tokens.",
      );
    }

    const objects = flattened.filter((item) => SUPPORTED_KINDS.has(item.kind));
    if (!objects.length) {
      throw new Error(
        "No supported RBAC objects found. Include a Role, ClusterRole, RoleBinding, or ClusterRoleBinding.",
      );
    }

    return {
      documents: flattened,
      objects,
      ignored: flattened.length - objects.length,
    };
  }

  function objectName(object) {
    return String(object?.metadata?.name || "").trim();
  }

  function objectNamespace(object) {
    return String(object?.metadata?.namespace || "default").trim() || "default";
  }

  function roleKey(kind, name, namespace) {
    return kind === "ClusterRole"
      ? `ClusterRole::${name}`
      : `Role:${namespace}:${name}`;
  }

  function normalizeRule(rule) {
    return {
      apiGroups: array(rule?.apiGroups).map(String),
      resources: array(rule?.resources).map(String),
      verbs: array(rule?.verbs).map(String),
      resourceNames: array(rule?.resourceNames).map(String),
      nonResourceURLs: array(rule?.nonResourceURLs).map(String),
    };
  }

  function labelSelectorMatches(labels, selector) {
    const matchLabels = selector?.matchLabels || {};
    if (
      Object.entries(matchLabels).some(([key, value]) => labels[key] !== String(value))
    ) {
      return false;
    }

    return array(selector?.matchExpressions).every((expression) => {
      const key = String(expression?.key || "");
      const operator = String(expression?.operator || "");
      const values = array(expression?.values).map(String);
      const present = Object.prototype.hasOwnProperty.call(labels, key);
      if (operator === "In") return present && values.includes(labels[key]);
      if (operator === "NotIn") return !present || !values.includes(labels[key]);
      if (operator === "Exists") return present;
      if (operator === "DoesNotExist") return !present;
      return false;
    });
  }

  function normalizeSubject(subject, bindingNamespace) {
    const kind = String(subject?.kind || "").trim();
    const name = String(subject?.name || "").trim();
    const namespace =
      kind === "ServiceAccount"
        ? String(subject?.namespace || bindingNamespace || "default").trim()
        : "";
    return { kind, name, namespace };
  }

  function subjectKey(subject) {
    return subject.kind === "ServiceAccount"
      ? `${subject.kind}:${subject.namespace}:${subject.name}`
      : `${subject.kind}:${subject.name}`;
  }

  function subjectLabel(subject) {
    return subject.kind === "ServiceAccount"
      ? `${subject.namespace}/${subject.name}`
      : subject.name;
  }

  function scopeLabel(grant) {
    return grant.scope === "cluster" ? "Cluster-wide" : grant.namespace;
  }

  function analyzeParsed(parsed) {
    const roles = [];
    const bindings = [];
    const duplicateRoles = [];
    const roleIndex = new Map();

    parsed.objects.forEach((object) => {
      const name = objectName(object);
      if (!name) return;

      if (object.kind === "Role" || object.kind === "ClusterRole") {
        const namespace = object.kind === "Role" ? objectNamespace(object) : "";
        const role = {
          kind: object.kind,
          name,
          namespace,
          labels: Object.fromEntries(
            Object.entries(object.metadata?.labels || {}).map(([key, value]) => [
              key,
              String(value),
            ]),
          ),
          aggregationSelectors: array(
            object.kind === "ClusterRole"
              ? object.aggregationRule?.clusterRoleSelectors
              : [],
          ),
          rules: array(object.rules).map(normalizeRule),
        };
        const key = roleKey(role.kind, role.name, role.namespace);
        if (roleIndex.has(key)) duplicateRoles.push(role);
        roleIndex.set(key, role);
        roles.push(role);
      }

      if (object.kind === "RoleBinding" || object.kind === "ClusterRoleBinding") {
        const namespace = object.kind === "RoleBinding" ? objectNamespace(object) : "";
        bindings.push({
          kind: object.kind,
          name,
          namespace,
          roleRef: {
            kind: String(object.roleRef?.kind || "").trim(),
            name: String(object.roleRef?.name || "").trim(),
          },
          subjects: array(object.subjects)
            .map((subject) => normalizeSubject(subject, namespace))
            .filter((subject) => subject.kind && subject.name),
        });
      }
    });

    const indexedRoles = [...roleIndex.values()];
    function resolveEffectiveRules(role, visiting = new Set()) {
      const key = roleKey(role.kind, role.name, role.namespace);
      if (role.effectiveRules) return role.effectiveRules;
      if (visiting.has(key)) return role.rules;
      visiting.add(key);

      const rules = [...role.rules];
      role.aggregationSources = [];
      if (role.kind === "ClusterRole" && role.aggregationSelectors.length) {
        indexedRoles
          .filter(
            (candidate) =>
              candidate !== role &&
              candidate.kind === "ClusterRole" &&
              role.aggregationSelectors.some((selector) =>
                labelSelectorMatches(candidate.labels, selector),
              ),
          )
          .forEach((candidate) => {
            role.aggregationSources.push(candidate.name);
            rules.push(...resolveEffectiveRules(candidate, new Set(visiting)));
          });
      }

      const signatures = new Set();
      role.effectiveRules = rules.filter((rule) => {
        const signature = JSON.stringify(rule);
        if (signatures.has(signature)) return false;
        signatures.add(signature);
        return true;
      });
      return role.effectiveRules;
    }
    indexedRoles.forEach((role) => resolveEffectiveRules(role));

    const unresolved = [];
    const grants = [];
    bindings.forEach((binding) => {
      const referenceNamespace =
        binding.roleRef.kind === "Role" ? binding.namespace : "";
      const key = roleKey(
        binding.roleRef.kind,
        binding.roleRef.name,
        referenceNamespace,
      );
      const role = roleIndex.get(key);
      if (!role) {
        unresolved.push({ binding, key });
        return;
      }

      binding.subjects.forEach((subject) => {
        role.effectiveRules.forEach((rule, ruleIndex) => {
          grants.push({
            subject,
            binding,
            role,
            rule,
            ruleIndex,
            scope: binding.kind === "ClusterRoleBinding" ? "cluster" : "namespace",
            namespace: binding.kind === "RoleBinding" ? binding.namespace : "",
          });
        });
      });
    });

    const subjects = new Map();
    grants.forEach((grant) => subjects.set(subjectKey(grant.subject), grant.subject));
    bindings.forEach((binding) => {
      binding.subjects.forEach((subject) => subjects.set(subjectKey(subject), subject));
    });

    const findings = buildFindings({
      roles,
      bindings,
      grants,
      unresolved,
      duplicateRoles,
    });

    return {
      parsed,
      roles,
      bindings,
      grants,
      subjects: [...subjects.values()],
      unresolved,
      findings,
      duplicateRoles,
    };
  }

  function includesAny(values, candidates) {
    return values.some((value) => candidates.includes(value));
  }

  function findingKey(finding) {
    return [finding.type, finding.subject, finding.binding, finding.role].join("|");
  }

  function buildFindings(analysis) {
    const findings = [];
    const seen = new Set();

    function add(finding) {
      const key = findingKey(finding);
      if (seen.has(key)) return;
      seen.add(key);
      findings.push(finding);
    }

    analysis.unresolved.forEach(({ binding }) => {
      add({
        type: "unresolved-role",
        severity: "medium",
        title: "Binding references a missing role",
        detail: `${binding.kind} ${binding.name} cannot be evaluated because ${binding.roleRef.kind} ${binding.roleRef.name} is not included.`,
        subject: "",
        binding: binding.name,
        role: binding.roleRef.name,
        tags: [binding.kind, scopeLabel({ scope: binding.kind === "ClusterRoleBinding" ? "cluster" : "namespace", namespace: binding.namespace })],
      });
    });

    analysis.duplicateRoles.forEach((role) => {
      add({
        type: "duplicate-role",
        severity: "low",
        title: "Duplicate role definition",
        detail: `${role.kind} ${role.name} appears more than once. The final definition is used for this analysis.`,
        subject: "",
        binding: "",
        role: role.name,
        tags: [role.kind, role.namespace || "cluster"],
      });
    });

    analysis.roles.forEach((role) => {
      const signatures = new Set();
      role.rules.forEach((rule) => {
        const signature = JSON.stringify(rule);
        if (signatures.has(signature)) {
          add({
            type: "duplicate-rule",
            severity: "low",
            title: "Duplicate permission rule",
            detail: `${role.kind} ${role.name} contains an identical rule more than once.`,
            subject: "",
            binding: "",
            role: role.name,
            tags: [role.kind, role.namespace || "cluster"],
          });
        }
        signatures.add(signature);
      });
    });

    analysis.roles
      .filter(
        (role) =>
          role.aggregationSelectors.length &&
          !role.aggregationSources.length &&
          !role.effectiveRules.length,
      )
      .forEach((role) => {
        add({
          type: "unresolved-aggregation",
          severity: "medium",
          title: "Aggregated ClusterRole is incomplete",
          detail: `ClusterRole ${role.name} selects other ClusterRoles, but no matching labeled roles or populated rules are included.`,
          subject: "",
          binding: "",
          role: role.name,
          tags: ["ClusterRole", "aggregationRule"],
        });
      });

    analysis.grants.forEach((grant) => {
      const { rule, subject, binding, role } = grant;
      const subjectName = subjectLabel(subject);
      const base = {
        subject: subjectName,
        binding: binding.name,
        role: role.name,
        tags: [subject.kind, binding.kind, scopeLabel(grant)],
      };

      if (
        rule.verbs.includes("*") &&
        (rule.resources.includes("*") || rule.nonResourceURLs.includes("*")) &&
        grant.scope === "cluster"
      ) {
        add({
          ...base,
          type: "cluster-admin-equivalent",
          severity: "critical",
          title: "Cluster-wide wildcard administration",
          detail: `${subject.kind} ${subjectName} receives wildcard actions on wildcard targets through ${binding.name}. This is broadly equivalent to unrestricted cluster access.`,
        });
      } else if (rule.verbs.includes("*") || rule.resources.includes("*")) {
        add({
          ...base,
          type: "wildcard-permission",
          severity: grant.scope === "cluster" ? "high" : "medium",
          title: "Wildcard permission",
          detail: `${subject.kind} ${subjectName} receives wildcard ${rule.verbs.includes("*") ? "verbs" : "resources"} at ${scopeLabel(grant)} scope. Wildcards also include future API capabilities.`,
        });
      }

      if (rule.resources.includes("secrets") && includesAny(rule.verbs, ["get", "list", "watch", "*"])) {
        add({
          ...base,
          type: "secret-read",
          severity: grant.scope === "cluster" ? "high" : "medium",
          title: "Secret data can be read",
          detail: `${subject.kind} ${subjectName} can read Secret resources at ${scopeLabel(grant)} scope. Secret access can expose service credentials and tokens.`,
        });
      }

      if (rule.resources.includes("secrets") && includesAny(rule.verbs, ["create", "update", "patch", "delete", "*"])) {
        add({
          ...base,
          type: "secret-write",
          severity: "high",
          title: "Secret data can be modified",
          detail: `${subject.kind} ${subjectName} can change Secret resources at ${scopeLabel(grant)} scope.`,
        });
      }

      if (rule.resources.includes("pods/exec") && includesAny(rule.verbs, ["create", "*"])) {
        add({
          ...base,
          type: "pod-exec",
          severity: grant.scope === "cluster" ? "high" : "medium",
          title: "Interactive pod execution",
          detail: `${subject.kind} ${subjectName} can execute commands in pods at ${scopeLabel(grant)} scope.`,
        });
      }

      if (includesAny(rule.verbs, ["impersonate", "bind", "escalate"])) {
        const sensitiveVerbs = rule.verbs.filter((verb) =>
          ["impersonate", "bind", "escalate", "*"].includes(verb),
        );
        add({
          ...base,
          type: "escalation-verb",
          severity: "critical",
          title: "Privilege escalation capability",
          detail: `${subject.kind} ${subjectName} receives ${sensitiveVerbs.join(", ")} through ${binding.name}. These verbs can enable access beyond ordinary resource operations.`,
        });
      }

      if (
        includesAny(rule.resources, ["roles", "clusterroles", "rolebindings", "clusterrolebindings", "*"]) &&
        includesAny(rule.verbs, ["create", "update", "patch", "delete", "*"])
      ) {
        add({
          ...base,
          type: "rbac-write",
          severity: grant.scope === "cluster" ? "critical" : "high",
          title: "RBAC policy can be changed",
          detail: `${subject.kind} ${subjectName} can modify RBAC resources at ${scopeLabel(grant)} scope.`,
        });
      }

      if (
        grant.scope === "cluster" &&
        includesAny(rule.verbs, ["create", "update", "patch", "delete", "*"]) &&
        includesAny(rule.resources, ["deployments", "statefulsets", "daemonsets", "pods", "jobs", "cronjobs", "*"])
      ) {
        add({
          ...base,
          type: "cluster-workload-write",
          severity: "high",
          title: "Workloads can be modified cluster-wide",
          detail: `${subject.kind} ${subjectName} can change workloads across namespaces. Workload writes can indirectly access mounted identities and data.`,
        });
      }

      if (
        subject.kind === "Group" &&
        ["system:authenticated", "system:unauthenticated"].includes(subject.name)
      ) {
        add({
          ...base,
          type: "broad-system-group",
          severity: subject.name === "system:unauthenticated" ? "critical" : "high",
          title: "Permission granted to a broad system group",
          detail: `${subject.name} receives access through ${binding.name}; this group can represent a very large population.`,
        });
      }
    });

    return findings.sort((left, right) => {
      const rank = SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity];
      return rank || left.title.localeCompare(right.title);
    });
  }

  function analyzeText(text) {
    return analyzeParsed(parseDocuments(text));
  }

  function roleDisplay(role) {
    return role.kind === "Role" ? `${role.namespace}/${role.name}` : role.name;
  }

  function ruleTarget(rule) {
    if (rule.nonResourceURLs.length) return rule.nonResourceURLs.join(", ");
    const groups = rule.apiGroups.length ? rule.apiGroups : [""];
    return rule.resources
      .map((resource) => {
        const group = groups[0];
        return group ? `${resource}.${group}` : resource;
      })
      .join(", ");
  }

  function setText(id, value) {
    byId(id).textContent = String(value);
  }

  function grantCanWrite(grant) {
    return includesAny(grant.rule.verbs, [
      "create",
      "update",
      "patch",
      "delete",
      "deletecollection",
      "bind",
      "escalate",
      "impersonate",
      "*",
    ]);
  }

  function grantIsSensitive(grant) {
    return (
      grant.rule.verbs.includes("*") ||
      grant.rule.resources.includes("*") ||
      includesAny(grant.rule.verbs, ["bind", "escalate", "impersonate"]) ||
      includesAny(grant.rule.resources, [
        "secrets",
        "pods/exec",
        "serviceaccounts/token",
      ])
    );
  }

  function grantCanAdministerRbac(grant) {
    return (
      includesAny(grant.rule.resources, [
        "roles",
        "clusterroles",
        "rolebindings",
        "clusterrolebindings",
        "*",
      ]) &&
      includesAny(grant.rule.verbs, [
        "create",
        "update",
        "patch",
        "delete",
        "bind",
        "escalate",
        "*",
      ])
    );
  }

  function subjectKeysFor(grants) {
    return new Set(grants.map((grant) => subjectKey(grant.subject)));
  }

  function subjectExposure(analysis) {
    const findingsBySubject = new Map();
    analysis.findings.forEach((finding) => {
      if (!finding.subject) return;
      const current = findingsBySubject.get(finding.subject) || [];
      current.push(finding);
      findingsBySubject.set(finding.subject, current);
    });

    return analysis.subjects.map((subject) => {
      const key = subjectKey(subject);
      const grants = analysis.grants.filter(
        (grant) => subjectKey(grant.subject) === key,
      );
      const clusterWide = grants.filter((grant) => grant.scope === "cluster").length;
      const write = grants.filter(grantCanWrite).length;
      const sensitive = grants.filter(grantIsSensitive).length;
      const rbacAdmin = grants.filter(grantCanAdministerRbac).length;
      const findings = findingsBySubject.get(subjectLabel(subject)) || [];
      const critical = findings.filter((finding) => finding.severity === "critical").length;
      const high = findings.filter((finding) => finding.severity === "high").length;
      const score =
        clusterWide * 4 +
        write * 2 +
        sensitive * 4 +
        rbacAdmin * 5 +
        critical * 8 +
        high * 4 +
        grants.length;
      return {
        subject,
        grants,
        clusterWide,
        write,
        sensitive,
        rbacAdmin,
        findings,
        score,
      };
    }).sort((left, right) => right.score - left.score ||
      subjectLabel(left.subject).localeCompare(subjectLabel(right.subject)));
  }

  function renderPosture(analysis, highRisk, critical) {
    const banner = byId("posture-banner");
    if (critical) {
      banner.className = "posture-banner is-critical";
      setText("posture-icon", "!");
      setText("posture-title", "Critical privilege paths need review");
      setText(
        "posture-copy",
        `${critical} critical ${plural(critical, "signal")} detected, including escalation or unrestricted access.`,
      );
    } else if (highRisk) {
      banner.className = "posture-banner is-review";
      setText("posture-icon", "!");
      setText("posture-title", "Broad access needs review");
      setText(
        "posture-copy",
        `${highRisk} high-risk ${plural(highRisk, "signal")} detected in the supplied policy.`,
      );
    } else if (analysis.unresolved.length) {
      banner.className = "posture-banner is-review";
      setText("posture-icon", "?");
      setText("posture-title", "Analysis is incomplete");
      setText(
        "posture-copy",
        `${analysis.unresolved.length} binding ${plural(analysis.unresolved.length, "reference")} could not be resolved.`,
      );
    } else {
      banner.className = "posture-banner";
      setText("posture-icon", "✓");
      setText("posture-title", "No high-risk grants detected");
      setText(
        "posture-copy",
        "The included policy has no critical or high deterministic review signals.",
      );
    }
  }

  function renderAccessComposition(analysis) {
    const total = analysis.grants.length;
    const rows = [
      {
        label: "Namespace-scoped",
        count: analysis.grants.filter((grant) => grant.scope === "namespace").length,
        className: "",
      },
      {
        label: "Cluster-wide",
        count: analysis.grants.filter((grant) => grant.scope === "cluster").length,
        className: "is-cluster",
      },
      {
        label: "Write-capable",
        count: analysis.grants.filter(grantCanWrite).length,
        className: "is-write",
      },
      {
        label: "Sensitive",
        count: analysis.grants.filter(grantIsSensitive).length,
        className: "is-sensitive",
      },
    ];
    setText("grant-total", total);
    byId("access-composition").innerHTML = rows.map((row) => {
      const percentage = total ? Math.round((row.count / total) * 100) : 0;
      return `
        <div class="composition-row ${row.className}">
          <span>${escapeHtml(row.label)}</span>
          <div class="composition-track" aria-hidden="true"><i style="width: ${percentage}%"></i></div>
          <strong aria-label="${row.count} of ${total} grant paths">${row.count}</strong>
        </div>
      `;
    }).join("");
  }

  function renderTopSubjects(exposures) {
    const container = byId("top-subjects");
    if (!exposures.length) {
      container.innerHTML = '<p class="overview-clear">No bound subjects were found.</p>';
      return;
    }

    container.innerHTML = exposures.slice(0, 3).map((exposure) => {
      const labels = [];
      if (exposure.clusterWide) labels.push(`${exposure.clusterWide} cluster-wide`);
      if (exposure.write) labels.push(`${exposure.write} write`);
      if (exposure.sensitive) labels.push(`${exposure.sensitive} sensitive`);
      if (!labels.length && exposure.grants.length) {
        labels.push(`${exposure.grants.length} read-only`);
      }
      if (!labels.length) labels.push("No resolved grants");
      const highExposure = exposure.sensitive || exposure.rbacAdmin ||
        exposure.findings.some((finding) => ["critical", "high"].includes(finding.severity));
      return `
        <div class="subject-exposure">
          <div>
            <strong>${escapeHtml(subjectLabel(exposure.subject))}</strong>
            <small>${escapeHtml(exposure.subject.kind)} · ${escapeHtml(labels.join(" · "))}</small>
          </div>
          <span class="exposure-score${highExposure ? " is-high" : ""}">${exposure.grants.length} ${plural(exposure.grants.length, "path")}</span>
        </div>
      `;
    }).join("");
  }

  function renderOverviewFindings(analysis) {
    const container = byId("overview-findings");
    if (!analysis.findings.length) {
      container.innerHTML = '<p class="overview-clear">No deterministic review signals were found. Continue with the permission matrix for a least-privilege review.</p>';
      return;
    }
    container.innerHTML = analysis.findings.slice(0, 2).map((finding) => `
      <article class="overview-finding">
        <span class="severity severity-${escapeHtml(finding.severity)}">${escapeHtml(finding.severity)}</span>
        <div>
          <strong>${escapeHtml(finding.title)}</strong>
          <small>${escapeHtml(finding.subject || finding.role || finding.binding || "Policy-wide")}</small>
        </div>
      </article>
    `).join("");
  }

  function renderSummary(analysis) {
    const clusterSubjects = subjectKeysFor(
      analysis.grants.filter((grant) => grant.scope === "cluster"),
    );
    const writeSubjects = subjectKeysFor(analysis.grants.filter(grantCanWrite));
    const sensitiveSubjects = subjectKeysFor(analysis.grants.filter(grantIsSensitive));
    const rbacAdminSubjects = subjectKeysFor(
      analysis.grants.filter(grantCanAdministerRbac),
    );
    const critical = analysis.findings.filter(
      (finding) => finding.severity === "critical",
    ).length;
    const highRisk = analysis.findings.filter(
      (finding) => finding.severity === "high",
    ).length;
    const sensitiveCapabilities = [];
    if (analysis.grants.some((grant) => grant.rule.resources.includes("secrets"))) {
      sensitiveCapabilities.push("Secrets");
    }
    if (analysis.grants.some((grant) => grant.rule.resources.includes("pods/exec"))) {
      sensitiveCapabilities.push("pod exec");
    }
    if (analysis.grants.some((grant) =>
      grant.rule.verbs.includes("*") || grant.rule.resources.includes("*"),
    )) {
      sensitiveCapabilities.push("wildcards");
    }
    if (analysis.grants.some((grant) =>
      includesAny(grant.rule.verbs, ["bind", "escalate", "impersonate"]),
    )) {
      sensitiveCapabilities.push("escalation");
    }
    const clusterPaths = analysis.grants.filter((grant) => grant.scope === "cluster").length;
    const writePaths = analysis.grants.filter(grantCanWrite).length;
    const rbacPaths = analysis.grants.filter(grantCanAdministerRbac).length;
    const cards = [
      [
        "cluster-exposure-card",
        "cluster-subject-count",
        "cluster-subject-detail",
        clusterSubjects.size,
        clusterSubjects.size
          ? `${clusterPaths} cluster-wide ${plural(clusterPaths, "path")}`
          : "None detected",
      ],
      [
        "write-exposure-card",
        "write-subject-count",
        "write-subject-detail",
        writeSubjects.size,
        writeSubjects.size
          ? `${writePaths} write ${plural(writePaths, "path")}`
          : "None detected",
      ],
      [
        "sensitive-exposure-card",
        "sensitive-subject-count",
        "sensitive-subject-detail",
        sensitiveSubjects.size,
        sensitiveSubjects.size
          ? sensitiveCapabilities.join(" · ")
          : "Secrets, exec, or wildcards",
      ],
      [
        "rbac-exposure-card",
        "rbac-admin-count",
        "rbac-admin-detail",
        rbacAdminSubjects.size,
        rbacAdminSubjects.size
          ? `${rbacPaths} administrative ${plural(rbacPaths, "path")}`
          : "None detected",
      ],
    ];

    cards.forEach(([cardId, countId, detailId, count, detail]) => {
      setText(countId, count);
      setText(detailId, detail);
      byId(cardId).classList.toggle("has-risk", count > 0 &&
        ["sensitive-exposure-card", "rbac-exposure-card"].includes(cardId));
    });

    renderPosture(analysis, highRisk, critical);
    renderAccessComposition(analysis);
    renderTopSubjects(subjectExposure(analysis));
    renderOverviewFindings(analysis);

    const unresolved = analysis.unresolved.length;
    const coverageStrip = byId("coverage-strip");
    coverageStrip.classList.toggle("has-gap", unresolved > 0);
    setText(
      "coverage-title",
      unresolved
        ? `${unresolved} unresolved role ${plural(unresolved, "reference")}`
        : "All binding references resolved",
    );
    setText(
      "coverage-detail",
      `${analysis.parsed.objects.length} RBAC ${plural(analysis.parsed.objects.length, "object")} analyzed · ${analysis.parsed.ignored} ignored`,
    );
    setText("coverage-subjects", analysis.subjects.length);
    setText("coverage-roles", analysis.roles.length);
    setText("coverage-bindings", analysis.bindings.length);
    setText("tab-finding-count", analysis.findings.length);
  }

  function filteredGrants(searchValue = "") {
    if (!currentAnalysis) return [];
    const search = searchValue.trim().toLowerCase();
    if (!search) return currentAnalysis.grants;
    return currentAnalysis.grants.filter((grant) =>
      [
        grant.subject.kind,
        subjectLabel(grant.subject),
        grant.binding.kind,
        grant.binding.name,
        scopeLabel(grant),
        grant.role.kind,
        roleDisplay(grant.role),
        ruleTarget(grant.rule),
        grant.rule.verbs.join(" "),
      ].join(" ").toLowerCase().includes(search),
    );
  }

  function renderAccessMap() {
    const container = byId("access-map");
    const grants = filteredGrants(byId("map-search").value);
    const visible = showAllMap ? grants : grants.slice(0, MAP_LIMIT);
    if (!visible.length) {
      container.innerHTML = '<p class="empty-results">No grant paths match this filter.</p>';
    } else {
      container.innerHTML = visible.map((grant) => `
        <article class="access-path">
          <div class="path-node">
            <span>${escapeHtml(grant.subject.kind)}</span>
            <strong>${escapeHtml(subjectLabel(grant.subject))}</strong>
          </div>
          <b class="path-arrow" aria-hidden="true">→</b>
          <div class="path-node">
            <span>${escapeHtml(grant.binding.kind)} · ${escapeHtml(scopeLabel(grant))}</span>
            <strong>${escapeHtml(grant.binding.name)}</strong>
          </div>
          <b class="path-arrow" aria-hidden="true">→</b>
          <div class="path-node">
            <span>${escapeHtml(grant.role.kind)}</span>
            <strong>${escapeHtml(roleDisplay(grant.role))}</strong>
          </div>
          <b class="path-arrow" aria-hidden="true">→</b>
          <div class="path-node">
            <span>${grant.rule.resourceNames.length ? `Named: ${escapeHtml(grant.rule.resourceNames.join(", "))}` : "Resources"}</span>
            <code>${escapeHtml(ruleTarget(grant.rule) || "No resource targets")}</code>
            <div class="permission-pills">${grant.rule.verbs.map((verb) => `<span>${escapeHtml(verb)}</span>`).join("")}</div>
          </div>
        </article>
      `).join("");
    }

    const showMore = byId("show-more-map");
    showMore.hidden = grants.length <= MAP_LIMIT;
    showMore.textContent = showAllMap
      ? "Show fewer paths"
      : `Show all ${grants.length} paths`;
  }

  function renderPermissions() {
    const search = byId("permission-search").value.trim().toLowerCase();
    const kind = byId("subject-kind-filter").value;
    let grants = currentAnalysis ? currentAnalysis.grants : [];
    if (kind !== "all") grants = grants.filter((grant) => grant.subject.kind === kind);
    if (search) {
      grants = grants.filter((grant) =>
        [
          grant.subject.kind,
          subjectLabel(grant.subject),
          scopeLabel(grant),
          grant.binding.name,
          roleDisplay(grant.role),
          ruleTarget(grant.rule),
          grant.rule.verbs.join(" "),
        ].join(" ").toLowerCase().includes(search),
      );
    }

    byId("permission-rows").innerHTML = grants.length
      ? grants.map((grant) => `
          <tr>
            <td><span class="cell-title">${escapeHtml(subjectLabel(grant.subject))}</span><span class="cell-detail">${escapeHtml(grant.subject.kind)}</span></td>
            <td><span class="cell-title">${escapeHtml(scopeLabel(grant))}</span><span class="cell-detail">${escapeHtml(grant.scope)}</span></td>
            <td><span class="cell-title">${escapeHtml(grant.binding.name)}</span><span class="cell-detail">${escapeHtml(grant.role.kind)} ${escapeHtml(roleDisplay(grant.role))}</span></td>
            <td><code>${escapeHtml(ruleTarget(grant.rule) || "—")}</code>${grant.rule.resourceNames.length ? `<span class="cell-detail">Names: ${escapeHtml(grant.rule.resourceNames.join(", "))}</span>` : ""}</td>
            <td><code>${escapeHtml(grant.rule.verbs.join(", ") || "—")}</code></td>
          </tr>
        `).join("")
      : '<tr><td colspan="5"><p class="empty-results">No effective permissions match these filters.</p></td></tr>';
    setText(
      "permission-total",
      `${grants.length} ${plural(grants.length, "grant path")} shown`,
    );
  }

  function renderFindings() {
    const filter = byId("severity-filter").value;
    const findings = currentAnalysis
      ? currentAnalysis.findings.filter(
          (finding) => filter === "all" || finding.severity === filter,
        )
      : [];
    byId("finding-list").innerHTML = findings.length
      ? findings.map((finding) => `
          <article class="finding-card">
            <span class="severity severity-${escapeHtml(finding.severity)}">${escapeHtml(finding.severity)}</span>
            <div>
              <h4>${escapeHtml(finding.title)}</h4>
              <p>${escapeHtml(finding.detail)}</p>
              <div class="finding-tags">${finding.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>
            </div>
          </article>
        `).join("")
      : '<p class="empty-results">No review signals match this filter.</p>';
  }

  function resetQueryResult() {
    byId("query-result").className = "query-result is-idle";
    byId("query-result").innerHTML = `
      <div class="query-result-icon" aria-hidden="true">?</div>
      <div><h4>Ready for a question</h4><p>Describe an identity, action, and target to test effective RBAC access.</p></div>
    `;
    byId("generator-card").hidden = true;
    generatedYaml = "";
  }

  function renderAnalysis(analysis) {
    currentAnalysis = analysis;
    showAllMap = false;
    byId("empty-state").hidden = true;
    byId("analysis-content").hidden = false;
    byId("results").hidden = false;
    byId("analysis-state").textContent = "Analysis ready";
    byId("analysis-state").className = "analysis-state is-ready";
    renderSummary(analysis);
    renderAccessMap();
    renderPermissions();
    renderFindings();
    resetQueryResult();
  }

  function resetAnalysis() {
    currentAnalysis = null;
    byId("empty-state").hidden = false;
    byId("analysis-content").hidden = true;
    byId("results").hidden = true;
    byId("analysis-state").textContent = "Not analyzed";
    byId("analysis-state").className = "analysis-state is-idle";
    byId("comparison-result").className = "comparison-result is-idle";
    byId("comparison-result").innerHTML = `
      <div class="comparison-empty"><span aria-hidden="true">±</span><h4>No comparison yet</h4><p>New and removed subject permissions will appear here.</p></div>
    `;
  }

  function runAnalysis({ scroll = false } = {}) {
    try {
      const analysis = analyzeText(source.value);
      renderAnalysis(analysis);
      const ignoredMessage = analysis.parsed.ignored
        ? ` ${analysis.parsed.ignored} non-RBAC ${plural(analysis.parsed.ignored, "object")} ignored.`
        : "";
      setSourceStatus(
        "success",
        `Analyzed ${analysis.parsed.objects.length} RBAC ${plural(analysis.parsed.objects.length, "object")} and ${analysis.grants.length} effective ${plural(analysis.grants.length, "grant path")}.${ignoredMessage}`,
      );
      byId("source-format").textContent = "Valid RBAC";
      if (scroll) byId("results").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      resetAnalysis();
      setSourceStatus("error", error.message);
      byId("source-format").textContent = "Needs attention";
    }
  }

  function wildcardMatch(value, pattern) {
    if (pattern === "*") return true;
    if (pattern.endsWith("*")) return value.startsWith(pattern.slice(0, -1));
    return value === pattern;
  }

  function subjectMatches(grantSubject, query) {
    if (grantSubject.kind === query.kind) {
      if (grantSubject.name !== query.name) return false;
      if (query.kind === "ServiceAccount") {
        return grantSubject.namespace === query.subjectNamespace;
      }
      return true;
    }

    if (query.kind === "User" && grantSubject.kind === "Group") {
      return ["system:authenticated", ...query.groups].includes(grantSubject.name);
    }
    if (query.kind === "ServiceAccount" && grantSubject.kind === "Group") {
      return [
        "system:serviceaccounts",
        `system:serviceaccounts:${query.subjectNamespace}`,
        "system:authenticated",
      ].includes(grantSubject.name);
    }
    return false;
  }

  function ruleMatches(rule, query) {
    if (!rule.verbs.some((verb) => verb === "*" || verb === query.verb)) return false;
    if (!rule.resources.some((resource) => wildcardMatch(query.resource, resource))) return false;
    const apiGroups = rule.apiGroups.length ? rule.apiGroups : [""];
    if (!apiGroups.some((group) => group === "*" || group === query.apiGroup)) return false;
    if (rule.resourceNames.length) {
      if (query.verb === "deletecollection") return false;
      if (query.verb === "create" && !query.resource.includes("/")) return false;
      return Boolean(query.resourceName) && rule.resourceNames.includes(query.resourceName);
    }
    return true;
  }

  function scopeMatches(grant, query) {
    if (grant.scope === "cluster") return true;
    return query.scope === "namespace" && grant.namespace === query.targetNamespace;
  }

  function queryFromForm() {
    const kind = byId("query-kind").value;
    return {
      kind,
      name: byId("query-subject").value.trim(),
      subjectNamespace: byId("query-subject-namespace").value.trim() || "default",
      groups: byId("query-groups").value.split(",").map((item) => item.trim()).filter(Boolean),
      verb: byId("query-verb").value.trim(),
      apiGroup: byId("query-api-group").value.trim(),
      resource: byId("query-resource").value.trim(),
      resourceName: byId("query-resource-name").value.trim(),
      scope: byId("query-scope").value,
      targetNamespace: byId("query-target-namespace").value.trim() || "default",
    };
  }

  function querySubjectLabel(query) {
    return query.kind === "ServiceAccount"
      ? `${query.subjectNamespace}/${query.name}`
      : query.name;
  }

  function canAccess(query) {
    return currentAnalysis.grants.filter(
      (grant) =>
        subjectMatches(grant.subject, query) &&
        scopeMatches(grant, query) &&
        ruleMatches(grant.rule, query),
    );
  }

  function slug(value) {
    const result = value
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48);
    return result || "rbac-access";
  }

  function yamlString(value) {
    if (/^[a-zA-Z0-9._:/-]+$/.test(value)) return value;
    return JSON.stringify(value);
  }

  function generatedGrant(query) {
    const namespace = query.targetNamespace || "default";
    const roleName = slug(`${query.name}-${query.resource}-${query.verb}`);
    const roleKind = query.scope === "cluster" ? "ClusterRole" : "Role";
    const bindingKind = query.scope === "cluster" ? "ClusterRoleBinding" : "RoleBinding";
    const namespaceBlock = query.scope === "namespace" ? `  namespace: ${yamlString(namespace)}\n` : "";
    const subjectNamespace = query.kind === "ServiceAccount"
      ? `    namespace: ${yamlString(query.subjectNamespace)}\n`
      : "";
    const subjectApiGroup = query.kind === "ServiceAccount"
      ? ""
      : "    apiGroup: rbac.authorization.k8s.io\n";
    const resourceNameBlock = query.resourceName
      ? `    resourceNames: [${yamlString(query.resourceName)}]\n`
      : "";

    return `apiVersion: rbac.authorization.k8s.io/v1
kind: ${roleKind}
metadata:
  name: ${roleName}
${namespaceBlock}rules:
  - apiGroups: [${JSON.stringify(query.apiGroup)}]
    resources: [${JSON.stringify(query.resource)}]
${resourceNameBlock}    verbs: [${JSON.stringify(query.verb)}]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ${bindingKind}
metadata:
  name: ${roleName}
${namespaceBlock}subjects:
  - kind: ${query.kind}
    name: ${yamlString(query.name)}
${subjectNamespace}${subjectApiGroup}roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ${roleKind}
  name: ${roleName}
`;
  }

  function runQuery(event) {
    event.preventDefault();
    if (!currentAnalysis) return;
    const query = queryFromForm();
    if (!query.name || !query.verb || !query.resource) return;
    const matching = canAccess(query);
    const target = query.scope === "cluster" ? "cluster scope" : `namespace ${query.targetNamespace}`;
    const apiTarget = query.apiGroup ? `${query.resource}.${query.apiGroup}` : query.resource;
    const identity = `${query.kind} ${querySubjectLabel(query)}`;
    const result = byId("query-result");

    if (matching.length) {
      result.className = "query-result is-allowed";
      result.innerHTML = `
        <div class="query-result-icon" aria-hidden="true">✓</div>
        <div>
          <h4>Allowed by the supplied RBAC policy</h4>
          <p>${escapeHtml(identity)} can <strong>${escapeHtml(query.verb)}</strong> <strong>${escapeHtml(apiTarget)}</strong> at ${escapeHtml(target)}.</p>
          <ul class="query-evidence">${matching.map((grant) => `<li>${escapeHtml(grant.binding.kind)} ${escapeHtml(grant.binding.name)} → ${escapeHtml(grant.role.kind)} ${escapeHtml(roleDisplay(grant.role))}</li>`).join("")}</ul>
        </div>
      `;
      byId("generator-card").hidden = true;
      generatedYaml = "";
    } else {
      result.className = "query-result is-denied";
      result.innerHTML = `
        <div class="query-result-icon" aria-hidden="true">×</div>
        <div>
          <h4>Not allowed by the supplied RBAC policy</h4>
          <p>No included grant allows ${escapeHtml(identity)} to <strong>${escapeHtml(query.verb)}</strong> <strong>${escapeHtml(apiTarget)}</strong> at ${escapeHtml(target)}. An incomplete export or external authorizer can change the live result.</p>
        </div>
      `;
      generatedYaml = generatedGrant(query);
      byId("generated-yaml").textContent = generatedYaml;
      byId("generator-card").hidden = false;
    }
  }

  function permissionSignatures(analysis) {
    const signatures = new Set();
    analysis.grants.forEach((grant) => {
      const groups = grant.rule.apiGroups.length ? grant.rule.apiGroups : [""];
      const targets = grant.rule.nonResourceURLs.length
        ? grant.rule.nonResourceURLs.map((url) => ({ group: "", resource: "", url }))
        : groups.flatMap((group) =>
            grant.rule.resources.map((resource) => ({ group, resource, url: "" })),
          );
      const names = grant.rule.resourceNames.length ? grant.rule.resourceNames : [""];
      grant.rule.verbs.forEach((verb) => {
        targets.forEach((target) => {
          names.forEach((name) => {
            signatures.add([
              subjectKey(grant.subject),
              grant.scope,
              grant.namespace,
              target.group,
              target.resource,
              verb,
              name,
              target.url,
            ].join("|"));
          });
        });
      });
    });
    return signatures;
  }

  function signatureLabel(signature) {
    const [subject, scope, namespace, group, resource, verb, name, url] = signature.split("|");
    const target = url || `${resource}${group ? `.${group}` : ""}`;
    const scopeValue = scope === "cluster" ? "cluster" : namespace;
    return `${subject} · ${verb} ${target} · ${scopeValue}${name ? ` · name: ${name}` : ""}`;
  }

  function runComparison() {
    try {
      const proposed = analyzeText(comparisonSource.value);
      const baselineSet = permissionSignatures(currentAnalysis);
      const proposedSet = permissionSignatures(proposed);
      const added = [...proposedSet].filter((signature) => !baselineSet.has(signature));
      const removed = [...baselineSet].filter((signature) => !proposedSet.has(signature));
      const container = byId("comparison-result");
      container.className = "comparison-result is-ready";
      container.innerHTML = `
        <div class="diff-summary">
          <article><span>New permissions</span><strong>${added.length}</strong></article>
          <article><span>Removed permissions</span><strong>${removed.length}</strong></article>
        </div>
        <div class="diff-group">
          <h4>New effective access</h4>
          ${added.length ? `<ul class="diff-list is-added">${added.slice(0, 80).map((signature) => `<li>${escapeHtml(signatureLabel(signature))}</li>`).join("")}</ul>` : '<p class="empty-results">No new effective permissions.</p>'}
        </div>
        <div class="diff-group">
          <h4>Removed effective access</h4>
          ${removed.length ? `<ul class="diff-list is-removed">${removed.slice(0, 80).map((signature) => `<li>${escapeHtml(signatureLabel(signature))}</li>`).join("")}</ul>` : '<p class="empty-results">No effective permissions were removed.</p>'}
        </div>
      `;
    } catch (error) {
      byId("comparison-result").className = "comparison-result is-error";
      byId("comparison-result").innerHTML = `<p class="empty-results">${escapeHtml(error.message)}</p>`;
    }
  }

  function markdownReport() {
    const critical = currentAnalysis.findings.filter((item) => item.severity === "critical").length;
    const high = currentAnalysis.findings.filter((item) => item.severity === "high").length;
    const medium = currentAnalysis.findings.filter((item) => item.severity === "medium").length;
    const low = currentAnalysis.findings.filter((item) => item.severity === "low").length;
    const lines = [
      "# Kubernetes RBAC review",
      "",
      `Generated locally with Native Cube RBAC Explorer on ${new Date().toISOString()}.`,
      "",
      "## Summary",
      "",
      `- Roles: ${currentAnalysis.roles.length}`,
      `- Bindings: ${currentAnalysis.bindings.length}`,
      `- Subjects: ${currentAnalysis.subjects.length}`,
      `- Effective grant paths: ${currentAnalysis.grants.length}`,
      `- Unresolved role references: ${currentAnalysis.unresolved.length}`,
      `- Review signals: ${currentAnalysis.findings.length} (${critical} critical, ${high} high, ${medium} medium, ${low} low)`,
      "",
      "## Review signals",
      "",
    ];

    if (!currentAnalysis.findings.length) {
      lines.push("No deterministic review signals were found.", "");
    } else {
      currentAnalysis.findings.forEach((finding) => {
        lines.push(
          `### ${finding.severity.toUpperCase()}: ${finding.title}`,
          "",
          finding.detail,
          "",
          `Context: ${finding.tags.join(" · ")}`,
          "",
        );
      });
    }

    lines.push(
      "## Effective permissions",
      "",
      "| Subject | Scope | Binding | Role | Resources | Verbs |",
      "| --- | --- | --- | --- | --- | --- |",
    );
    currentAnalysis.grants.forEach((grant) => {
      const values = [
        `${grant.subject.kind} ${subjectLabel(grant.subject)}`,
        scopeLabel(grant),
        `${grant.binding.kind} ${grant.binding.name}`,
        `${grant.role.kind} ${roleDisplay(grant.role)}`,
        ruleTarget(grant.rule) || "—",
        grant.rule.verbs.join(", ") || "—",
      ].map((value) => value.replaceAll("|", "\\|"));
      lines.push(`| ${values.join(" | ")} |`);
    });
    lines.push(
      "",
      "> This static review models only the supplied Kubernetes RBAC objects. Confirm live access with kubectl auth can-i.",
      "",
    );
    return lines.join("\n");
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
    URL.revokeObjectURL(url);
  }

  async function copyText(text, successMessage) {
    try {
      await navigator.clipboard.writeText(text);
      showToast(successMessage);
    } catch {
      const helper = document.createElement("textarea");
      helper.value = text;
      helper.style.position = "fixed";
      helper.style.opacity = "0";
      document.body.append(helper);
      helper.select();
      document.execCommand("copy");
      helper.remove();
      showToast(successMessage);
    }
  }

  function switchTab(button, focus = false) {
    const tabName = button.dataset.tab;
    document.querySelectorAll("[data-tab]").forEach((tab) => {
      const selected = tab === button;
      tab.classList.toggle("is-active", selected);
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    document.querySelectorAll("[data-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.panel !== tabName;
    });
    if (focus) button.focus();
  }

  async function loadFile(file, target, afterLoad) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setSourceStatus("error", "Choose a file smaller than 5 MB.");
      return;
    }
    try {
      target.value = await file.text();
      afterLoad?.();
    } catch {
      setSourceStatus("error", "This file could not be read.");
    }
  }

  byId("analyze-button").addEventListener("click", () => runAnalysis({ scroll: true }));
  byId("sample-button").addEventListener("click", () => {
    source.value = SAMPLE;
    runAnalysis();
    showToast("Example RBAC policy loaded");
  });
  byId("clear-button").addEventListener("click", () => {
    source.value = "";
    comparisonSource.value = "";
    resetAnalysis();
    setSourceStatus("", "Waiting for RBAC manifests.");
    byId("source-format").textContent = "YAML or JSON";
    source.focus();
  });

  byId("rbac-file").addEventListener("change", (event) => {
    loadFile(event.target.files[0], source, () => runAnalysis());
    event.target.value = "";
  });
  byId("comparison-file").addEventListener("change", (event) => {
    loadFile(event.target.files[0], comparisonSource);
    event.target.value = "";
  });

  const dropZone = byId("drop-zone");
  ["dragenter", "dragover"].forEach((eventName) => {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.add("is-dragging");
    });
  });
  ["dragleave", "drop"].forEach((eventName) => {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.remove("is-dragging");
    });
  });
  dropZone.addEventListener("drop", (event) => {
    loadFile(event.dataTransfer.files[0], source, () => runAnalysis());
  });

  source.addEventListener("input", () => {
    if (currentAnalysis) {
      byId("analysis-state").textContent = "Source changed";
      byId("analysis-state").className = "analysis-state is-idle";
      setSourceStatus("", "Source changed. Analyze again to refresh effective access.");
    }
  });
  source.addEventListener("keydown", (event) => {
    if (event.key === "Tab") {
      event.preventDefault();
      const start = source.selectionStart;
      const end = source.selectionEnd;
      source.setRangeText("  ", start, end, "end");
    }
  });

  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => switchTab(button));
    button.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const tabs = [...document.querySelectorAll("[data-tab]")];
      const index = tabs.indexOf(button);
      let next = index;
      if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
      if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = tabs.length - 1;
      switchTab(tabs[next], true);
    });
  });

  byId("map-search").addEventListener("input", () => {
    showAllMap = false;
    renderAccessMap();
  });
  byId("show-more-map").addEventListener("click", () => {
    showAllMap = !showAllMap;
    renderAccessMap();
  });
  byId("permission-search").addEventListener("input", renderPermissions);
  byId("subject-kind-filter").addEventListener("change", renderPermissions);
  byId("severity-filter").addEventListener("change", renderFindings);

  function openFindings() {
    switchTab(byId("tab-findings"));
    byId("results").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  byId("posture-action").addEventListener("click", openFindings);
  byId("view-all-findings").addEventListener("click", openFindings);

  function updateQueryFields() {
    const kind = byId("query-kind").value;
    byId("query-subject-namespace-field").hidden = kind !== "ServiceAccount";
    byId("query-groups-field").hidden = kind !== "User";
  }

  function updateQueryScope() {
    byId("query-target-namespace-field").hidden = byId("query-scope").value === "cluster";
  }

  byId("query-kind").addEventListener("change", updateQueryFields);
  byId("query-scope").addEventListener("change", updateQueryScope);
  byId("query-form").addEventListener("submit", runQuery);
  byId("copy-generated").addEventListener("click", () => {
    if (generatedYaml) copyText(generatedYaml, "Generated RBAC YAML copied");
  });
  byId("download-generated").addEventListener("click", () => {
    if (generatedYaml) downloadText(generatedYaml, "rbac-grant.yaml", "text/yaml");
  });
  byId("compare-button").addEventListener("click", runComparison);
  byId("export-button").addEventListener("click", () => {
    if (!currentAnalysis) return;
    downloadText(markdownReport(), "kubernetes-rbac-review.md", "text/markdown");
    showToast("Markdown security review exported");
  });

  updateQueryFields();
  updateQueryScope();
})();
