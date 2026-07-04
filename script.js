const DATA_ROOT = "./data/";

const state = {
  scenario: "base",
  revenueHistory: [],
  ratios: [],
  peers: [],
  valuation: [],
  valuationDetails: [],
  segments: [],
  storeDrivers: [],
  fpa: [],
  monthly: [],
  sources: [],
  sensitivities: [],
  driverMetric: "ending_stores",
};

const scenarioLabel = {
  bull: "Bull case",
  base: "Base case",
  bear: "Bear case",
};

const segmentColors = {
  "TGDD / TopZone Revenue": "#f6c800",
  "DMX Revenue": "#0c0c0c",
  "BHX Revenue": "#18844f",
  "An Khang Revenue": "#2556a3",
  "AVAKids Revenue": "#c57b00",
};

const fmt0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const fmt1 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const monthFmt = new Intl.DateTimeFormat("en-US", { month: "short" });

function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && quoted && next === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell);
      if (row.some((item) => item.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }

  const headers = rows.shift().map((h) => h.trim().replace(/^\uFEFF/, ""));
  return rows.map((items) =>
    Object.fromEntries(headers.map((header, index) => [header, items[index] ?? ""])),
  );
}

async function loadCSV(name) {
  const response = await fetch(`${DATA_ROOT}${name}`);
  if (!response.ok) throw new Error(`Cannot load ${name}`);
  return parseCSV(await response.text());
}

function num(value) {
  if (value == null || value === "") return null;
  const parsed = Number.parseFloat(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function money(value) {
  const n = num(value);
  return n == null ? "NM" : fmt0.format(n);
}

function moneyShort(value) {
  const n = num(value);
  if (n == null) return "NM";
  if (Math.abs(n) >= 1000) return `${fmt1.format(n / 1000)}k`;
  return fmt0.format(n);
}

function vndTnFromBn(value) {
  const n = num(value);
  return n == null ? "NM" : `VND ${fmt1.format(n / 1000)}tn`;
}

function pct(value, decimals = 1) {
  const n = num(value);
  if (n == null) return "NM";
  return `${(n * 100).toFixed(decimals)}%`;
}

function multiple(value) {
  const n = num(value);
  return n == null ? "NM" : `${fmt1.format(n)}x`;
}

function scenarioValue(row) {
  return row ? num(row[state.scenario]) : null;
}

function byLine(method, lineItem) {
  return state.valuation.find((row) => row.method === method && row.line_item === lineItem);
}

function valuationDetail(method, section, lineItem, scenario = "Base") {
  return state.valuationDetails.find(
    (row) =>
      row.method === method &&
      row.section === section &&
      row.line_item === lineItem &&
      row.scenario === scenario,
  );
}

function valuationDetailNum(method, section, lineItem, scenario = "Base") {
  return num(valuationDetail(method, section, lineItem, scenario)?.value_num);
}

function currentPrice() {
  const peerPrice = num(state.peers.find((row) => row.ticker === "MWG")?.current_price_vnd);
  if (peerPrice != null) return peerPrice;

  const dcfTarget = byLine("DCF", "Target Price");
  const dcfUpside = byLine("DCF", "Upside / Downside");
  const dcfBaseTarget = num(dcfTarget?.base);
  const dcfBaseUpside = num(dcfUpside?.base);
  if (dcfBaseTarget != null && dcfBaseUpside != null) return dcfBaseTarget / (1 + dcfBaseUpside);

  const sotpTarget = byLine("SOTP", "SOTP Target Price");
  const sotpUpside = byLine("SOTP", "Upside / Downside");
  const sotpBaseTarget = num(sotpTarget?.base);
  const sotpBaseUpside = num(sotpUpside?.base);
  if (sotpBaseTarget != null && sotpBaseUpside != null) return sotpBaseTarget / (1 + sotpBaseUpside);

  return null;
}

function segmentRevenue(period, metric) {
  return num(state.segments.find((row) => row.period === period && row.metric === metric)?.revenue_vnd_bn);
}

function storeDriver(period, chain, field) {
  return num(state.storeDrivers.find((row) => row.period === period && row.chain === chain)?.[field]);
}

function recommendation(upside) {
  const n = num(upside);
  if (n == null) return { label: "Review", className: "hold" };
  if (n >= 0.15) return { label: "BUY", className: "buy" };
  if (n > -0.1) return { label: "HOLD", className: "hold" };
  return { label: "SELL", className: "sell" };
}

function svgEl(tag, attrs = {}, text = "") {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value));
  if (text !== "") el.textContent = text;
  return el;
}

function showTooltip(event, html) {
  const tooltip = document.querySelector("#tooltip");
  tooltip.innerHTML = html;
  tooltip.style.left = `${event.clientX}px`;
  tooltip.style.top = `${event.clientY}px`;
  tooltip.classList.add("visible");
}

function hideTooltip() {
  document.querySelector("#tooltip").classList.remove("visible");
}

function attachTooltip(el, html) {
  el.addEventListener("mousemove", (event) => showTooltip(event, html));
  el.addEventListener("mouseleave", hideTooltip);
}

function clear(el, emptyText = "No data") {
  if (!el) return false;
  el.replaceChildren();
  if (emptyText) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = emptyText;
    el.appendChild(empty);
  }
  return true;
}

function setText(id, value) {
  const el = document.querySelector(id);
  if (el) el.textContent = value;
}

