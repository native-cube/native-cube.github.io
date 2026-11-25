"use strict";

function setupTimeZonePicker(timeZone, { onInput, onSelect }) {
  const picker = timeZone.closest(".timezone-picker");
  const toggle = picker.querySelector("button");
  const list = document.getElementById(timeZone.getAttribute("aria-controls"));
  const matches = picker.querySelector("[role=status]");
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
      option.id = `${list.id}-${index}`;
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
    onSelect();
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
    onInput();
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
