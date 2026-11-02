"use strict";

(() => {
  const engine = CronScheduleBuilder;
  const byId = (id) => document.getElementById(id);
  const expression = byId("expression");
  const scheduler = byId("scheduler");
  const timeZone = byId("timezone");
  const after = byId("preview-after");
  const count = byId("run-count");
  const actions = ["copy-config", "download-config", "copy-expression", "share-schedule", "download-runs"].map(byId);
  const presetExpressions = {
    frequent: ["*/15 * * * *", "*/15 * * * ? *"],
    daily: ["0 0 * * *", "0 0 * * ? *"],
    weekdays: ["30 9 * * MON-FRI", "30 9 ? * MON-FRI *"],
    weekly: ["0 8 * * MON", "0 8 ? * MON *"],
    monthly: ["0 0 1 * *", "0 0 1 * ? *"],
  };
  const platformNotes = {
    linux: "Cronie-style preview: skipped local times do not match; repeated local times match twice. Other cron daemons may handle clock changes differently.",
    kubernetes: "Preview uses spec.timeZone. Missing local times are skipped; repeated local times are listed twice. Concurrency and missed-job policies affect actual execution.",
    github: "Missing local times advance to the next valid time. Repeated times use the first occurrence in this preview; GitHub does not document this edge case. Minimum interval: five minutes.",
    aws: "EventBridge Scheduler skips missing local times and invokes repeated local times once. Preview shows the first occurrence. Flexible time windows are disabled in the export.",
  };
  const exportNotes = {
    linux: "Replace /path/to/your-command with your task. CRON_TZ requires a compatible implementation, such as Cronie; check your server's cron documentation.",
    kubernetes: "Example manifest, with concurrencyPolicy: Forbid. Replace the container image and command, set appropriate resources, and validate against your cluster. spec.timeZone requires Kubernetes 1.27 or later.",
    github: "Save as .github/workflows/scheduled-task.yml on the default branch and replace the example step. timezone requires a supporting GitHub version. Actual workflows may be delayed or dropped under load.",
    aws: "Schedule properties only, not a complete create-schedule request. Add a schedule name, target ARN, and execution-role ARN separately. This is EventBridge Scheduler, not scheduled EventBridge rules.",
  };
  const filenames = { linux: "crontab.txt", kubernetes: "cronjob.yaml", github: "scheduled-task.yml", aws: "schedule-properties.json" };
  let current = null;
  let renderTimer;
  let toastTimer;
  const closeTimeZones = setupTimeZonePicker();

  function setupTimeZonePicker() {
    const picker = byId("timezone-picker");
    const toggle = byId("timezone-toggle");
    const list = byId("timezone-options");
    const matches = byId("timezone-status");
    const commonZones = ["UTC", "Europe/London", "Europe/Warsaw", "America/New_York", "America/Los_Angeles", "Asia/Kolkata", "Asia/Tokyo", "Australia/Sydney"];
    let availableZones = [];
    try {
      availableZones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
    } catch { /* Common choices and manual input remain available. */ }
    const zones = [...new Set([...commonZones, ...availableZones])];
    let filteredZones = [];
    let activeIndex = -1;

    function close() {
      list.hidden = true;
      timeZone.setAttribute("aria-expanded", "false");
      timeZone.removeAttribute("aria-activedescendant");
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-label", "Show time zones");
      matches.textContent = "";
      activeIndex = -1;
    }

    function open(query = "") {
      const tokens = query.trim().toLowerCase().replaceAll("_", " ").split(/[\s/]+/).filter(Boolean);
      filteredZones = zones.filter((zone) => tokens.every((token) => zone.toLowerCase().replaceAll("_", " ").includes(token)));
      activeIndex = -1;
      timeZone.removeAttribute("aria-activedescendant");
      const fragment = document.createDocumentFragment();
      filteredZones.forEach((zone, index) => {
        const option = document.createElement("li");
        option.id = `timezone-option-${index}`;
        option.className = "timezone-option";
        option.dataset.zone = zone;
        option.dataset.index = index;
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", String(zone === timeZone.value.trim()));
        option.textContent = zone;
        fragment.append(option);
      });
      if (!filteredZones.length) {
        const empty = document.createElement("li");
        empty.className = "timezone-empty";
        empty.setAttribute("role", "option");
        empty.setAttribute("aria-disabled", "true");
        empty.textContent = "No matching suggestions. You can still type a full IANA time zone.";
        fragment.append(empty);
      }
      list.replaceChildren(fragment);
      list.hidden = false;
      list.scrollTop = 0;
      timeZone.setAttribute("aria-expanded", "true");
      toggle.setAttribute("aria-expanded", "true");
      toggle.setAttribute("aria-label", "Hide time zones");
      matches.textContent = filteredZones.length ? `${filteredZones.length} time zone${filteredZones.length === 1 ? "" : "s"} available.` : "No matching suggestions. Manual entry is still available.";
    }

    function activate(index, scroll = true) {
      if (!filteredZones.length) return;
      activeIndex = Math.max(0, Math.min(index, filteredZones.length - 1));
      [...list.children].forEach((option, position) => {
        option.classList.toggle("is-active", position === activeIndex);
        option.setAttribute("aria-selected", String(position === activeIndex));
      });
      const option = list.children[activeIndex];
      timeZone.setAttribute("aria-activedescendant", option.id);
      if (scroll) option.scrollIntoView({ block: "nearest", behavior: "instant" });
    }

    function choose(zone) {
      timeZone.value = zone;
      timeZone.focus({ preventScroll: true });
      timeZone.setSelectionRange(zone.length, zone.length);
      close();
      render();
    }

    function resumeEditing() {
      activeIndex = -1;
      timeZone.removeAttribute("aria-activedescendant");
      [...list.children].forEach((option) => {
        option.classList.remove("is-active");
        option.setAttribute("aria-selected", String(option.dataset.zone === timeZone.value.trim()));
      });
    }

    timeZone.addEventListener("focus", () => open());
    timeZone.addEventListener("click", () => {
      if (list.hidden) open();
      else resumeEditing();
    });
    timeZone.addEventListener("input", () => {
      open(timeZone.value);
      queueRender();
    });
    timeZone.addEventListener("keydown", (event) => {
      if (event.isComposing) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (event.altKey && event.key === "ArrowUp") { close(); return; }
        if (list.hidden) open();
        if (!event.altKey) activate(activeIndex < 0 ? event.key === "ArrowDown" ? 0 : filteredZones.length - 1 : activeIndex + (event.key === "ArrowDown" ? 1 : -1));
      } else if (event.key === "Enter" && !list.hidden) {
        if (activeIndex >= 0) {
          event.preventDefault();
          choose(filteredZones[activeIndex]);
        } else close();
      } else if (event.key === "Escape" && !list.hidden) {
        event.preventDefault();
        close();
      } else if (event.key === "Tab") close();
      else if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) resumeEditing();
    });
    toggle.addEventListener("mousedown", (event) => event.preventDefault());
    toggle.addEventListener("click", () => {
      const wasOpen = !list.hidden;
      timeZone.focus({ preventScroll: true });
      if (wasOpen) close();
      else open();
    });
    list.addEventListener("mousedown", (event) => event.preventDefault());
    list.addEventListener("pointermove", (event) => {
      const option = event.target.closest("[data-zone]");
      if (option && Number(option.dataset.index) !== activeIndex) activate(Number(option.dataset.index), false);
    });
    list.addEventListener("click", (event) => {
      const option = event.target.closest("[data-zone]");
      if (option) choose(option.dataset.zone);
    });
    document.addEventListener("pointerdown", (event) => { if (!picker.contains(event.target)) close(); });
    document.addEventListener("focusin", (event) => { if (!picker.contains(event.target)) close(); });
    window.addEventListener("blur", close);
    return close;
  }

  function notify(message) {
    clearTimeout(toastTimer);
    byId("toast").textContent = message;
    byId("toast").classList.add("is-visible");
    toastTimer = setTimeout(() => byId("toast").classList.remove("is-visible"), 4500);
  }

  function setNow() {
    after.value = new Date().toISOString().slice(0, 16);
  }

  function addOption(select, value, label) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.append(option);
  }

  function buildFields() {
    const container = byId("builder-fields");
    container.replaceChildren();
    engine.definitions(scheduler.value).forEach((definition, index) => {
      const card = document.createElement("div");
      card.className = "builder-field";
      const label = document.createElement("label");
      label.className = "field";
      label.textContent = definition.name;
      label.htmlFor = `builder-value-${index}`;
      const select = document.createElement("select");
      select.dataset.index = index;
      select.setAttribute("aria-label", `${definition.name} shortcut`);
      addOption(select, "custom", "Custom expression…");
      addOption(select, "*", "Every value (*)");
      if (scheduler.value === "aws" && (index === 2 || index === 4)) addOption(select, "?", "Not specified (?)");
      if (index === 0 || index === 1) {
        for (const step of index === 0 ? [5, 10, 15, 20, 30] : [2, 3, 4, 6, 12]) addOption(select, `*/${step}`, `Every ${step} ${index === 0 ? "minutes" : "hours"}`);
      }
      if (scheduler.value === "aws" && index === 2) addOption(select, "L", "Last day (L)");
      if (index !== 5) {
        for (let value = definition.min; value <= definition.max; value += 1) {
          const name = definition.names?.[value - definition.nameStart];
          addOption(select, name || String(value), name ? `${name} (${value})` : String(value).padStart(index < 2 ? 2 : 1, "0"));
        }
      }
      const input = document.createElement("input");
      input.id = `builder-value-${index}`;
      input.dataset.index = index;
      input.maxLength = 100;
      input.spellcheck = false;
      input.setAttribute("aria-describedby", `builder-help-${index}`);
      const help = document.createElement("span");
      help.className = "field-help";
      help.id = `builder-help-${index}`;
      help.textContent = `${definition.min}–${definition.max}${definition.names ? ` · ${definition.names[0]}–${definition.names.at(-1)}` : ""}`;
      card.append(label, select, input, help);
      container.append(card);
      select.addEventListener("change", () => {
        if (select.value === "custom") {
          input.focus();
          return;
        }
        input.value = select.value;
        applyBuilder();
      });
      input.addEventListener("input", applyBuilder);
    });
    const isAws = scheduler.value === "aws";
    byId("field-count").textContent = `${isAws ? 6 : 5} fields · minute precision`;
    byId("expression-help").textContent = `Minute · Hour · Day of month · Month · Day of week${isAws ? " · Year (not seconds)" : ""}`;
    byId("file-label").textContent = filenames[scheduler.value];
    byId("export-note").textContent = exportNotes[scheduler.value];
  }

  function applyBuilder() {
    expression.value = [...byId("builder-fields").querySelectorAll("input")].map((input) => input.value.trim()).join(" ");
    queueRender();
  }

  function syncBuilder(schedule) {
    if (!schedule && byId("builder-fields").contains(document.activeElement)) return;
    const tokens = schedule?.fields.map((field) => field.raw) || expression.value.trim().split(/\s+/);
    byId("builder-fields").querySelectorAll("input").forEach((input, index) => {
      if (document.activeElement !== input) input.value = tokens[index] || "";
      const select = input.previousElementSibling;
      const raw = input.value.toUpperCase();
      select.value = [...select.options].some((option) => option.value === raw) ? raw : "custom";
    });
  }

  function clearResults() {
    current = null;
    for (const button of actions) button.disabled = true;
    byId("runs-body").replaceChildren();
    byId("field-breakdown").replaceChildren();
    byId("config-output").textContent = "A valid schedule and time zone are needed to generate configuration.";
    byId("runs-summary").textContent = "Resolve the validation message to preview upcoming times.";
    byId("explanation").textContent = "Let’s check that schedule.";
    byId("schedule-note").textContent = "";
  }

  function status(title, message, type = "") {
    byId("validation-title").textContent = title;
    byId("validation-message").textContent = message;
    byId("validation-panel").className = `validation-panel${type ? ` is-${type}` : ""}`;
  }

  function offsetLabel(offset) {
    const absolute = Math.abs(offset);
    return `UTC${offset >= 0 ? "+" : "−"}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
  }

  function dateLabel(timestamp, zone) {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: zone, year: "numeric", month: "short", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).format(timestamp);
  }

  function gapLabel(milliseconds) {
    const minutes = Math.round(milliseconds / 60000);
    return [
      minutes >= 1440 ? `${Math.floor(minutes / 1440)}d` : "",
      Math.floor(minutes % 1440 / 60) ? `${Math.floor(minutes % 1440 / 60)}h` : "",
      minutes % 60 ? `${minutes % 60}m` : "",
    ].filter(Boolean).join(" ") || "0m";
  }

  function renderRuns(result, zone) {
    const fragment = document.createDocumentFragment();
    result.runs.forEach((run, index) => {
      const row = document.createElement("tr");
      const position = document.createElement("td");
      position.textContent = String(index + 1).padStart(2, "0");
      const local = document.createElement("td");
      const localTime = document.createElement("time");
      localTime.dateTime = new Date(run.timestamp).toISOString();
      localTime.textContent = dateLabel(run.timestamp, zone);
      const offset = document.createElement("small");
      offset.textContent = `${offsetLabel(run.offset)}${run.note ? ` · ${run.note}` : ""}`;
      local.append(localTime, offset);
      const utc = document.createElement("td");
      const utcTime = document.createElement("time");
      utcTime.dateTime = new Date(run.timestamp).toISOString();
      utcTime.textContent = new Date(run.timestamp).toISOString().slice(0, 16).replace("T", " ");
      utc.append(utcTime);
      const gap = document.createElement("td");
      gap.textContent = index ? gapLabel(run.timestamp - result.runs[index - 1].timestamp) : "—";
      row.append(position, local, utc, gap);
      fragment.append(row);
    });
    byId("runs-body").replaceChildren(fragment);
    byId("zone-column").textContent = `Schedule time (${zone})`;
    byId("runs-caption").textContent = `${zone} wall-clock times compared with UTC`;
  }

  function renderBreakdown(schedule) {
    const fragment = document.createDocumentFragment();
    schedule.fields.forEach((field, index) => {
      const item = document.createElement("div");
      item.className = "breakdown-item";
      const name = document.createElement("strong");
      name.textContent = field.name;
      const raw = document.createElement("code");
      raw.textContent = field.raw;
      const meaning = document.createElement("span");
      meaning.textContent = engine.fieldDescription(field, index, schedule.mode);
      item.append(name, raw, meaning);
      fragment.append(item);
    });
    byId("field-breakdown").replaceChildren(fragment);
  }

  function previewStart() {
    const value = after.value;
    if (!value || !after.validity.valid) throw new Error("Choose a UTC start between 1970 and 2191. The eight-year preview stays inside the AWS year range.");
    const timestamp = new Date(`${value}Z`).getTime();
    if (!Number.isFinite(timestamp)) throw new Error("Choose a valid preview start date in UTC.");
    return timestamp;
  }

  function render() {
    clearTimeout(renderTimer);
    clearResults();
    [expression, timeZone, after].forEach((input) => input.removeAttribute("aria-invalid"));
    let input = expression;
    try {
      const schedule = engine.parse(expression.value, scheduler.value);
      input = timeZone;
      const zone = timeZone.value.trim();
      // Restrict to named IANA zones rather than engine-specific offset strings.
      if (!/^[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+)*$/.test(zone)) throw new Error("Enter an IANA time zone such as UTC, Europe/London, or America/New_York.");
      engine.createClock(zone);
      input = after;
      const start = previewStart();
      const requestedCount = Number(count.value);
      const evaluated = engine.nextRuns(schedule, {
        timeZone: zone,
        after: start,
        count: schedule.mode === "github" ? Math.max(requestedCount, 10) : requestedCount,
      });
      const result = { ...evaluated, runs: evaluated.runs.slice(0, requestedCount) };
      const warnings = [];
      const dayFields = schedule.fields.slice(2, 5);
      if (schedule.mode !== "aws" && !dayFields[0].wildcard && !dayFields[2].wildcard) warnings.push("Both day fields are restricted: day of month OR day of week can match.");
      const intervals = evaluated.runs.slice(1).map((run, index) => run.timestamp - evaluated.runs[index].timestamp);
      if (schedule.mode === "github" && intervals.some((gap) => gap < 5 * 60000)) {
        warnings.push("GitHub Actions supports a minimum interval of five minutes. This expression has more frequent matches; choose a less frequent schedule before deploying.");
      }
      if (new Set(result.runs.map((run) => run.offset)).size > 1) warnings.push("A UTC offset changes within this preview. Check the local and UTC columns around the clock change.");
      if (result.runs.length < Number(count.value)) warnings.push(`Found ${result.runs.length} matching time${result.runs.length === 1 ? "" : "s"} in the eight-year search window. Check calendar dates, the year field, or move the preview start.`);
      status(warnings.length ? "Valid expression · Review the schedule" : "Valid expression · Ready to use", warnings.join(" ") || `${engine.modes[schedule.mode].name} syntax checked. Times below are interpreted in ${zone}; actual execution depends on your scheduler.`, warnings.length ? "warning" : "");
      byId("explanation").textContent = engine.explain(schedule);
      byId("schedule-note").textContent = `${zone} · ${platformNotes[schedule.mode]}`;
      renderBreakdown(schedule);
      renderRuns(result, zone);
      const config = engine.snippet(schedule, zone);
      byId("config-output").textContent = config;
      byId("runs-summary").textContent = result.runs.length ? `${result.runs.length} ${result.runs.length === 1 ? "match" : "matches"} after ${new Date(start).toISOString().slice(0, 16).replace("T", " ")} UTC. Gap is elapsed time between consecutive matches.` : "No matching time found within eight calendar years. Valid syntax does not guarantee a possible calendar date.";
      current = { schedule, zone, start, result, config };
      for (const button of actions) button.disabled = button.id === "download-runs" && !result.runs.length;
      syncBuilder(schedule);
    } catch (error) {
      input.setAttribute("aria-invalid", "true");
      status("Check your schedule", error.message, "error");
      syncBuilder();
    }
  }

  function queueRender() {
    clearTimeout(renderTimer);
    clearResults();
    status("Checking schedule…", "Updating the preview.");
    renderTimer = setTimeout(render, 180);
  }

  async function copy(text, message) {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.append(textarea);
        const active = document.activeElement;
        textarea.select();
        const copied = document.execCommand("copy");
        textarea.remove();
        active?.focus();
        if (!copied) throw new Error("Copy unavailable");
      }
      notify(message);
    } catch {
      notify("Clipboard unavailable. Select and copy the expression or configuration manually.");
    }
  }

  function download(text, filename, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function restoreShare() {
    const hash = location.hash.slice(1);
    if (!hash.startsWith("schedule=") || hash.length > 2500) return;
    const params = new URLSearchParams(hash);
    const mode = params.get("mode");
    if (Object.hasOwn(engine.modes, mode)) scheduler.value = mode;
    expression.value = (params.get("schedule") || "").slice(0, 512);
    if (params.has("zone")) timeZone.value = params.get("zone").slice(0, 100);
    if (params.has("after")) after.value = params.get("after");
    if ([...count.options].some((option) => option.value === params.get("count"))) count.value = params.get("count");
  }

  byId("schedule-form").addEventListener("submit", (event) => {
    event.preventDefault();
    render();
  });
  expression.addEventListener("input", queueRender);
  after.addEventListener("change", render);
  count.addEventListener("change", render);
  scheduler.addEventListener("change", () => {
    buildFields();
    render();
    if (!current) notify("Expression kept. Choose a preset to load this scheduler’s syntax.");
  });
  byId("local-zone").addEventListener("click", () => {
    closeTimeZones();
    timeZone.value = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    render();
  });
  byId("use-now").addEventListener("click", () => { setNow(); render(); });
  document.querySelectorAll("[data-preset]").forEach((button) => button.addEventListener("click", () => {
    expression.value = presetExpressions[button.dataset.preset][scheduler.value === "aws" ? 1 : 0];
    render();
  }));
  document.querySelectorAll("[data-example]").forEach((button) => button.addEventListener("click", () => {
    scheduler.value = "linux";
    expression.value = button.dataset.example;
    buildFields();
    render();
    expression.focus();
    expression.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  }));
  byId("copy-config").addEventListener("click", () => { if (current) copy(current.config, "Scheduler configuration copied."); });
  byId("copy-expression").addEventListener("click", () => {
    if (current) copy(current.schedule.mode === "aws" ? `cron(${current.schedule.expression})` : current.schedule.expression, "Cron expression copied.");
  });
  byId("download-config").addEventListener("click", () => {
    if (current) download(current.config, filenames[current.schedule.mode], "text/plain;charset=utf-8");
  });
  byId("download-runs").addEventListener("click", () => {
    if (!current) return;
    const quote = (value) => `"${String(value).replaceAll('"', '""')}"`;
    const rows = [["Run", "Schedule time", "Time zone", "UTC offset", "UTC instant", "Note"]];
    current.result.runs.forEach((run, index) => rows.push([index + 1, dateLabel(run.timestamp, current.zone), current.zone, offsetLabel(run.offset), new Date(run.timestamp).toISOString(), run.note]));
    download(rows.map((row) => row.map(quote).join(",")).join("\r\n") + "\r\n", "cron-upcoming-runs.csv", "text/csv;charset=utf-8");
  });
  byId("share-schedule").addEventListener("click", () => {
    if (!current) return;
    const params = new URLSearchParams({ schedule: current.schedule.expression, mode: current.schedule.mode, zone: current.zone, after: after.value, count: count.value });
    const url = new URL(location.href);
    url.search = "";
    url.hash = params.toString();
    copy(url.href, "Share link copied. It includes your schedule settings.");
  });
  window.addEventListener("hashchange", () => { closeTimeZones(); restoreShare(); buildFields(); render(); });
  setNow();
  restoreShare();
  buildFields();
  render();
})();