function renderSnapshot() {
  const marketPrice = currentPrice();
  const sotpTarget = byLine("SOTP", "SOTP Target Price");
  const sotpUpside = byLine("SOTP", "Upside / Downside");
  const dcfTarget = byLine("DCF", "Target Price");
  const dcfUpside = byLine("DCF", "Upside / Downside");
  const revenue2026 = totalSegmentRevenue("2026E");

  setText("#heroTarget", money(scenarioValue(sotpTarget)));
  setText("#heroUpside", `${scenarioLabel[state.scenario]}: ${pct(scenarioValue(sotpUpside))}`);
  setText("#heroCurrent", money(marketPrice));
  setText("#heroDcf", money(scenarioValue(dcfTarget)));

  setText("#currentPrice", money(marketPrice));
  setText("#sotpTarget", money(scenarioValue(sotpTarget)));
  setText("#dcfTarget", money(scenarioValue(dcfTarget)));
  setText("#sotpUpside", `SOTP ${pct(scenarioValue(sotpUpside))}`);
  setText("#dcfUpside", `DCF ${pct(scenarioValue(dcfUpside))}`);
  setText("#revenue2026", moneyShort(revenue2026));
  setText("#scenarioBadge", scenarioLabel[state.scenario]);
}

function renderInvestmentSummary() {
  const marketPrice = currentPrice();
  const sotpTarget = byLine("SOTP", "SOTP Target Price");
  const sotpUpside = byLine("SOTP", "Upside / Downside");
  const dcfTarget = byLine("DCF", "Target Price");
  const selectedTarget = scenarioValue(sotpTarget);
  const selectedUpside = scenarioValue(sotpUpside);
  const view = recommendation(selectedUpside);
  const recEl = document.querySelector("#summaryRecommendation");

  setText("#summaryScenario", scenarioLabel[state.scenario]);
  if (recEl) {
    recEl.className = view.className;
    recEl.textContent = view.label;
  }

  setText("#summaryTarget", money(selectedTarget));
  setText("#summaryUpside", `${pct(selectedUpside)} vs current price`);
  setText("#summaryTargetRange", `${money(sotpTarget?.bear)} - ${money(sotpTarget?.bull)}`);
  setText("#summaryUpsideRange", `${pct(sotpUpside?.bear)} - ${pct(sotpUpside?.bull)}`);
  setText("#summaryCurrent", money(marketPrice));
  setText("#summaryRecNote", "SOTP is the primary method; DCF is used as a cash-flow cross-check.");

  const tgdd2026 = segmentRevenue("2026E", "TGDD / TopZone Revenue") ?? 0;
  const dmx2026 = segmentRevenue("2026E", "DMX Revenue") ?? 0;
  const core2026 = tgdd2026 + dmx2026;
  const bhxRevenue2026 = segmentRevenue("2026E", "BHX Revenue");
  const bhxStores2026 = storeDriver("2026E", "BHX", "ending_stores");
  const dcfBase = num(dcfTarget?.base);

  setText(
    "#summaryCoreEvidence",
    `Core ICT/CE 2026E revenue: ${moneyShort(core2026)} VND bn; DMX remains the main profit and valuation anchor.`,
  );
  setText(
    "#summaryBhxEvidence",
    `BHX 2026E revenue: ${moneyShort(bhxRevenue2026)} VND bn with ${money(bhxStores2026)} ending stores; RPSM is the key execution check.`,
  );
  setText(
    "#summarySotpEvidence",
    `SOTP target range: ${money(sotpTarget?.bear)}-${money(sotpTarget?.bull)} VND/share; DCF base is a cross-check at ${money(dcfBase)}.`,
  );
}

function totalSegmentRevenue(period) {
  return state.segments
    .filter((row) => row.period === period && !row.metric.includes("Revenue Check"))
    .reduce((sum, row) => sum + (num(row.revenue_vnd_bn) ?? 0), 0);
}

