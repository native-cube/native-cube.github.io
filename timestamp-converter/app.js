"use strict";

(() => {
  const engine = TimestampConverter;
  const byId = (id) => document.getElementById(id);
  const form = byId("timestamp-form");
  const timeZone = byId("timezone");
  const zoneError = byId("zone-error");
  const events = ["a", "b"].map((key) => {
    const results = byId(`results-${key}`);
    return {
      input: byId(`timestamp-${key}`),
      format: byId(`format-${key}`),
      status: byId(`status-${key}`),
      now: byId(`event-${key}`).querySelector("[data-now]"),
      results,
      outputs: [...results.querySelectorAll("[data-output]")].map((value) => ({
        value,
        copyButton: results.querySelector(`[data-copy="${value.dataset.output}"]`),
      })),
    };
  });
  const labels = { seconds: "Unix seconds", milliseconds: "Unix milliseconds", iso: "ISO 8601" };
  const eventOrder = byId("event-order");
  const comparison = byId("comparison");
  const flags = byId("cloudwatch-flags");
  const copyBounds = byId("copy-bounds");
  const toast = byId("toast");
  const examples = [...document.querySelectorAll("[data-example]")];
  let exampleIndex = -1;
  let toastTimer;
  let lastZone;
  let zoneFormatter;
  const closeTimeZones = setupTimeZonePicker(timeZone, { onInput: render, onSelect: render });

  function notify(message) {
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add("is-visible");
    toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 4500);
  }

  async function copy(text, message) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const field = document.createElement("textarea");
      field.value = text;
      field.readOnly = true;
      field.tabIndex = -1;
      field.style.cssText = "position:fixed;top:0;left:0;opacity:0";
      const active = document.activeElement;
      document.body.append(field);
      try {
        field.select();
        if (!document.execCommand("copy")) throw new Error("Copy unavailable");
      } catch {
        notify("Select the result to copy it manually.");
        return;
      } finally {
        field.remove();
        active?.focus({ preventScroll: true });
      }
    }
    notify(message);
  }

  function displayZone() {
    const zone = timeZone.value.trim();
    if (zone === lastZone) return zoneFormatter;
    lastZone = zone;

    try {
      if (!zone) throw new RangeError();
      zoneFormatter = engine.createZoneFormatter(zone);
      timeZone.removeAttribute("aria-invalid");
      zoneError.hidden = true;
      zoneError.textContent = "";
    } catch {
      zoneFormatter = null;
      timeZone.setAttribute("aria-invalid", "true");
      zoneError.textContent = "Choose a supported time zone, such as UTC or Europe/London.";
      zoneError.hidden = false;
    }
    return zoneFormatter;
  }

  function renderEvent(event, formatter) {
    const input = event.input.value.trim();
    let timestamp;
    let error = "";

    if (input) {
      try {
        timestamp = engine.parseTimestamp(input, event.format.value);
      } catch (failure) {
        error = failure.message;
      }
    }

    if (error) event.input.setAttribute("aria-invalid", "true");
    else event.input.removeAttribute("aria-invalid");
    event.status.classList.toggle("input-error", Boolean(error));
    const status = error || (timestamp && event.format.value === "auto" ? `Detected ${labels[timestamp.format]}.` : "");
    if (event.status.textContent !== status) event.status.textContent = status;

    event.results.hidden = !timestamp;
    const values = timestamp ? engine.formatTimestamp(timestamp.nanoseconds, formatter) : {};
    for (const { value, copyButton } of event.outputs) {
      const result = values[value.dataset.output];
      value.textContent = result || "—";
      copyButton.disabled = !result;
    }
    return timestamp;
  }

  function renderComparison(a, b) {
    comparison.hidden = !(a && b);
    copyBounds.disabled = true;
    flags.textContent = "";
    if (!a || !b) {
      eventOrder.textContent = "";
      return;
    }

    const result = engine.compareTimestamps(a.nanoseconds, b.nanoseconds);
    const order = result.earlier ? `Timestamp ${result.earlier} came first.` : "Both timestamps describe the same instant.";
    if (eventOrder.textContent !== order) eventOrder.textContent = order;
    byId("elapsed-duration").textContent = result.duration;
    byId("elapsed-milliseconds").textContent = `${result.milliseconds} ms`;

    copyBounds.hidden = flags.parentElement.hidden = !result.cloudWatch;
    const note = byId("cloudwatch-note");
    if (!result.cloudWatch) {
      note.textContent = "CloudWatch Logs accepts ranges from 1 January 1970 UTC onward.";
      return;
    }

    const { start, end, rounded } = result.cloudWatch;
    flags.textContent = `--start-time ${start} --end-time ${end}`;
    note.textContent = rounded ? "Rounded outward to whole milliseconds." : "Inclusive bounds in Unix milliseconds.";
    copyBounds.disabled = false;
  }

  function render() {
    const formatter = displayZone();
    const [a, b] = events.map((event) => renderEvent(event, formatter));
    renderComparison(a, b);
  }

  function loadExample(index) {
    const example = examples[index];
    const { first, second = "", zone } = example.dataset;
    exampleIndex = index;
    events[0].input.value = first;
    events[1].input.value = second;
    for (const event of events) event.format.value = "auto";
    if (zone) timeZone.value = zone;
    closeTimeZones();
    render();
    notify(`Loaded “${example.querySelector("strong").textContent}”.`);
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    render();
    const invalid = form.querySelector('[aria-invalid="true"]');
    if (invalid) invalid.focus();
    else if (events.some(({ input }) => input.value.trim())) notify("Timestamps converted.");
    else events[0].input.focus();
  });

  for (const event of events) {
    event.input.addEventListener("input", render);
    event.input.addEventListener("paste", (paste) => {
      const text = paste.clipboardData?.getData("text/plain") ?? "";
      if (!/[\r\n]/.test(text.trim())) return;
      paste.preventDefault();
      notify("Paste one timestamp into each field.");
    });
    event.format.addEventListener("change", render);
    event.now.addEventListener("click", () => {
      event.input.value = new Date().toISOString();
      event.format.value = "iso";
      render();
    });
    for (const { value, copyButton } of event.outputs) {
      copyButton.addEventListener("click", () => copy(value.textContent, "Timestamp copied."));
    }
  }

  byId("local-zone").addEventListener("click", () => {
    closeTimeZones();
    timeZone.value = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    render();
  });
  byId("clear-timestamps").addEventListener("click", () => {
    for (const event of events) {
      event.input.value = "";
      event.format.value = "auto";
    }
    render();
    events[0].input.focus();
  });
  examples.forEach((example, index) => {
    example.addEventListener("click", () => {
      loadExample(index);
      events[0].input.focus({ preventScroll: true });
      events[0].input.scrollIntoView({ block: "nearest" });
    });
  });
  byId("load-example").addEventListener("click", () => loadExample((exampleIndex + 1) % examples.length));
  copyBounds.addEventListener("click", () => copy(flags.textContent, "CloudWatch time bounds copied."));

  render();
})();
