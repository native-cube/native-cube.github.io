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
  const requiredComment = requiredCount === 0
    ? "  # no required variables"
    : `  # insert the ${requiredCount} required ${requiredCount === 1 ? "variable" : "variables"} here`;

  return [
    `module "${moduleName}" {`,
    `  source  = "${source}"`,
    `  version = "${version}"`,
    "",
    requiredComment,
    "}",
  ].join("\n");
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
  const label = button.querySelector("span");
  const originalLabel = "Copy module block";

  try {
    await writeToClipboard(example);
    label.textContent = "Copied";
    button.classList.add("is-copied");
    button.setAttribute("aria-label", `${moduleTitle} module block copied to clipboard`);
    showCopyStatus(`${moduleTitle} module block copied.`);

    window.setTimeout(() => {
      label.textContent = originalLabel;
      button.classList.remove("is-copied");
      button.setAttribute("aria-label", `Copy ${moduleTitle} module block`);
    }, 1800);
  } catch (error) {
    label.textContent = "Unavailable";
    showCopyStatus(`Could not copy the ${moduleTitle} module block.`, true);

    window.setTimeout(() => {
      label.textContent = originalLabel;
    }, 1800);
  }
}

for (const button of copyButtons) {
  button.addEventListener("click", () => copySource(button));
}