function renderValuationRange() {
  const el = document.querySelector("#valuationRangeChart");
  if (!el) return;
  const rows = [
    { label: "DCF", row: byLine("DCF", "Target Price"), color: "#18844f" },
    { label: "SOTP", row: byLine("SOTP", "SOTP Target Price"), color: "#ffd200" },
  ].filter((item) => item.row);
  const current = currentPrice();
  if (!rows.length || current == null) return clear(el);

  const values = rows.flatMap((item) => [num(item.row.bear), num(item.row.base), num(item.row.bull)]);
  const min = Math.min(current, ...values) * 0.88;
  const max = Math.max(current, ...values) * 1.08;
  const width = 940;
  const height = 310;
  const pad = { left: 92, right: 42, top: 28, bottom: 58 };
  const plot = width - pad.left - pad.right;
  const x = (value) => pad.left + ((value - min) / (max - min)) * plot;
  const svg = svgEl("svg", { viewBox: `0 0 ${width} ${height}`, role: "img" });

  [min, (min + max) / 2, max].forEach((tick) => {
    const tx = x(tick);
    svg.appendChild(svgEl("line", { x1: tx, y1: pad.top, x2: tx, y2: height - pad.bottom, stroke: "#e6dfcf" }));
    svg.appendChild(svgEl("text", { x: tx, y: height - 22, "text-anchor": "middle", class: "axis" }, moneyShort(tick)));
  });

  const currentX = x(current);
  svg.appendChild(svgEl("line", {
    x1: currentX,
    y1: pad.top - 4,
    x2: currentX,
    y2: height - pad.bottom + 8,
    stroke: "#b42318",
    "stroke-width": 2,
    "stroke-dasharray": "6 6",
  }));
  svg.appendChild(svgEl("text", { x: currentX, y: pad.top - 10, "text-anchor": "middle", class: "value-label" }, "Current"));

  rows.forEach((item, index) => {
    const y = pad.top + 58 + index * 84;
    const bear = num(item.row.bear);
    const base = num(item.row.base);
    const bull = num(item.row.bull);
    const selected = num(item.row[state.scenario]);
    const xBear = x(bear);
    const xBase = x(base);
    const xBull = x(bull);
    const xSelected = x(selected);

    svg.appendChild(svgEl("text", { x: 0, y: y + 5, class: "bar-label" }, item.label));
    svg.appendChild(svgEl("line", { x1: xBear, y1: y, x2: xBull, y2: y, stroke: "#c9c1ad", "stroke-width": 17, "stroke-linecap": "round" }));
    ["bear", "base", "bull"].forEach((key) => {
      const cx = x(num(item.row[key]));
      const dot = svgEl("circle", { cx, cy: y, r: key === state.scenario ? 10 : 6, fill: key === "base" ? item.color : "#ffffff", stroke: "#0c0c0c", "stroke-width": 2 });
      attachTooltip(dot, `<b>${item.label} ${key}</b><br>${money(item.row[key])} VND/share`);
      svg.appendChild(dot);
    });
    svg.appendChild(svgEl("path", {
      d: `M ${xSelected - 9} ${y - 25} L ${xSelected + 9} ${y - 25} L ${xSelected} ${y - 10} Z`,
      fill: "#0c0c0c",
    }));
    svg.appendChild(svgEl("text", { x: xBase, y: y + 34, "text-anchor": "middle", class: "value-label" }, `Base ${money(base)}`));
  });

  svg.appendChild(svgEl("text", { x: pad.left, y: height - 4, class: "chart-note" }, "Range = bear to bull. Triangle = selected scenario. Red dashed line = market price."));
  el.replaceChildren(svg);
}

function renderPeerChart() {
  const el = document.querySelector("#peerChart");
  if (!el) return;
  const rows = state.peers
    .map((row) => ({ ...row, value: num(row.ev_sales_ltm) }))
    .filter((row) => row.value != null)
    .sort((a, b) => a.value - b.value);
  if (!rows.length) return clear(el);

  const width = 560;
  const height = 250;
  const pad = { left: 42, right: 20, top: 18, bottom: 40 };
  const max = Math.max(...rows.map((row) => row.value)) * 1.16;
  const step = (width - pad.left - pad.right) / rows.length;
  const barW = Math.max(32, step - 16);
  const svg = svgEl("svg", { viewBox: `0 0 ${width} ${height}`, role: "img" });

  rows.forEach((row, index) => {
    const x = pad.left + index * step + (step - barW) / 2;
    const h = (row.value / max) * (height - pad.top - pad.bottom);
    const y = height - pad.bottom - h;
    const fill = row.ticker === "MWG" ? "#ffd200" : "#18844f";
    const rect = svgEl("rect", { x, y, width: barW, height: h, rx: 6, fill, stroke: row.ticker === "MWG" ? "#0c0c0c" : "none", "stroke-width": 2 });
    attachTooltip(rect, `<b>${row.ticker}</b><br>${row.company}<br>EV/Sales LTM: ${multiple(row.value)}`);
    svg.appendChild(rect);
    svg.appendChild(svgEl("text", { x: x + barW / 2, y: height - 16, "text-anchor": "middle", class: "axis" }, row.ticker));
    svg.appendChild(svgEl("text", { x: x + barW / 2, y: y - 8, "text-anchor": "middle", class: "value-label" }, multiple(row.value)));
  });

  el.replaceChildren(svg);
}

function fillSegmentSelector() {
  const select = document.querySelector("#segmentSelect");
  if (!select) return;
  const metrics = [...new Set(state.storeDrivers.map((row) => row.chain))]
    .sort();
  metrics.forEach((metric) => {
    const option = document.createElement("option");
    option.value = metric;
    option.textContent = metric;
    select.appendChild(option);
  });
}

