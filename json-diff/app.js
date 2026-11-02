(() => {
  "use strict";

  const byId = (id) => document.getElementById(id);
  const sides = ["before", "after"];
  const fileVersions = { before: 0, after: 0 };
  const changeSymbols = { added: "+", removed: "−", changed: "~" };
  const samples = {
    json: [
      '{\n  "service": "catalog-api",\n  "replicas": 2,\n  "ports": [8080, 8443],\n  "environment": {\n    "LOG_LEVEL": "info",\n    "LEGACY_MODE": true\n  }\n}',
      '{\n  "replicas": 3,\n  "service": "catalog-api",\n  "ports": [8080, 8443, 9090],\n  "environment": {\n    "LOG_LEVEL": "debug",\n    "FEATURE_SEARCH": true\n  }\n}',
    ],
    yaml: [
      "# Original service configuration\nservice:\n  name: catalog-api\n  replicas: 2\n  image: catalog:1.0\n  ports: [8080, 8443]\n  debug: false\n",
      "# Updated service configuration\nservice:\n  name: catalog-api\n  replicas: 3\n  image: catalog:1.1\n  ports: [8080, 8443]\n  cache:\n    enabled: true\n",
    ],
    kubernetes: [
      "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: catalog-api\n  namespace: production\nspec:\n  replicas: 2\n  selector:\n    matchLabels:\n      app: catalog\n  template:\n    metadata:\n      labels:\n        app: catalog\n    spec:\n      containers:\n        - name: api\n          image: catalog:1.0\n---\napiVersion: v1\nkind: Service\nmetadata:\n  name: catalog-api\n  namespace: production\nspec:\n  selector:\n    app: catalog\n  ports:\n    - name: http\n      port: 80\n      targetPort: 8080\n",
      "apiVersion: v1\nkind: Service\nmetadata:\n  name: catalog-api\n  namespace: production\nspec:\n  selector:\n    app: catalog\n  ports:\n    - name: http\n      port: 80\n      targetPort: 8080\n---\napiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: catalog-api\n  namespace: production\nspec:\n  replicas: 3\n  selector:\n    matchLabels:\n      app: catalog\n  template:\n    metadata:\n      labels:\n        app: catalog\n    spec:\n      containers:\n        - name: api\n          image: catalog:1.1\n",
    ],
  };
  let report = null;
  let visibleLimit = 100;
  let toastTimer;
  let comparisonTimer;
  let activeChange = -1;
  let composing = false;
  const editorStates = Object.fromEntries(sides.map((side) => [side, {
    lines: [""], offsets: [0], markers: new Map(), targets: [],
  }]));

  function lineAt(offsets, position) {
    let low = 0;
    let high = offsets.length;
    while (low + 1 < high) {
      const middle = Math.floor((low + high) / 2);
      if (offsets[middle] <= position) low = middle;
      else high = middle;
    }
    return low;
  }

  function paintEditor(side) {
    const editor = byId(`${side}-editor`);
    const state = editorStates[side];
    const lineHeight = parseFloat(getComputedStyle(editor).lineHeight);
    const first = Math.max(0, Math.floor(editor.scrollTop / lineHeight) - 6);
    const last = Math.min(state.lines.length, first + Math.ceil(editor.clientHeight / lineHeight) + 14);
    const content = document.createDocumentFragment();
    const gutter = document.createElement("span");
    gutter.className = "source-gutter-content";
    gutter.style.paddingTop = `${first * lineHeight}px`;
    gutter.style.paddingBottom = `${(state.lines.length - last) * lineHeight}px`;
    for (let index = first; index < last; index++) {
      const text = state.lines[index];
      const markers = state.markers.get(index) || [];
      const active = markers.some((marker) => marker.index === activeChange);
      const type = markers.find((marker) => marker.index === activeChange)?.type || markers[0]?.type;
      const line = document.createElement("span");
      line.className = `source-line${type ? ` is-${type}` : ""}${active ? " is-active" : ""}`;
      line.dataset.line = index + 1;
      const boundaries = [...new Set([0, text.length, ...markers.flatMap((marker) => [marker.start, marker.end])])].sort((a, b) => a - b);
      for (let part = 0; part < boundaries.length - 1; part++) {
        const start = boundaries[part];
        const end = boundaries[part + 1];
        const marker = markers.find((item) => item.start <= start && item.end >= end && item.end > item.start);
        if (marker) {
          const mark = document.createElement("mark");
          mark.className = `source-token token-${marker.type}`;
          mark.textContent = text.slice(start, end);
          line.append(mark);
        } else line.append(document.createTextNode(text.slice(start, end)));
      }
      content.append(line);
      const number = document.createElement("span");
      number.className = `source-gutter-line${type ? ` is-${type}` : ""}${active ? " is-active" : ""}`;
      const symbol = document.createElement("span");
      symbol.textContent = type ? { added: "+", removed: "−", changed: "~" }[type] : "";
      const digits = document.createElement("span");
      digits.textContent = index + 1;
      number.append(symbol, digits);
      gutter.append(number);
    }
    const code = byId(`${side}-highlight`);
    code.style.paddingTop = `${first * lineHeight}px`;
    code.style.paddingBottom = `${(state.lines.length - last) * lineHeight}px`;
    const style = getComputedStyle(editor);
    code.style.minWidth = `${editor.scrollWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)}px`;
    code.replaceChildren(content);
    byId(`${side}-lines`).replaceChildren(gutter);
    byId(`${side}-lines`).scrollTop = editor.scrollTop;
    const backdrop = byId(`${side}-backdrop`);
    backdrop.scrollTop = editor.scrollTop;
    backdrop.scrollLeft = editor.scrollLeft;
    editor.closest(".editor-surface").classList.add("has-backdrop");
  }

  function clearSourceHighlights() {
    activeChange = -1;
    sides.forEach((side) => {
      editorStates[side].markers.clear();
      editorStates[side].targets = [];
      paintEditor(side);
    });
    ["previous-change", "next-change", "review-change"].forEach((id) => { byId(id).disabled = true; });
    byId("change-position").textContent = "No current comparison";
    byId("active-change").textContent = "Differences are highlighted directly in your inputs.";
    byId("active-change").removeAttribute("title");
  }

  function updateSummary(counts = null) {
    Object.keys(changeSymbols).forEach((type) => {
      const value = counts ? counts[type].toLocaleString() : "—";
      byId(`${type}-count`).textContent = value;
      byId(`live-${type}`).textContent = `${changeSymbols[type]} ${value} ${type}`;
    });
    byId("total-count").textContent = counts
      ? Object.values(counts).reduce((total, value) => total + value, 0).toLocaleString()
      : "—";
  }

  function highlightSources(parsed) {
    const sources = Object.fromEntries(sides.map((side) => [side, byId(`${side}-editor`).value]));
    const locations = Object.fromEntries(sides.map((side) => [side, window.NativeDiffSource.build(sources[side], parsed[side])]));
    const settings = { ...report.options, multipleDocuments: sides.some((side) => parsed[side].documents.length > 1) };
    report.changes.forEach((change, index) => {
      const ranges = Object.fromEntries(sides.map((side) => [side, window.NativeDiffSource.locate(locations[side], parsed[side], change, side, settings)]));
      sides.forEach((side) => {
        const range = ranges[side];
        if (!range) return;
        const state = editorStates[side];
        let start = change.type === "changed" ? range.start : range.keyStart;
        let end = range.end;
        const other = side === "before" ? "after" : "before";
        if (change.type === "changed" && typeof change.before === "string" && typeof change.after === "string" && ranges[other] && !range.alias && !ranges[other].alias) {
          const lexemes = Object.fromEntries(sides.map((name) => [name, sources[name].slice(ranges[name].start, ranges[name].end)]));
          const relative = textDifference(lexemes.before, lexemes.after, side);
          start = range.start + relative[0];
          end = range.start + relative[1];
        }
        if (range.start === range.end) { start = range.keyStart; end = range.end; }
        state.targets[index] = { ...range, focusStart: start };
        const first = lineAt(state.offsets, range.keyStart);
        const last = lineAt(state.offsets, Math.max(range.keyStart, range.end - 1));
        for (let line = first; line <= last; line++) {
          if (!state.markers.has(line)) state.markers.set(line, []);
          const columnStart = Math.min(state.lines[line].length, Math.max(0, start - state.offsets[line]));
          const columnEnd = Math.min(state.lines[line].length, Math.max(0, end - state.offsets[line]));
          state.markers.get(line).push({ type: change.type, index, start: columnStart, end: columnEnd });
        }
      });
    });
    sides.forEach(paintEditor);
    byId("change-position").textContent = report.changes.length ? `${report.changes.length} changes` : "Documents match";
    byId("previous-change").disabled = byId("next-change").disabled = !report.changes.length;
    byId("active-change").textContent = report.changes.length ? "Use Next / Previous to inspect matching fields in both editors." : "No structural differences with the selected options.";
  }

  function activateChange(index, reveal = false) {
    if (!report?.changes.length) return;
    activeChange = (index + report.changes.length) % report.changes.length;
    sides.forEach((side) => {
      const editor = byId(`${side}-editor`);
      const state = editorStates[side];
      const range = state.targets[activeChange];
      if (range) {
        const focusStart = range.focusStart ?? range.start;
        const line = lineAt(state.offsets, focusStart);
        const style = getComputedStyle(editor);
        const lineHeight = parseFloat(style.lineHeight);
        editor.scrollTop = Math.max(0, (line - 3) * lineHeight);
        const column = focusStart - state.offsets[line];
        const context = document.createElement("canvas").getContext("2d");
        context.font = `${style.fontSize} ${style.fontFamily}`;
        const prefixWidth = context.measureText(state.lines[line].slice(0, column).replace(/\t/g, "  ")).width;
        editor.scrollLeft = Math.max(0, prefixWidth - editor.clientWidth / 2);
      }
      paintEditor(side);
    });
    const change = report.changes[activeChange];
    byId("change-position").textContent = `${activeChange + 1} / ${report.changes.length}`;
    byId("active-change").textContent = `${{ added: "+ Added", removed: "− Removed", changed: "~ Changed" }[change.type]} · ${fieldPath(change.path).textContent}`;
    byId("active-change").title = change.path || "(root)";
    byId("review-change").disabled = false;
    if (reveal) {
      document.querySelector(".change-navigation").scrollIntoView({ block: "start", behavior: "instant" });
      byId("next-change").focus({ preventScroll: true });
    }
  }

  function toast(message) {
    clearTimeout(toastTimer);
    byId("toast").textContent = message;
    byId("toast").classList.add("is-visible");
    toastTimer = setTimeout(() => byId("toast").classList.remove("is-visible"), 4000);
  }

  function status(state, title, message) {
    byId("validation-panel").className = `validation-panel is-${state}`;
    byId("validation-title").textContent = title;
    byId("validation-message").textContent = message;
  }

  function empty(message) {
    const paragraph = document.createElement("p");
    paragraph.className = "empty-state";
    paragraph.textContent = message;
    byId("diff-results").replaceChildren(paragraph);
  }

  function invalidate(schedule = true) {
    clearTimeout(comparisonTimer);
    report = null;
    clearSourceHighlights();
    byId("copy-button").disabled = true;
    byId("download-button").disabled = true;
    byId("more-button").hidden = true;
    updateSummary();
    byId("visible-count").textContent = "";
    empty("Inputs or options changed. Compare again to refresh the results.");
    status("pending", "Ready to compare", "Choose Compare documents or press Ctrl/⌘ + Enter to review these inputs.");
    byId("live-total").textContent = "Waiting for comparison";
    if (schedule && !composing && byId("live-compare").checked && sides.every((side) => byId(`${side}-editor`).value.trim())) {
      byId("live-total").textContent = "Updating differences…";
      comparisonTimer = setTimeout(compare, 450);
    }
  }

  function clearError(side) {
    byId(`${side}-error`).hidden = true;
    byId(`${side}-error`).textContent = "";
    byId(`${side}-editor`).removeAttribute("aria-invalid");
    byId(`${side}-editor`).closest(".editor-card").classList.remove("has-error");
  }

  function showError(side, error) {
    byId(`${side}-error`).textContent = error.message;
    byId(`${side}-error`).hidden = false;
    byId(`${side}-editor`).setAttribute("aria-invalid", "true");
    byId(`${side}-editor`).closest(".editor-card").classList.add("has-error");
  }

  function updateEditor(side) {
    const editor = byId(`${side}-editor`);
    const lines = editor.value.split("\n").length;
    const state = editorStates[side];
    state.lines = editor.value.split("\n");
    state.offsets = [];
    let offset = 0;
    state.lines.forEach((line) => { state.offsets.push(offset); offset += line.length + 1; });
    byId(`${side}-stats`).textContent = `${lines.toLocaleString()} lines · ${editor.value.length.toLocaleString()} characters`;
    clearError(side);
  }

  function options() {
    return {
      arrayMode: byId("array-mode").value,
      arrayKey: byId("array-key").value.trim(),
      documents: byId("document-mode").value,
    };
  }

  function updateOptions() {
    const mode = byId("array-mode").value;
    byId("array-key-field").hidden = mode !== "keyed";
    const descriptions = {
      ordered: "Array positions matter.",
      unordered: "Array order is ignored at every level; duplicate counts still matter. Edited items appear as removed and added.",
      keyed: "Object arrays match by a unique direct field; primitive and mixed arrays compare by position.",
    };
    const documents = byId("document-mode").value === "kubernetes"
      ? " Resources match by API version, kind, exact namespace and name."
      : " Multiple YAML documents compare by position.";
    byId("mode-description").textContent = `Object key order, indentation, and YAML comments are ignored. ${descriptions[mode]}${documents} Ctrl/⌘ + Enter compares.`;
  }

  function changedRange(change, side, text) {
    if (change.type !== "changed") return null;
    if (typeof change.before !== "string" || typeof change.after !== "string") return [0, text.length];
    return textDifference(JSON.stringify(change.before), JSON.stringify(change.after), side);
  }

  function textDifference(before, after, side) {
    const original = Array.from(before);
    const updated = Array.from(after);
    let start = 0;
    let end = 0;
    while (start < Math.min(original.length, updated.length) && original[start] === updated[start]) start++;
    while (end < Math.min(original.length, updated.length) - start && original[original.length - end - 1] === updated[updated.length - end - 1]) end++;
    const points = side === "before" ? original : updated;
    return [points.slice(0, start).join("").length, points.slice(0, points.length - end).join("").length];
  }

  function appendHighlighted(parent, text, offset, range) {
    const start = range ? Math.max(0, range[0] - offset) : 0;
    const end = range ? Math.min(text.length, range[1] - offset) : 0;
    if (end <= start) {
      parent.append(document.createTextNode(text));
      return;
    }
    parent.append(document.createTextNode(text.slice(0, start)));
    const mark = document.createElement("mark");
    mark.className = "inline-change";
    mark.textContent = text.slice(start, end);
    parent.append(mark, document.createTextNode(text.slice(end)));
  }

  function highlightJson(text, range) {
    const fragment = document.createDocumentFragment();
    const tokens = /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b/g;
    let offset = 0;
    for (const match of text.matchAll(tokens)) {
      appendHighlighted(fragment, text.slice(offset, match.index), offset, range);
      const token = document.createElement("span");
      token.className = `json-token ${match[2] ? "json-key" : match[1] ? "json-string" : match[3] ? "json-number" : match[4] === "null" ? "json-null" : "json-boolean"}`;
      appendHighlighted(token, match[0], match.index, range);
      fragment.append(token);
      offset = match.index + match[0].length;
    }
    appendHighlighted(fragment, text.slice(offset), offset, range);
    return fragment;
  }

  function valuePane(change, side) {
    const pane = document.createElement("div");
    const present = Object.prototype.hasOwnProperty.call(change, side);
    pane.className = `value-pane ${side}-value${present ? "" : " value-absent"}`;
    const label = document.createElement("div");
    label.className = "value-label";
    const source = document.createElement("span");
    source.textContent = side === "before" ? "Original" : "Updated";
    const type = document.createElement("span");
    type.className = "value-type";
    type.textContent = present ? change[side] === null ? "null" : Array.isArray(change[side]) ? "array" : typeof change[side] : "absent";
    label.append(source, type);
    const content = document.createElement("div");
    content.className = "value-content";
    const marker = document.createElement("span");
    marker.className = "value-marker";
    marker.setAttribute("aria-hidden", "true");
    marker.textContent = present ? side === "before" ? "−" : "+" : "·";
    const value = document.createElement("pre");
    const fullValue = present ? JSON.stringify(change[side], null, 2) : "Field not present";
    const preview = fullValue.slice(0, 20000);
    if (present) value.append(highlightJson(preview, changedRange(change, side, fullValue)));
    else value.textContent = fullValue;
    if (fullValue.length > 20000) {
      const notice = document.createElement("span");
      notice.className = "preview-notice";
      notice.textContent = "\n… Preview shortened. The complete value is in the exported report.";
      value.append(notice);
    }
    content.append(marker, value);
    pane.append(label, content);
    return pane;
  }

  function fieldPath(path) {
    const title = document.createElement("h3");
    title.title = path || "(root)";
    let displayPath = path;
    if (report.options.documents === "kubernetes" && path.startsWith("/resources/")) {
      const parts = path.split("/");
      try {
        const [, kind, namespace, name] = JSON.parse(parts[2].replace(/~1/g, "/").replace(/~0/g, "~"));
        const resource = document.createElement("span");
        resource.className = "resource-context";
        resource.textContent = `${kind} · ${namespace ? `${namespace}/` : ""}${name}`;
        title.append(resource);
        displayPath = parts.length > 3 ? `/${parts.slice(3).join("/")}` : "(resource)";
      } catch { /* Keep the original pointer if it is not a resource identity. */ }
    }
    const pathText = document.createElement("span");
    pathText.className = "field-path";
    const separator = displayPath.lastIndexOf("/");
    const prefix = document.createElement("span");
    prefix.className = "path-parent";
    prefix.textContent = displayPath.slice(0, separator + 1);
    const field = document.createElement("strong");
    field.textContent = displayPath.slice(separator + 1) || (displayPath ? "(empty key)" : "(root)");
    pathText.append(prefix, field);
    title.append(pathText);
    return title;
  }

  function render() {
    if (!report) return;
    const filter = byId("change-filter").value;
    const path = byId("path-filter").value.toLowerCase();
    const changes = report.changes.filter((change) => (filter === "all" || change.type === filter) && (change.path || "(root)").toLowerCase().includes(path));
    const fragment = document.createDocumentFragment();
    const labels = { added: "+ Added", removed: "− Removed", changed: "~ Changed" };
    changes.slice(0, visibleLimit).forEach((change, index) => {
      const card = document.createElement("article");
      card.className = `change-card ${change.type}`;
      card.tabIndex = -1;
      const originalIndex = report.changes.indexOf(change);
      card.dataset.changeIndex = originalIndex;
      const heading = document.createElement("div");
      heading.className = "change-heading";
      const number = document.createElement("span");
      number.className = "change-number";
      number.textContent = String(index + 1).padStart(2, "0");
      number.setAttribute("aria-label", `Change ${index + 1}`);
      const label = document.createElement("span");
      label.className = "change-label";
      label.textContent = labels[change.type];
      const title = fieldPath(change.path);
      heading.append(number, title, label);
      const reveal = document.createElement("button");
      reveal.className = "text-button source-jump";
      reveal.type = "button";
      reveal.append(document.createTextNode("Show in inputs "));
      const arrow = document.createElement("span");
      arrow.textContent = "↑";
      arrow.setAttribute("aria-hidden", "true");
      reveal.append(arrow);
      reveal.setAttribute("aria-label", `Show in inputs: ${change.path || "root change"}`);
      reveal.addEventListener("click", () => activateChange(originalIndex, true));
      heading.append(reveal);
      const grid = document.createElement("div");
      grid.className = "value-grid";
      grid.append(valuePane(change, "before"), valuePane(change, "after"));
      card.append(heading, grid);
      fragment.append(card);
    });
    byId("diff-results").replaceChildren(fragment);
    if (!changes.length) empty(report.changes.length ? "No changes match these filters." : "No structural differences. The documents match with the selected comparison options.");
    byId("visible-count").textContent = `${Math.min(visibleLimit, changes.length)} of ${changes.length} matching changes`;
    byId("more-button").hidden = changes.length <= visibleLimit;
  }

  function compare() {
    invalidate(false);
    const parsed = {};
    for (const side of sides) {
      clearError(side);
      try {
        parsed[side] = window.NativeDiff.parse(byId(`${side}-editor`).value, byId(`${side}-format`).value);
      } catch (error) {
        showError(side, error);
      }
    }
    if (!parsed.before || !parsed.after) {
      byId("live-total").textContent = "Check input syntax";
      status("error", "Check your input", "The highlighted editor explains what to fix. For YAML flow syntax, choose YAML explicitly.");
      empty("Fix the input errors, then compare again.");
      return;
    }
    try {
      const settings = options();
      if (settings.arrayMode === "keyed" && !settings.arrayKey) throw new Error("Enter the direct field name to match object arrays, such as name or id.");
      const changes = window.NativeDiff.compare(parsed.before, parsed.after, settings);
      const counts = { added: 0, removed: 0, changed: 0 };
      changes.forEach((change) => counts[change.type]++);
      report = {
        tool: "Native Cube JSON & YAML Diff Checker",
        version: 1,
        options: settings,
        inputs: Object.fromEntries(sides.map((side) => [side, { format: parsed[side].format, documents: parsed[side].documents.length }])),
        summary: { total: changes.length, ...counts },
        changes,
      };
      updateSummary(counts);
      byId("live-total").textContent = changes.length ? `${changes.length} change${changes.length === 1 ? "" : "s"} found` : "Documents match";
      highlightSources(parsed);
      byId("copy-button").disabled = false;
      byId("download-button").disabled = false;
      const inputSummary = sides.map((side) => `${side === "before" ? "Original" : "Updated"}: ${parsed[side].format.toUpperCase()}, ${parsed[side].documents.length} document${parsed[side].documents.length === 1 ? "" : "s"}`).join(" · ");
      status(changes.length ? "idle" : "success", changes.length ? `${changes.length} structural change${changes.length === 1 ? "" : "s"} found` : "The documents match", `${inputSummary}. Compared locally using the selected options.`);
      visibleLimit = 100;
      render();
    } catch (error) {
      report = null;
      clearSourceHighlights();
      updateSummary();
      byId("copy-button").disabled = byId("download-button").disabled = true;
      byId("live-total").textContent = "Check comparison options";
      status("error", "Comparison needs attention", error.message);
      empty("Adjust your inputs or comparison options, then try again.");
    }
  }

  function loadSample() {
    const example = byId("example-select").value;
    sides.forEach((side, index) => {
      fileVersions[side]++;
      byId(`${side}-editor`).value = samples[example][index];
      byId(`${side}-format`).value = example === "json" ? "json" : "yaml";
      updateEditor(side);
    });
    byId("array-mode").value = "ordered";
    byId("document-mode").value = example === "kubernetes" ? "kubernetes" : "position";
    byId("change-filter").value = "all";
    byId("path-filter").value = "";
    updateOptions();
    compare();
  }

  sides.forEach((side) => {
    const editor = byId(`${side}-editor`);
    editor.addEventListener("input", () => { fileVersions[side]++; updateEditor(side); invalidate(); });
    editor.addEventListener("scroll", () => paintEditor(side));
    editor.addEventListener("compositionstart", () => { composing = true; clearTimeout(comparisonTimer); });
    editor.addEventListener("compositionend", () => { composing = false; updateEditor(side); invalidate(); });
    editor.addEventListener("keydown", (event) => {
      if (event.key === "Tab" && !event.shiftKey) {
        event.preventDefault();
        editor.setRangeText("  ", editor.selectionStart, editor.selectionEnd, "end");
        editor.dispatchEvent(new Event("input"));
      }
    });
    byId(`${side}-format`).addEventListener("change", () => { clearError(side); invalidate(); });
    byId(`${side}-file`).addEventListener("change", async (event) => {
      const file = event.target.files[0];
      event.target.value = "";
      if (!file) return;
      const version = ++fileVersions[side];
      try {
        if (file.size > window.NativeDiff.MAX_SOURCE) throw new Error("Each input is limited to 1 MiB.");
        const source = await file.text();
        if (fileVersions[side] !== version) return;
        editor.value = source;
        byId(`${side}-format`).value = /\.ya?ml$/i.test(file.name) ? "yaml" : /\.json$/i.test(file.name) ? "json" : "auto";
        updateEditor(side);
        invalidate();
        toast(`${side === "before" ? "Original" : "Updated"} file opened locally.`);
      } catch (error) { toast(error.message); }
    });
  });

  document.querySelectorAll("[data-open]").forEach((button) => button.addEventListener("click", () => byId(`${button.dataset.open}-file`).click()));
  document.querySelectorAll("[data-format]").forEach((button) => button.addEventListener("click", () => {
    const side = button.dataset.format;
    try {
      const parsed = window.NativeDiff.parse(byId(`${side}-editor`).value, byId(`${side}-format`).value);
      byId(`${side}-editor`).value = parsed.format === "json"
        ? JSON.stringify(parsed.documents[0], null, 2)
        : parsed.documents.map((value) => window.jsyaml.dump(value, { schema: window.jsyaml.JSON_SCHEMA, lineWidth: -1, indent: 2 })).join("---\n");
      byId(`${side}-format`).value = parsed.format;
      fileVersions[side]++;
      updateEditor(side);
      invalidate();
      toast("Formatted locally. YAML comments are omitted.");
    } catch (error) { showError(side, error); status("error", "Could not format this input", error.message); }
  }));

  byId("compare-button").addEventListener("click", compare);
  byId("live-compare").addEventListener("change", () => {
    clearTimeout(comparisonTimer);
    if (byId("live-compare").checked) compare();
  });
  byId("previous-change").addEventListener("click", () => activateChange(activeChange < 0 ? -1 : activeChange - 1));
  byId("next-change").addEventListener("click", () => activateChange(activeChange + 1));
  byId("review-change").addEventListener("click", () => {
    if (!report || activeChange < 0) return;
    byId("change-filter").value = "all";
    byId("path-filter").value = "";
    visibleLimit = Math.max(100, activeChange + 1);
    render();
    const row = byId("diff-results").querySelector(`[data-change-index="${activeChange}"]`);
    row?.scrollIntoView({ block: "center", behavior: "instant" });
    row?.focus({ preventScroll: true });
  });
  window.addEventListener("resize", () => sides.forEach(paintEditor));
  byId("sample-button").addEventListener("click", loadSample);
  byId("swap-button").addEventListener("click", () => {
    for (const suffix of ["editor", "format"]) {
      const before = byId(`before-${suffix}`);
      const after = byId(`after-${suffix}`);
      [before.value, after.value] = [after.value, before.value];
    }
    sides.forEach((side) => { fileVersions[side]++; updateEditor(side); });
    invalidate();
  });
  byId("clear-button").addEventListener("click", () => {
    sides.forEach((side) => { fileVersions[side]++; byId(`${side}-editor`).value = ""; updateEditor(side); });
    invalidate();
    byId("before-editor").focus();
  });
  ["array-mode", "array-key", "document-mode"].forEach((id) => byId(id).addEventListener(id === "array-key" ? "input" : "change", () => { updateOptions(); invalidate(); }));
  ["change-filter", "path-filter"].forEach((id) => byId(id).addEventListener(id === "path-filter" ? "input" : "change", () => { visibleLimit = 100; render(); }));
  document.querySelectorAll('input[name="result-view"]').forEach((input) => input.addEventListener("change", () => {
    byId("diff-viewer").dataset.view = input.value;
  }));
  byId("more-button").addEventListener("click", () => { visibleLimit += 100; render(); });
  byId("copy-button").addEventListener("click", async () => {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
      toast("Complete JSON report copied.");
    } catch { toast("Clipboard is unavailable. Download the JSON report instead."); }
  });
  byId("download-button").addEventListener("click", () => {
    if (!report) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2) + "\n"], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "native-cube-json-yaml-diff.json";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("Complete JSON report downloaded.");
  });
  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); compare(); }
    if (event.altKey && ["ArrowDown", "ArrowUp"].includes(event.key) && report?.changes.length) {
      event.preventDefault();
      activateChange(event.key === "ArrowDown" ? activeChange + 1 : activeChange < 0 ? -1 : activeChange - 1);
    }
  });
  loadSample();
})();
