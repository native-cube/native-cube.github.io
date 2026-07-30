(() => {
  "use strict";

  if (typeof document === "undefined") return;

  const SAMPLE = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-app
  labels:
    app: web
spec:
  replicas: 3
  selector:
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: web
    spec:
      containers:
        - name: web
          image: nginx:1.27
          ports:
            - containerPort: 80
`;

  const byId = (id) => document.getElementById(id);
  const sourceEditor = byId("source-editor");
  const outputEditor = byId("output-editor");
  const sourceLines = byId("source-lines");
  const outputLines = byId("output-lines");
  const sourceCard = sourceEditor.closest(".editor-card");
  const formatButton = byId("format-button");
  const outputFormat = byId("output-format");
  const indentSize = byId("indent-size");
  const sortKeys = byId("sort-keys");
  const detectedFormat = byId("detected-format");
  const outputFormatLabel = byId("output-format-label");
  const validationPanel = byId("validation-panel");
  const validationTitle = byId("validation-title");
  const validationMessage = byId("validation-message");
  const errorLocation = byId("error-location");
  const copyButton = byId("copy-button");
  const downloadButton = byId("download-button");
  const useOutputButton = byId("use-output-button");
  const toast = byId("toast");
  let validationTimer;
  let toastTimer;
  let currentOutputFormat = "yaml";

  function selectedInputFormat() {
    return document.querySelector('input[name="input-format"]:checked').value;
  }

  function lineCount(value) {
    return value === "" ? 1 : value.split("\n").length;
  }

  function updateLineNumbers(editor, lineNumbers) {
    const count = lineCount(editor.value);
    lineNumbers.textContent = Array.from(
      { length: count },
      (_, index) => index + 1,
    ).join("\n");
    lineNumbers.scrollTop = editor.scrollTop;
  }

  function updateStats(editor, target, emptyMessage) {
    const value = editor.value;
    if (!value && emptyMessage) {
      target.textContent = emptyMessage;
      return;
    }

    const lines = lineCount(value);
    const characters = value.length;
    target.textContent = `${lines} ${lines === 1 ? "line" : "lines"} · ${characters} ${
      characters === 1 ? "character" : "characters"
    }`;
  }

  function syncEditor(editor, lineNumbers) {
    editor.addEventListener("scroll", () => {
      lineNumbers.scrollTop = editor.scrollTop;
    });
  }

  function detectFormat(source) {
    const chosen = selectedInputFormat();
    if (chosen !== "auto") return chosen;

    const trimmed = source.trimStart();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "json";
    return "yaml";
  }

  function formatName(format) {
    return format === "json" ? "JSON" : "YAML";
  }

  function parseSource(source, format) {
    if (!source.trim()) {
      throw new Error("Paste YAML or JSON into the source editor first.");
    }

    if (format === "json") {
      return {
        documents: [JSON.parse(source)],
        multiple: false,
      };
    }

    const documents = [];
    window.jsyaml.loadAll(source, (documentValue) => {
      documents.push(documentValue);
    });

    return {
      documents,
      multiple: documents.length > 1,
    };
  }

  function sortValue(value) {
    if (Array.isArray(value)) return value.map(sortValue);
    if (!value || typeof value !== "object") return value;

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return value;

    return Object.fromEntries(
      Object.keys(value)
        .sort((left, right) => left.localeCompare(right))
        .map((key) => [key, sortValue(value[key])]),
    );
  }

  function serializeDocuments(parsed, format, indent, shouldSort) {
    const documents = shouldSort
      ? parsed.documents.map(sortValue)
      : parsed.documents;

    if (format === "json") {
      const value = parsed.multiple ? documents : documents[0];
      return `${JSON.stringify(value, null, indent)}\n`;
    }

    return documents
      .map((documentValue, index) => {
        const yaml = window.jsyaml.dump(documentValue, {
          indent,
          lineWidth: -1,
          noCompatMode: true,
          noRefs: true,
          sortKeys: false,
        });
        return index === 0 ? yaml : `---\n${yaml}`;
      })
      .join("");
  }

  function parseJsonLocation(error, source) {
    const match = error.message.match(/position\s+(\d+)/i);
    if (!match) return undefined;

    const offset = Math.min(Number(match[1]), source.length);
    const before = source.slice(0, offset);
    const lines = before.split("\n");
    return {
      line: lines.length,
      column: lines[lines.length - 1].length + 1,
      offset,
    };
  }

  function errorDetails(error, source, format) {
    if (format === "yaml" && error.mark) {
      return {
        message: error.reason || error.message,
        line: error.mark.line + 1,
        column: error.mark.column + 1,
        offset: error.mark.position,
      };
    }

    const location = format === "json" ? parseJsonLocation(error, source) : undefined;
    return {
      message: error.message.replace(/\s+at position\s+\d+.*$/i, ""),
      ...location,
    };
  }

  function setValidation(state, title, message, location) {
    validationPanel.className = `validation-panel is-${state}`;
    validationTitle.textContent = title;
    validationMessage.textContent = message;
    sourceCard.classList.toggle("has-error", state === "error");

    if (location?.line) {
      errorLocation.textContent = `Line ${location.line}, column ${location.column}`;
      errorLocation.dataset.offset = String(location.offset ?? 0);
      errorLocation.hidden = false;
    } else {
      errorLocation.hidden = true;
      delete errorLocation.dataset.offset;
    }
  }

  function setOutput(value, format, documentTotal) {
    currentOutputFormat = format;
    outputEditor.value = value;
    outputFormatLabel.textContent = formatName(format);
    updateLineNumbers(outputEditor, outputLines);
    updateStats(outputEditor, byId("output-stats"), "Waiting for valid input");
    byId("document-count").textContent =
      documentTotal > 1 ? `${documentTotal} YAML documents` : "";
    copyButton.disabled = !value;
    downloadButton.disabled = !value;
    useOutputButton.disabled = !value;
  }

  function clearOutput() {
    setOutput("", "yaml", 0);
  }

  function validateAndFormat({ quiet = false } = {}) {
    const source = sourceEditor.value;
    const input = detectFormat(source);
    const requestedOutput = outputFormat.value === "same" ? input : outputFormat.value;
    detectedFormat.textContent =
      selectedInputFormat() === "auto" ? `${formatName(input)} detected` : formatName(input);

    try {
      const parsed = parseSource(source, input);
      const formatted = serializeDocuments(
        parsed,
        requestedOutput,
        Number(indentSize.value),
        sortKeys.checked,
      );
      setOutput(formatted, requestedOutput, parsed.documents.length);
      const conversion =
        requestedOutput === input
          ? `Formatted as ${formatName(requestedOutput)}.`
          : `Converted from ${formatName(input)} to ${formatName(requestedOutput)}.`;
      setValidation(
        "success",
        `Valid ${formatName(input)}`,
        `${conversion} ${parsed.documents.length} ${
          parsed.documents.length === 1 ? "document" : "documents"
        } parsed locally.`,
      );
      if (!quiet) showToast(`${formatName(input)} is valid and formatted.`);
      return true;
    } catch (error) {
      clearOutput();
      const details = errorDetails(error, source, input);
      setValidation(
        "error",
        `Invalid ${formatName(input)}`,
        details.message,
        details,
      );
      return false;
    }
  }

  function scheduleValidation() {
    window.clearTimeout(validationTimer);
    if (!sourceEditor.value.trim()) {
      detectedFormat.textContent =
        selectedInputFormat() === "auto"
          ? "Auto detect"
          : formatName(selectedInputFormat());
      clearOutput();
      setValidation(
        "idle",
        "Ready when you are",
        "Paste YAML or JSON, then format it or press Ctrl/⌘ + Enter.",
      );
      return;
    }

    const input = detectFormat(sourceEditor.value);
    detectedFormat.textContent =
      selectedInputFormat() === "auto" ? `${formatName(input)} detected` : formatName(input);
    setValidation("pending", "Checking syntax", "Waiting for you to finish typing…");
    validationTimer = window.setTimeout(() => {
      validateAndFormat({ quiet: true });
    }, 550);
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add("is-visible");
    toastTimer = window.setTimeout(() => {
      toast.classList.remove("is-visible");
    }, 2400);
  }

  async function copyOutput() {
    if (!outputEditor.value) return;
    try {
      await navigator.clipboard.writeText(outputEditor.value);
      showToast("Formatted output copied.");
    } catch {
      outputEditor.select();
      document.execCommand("copy");
      showToast("Formatted output copied.");
    }
  }

  function downloadOutput() {
    if (!outputEditor.value) return;
    const extension = currentOutputFormat === "json" ? "json" : "yaml";
    const blob = new Blob([outputEditor.value], {
      type: currentOutputFormat === "json" ? "application/json" : "application/yaml",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `formatted.${extension}`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    showToast(`Downloaded formatted.${extension}.`);
  }

  function useOutputAsSource() {
    if (!outputEditor.value) return;
    sourceEditor.value = outputEditor.value;
    const inputControl = document.querySelector(
      `input[name="input-format"][value="${currentOutputFormat}"]`,
    );
    inputControl.checked = true;
    outputFormat.value = "same";
    updateSourceMeta();
    validateAndFormat({ quiet: true });
    sourceEditor.focus();
    showToast("Formatted output moved to the source editor.");
  }

  function updateSourceMeta() {
    updateLineNumbers(sourceEditor, sourceLines);
    updateStats(sourceEditor, byId("source-stats"));
  }

  function insertIndent(event) {
    if (event.key !== "Tab") return;
    event.preventDefault();
    const spaces = " ".repeat(Number(indentSize.value));
    const start = sourceEditor.selectionStart;
    const end = sourceEditor.selectionEnd;
    sourceEditor.setRangeText(spaces, start, end, "end");
    sourceEditor.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function focusError() {
    const offset = Number(errorLocation.dataset.offset || 0);
    sourceEditor.focus();
    sourceEditor.setSelectionRange(offset, Math.min(offset + 1, sourceEditor.value.length));

    const precedingLines = sourceEditor.value.slice(0, offset).split("\n").length - 1;
    const lineHeight = Number.parseFloat(getComputedStyle(sourceEditor).lineHeight);
    sourceEditor.scrollTop = Math.max(0, precedingLines * lineHeight - 90);
    sourceLines.scrollTop = sourceEditor.scrollTop;
  }

  sourceEditor.addEventListener("input", () => {
    updateSourceMeta();
    scheduleValidation();
  });
  sourceEditor.addEventListener("keydown", (event) => {
    insertIndent(event);
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      validateAndFormat();
    }
  });
  formatButton.addEventListener("click", () => validateAndFormat());
  copyButton.addEventListener("click", copyOutput);
  downloadButton.addEventListener("click", downloadOutput);
  useOutputButton.addEventListener("click", useOutputAsSource);
  errorLocation.addEventListener("click", focusError);

  byId("sample-button").addEventListener("click", () => {
    sourceEditor.value = SAMPLE;
    document.querySelector('input[name="input-format"][value="auto"]').checked = true;
    outputFormat.value = "same";
    updateSourceMeta();
    validateAndFormat({ quiet: true });
    sourceEditor.focus();
    showToast("Sample YAML loaded.");
  });

  byId("clear-button").addEventListener("click", () => {
    sourceEditor.value = "";
    updateSourceMeta();
    scheduleValidation();
    sourceEditor.focus();
  });

  document.querySelectorAll('input[name="input-format"]').forEach((control) => {
    control.addEventListener("change", scheduleValidation);
  });
  [outputFormat, indentSize, sortKeys].forEach((control) => {
    control.addEventListener("change", () => {
      if (sourceEditor.value.trim()) validateAndFormat({ quiet: true });
    });
  });

  syncEditor(sourceEditor, sourceLines);
  syncEditor(outputEditor, outputLines);
  updateSourceMeta();
  validateAndFormat({ quiet: true });
})();