function renderSegmentChart() {
  const el = document.querySelector("#segmentChart");
  const selected = document.querySelector("#segmentSelect")?.value ?? "all";
  if (!el) return;
  const metric = state.driverMetric;
  const rows = state.storeDrivers
    .map((row) => ({ ...row, value: num(row[metric]) }))
    .filter((row) => row.value != null);
  const periods = [...new Set(rows.map((row) => row.period))].sort();
  const keySegments = [...new Set(rows.map((row) => row.chain))];
  const width = 940;
  const height = 330;
  const pad = { left: 62, right: 24, top: 24, bottom: 66 };
  const plotH = height - pad.top - pad.bottom;
  const plotW = width - pad.left - pad.right;
  const svg = svgEl("svg", { viewBox: `0 0 ${width} ${height}`, role: "img" });
  const format = driverMetricFormatter(metric);
  let max = Math.max(...rows.filter((row) => selected === "all" || row.chain === selected).map((row) => row.value)) * 1.16;
  if (!Number.isFinite(max) || max <= 0) max = 1;
  [0, 0.5, 1].forEach((tick) => {
    const value = max * tick;
    const y = height - pad.bottom - (value / max) * plotH;
    svg.appendChild(svgEl("line", { x1: pad.left, y1: y, x2: width - pad.right, y2: y, stroke: "#e6dfcf" }));
    svg.appendChild(svgEl("text", { x: 4, y: y + 4, class: "axis" }, driverAxisLabel(metric, value)));
  });

  if (selected === "all") {
    keySegments.forEach((chain) => {
      const points = periods
        .map((period, index) => {
          const row = rows.find((item) => item.period === period && item.chain === chain);
          if (!row) return null;
          return {
            x: pad.left + (index / (periods.length - 1)) * plotW,
            y: height - pad.bottom - (row.value / max) * plotH,
            period,
            value: row.value,
          };
        })
        .filter(Boolean);
      if (points.length < 2) return;
      const color = driverColor(chain);
      svg.appendChild(svgEl("path", {
        d: points.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" "),
        class: "series-line",
        stroke: color,
      }));
      points.forEach((point) => {
        const dot = svgEl("circle", { cx: point.x, cy: point.y, r: 5, fill: color, stroke: "#ffffff", "stroke-width": 1.5, class: "dot" });
        attachTooltip(dot, `<b>${chain}</b><br>${point.period}: ${format(point.value)}`);
        svg.appendChild(dot);
      });
    });

    periods.forEach((period, index) => {
      const x = pad.left + (index / (periods.length - 1)) * plotW;
      svg.appendChild(svgEl("text", { x, y: height - 35, "text-anchor": "middle", class: "axis" }, period));
    });

    keySegments.forEach((chain, index) => {
      const x = pad.left + index * 142;
      const y = height - 10;
      svg.appendChild(svgEl("rect", { x, y: y - 10, width: 10, height: 10, fill: driverColor(chain) }));
      svg.appendChild(svgEl("text", { x: x + 15, y, class: "axis" }, chain));
    });
  } else {
    const rows = periods.map((period) => ({
      period,
      value: num(state.storeDrivers.find((row) => row.period === period && row.chain === selected)?.[metric]) ?? 0,
    }));
    const step = plotW / rows.length;
    const barW = Math.max(48, step * 0.56);
    rows.forEach((row, index) => {
      const x = pad.left + index * step + (step - barW) / 2;
      const h = (row.value / max) * plotH;
      const y = height - pad.bottom - h;
      const rect = svgEl("rect", { x, y, width: barW, height: h, rx: 7, fill: driverColor(selected) });
      attachTooltip(rect, `<b>${selected}</b><br>${row.period}: ${format(row.value)}`);
      svg.appendChild(rect);
      svg.appendChild(svgEl("text", { x: x + barW / 2, y: height - 30, "text-anchor": "middle", class: "axis" }, row.period));
      svg.appendChild(svgEl("text", { x: x + barW / 2, y: y - 8, "text-anchor": "middle", class: "value-label" }, format(row.value, true)));
    });
  }

  svg.appendChild(svgEl("text", { x: pad.left, y: 16, class: "chart-note" }, driverMetricTitle(metric)));
  el.replaceChildren(svg);
}

function driverColor(chain) {
  const map = {
    "TGDD / TopZone": "#f6c800",
    DMX: "#0c0c0c",
    BHX: "#18844f",
    "An Khang": "#2556a3",
    AVAKids: "#c57b00",
  };
  return map[chain] ?? "#18844f";
}

function driverMetricTitle(metric) {
  const map = {
    revenue_vnd_bn: "Revenue by chain (VND bn)",
    ending_stores: "Ending store count by chain",
    revenue_per_store_month_vnd_bn: "Revenue per store per month (VND bn/store/month)",
  };
  return map[metric] ?? metric;
}

function driverMetricFormatter(metric) {
  if (metric === "revenue_vnd_bn") return (value, compact = false) => `${compact ? moneyShort(value) : money(value)} VND bn`;
  if (metric === "ending_stores") return (value) => `${fmt0.format(value)} stores`;
  return (value, compact = false) => `${compact ? fmt1.format(value) : fmt1.format(value)} VND bn/store/month`;
}

function driverAxisLabel(metric, value) {
  if (metric === "revenue_vnd_bn") return moneyShort(value);
  if (metric === "ending_stores") return fmt0.format(value);
  return fmt1.format(value);
}

function renderRatioChart() {
  const el = document.querySelector("#ratioChart");
  const metric = document.querySelector("#ratioSelect")?.value ?? "gross_margin";
  if (!el) return;
  const rows = state.ratios
    .filter((row) => !row.period.startsWith("Q1"))
    .map((row) => ({ period: row.period, value: num(row[metric]) }))
    .filter((row) => row.value != null);
  if (!rows.length) return clear(el);

  const width = 560;
  const height = 252;
  const pad = { left: 52, right: 28, top: 24, bottom: 42 };
  const values = rows.map((row) => row.value);
  const min = Math.min(...values) * 0.86;
  const max = Math.max(...values) * 1.16;
  const x = (index) => pad.left + (index / (rows.length - 1)) * (width - pad.left - pad.right);
  const y = (value) => height - pad.bottom - ((value - min) / (max - min || 1)) * (height - pad.top - pad.bottom);
  const svg = svgEl("svg", { viewBox: `0 0 ${width} ${height}`, role: "img" });

  [0, 0.5, 1].forEach((tick) => {
    const value = min + (max - min) * tick;
    const ty = y(value);
    svg.appendChild(svgEl("line", { x1: pad.left, y1: ty, x2: width - pad.right, y2: ty, stroke: "#e6dfcf" }));
    svg.appendChild(svgEl("text", { x: 4, y: ty + 4, class: "axis" }, metric.includes("days") || metric.includes("cycle") ? fmt0.format(value) : pct(value, 0)));
  });

  const path = rows.map((row, index) => `${index ? "L" : "M"} ${x(index)} ${y(row.value)}`).join(" ");
  svg.appendChild(svgEl("path", { d: path, class: "series-line", stroke: "#18844f" }));

  rows.forEach((row, index) => {
    const dot = svgEl("circle", { cx: x(index), cy: y(row.value), r: 6, fill: "#ffd200", stroke: "#0c0c0c", "stroke-width": 2, class: "dot" });
    attachTooltip(dot, `<b>${row.period}</b><br>${metricLabel(metric)}: ${metric.includes("days") || metric.includes("cycle") ? fmt1.format(row.value) : pct(row.value)}`);
    svg.appendChild(dot);
    svg.appendChild(svgEl("text", { x: x(index), y: height - 16, "text-anchor": "middle", class: "axis" }, row.period.replace("LTM ", "LTM")));
  });

  el.replaceChildren(svg);
}

