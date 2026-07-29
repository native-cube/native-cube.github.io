(() => {
  "use strict";

  const MAX_SUBNETS = 512;
  const COLORS = [
    "#2563eb",
    "#16805a",
    "#7c5ce7",
    "#d97706",
    "#0787a5",
    "#c94f70",
  ];
  const MODES = new Set(["standard", "aws", "azure"]);

  function parseIPv4(input) {
    const parts = input.trim().split(".");
    if (
      parts.length !== 4 ||
      parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)
    ) {
      throw new Error("Enter a valid IPv4 address, for example 10.10.0.0.");
    }

    return parts.reduce((result, part) => result * 256 + Number(part), 0);
  }

  function intToIPv4(input) {
    const value = Number(input);
    return [
      Math.floor(value / 2 ** 24) % 256,
      Math.floor(value / 2 ** 16) % 256,
      Math.floor(value / 2 ** 8) % 256,
      value % 256,
    ].join(".");
  }

  function blockSize(prefix) {
    return 2 ** (32 - prefix);
  }

  function parseCidr(input) {
    const match = input.trim().match(/^([^/]+)\/(\d{1,2})$/);
    if (!match) {
      throw new Error("Use CIDR notation, for example 10.42.0.0/16.");
    }

    const address = parseIPv4(match[1]);
    const prefix = Number(match[2]);
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
      throw new Error("The CIDR prefix must be between 0 and 32.");
    }

    const size = blockSize(prefix);
    const network = Math.floor(address / size) * size;
    return {
      network,
      prefix,
      normalized: network !== address,
    };
  }

  function subnetDetails(network, prefix, mode = "standard") {
    const size = blockSize(prefix);
    const broadcast = network + size - 1;
    let firstUsable;
    let lastUsable;
    let usable;

    if (mode === "standard") {
      if (prefix === 32) {
        firstUsable = network;
        lastUsable = network;
        usable = 1;
      } else if (prefix === 31) {
        firstUsable = network;
        lastUsable = broadcast;
        usable = 2;
      } else {
        firstUsable = network + 1;
        lastUsable = broadcast - 1;
        usable = size - 2;
      }
    } else {
      usable = Math.max(size - 5, 0);
      if (usable > 0) {
        firstUsable = network + 4;
        lastUsable = broadcast - 1;
      }
    }

    return {
      size,
      broadcast,
      firstUsable,
      lastUsable,
      usable,
    };
  }

  const subnetMath = {
    blockSize,
    intToIPv4,
    parseCidr,
    parseIPv4,
    subnetDetails,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = subnetMath;
  }

  if (typeof document === "undefined") return;

  const byId = (id) => document.getElementById(id);
  const form = byId("network-form");
  const networkInput = byId("network-input");
  const modeSelect = byId("mode-select");
  const networkError = byId("network-error");
  const rowsContainer = byId("subnet-rows");
  const mapContainer = byId("subnet-map");
  const toast = byId("toast");
  let toastTimer;
  let networkReloadTimer;
  let state;

  function formatNumber(value) {
    return new Intl.NumberFormat("en-US").format(value);
  }

  function cidrOf(subnet) {
    return `${intToIPv4(subnet.network)}/${subnet.prefix}`;
  }

  function makeSubnet(network, prefix, colorIndex = 0, note = "") {
    return {
      id: `subnet-${network}-${prefix}`,
      network,
      prefix,
      color: COLORS[colorIndex % COLORS.length],
      note,
    };
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add("is-visible");
    toastTimer = window.setTimeout(() => {
      toast.classList.remove("is-visible");
    }, 2600);
  }

  function modeLabel(mode) {
    return {
      standard: "Standard IPv4",
      aws: "AWS VPC",
      azure: "Azure VNet",
    }[mode];
  }

  function updateModeHint() {
    const hints = {
      standard:
        "Network and broadcast are reserved; /31 and /32 follow point-to-point rules.",
      aws: "AWS reserves the first four and last address in every subnet.",
      azure: "Azure reserves the first four and last address in every subnet.",
    };
    byId("mode-hint").textContent = hints[modeSelect.value];
  }

  function buildPlan(cidr, mode) {
    state = {
      baseNetwork: cidr.network,
      basePrefix: cidr.prefix,
      mode,
      subnets: [makeSubnet(cidr.network, cidr.prefix)],
    };
    render();
  }

  function setNetworkFeedback(
    message = "Changes apply automatically.",
    isError = false,
  ) {
    networkError.textContent = message;
    networkError.classList.toggle("is-error", isError);
  }

  function applyNetworkInput(
    { announce = false, focusOnError = false, forceReset = false } = {},
  ) {
    window.clearTimeout(networkReloadTimer);
    try {
      const cidr = parseCidr(networkInput.value);
      const changed =
        forceReset ||
        !state ||
        cidr.network !== state.baseNetwork ||
        cidr.prefix !== state.basePrefix;

      networkInput.value = `${intToIPv4(cidr.network)}/${cidr.prefix}`;
      setNetworkFeedback();

      if (changed) {
        buildPlan(cidr, modeSelect.value);
        if (cidr.normalized) {
          showToast("Host bits were cleared to use the network address.");
        } else if (forceReset) {
          showToast("Subnet plan reset.");
        } else if (announce) {
          showToast("Network updated.");
        }
      } else if (cidr.normalized) {
        showToast("Host bits were cleared to use the network address.");
      }
    } catch (error) {
      setNetworkFeedback(error.message, true);
      if (focusOnError) networkInput.focus();
    }
  }

  function siblingFor(subnet) {
    if (subnet.prefix <= state.basePrefix) return undefined;
    const size = blockSize(subnet.prefix);
    const parentSize = size * 2;
    const parentNetwork = Math.floor(subnet.network / parentSize) * parentSize;
    const siblingNetwork =
      subnet.network === parentNetwork ? parentNetwork + size : parentNetwork;
    return state.subnets.find(
      (candidate) =>
        candidate.prefix === subnet.prefix &&
        candidate.network === siblingNetwork,
    );
  }

  function splitSubnet(id) {
    if (state.subnets.length >= MAX_SUBNETS) {
      showToast(`Plans are limited to ${MAX_SUBNETS} visible subnets.`);
      return;
    }

    const index = state.subnets.findIndex((subnet) => subnet.id === id);
    const subnet = state.subnets[index];
    if (!subnet || subnet.prefix === 32) return;

    const childPrefix = subnet.prefix + 1;
    const childSize = blockSize(childPrefix);
    const colorIndex = Math.max(COLORS.indexOf(subnet.color), 0);
    state.subnets.splice(
      index,
      1,
      makeSubnet(subnet.network, childPrefix, colorIndex, subnet.note),
      makeSubnet(subnet.network + childSize, childPrefix, colorIndex + 1),
    );
    render();
  }

  function joinSubnet(id) {
    const subnet = state.subnets.find((candidate) => candidate.id === id);
    const sibling = subnet ? siblingFor(subnet) : undefined;
    if (!subnet || !sibling) return;

    const first = subnet.network < sibling.network ? subnet : sibling;
    const second = first === subnet ? sibling : subnet;
    const notes = [first.note, second.note].filter(Boolean);
    const joined = makeSubnet(
      first.network,
      first.prefix - 1,
      Math.max(COLORS.indexOf(first.color), 0),
      [...new Set(notes)].join(" · ").slice(0, 80),
    );

    state.subnets = state.subnets
      .filter((candidate) => candidate !== subnet && candidate !== sibling)
      .concat(joined)
      .sort((a, b) => a.network - b.network);
    render();
  }

  function splitAll() {
    const splittable = state.subnets.filter((subnet) => subnet.prefix < 32);
    if (!splittable.length) {
      showToast("Every subnet is already a /32.");
      return;
    }
    if (state.subnets.length + splittable.length > MAX_SUBNETS) {
      showToast(`Splitting all would exceed the ${MAX_SUBNETS}-subnet limit.`);
      return;
    }

    state.subnets = state.subnets.flatMap((subnet, index) => {
      if (subnet.prefix === 32) return subnet;
      const childPrefix = subnet.prefix + 1;
      const childSize = blockSize(childPrefix);
      const colorIndex = Math.max(COLORS.indexOf(subnet.color), index);
      return [
        makeSubnet(subnet.network, childPrefix, colorIndex, subnet.note),
        makeSubnet(subnet.network + childSize, childPrefix, colorIndex + 1),
      ];
    });
    render();
  }

  function cycleColor(id) {
    const subnet = state.subnets.find((candidate) => candidate.id === id);
    if (!subnet) return;
    const currentIndex = COLORS.indexOf(subnet.color);
    subnet.color = COLORS[(currentIndex + 1) % COLORS.length];
    render();
  }

  function createCell(row, className, text) {
    const cell = document.createElement("td");
    if (className) cell.className = className;
    if (text !== undefined) cell.textContent = text;
    row.append(cell);
    return cell;
  }

  function createAction(label, action, subnet, disabled = false) {
    const button = document.createElement("button");
    button.className = "icon-button";
    button.type = "button";
    button.textContent = label;
    button.dataset.action = action;
    button.dataset.id = subnet.id;
    button.disabled = disabled;
    return button;
  }

  function renderRow(subnet) {
    const details = subnetDetails(subnet.network, subnet.prefix, state.mode);
    const row = document.createElement("tr");
    row.id = `row-${subnet.id}`;
    row.style.setProperty("--row-color", subnet.color);

    const subnetCell = createCell(row, "subnet-cell");
    const colorButton = document.createElement("button");
    colorButton.className = "color-button";
    colorButton.type = "button";
    colorButton.dataset.action = "color";
    colorButton.dataset.id = subnet.id;
    colorButton.title = `Change color for ${cidrOf(subnet)}`;
    colorButton.setAttribute("aria-label", colorButton.title);
    subnetCell.append(colorButton);
    const cidr = document.createElement("span");
    cidr.className = "cidr";
    cidr.textContent = cidrOf(subnet);
    subnetCell.append(cidr);

    createCell(
      row,
      "address-range",
      `${intToIPv4(subnet.network)} – ${intToIPv4(details.broadcast)}`,
    );
    createCell(
      row,
      "address-range",
      details.usable
        ? `${intToIPv4(details.firstUsable)} – ${intToIPv4(details.lastUsable)}`
        : "No usable addresses",
    );
    createCell(row, "host-count", formatNumber(details.usable));

    const noteCell = createCell(row);
    const noteInput = document.createElement("input");
    noteInput.className = "note-input";
    noteInput.value = subnet.note;
    noteInput.maxLength = 80;
    noteInput.placeholder = "Add purpose or owner…";
    noteInput.dataset.noteFor = subnet.id;
    noteInput.setAttribute("aria-label", `Note for ${cidrOf(subnet)}`);
    noteCell.append(noteInput);

    const actions = createCell(row, "row-actions");
    actions.append(
      createAction(
        "Split",
        "split",
        subnet,
        subnet.prefix === 32 || state.subnets.length >= MAX_SUBNETS,
      ),
      createAction("Join", "join", subnet, !siblingFor(subnet)),
    );
    return row;
  }

  function renderMap() {
    mapContainer.replaceChildren();
    const baseSize = blockSize(state.basePrefix);
    mapContainer.classList.toggle("is-dense", state.subnets.length > 128);
    mapContainer.style.gap =
      state.subnets.length > 128
        ? "0"
        : state.subnets.length > 64
          ? "1px"
          : "3px";

    state.subnets.forEach((subnet) => {
      const size = blockSize(subnet.prefix);
      const percentage = (size / baseSize) * 100;
      const segment = document.createElement("button");
      segment.className = "map-segment";
      segment.type = "button";
      segment.style.flexGrow = String(size);
      segment.style.flexBasis = "0";
      segment.style.setProperty("--segment-color", subnet.color);
      segment.dataset.id = subnet.id;
      segment.title = `${cidrOf(subnet)} · ${formatNumber(size)} addresses${
        subnet.note ? ` · ${subnet.note}` : ""
      }`;
      segment.setAttribute("aria-label", segment.title);

      if (percentage >= 4.5) {
        const label = document.createElement("span");
        label.textContent = subnet.note || cidrOf(subnet);
        segment.append(label);
      }
      mapContainer.append(segment);
    });
  }

  function render() {
    state.subnets.sort((a, b) => a.network - b.network);
    const base = subnetDetails(state.baseNetwork, state.basePrefix, state.mode);
    const totalUsable = state.subnets.reduce(
      (total, subnet) =>
        total + subnetDetails(subnet.network, subnet.prefix, state.mode).usable,
      0,
    );

    byId("summary-network").textContent =
      `${intToIPv4(state.baseNetwork)}/${state.basePrefix}`;
    byId("summary-subnets").textContent = formatNumber(state.subnets.length);
    byId("summary-addresses").textContent = formatNumber(base.size);
    byId("summary-usable").textContent = formatNumber(totalUsable);
    byId("plan-caption").textContent =
      `${intToIPv4(state.baseNetwork)} – ${intToIPv4(base.broadcast)} · ${modeLabel(state.mode)} policy`;

    rowsContainer.replaceChildren(
      ...state.subnets.map((subnet) => renderRow(subnet)),
    );
    renderMap();

    const splittableCount = state.subnets.filter(
      (subnet) => subnet.prefix < 32,
    ).length;
    byId("split-all-button").disabled =
      splittableCount === 0 ||
      state.subnets.length + splittableCount > MAX_SUBNETS;
  }

  function serializableState() {
    return {
      version: 1,
      base: [state.baseNetwork, state.basePrefix],
      mode: state.mode,
      subnets: state.subnets.map((subnet) => [
        subnet.network,
        subnet.prefix,
        subnet.color,
        subnet.note,
      ]),
    };
  }

  function encodeState() {
    const bytes = new TextEncoder().encode(JSON.stringify(serializableState()));
    let binary = "";
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return window
      .btoa(binary)
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/, "");
  }

  function decodeState(encoded) {
    if (!encoded || encoded.length > 100000) {
      throw new Error("The shared plan is empty or too large.");
    }

    const padded = encoded.replaceAll("-", "+").replaceAll("_", "/");
    const binary = window.atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const data = JSON.parse(new TextDecoder().decode(bytes));
    if (
      data.version !== 1 ||
      !Array.isArray(data.base) ||
      !MODES.has(data.mode) ||
      !Array.isArray(data.subnets) ||
      data.subnets.length < 1 ||
      data.subnets.length > MAX_SUBNETS
    ) {
      throw new Error("The shared plan has an unsupported format.");
    }

    const baseNetwork = Number(data.base[0]);
    const basePrefix = Number(data.base[1]);
    if (
      !Number.isInteger(baseNetwork) ||
      !Number.isInteger(basePrefix) ||
      baseNetwork < 0 ||
      baseNetwork > 2 ** 32 - 1 ||
      basePrefix < 0 ||
      basePrefix > 32 ||
      baseNetwork % blockSize(basePrefix) !== 0
    ) {
      throw new Error("The shared plan contains an invalid base network.");
    }

    const subnets = data.subnets
      .map((item, index) => {
        if (!Array.isArray(item)) {
          throw new Error("The shared plan contains an invalid subnet.");
        }
        const network = Number(item[0]);
        const prefix = Number(item[1]);
        if (
          !Number.isInteger(network) ||
          !Number.isInteger(prefix) ||
          prefix < basePrefix ||
          prefix > 32 ||
          network % blockSize(prefix) !== 0
        ) {
          throw new Error("The shared plan contains an invalid subnet.");
        }
        const color = COLORS.includes(item[2]) ? item[2] : COLORS[index % COLORS.length];
        const note = typeof item[3] === "string" ? item[3].slice(0, 80) : "";
        return {
          ...makeSubnet(network, prefix, index, note),
          color,
        };
      })
      .sort((a, b) => a.network - b.network);

    const baseEnd = baseNetwork + blockSize(basePrefix);
    let expectedNetwork = baseNetwork;
    subnets.forEach((subnet) => {
      if (
        subnet.network !== expectedNetwork ||
        subnet.network + blockSize(subnet.prefix) > baseEnd
      ) {
        throw new Error("The shared subnets do not form a complete network.");
      }
      expectedNetwork += blockSize(subnet.prefix);
    });
    if (expectedNetwork !== baseEnd) {
      throw new Error("The shared subnets do not cover the complete network.");
    }

    return {
      baseNetwork,
      basePrefix,
      mode: data.mode,
      subnets,
    };
  }

  async function copyText(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const input = document.createElement("textarea");
    input.value = text;
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.append(input);
    input.select();
    document.execCommand("copy");
    input.remove();
  }

  async function copyShareLink() {
    const url = new URL(window.location.href);
    url.search = "";
    url.hash = "";
    url.searchParams.set("design", encodeState());
    try {
      await copyText(url.toString());
      showToast("Share link copied to the clipboard.");
    } catch {
      showToast("Clipboard access was blocked by the browser.");
    }
  }

  function exportJson() {
    const data = JSON.stringify(
      {
        baseNetwork: `${intToIPv4(state.baseNetwork)}/${state.basePrefix}`,
        addressPolicy: state.mode,
        subnets: state.subnets.map((subnet) => {
          const details = subnetDetails(subnet.network, subnet.prefix, state.mode);
          return {
            cidr: cidrOf(subnet),
            firstAddress: intToIPv4(subnet.network),
            lastAddress: intToIPv4(details.broadcast),
            usableAddresses: details.usable,
            note: subnet.note,
          };
        }),
      },
      null,
      2,
    );
    const blobUrl = URL.createObjectURL(
      new Blob([`${data}\n`], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download =
      `subnet-plan-${intToIPv4(state.baseNetwork).replaceAll(".", "-")}-${state.basePrefix}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(blobUrl);
    showToast("Subnet plan exported as JSON.");
  }

  function loadExample() {
    networkInput.value = "10.10.0.0/16";
    modeSelect.value = "aws";
    updateModeHint();
    buildPlan(parseCidr(networkInput.value), "aws");
    setNetworkFeedback();
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    applyNetworkInput({ announce: true, focusOnError: true });
  });

  networkInput.addEventListener("input", () => {
    window.clearTimeout(networkReloadTimer);
    setNetworkFeedback("Waiting for a valid CIDR…");
    networkReloadTimer = window.setTimeout(() => {
      applyNetworkInput({ announce: true });
    }, 450);
  });

  networkInput.addEventListener("blur", () => {
    applyNetworkInput({ announce: true });
  });

  modeSelect.addEventListener("change", () => {
    updateModeHint();
    if (state) {
      state.mode = modeSelect.value;
      render();
    }
  });

  rowsContainer.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const actions = {
      color: cycleColor,
      split: splitSubnet,
      join: joinSubnet,
    };
    actions[button.dataset.action]?.(button.dataset.id);
  });

  rowsContainer.addEventListener("input", (event) => {
    const id = event.target.dataset.noteFor;
    if (!id) return;
    const subnet = state.subnets.find((candidate) => candidate.id === id);
    if (subnet) {
      subnet.note = event.target.value;
      renderMap();
    }
  });

  mapContainer.addEventListener("click", (event) => {
    const segment = event.target.closest(".map-segment");
    if (!segment) return;
    const row = byId(`row-${segment.dataset.id}`);
    row?.scrollIntoView({ behavior: "smooth", block: "center" });
    row?.querySelector(".note-input")?.focus({ preventScroll: true });
  });

  byId("split-all-button").addEventListener("click", splitAll);
  byId("share-button").addEventListener("click", copyShareLink);
  byId("export-button").addEventListener("click", exportJson);
  byId("reset-button").addEventListener("click", () => {
    applyNetworkInput({ focusOnError: true, forceReset: true });
  });

  updateModeHint();
  const sharedDesign = new URLSearchParams(window.location.search).get("design");
  if (sharedDesign) {
    try {
      state = decodeState(sharedDesign);
      networkInput.value = `${intToIPv4(state.baseNetwork)}/${state.basePrefix}`;
      modeSelect.value = state.mode;
      updateModeHint();
      render();
      showToast("Shared subnet plan loaded.");
    } catch {
      loadExample();
      showToast("That share link is invalid. The example plan was loaded.");
    }
  } else {
    loadExample();
  }
})();
