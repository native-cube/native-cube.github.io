"use strict";

const copyButtons = document.querySelectorAll("[data-module-copy]");
const copyStatus = document.querySelector("#copy-status");
let copyStatusTimer;

function showCopyStatus(message, isError = false) {
  window.clearTimeout(copyStatusTimer);
  copyStatus.textContent = message;
  copyStatus.classList.toggle("is-error", isError);
  copyStatus.classList.add("is-visible");

  copyStatusTimer = window.setTimeout(() => {
    copyStatus.classList.remove("is-visible", "is-error");
  }, 2600);
}

function buildModuleExample(button) {
  const moduleName = button.dataset.module;
  const source = button.dataset.source;
  const version = button.dataset.version;
  const requiredCount = Number(button.dataset.required);
  const lines = [
    `module "${moduleName}" {`,
    `  source  = "${source}"`,
    `  version = "${version}"`,
  ];

  if (requiredCount === 0) {
    lines.push("", "  # no required variables");
  } else if (button.dataset.snippet === "starter") {
    const inputs = JSON.parse(button.dataset.inputs || "[]");
    const longestName = Math.max(...inputs.map((input) => input.name.length));
    lines.push("");
    for (const input of inputs) {
      const padding = " ".repeat(longestName - input.name.length + 1);
      lines.push(`  # ${input.name}${padding}= ${inputPlaceholder(input.type)}`);
    }
  } else {
    const noun = requiredCount === 1 ? "variable" : "variables";
    lines.push("", `  # insert the ${requiredCount} required ${noun} here`);
  }

  lines.push("}");
  return lines.join("\n");
}

function inputPlaceholder(type) {
  const normalized = type.replace(/\s+/g, "");
  if (normalized === "string") {
    return '"replace-me"';
  }
  if (normalized === "number") {
    return "0";
  }
  if (normalized === "bool") {
    return "false";
  }
  if (/^(list|set|tuple)\(/.test(normalized)) {
    return "[]";
  }
  if (/^(map|object)\(/.test(normalized)) {
    return "{}";
  }
  return "null";
}

async function writeToClipboard(value) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch (error) {
      // Continue to the browser fallback when clipboard permission is unavailable.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();

  if (!copied) {
    throw new Error("Clipboard access is unavailable");
  }
}

async function copySource(button) {
  const example = buildModuleExample(button);
  const moduleTitle = button.dataset.title;
  const label = button.querySelector("span") || button;
  const originalLabel = label.textContent;
  const snippetLabel = button.dataset.snippet === "starter" ? "starter block" : "module block";

  try {
    await writeToClipboard(example);
    label.textContent = "Copied";
    button.classList.add("is-copied");
    button.setAttribute("aria-label", `${moduleTitle} ${snippetLabel} copied to clipboard`);
    showCopyStatus(`${moduleTitle} ${snippetLabel} copied.`);

    window.setTimeout(() => {
      label.textContent = originalLabel;
      button.classList.remove("is-copied");
      button.setAttribute("aria-label", `Copy ${moduleTitle} ${snippetLabel}`);
    }, 1800);
  } catch (error) {
    label.textContent = "Unavailable";
    showCopyStatus(`Could not copy the ${moduleTitle} ${snippetLabel}.`, true);

    window.setTimeout(() => {
      label.textContent = originalLabel;
    }, 1800);
  }
}

for (const button of copyButtons) {
  button.addEventListener("click", () => copySource(button));
}