function metricLabel(metric) {
  return metric
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function renderAnchors() {
  const el = document.querySelector("#anchorList");
  if (!el) return;
  const wanted = [
    "Group revenue",
    "DMX Investment / core ICT+CE revenue",
    "Core same-store sales growth",
    "BHX revenue",
    "BHX new stores",
    "2026 group revenue target",
  ];
  const rows = wanted
    .map((label) => state.sources.find((row) => row.data_point.toLowerCase() === label.toLowerCase()))
    .filter(Boolean);

  el.replaceChildren(
    ...rows.map((row) => {
      const item = document.createElement("div");
      item.className = "anchor-item";
      item.innerHTML = `
        <div>
          <b>${row.data_point}</b>
          <span>${row.period} | ${row.source}</span>
        </div>
        <strong>${row.value}</strong>
      `;
      return item;
    }),
  );
}

function fpaValue(metric, value) {
  const n = num(value);
  if (n == null) return "NM";
  const lower = metric.toLowerCase();
  if (lower.includes("margin")) return pct(n);
  if (lower.includes("store")) return fmt0.format(n);
  return money(n);
}

function fpaVariance(metric, value) {
  const n = num(value);
  if (n == null) return "NM";
  const lower = metric.toLowerCase();
  if (lower.includes("margin")) return `${fmt1.format(n * 100)} ppt`;
  if (lower.includes("store")) return fmt0.format(n);
  return money(n);
}

function renderFpaTable() {
  const el = document.querySelector("#fpaTable");
  if (!el) return;
  const filter = document.querySelector("#fpaFilter")?.value ?? "all";
  const rows = state.fpa.filter((row) => filter === "all" || row.status === filter);

  el.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Metric</th>
          <th>Period</th>
          <th>Actual</th>
          <th>Budget</th>
          <th>Variance</th>
          <th>Variance % / ppt</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map((row) => {
            const favorable = row.status === "Favorable" || row.status === "Ahead of plan";
            return `
              <tr>
                <td>${row.metric}</td>
                <td>${row.actual_period}</td>
                <td class="num">${fpaValue(row.metric, row.actual)}</td>
                <td class="num">${fpaValue(row.metric, row.budget)}</td>
                <td class="num ${favorable ? "positive" : "negative"}">${fpaVariance(row.metric, row.variance)}</td>
                <td class="num ${favorable ? "positive" : "negative"}">${row.metric.toLowerCase().includes("margin") ? `${fmt1.format(num(row.variance_pct_or_ppt))} ppt` : pct(row.variance_pct_or_ppt)}</td>
                <td>${row.status}</td>
              </tr>
            `;
          })
          .join("")}
      </tbody>
    </table>
  `;
}

function renderMonthlyChart() {
  const el = document.querySelector("#monthlyChart");
  if (!el) return;
  const rows = state.monthly
    .filter((row) => row.section === "Revenue" && row.line_item === "Total Revenue" && row.month.startsWith("2026-"))
    .map((row) => ({ month: row.month, value: num(row.value) }))
    .filter((row) => row.value != null);
  if (!rows.length) return clear(el);

  const width = 560;
  const height = 252;
  const pad = { left: 50, right: 20, top: 20, bottom: 42 };
  const max = Math.max(...rows.map((row) => row.value)) * 1.14;
  const step = (width - pad.left - pad.right) / rows.length;
  const barW = Math.max(18, step - 10);
  const svg = svgEl("svg", { viewBox: `0 0 ${width} ${height}`, role: "img" });

  rows.forEach((row, index) => {
    const x = pad.left + index * step + (step - barW) / 2;
    const h = (row.value / max) * (height - pad.top - pad.bottom);
    const y = height - pad.bottom - h;
    const rect = svgEl("rect", { x, y, width: barW, height: h, rx: 5, fill: index < 5 ? "#18844f" : "#ffd200", stroke: "#0c0c0c", "stroke-width": index < 5 ? 0 : 1 });
    const label = monthFmt.format(new Date(row.month));
    attachTooltip(rect, `<b>${label} 2026 budget</b><br>${money(row.value)} VND bn`);
    svg.appendChild(rect);
    svg.appendChild(svgEl("text", { x: x + barW / 2, y: height - 16, "text-anchor": "middle", class: "axis" }, label));
  });

  svg.appendChild(svgEl("text", { x: pad.left, y: 14, class: "chart-note" }, "Green = Jan-May public actual period; yellow = remaining budget period."));
  el.replaceChildren(svg);
}

function renderHeatmap(containerId, tableId, options) {
  const el = document.querySelector(containerId);
  if (!el) return;
  const rows = state.sensitivities.filter((row) => row.table_id === tableId);
  if (!rows.length) return clear(el);

  const xs = [...new Set(rows.map((row) => num(row.x_value)))].sort((a, b) => a - b);
  const ys = [...new Set(rows.map((row) => num(row.y_value)))].sort((a, b) => a - b);
  const values = rows.map((row) => num(row.target_price)).filter((value) => value != null);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const midX = xs[Math.floor(xs.length / 2)];
  const midY = ys[Math.floor(ys.length / 2)];

  const table = document.createElement("table");
  table.className = "heatmap-table";
  const thead = document.createElement("thead");
  thead.innerHTML = `
    <tr>
      <th>${options.yHeader}</th>
      ${xs.map((x) => `<th>${options.formatX(x)}</th>`).join("")}
    </tr>
  `;
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  ys.forEach((y) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<th>${options.formatY(y)}</th>`;
    xs.forEach((x) => {
      const row = rows.find((item) => num(item.x_value) === x && num(item.y_value) === y);
      const value = num(row?.target_price);
      const intensity = clamp((value - min) / (max - min || 1), 0, 1);
      const bg = heatColor(intensity);
      const td = document.createElement("td");
      td.className = `heat-cell ${x === midX && y === midY ? "base-cell" : ""}`;
      td.style.background = bg;
      td.textContent = money(value);
      attachTooltip(td, `<b>${options.title}</b><br>${options.xHeader}: ${options.formatX(x)}<br>${options.yHeader}: ${options.formatY(y)}<br>Target: ${money(value)} VND/share`);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  el.replaceChildren(table);
}

function heatColor(intensity) {
  const start = [255, 245, 189];
  const end = [24, 132, 79];
  const mix = start.map((channel, index) => Math.round(channel + (end[index] - channel) * intensity));
  return `rgb(${mix.join(",")})`;
}

function renderSensitivity() {
  renderHeatmap("#dcfSensitivity", "dcf_wacc_terminal_growth", {
    title: "DCF sensitivity",
    xHeader: "WACC",
    yHeader: "Terminal growth",
    formatX: (value) => pct(value),
    formatY: (value) => pct(value),
  });
  renderHeatmap("#sotpSensitivity", "dmx_value_platform_discount", {
    title: "DMX IPO anchor sensitivity",
    xHeader: "Holding discount",
    yHeader: "DMX value",
    formatX: (value) => pct(value),
    formatY: (value) => moneyShort(value),
  });
  renderHeatmap("#bhxSensitivity", "bhx_ev_sales_platform_discount", {
    title: "BHX multiple sensitivity",
    xHeader: "Holding discount",
    yHeader: "BHX EV/Sales",
    formatX: (value) => pct(value),
    formatY: (value) => multiple(value),
  });
}

function simulatorBase() {
  const bhxMultiple = valuationDetailNum("SOTP", "BHX", "BHX EV/Sales multiple") ?? 0.8;
  const bhxValue = valuationDetailNum("SOTP", "Segment Value", "BHX value") ?? 44400;
  const netDebt = valuationDetailNum("SOTP", "Equity Bridge", "Net Debt / (Net Cash)") ?? -18284.153128745;

  return {
    current: currentPrice() ?? 78500,
    shares:
      valuationDetailNum("SOTP", "Market Data", "Diluted Shares Outstanding") ??
      valuationDetailNum("DCF", "Market Data", "Diluted Shares Outstanding") ??
      1468423529,
    dmxValue: valuationDetailNum("SOTP", "DMX IPO Anchor", "DMX 100% post-money equity value") ?? 102460,
    dmxOwnership:
      valuationDetailNum("SOTP", "DMX IPO Anchor", "Implied MWG ownership after planned IPO") ?? 0.8598510283,
    bhxRevenue: bhxMultiple ? bhxValue / bhxMultiple : (segmentRevenue("2026E", "BHX Revenue") ?? 55500),
    bhxMultiple,
    anKhangValue: valuationDetailNum("SOTP", "Segment Value", "An Khang value") ?? 858,
    avaKidsValue: valuationDetailNum("SOTP", "Segment Value", "AVAKids value") ?? 840,
    otherValue: valuationDetailNum("SOTP", "Segment Value", "Other / unallocated value") ?? 0,
    holdingDiscount: valuationDetailNum("SOTP", "Holding Company", "Holding company discount") ?? 0.1,
    netCash: Math.abs(netDebt),
    netCashFactor: valuationDetailNum("SOTP", "Equity Bridge", "Consolidated net cash inclusion factor") ?? 0.5,
    wacc: valuationDetailNum("DCF", "Discount Rate", "WACC") ?? 0.112,
    terminalGrowth: valuationDetailNum("DCF", "Terminal Value", "Terminal Growth") ?? 0.03,
  };
}

function simulatorInput(id) {
  return num(document.querySelector(`#${id}`)?.value);
}

function setSimulatorInput(id, value) {
  const input = document.querySelector(`#${id}`);
  if (input && value != null) input.value = String(value);
}

function resetSimulatorInputs() {
  const base = simulatorBase();
  setSimulatorInput("simDmxValue", base.dmxValue);
  setSimulatorInput("simBhxMultiple", base.bhxMultiple);
  setSimulatorInput("simHoldingDiscount", base.holdingDiscount);
  setSimulatorInput("simNetCash", base.netCashFactor);
  setSimulatorInput("simWacc", base.wacc);
  setSimulatorInput("simTerminalGrowth", base.terminalGrowth);
  renderSimulator();
}

function bracket(values, selected) {
  const ordered = [...new Set(values.filter((value) => value != null))].sort((a, b) => a - b);
  if (!ordered.length || selected == null) return [null, null];
  if (selected <= ordered[0]) return [ordered[0], ordered[0]];
  if (selected >= ordered[ordered.length - 1]) return [ordered[ordered.length - 1], ordered[ordered.length - 1]];
  for (let index = 0; index < ordered.length - 1; index += 1) {
    if (selected >= ordered[index] && selected <= ordered[index + 1]) return [ordered[index], ordered[index + 1]];
  }
  return [ordered[0], ordered[0]];
}

function dcfSensitivityValue(wacc, terminalGrowth) {
  const rows = state.sensitivities.filter((row) => row.table_id === "dcf_wacc_terminal_growth");
  if (!rows.length) return scenarioValue(byLine("DCF", "Target Price"));

  const xs = rows.map((row) => num(row.x_value));
  const ys = rows.map((row) => num(row.y_value));
  const [x0, x1] = bracket(xs, wacc);
  const [y0, y1] = bracket(ys, terminalGrowth);

  const findValue = (x, y) =>
    num(rows.find((row) => Math.abs(num(row.x_value) - x) < 1e-9 && Math.abs(num(row.y_value) - y) < 1e-9)?.target_price);

  const q00 = findValue(x0, y0);
  const q10 = findValue(x1, y0);
  const q01 = findValue(x0, y1);
  const q11 = findValue(x1, y1);
  if ([q00, q10, q01, q11].some((value) => value == null)) return scenarioValue(byLine("DCF", "Target Price"));

  const tx = x0 === x1 ? 0 : (wacc - x0) / (x1 - x0);
  const ty = y0 === y1 ? 0 : (terminalGrowth - y0) / (y1 - y0);
  const bottom = q00 + (q10 - q00) * tx;
  const top = q01 + (q11 - q01) * tx;
  return bottom + (top - bottom) * ty;
}

function computeSimulator() {
  const base = simulatorBase();
  const dmxValue = simulatorInput("simDmxValue") ?? base.dmxValue;
  const bhxMultiple = simulatorInput("simBhxMultiple") ?? base.bhxMultiple;
  const holdingDiscount = simulatorInput("simHoldingDiscount") ?? base.holdingDiscount;
  const netCashFactor = simulatorInput("simNetCash") ?? base.netCashFactor;
  const wacc = simulatorInput("simWacc") ?? base.wacc;
  const terminalGrowth = simulatorInput("simTerminalGrowth") ?? base.terminalGrowth;

  const dmxAttributable = dmxValue * base.dmxOwnership;
  const bhxValue = base.bhxRevenue * bhxMultiple;
  const grossSegmentValue =
    dmxAttributable + bhxValue + base.anKhangValue + base.avaKidsValue + base.otherValue;
  const holdingDiscountValue = -grossSegmentValue * holdingDiscount;
  const netCashValue = base.netCash * netCashFactor;
  const sotpEquityValue = grossSegmentValue + holdingDiscountValue + netCashValue;
  const sotpTarget = (sotpEquityValue * 1_000_000_000) / base.shares;
  const sotpUpside = sotpTarget / base.current - 1;
  const dcfTarget = dcfSensitivityValue(wacc, terminalGrowth);
  const dcfUpside = dcfTarget / base.current - 1;

  return {
    ...base,
    dmxValue,
    bhxMultiple,
    holdingDiscount,
    netCashFactor,
    wacc,
    terminalGrowth,
    dmxAttributable,
    bhxValue,
    grossSegmentValue,
    holdingDiscountValue,
    netCashValue,
    sotpEquityValue,
    sotpTarget,
    sotpUpside,
    dcfTarget,
    dcfUpside,
  };
}

function simulatorDriverLabel(result) {
  const base = simulatorBase();
  const dmxDelta = Math.abs((result.dmxValue - base.dmxValue) / base.dmxValue);
  const bhxDelta = Math.abs((result.bhxMultiple - base.bhxMultiple) / base.bhxMultiple);
  const discountDelta = Math.abs(result.holdingDiscount - base.holdingDiscount);
  const netCashDelta = Math.abs(result.netCashFactor - base.netCashFactor);

  const changes = [
    ["DMX IPO anchor", dmxDelta],
    ["BHX multiple", bhxDelta],
    ["holding discount", discountDelta],
    ["net cash credit", netCashDelta],
  ].sort((a, b) => b[1] - a[1]);

  return changes[0][1] > 0.001 ? changes[0][0] : "SOTP base assumptions";
}

function renderSimulatorBridge(result) {
  const el = document.querySelector("#simBridgeChart");
  if (!el) return;
  const rows = [
    ["DMX attributable", result.dmxAttributable, "Core anchor"],
    ["BHX value", result.bhxValue, `${multiple(result.bhxMultiple)} EV/Sales`],
    ["Other chains", result.anKhangValue + result.avaKidsValue + result.otherValue, "An Khang + AVAKids"],
    ["Holding discount", result.holdingDiscountValue, pct(result.holdingDiscount)],
    ["Net cash credited", result.netCashValue, pct(result.netCashFactor)],
  ];
  const maxAbs = Math.max(...rows.map(([, value]) => Math.abs(value)), 1);
  el.innerHTML = rows
    .map(([label, value, note]) => {
      const width = clamp((Math.abs(value) / maxAbs) * 100, 3, 100);
      const side = value < 0 ? "negative" : "positive";
      return `
        <div class="sim-bridge-row">
          <div>
            <b>${label}</b>
            <span>${note}</span>
          </div>
          <div class="sim-bar-track ${side}">
            <i style="width:${width}%"></i>
          </div>
          <strong>${vndTnFromBn(value)}</strong>
        </div>
      `;
    })
    .join("");
}

function renderSimulator() {
  const root = document.querySelector("#simulator");
  if (!root) return;
  const result = computeSimulator();
  const primaryView = recommendation(result.sotpUpside);

  setText("#simDmxValueLabel", vndTnFromBn(result.dmxValue));
  setText("#simBhxMultipleLabel", multiple(result.bhxMultiple));
  setText("#simHoldingDiscountLabel", pct(result.holdingDiscount));
  setText("#simNetCashLabel", pct(result.netCashFactor));
  setText("#simWaccLabel", pct(result.wacc));
  setText("#simTerminalGrowthLabel", pct(result.terminalGrowth));

  setText("#simSotpTarget", money(result.sotpTarget));
  setText("#simSotpUpside", `${pct(result.sotpUpside)} vs current price`);
  setText("#simDcfTarget", money(result.dcfTarget));
  setText("#simDcfUpside", `${pct(result.dcfUpside)} vs current price`);
  setText("#simBlendedTarget", money(result.sotpTarget));
  setText("#simBlendedUpside", "SOTP remains the primary method; DCF is the cross-check.");

  const rating = document.querySelector("#simRating");
  if (rating) {
    rating.textContent = primaryView.label;
    rating.className = primaryView.className;
  }

  const spread = result.dcfTarget - result.sotpTarget;
  const biggestDriver = simulatorDriverLabel(result);
  setText(
    "#simTakeaway",
    `Current run gives ${money(result.sotpTarget)} VND/share from SOTP. DCF is ${money(
      result.dcfTarget,
    )}, or ${money(spread)} VND/share away from SOTP. The clean read is that ${biggestDriver} is doing most of the work, while net cash only supports the bridge if you choose to credit it.`,
  );

  renderSimulatorBridge(result);
}

function renderAll() {
  renderSnapshot();
  renderInvestmentSummary();
  renderSimulator();
  renderValuationRange();
  renderPeerChart();
  renderSegmentChart();
  renderRatioChart();
  renderAnchors();
  renderFpaTable();
  renderMonthlyChart();
  renderSensitivity();
}

function wireControls() {
  document.querySelectorAll(".scenario").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".scenario").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      state.scenario = button.dataset.scenario;
      renderAll();
    });
  });

  document.querySelector("#segmentSelect")?.addEventListener("change", renderSegmentChart);
  document.querySelectorAll(".driver-metric").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".driver-metric").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      state.driverMetric = button.dataset.driverMetric;
      renderSegmentChart();
    });
  });
  document.querySelector("#ratioSelect")?.addEventListener("change", renderRatioChart);
  document.querySelector("#fpaFilter")?.addEventListener("change", renderFpaTable);
  ["simDmxValue", "simBhxMultiple", "simHoldingDiscount", "simNetCash", "simWacc", "simTerminalGrowth"].forEach(
    (id) => document.querySelector(`#${id}`)?.addEventListener("input", renderSimulator),
  );
  document.querySelector("#simReset")?.addEventListener("click", resetSimulatorInputs);
  setupReportDownload();
}

async function setupReportDownload() {
  const card = document.querySelector(".download-card.disabled");
  if (!card) return;
  const href = card.getAttribute("href");

  try {
    const response = await fetch(href, { method: "HEAD" });
    if (response.ok) {
      card.classList.remove("disabled");
      card.classList.add("ready");
      card.removeAttribute("aria-disabled");
      card.setAttribute("download", "");
      card.querySelector("strong").textContent = "Download PDF report";
      card.querySelector("small").textContent = "Initiation report PDF";
      return;
    }
  } catch (error) {
    // Static hosting may block HEAD; keep the card in placeholder mode.
  }

  card.addEventListener("click", (event) => {
    event.preventDefault();
    alert("PDF report chưa gắn vào web. Khi có file, đặt tên MWG_Initiation_Report.pdf trong thư mục downloads.");
  });
}

async function boot() {
  try {
    const [
      revenueHistory,
      ratios,
      peers,
      valuation,
      valuationDetails,
      fpa,
      segments,
      storeDrivers,
      monthly,
      sources,
      sensitivities,
    ] = await Promise.all([
      loadCSV("01_revenue_growth.csv"),
      loadCSV("02_profitability_and_wc.csv"),
      loadCSV("03_peer_multiples.csv"),
      loadCSV("04_valuation_summary.csv"),
      loadCSV("valuation.csv"),
      loadCSV("05_fpa_variance.csv"),
      loadCSV("06_segment_revenue_forecast.csv"),
      loadCSV("07_store_driver_chart.csv"),
      loadCSV("fpa_monthly.csv"),
      loadCSV("source_audit.csv"),
      loadCSV("sensitivity_tables.csv"),
    ]);

    Object.assign(state, {
      revenueHistory,
      ratios,
      peers,
      valuation,
      valuationDetails,
      fpa,
      segments,
      storeDrivers,
      monthly,
      sources,
      sensitivities,
    });

    fillSegmentSelector();
    wireControls();
    resetSimulatorInputs();
    renderAll();
    window.MWG_DASHBOARD_READY = true;
  } catch (error) {
    console.error(error);
    document.querySelector("main").innerHTML = `
      <div class="empty">
        Could not load web data. Run this page through the local server and refresh the CSV exports.
      </div>
    `;
  }
}

boot();
