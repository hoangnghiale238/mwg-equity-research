const DATA_ROOT = "./data/";
const DATA_VERSION = "20260712-scenario-sync";

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
  modelChecks: [],
  sensitivities: [],
  pricePerformance: [],
  performanceMode: "price",
  performanceRange: "1y",
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
  const response = await fetch(`${DATA_ROOT}${name}?v=${DATA_VERSION}`);
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

function sourceNumber(dataPoint, period) {
  const row = state.sources.find(
    (item) => item.data_point?.toLowerCase() === dataPoint.toLowerCase() && item.period === period,
  );
  return num(row?.value);
}

function sourceLabel(row) {
  if (row?.source === "kqkd 5t 2026.pdf") return "MWG 5M2026 Business Update";
  return row?.source ?? "Public disclosure";
}

function sourceType(row) {
  if (row?.source_id?.startsWith("KQKD5M26")) return "Public actual";
  if (row?.source?.toLowerCase().includes("business directions")) return "Company guidance";
  if (row?.source_id?.startsWith("ASSUMP") || row?.source?.toLowerCase() === "analyst assumption") return "Analyst assumption";
  if (row?.source_id?.startsWith("COMPS")) return "Market data";
  if (row?.source_id?.startsWith("SOTP")) return "Valuation benchmark";
  if (row?.source_id?.startsWith("FPA")) return "Analyst methodology";
  return "Public disclosure";
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
  const revenue2026 = sourceNumber("Group revenue target", "2026E") ?? totalSegmentRevenue("2026E");

  setText("#heroTarget", money(scenarioValue(sotpTarget)));
  setText("#heroUpside", `${scenarioLabel[state.scenario]}: ${pct(scenarioValue(sotpUpside))}`);
  setText("#heroCurrent", money(marketPrice));
  setText("#heroMeta", `${scenarioLabel[state.scenario]} · 12-month horizon · Market data as of 26 Jun 2026`);

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

const performanceRangeLabels = {
  "3m": "3M",
  "6m": "6M",
  ytd: "YTD",
  "1y": "1Y",
  since: "Since initiation",
};

function pricePerformanceRows() {
  return state.pricePerformance
    .map((row) => ({
      date: row.date,
      timestamp: new Date(`${row.date}T12:00:00`).getTime(),
      mwg: num(row.mwg_price_vnd),
      index: num(row.vnindex),
    }))
    .filter((row) => Number.isFinite(row.timestamp) && row.mwg != null && row.index != null)
    .sort((a, b) => a.timestamp - b.timestamp);
}

function performanceRowsForSelectedRange(rows) {
  if (state.performanceRange === "since") return rows;
  const cutoff = new Date(rows.at(-1).timestamp);
  if (state.performanceRange === "3m") cutoff.setMonth(cutoff.getMonth() - 3);
  if (state.performanceRange === "6m") cutoff.setMonth(cutoff.getMonth() - 6);
  if (state.performanceRange === "1y") cutoff.setFullYear(cutoff.getFullYear() - 1);
  if (state.performanceRange === "ytd") cutoff.setMonth(0, 1);
  const filtered = rows.filter((row) => row.timestamp >= cutoff.getTime());
  return filtered.length >= 2 ? filtered : rows;
}

function signedPct(value) {
  const n = num(value);
  if (n == null) return "NM";
  return `${n >= 0 ? "+" : ""}${pct(n)}`;
}

function signedPercentagePoints(value) {
  const n = num(value);
  if (n == null) return "NM";
  return `${n >= 0 ? "+" : ""}${(n * 100).toFixed(1)} percentage points`;
}

function renderPerformanceSummary(first, last) {
  const mwgReturn = last.mwg / first.mwg - 1;
  const indexReturn = last.index / first.index - 1;
  const relative = mwgReturn - indexReturn;
  setText("#performanceMwgReturn", signedPct(mwgReturn));
  setText("#performanceIndexReturn", signedPct(indexReturn));
  setText("#performanceRelative", signedPercentagePoints(relative));
  return { mwgReturn, indexReturn, relative };
}

function renderSharePriceChart() {
  const el = document.querySelector("#sharePriceChart");
  if (!el) return;

  const rows = performanceRowsForSelectedRange(pricePerformanceRows());
  if (rows.length < 2) return clear(el, "No share-price data");

  const rebased = state.performanceMode === "rebased";
  const first = rows[0];
  const last = rows.at(-1);
  const performance = renderPerformanceSummary(first, last);
  const plotRows = rows.map((row) => ({
    ...row,
    mwgValue: rebased ? (row.mwg / first.mwg) * 100 : row.mwg,
    indexValue: rebased ? (row.index / first.index) * 100 : row.index,
  }));
  const range = (values) => {
    const rawMin = Math.min(...values);
    const rawMax = Math.max(...values);
    const padding = Math.max((rawMax - rawMin) * 0.1, rebased ? 3 : rawMax * 0.04);
    return { min: rawMin - padding, max: rawMax + padding };
  };

  const indexRange = range(plotRows.map((row) => row.indexValue));
  const mwgRange = rebased ? indexRange : range(plotRows.map((row) => row.mwgValue));
  const width = 1100;
  const height = 360;
  const pad = { left: 78, right: 84, top: 16, bottom: 66 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const x = (timestamp) => pad.left + ((timestamp - first.timestamp) / (last.timestamp - first.timestamp)) * plotWidth;
  const y = (value, axisRange) => pad.top + ((axisRange.max - value) / (axisRange.max - axisRange.min)) * plotHeight;
  const linePath = (field, axisRange) => plotRows
    .map((row, index) => `${index === 0 ? "M" : "L"} ${x(row.timestamp).toFixed(1)} ${y(row[field], axisRange).toFixed(1)}`)
    .join(" ");
  const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" });

  const svg = svgEl("svg", { viewBox: `0 0 ${width} ${height}`, role: "img" });
  svg.appendChild(svgEl("title", {}, "MWG share price and VN-Index performance"));
  svg.appendChild(svgEl("desc", {}, `${performanceRangeLabels[state.performanceRange]} return: MWG ${signedPct(performance.mwgReturn)}, VN-Index ${signedPct(performance.indexReturn)}, relative ${signedPercentagePoints(performance.relative)}.`));
  const horizontalTicks = 5;
  for (let index = 0; index < horizontalTicks; index += 1) {
    const ratio = index / (horizontalTicks - 1);
    const gridY = pad.top + ratio * plotHeight;
    const indexTick = indexRange.max - ratio * (indexRange.max - indexRange.min);
    const mwgTick = mwgRange.max - ratio * (mwgRange.max - mwgRange.min);
    svg.appendChild(svgEl("line", {
      x1: pad.left,
      y1: gridY,
      x2: width - pad.right,
      y2: gridY,
      stroke: "rgba(255,255,255,0.13)",
    }));
    svg.appendChild(svgEl("text", { x: pad.left - 12, y: gridY + 4, "text-anchor": "end", class: "axis" }, rebased ? fmt0.format(indexTick) : fmt0.format(indexTick)));
    if (!rebased) {
      svg.appendChild(svgEl("text", { x: width - pad.right + 12, y: gridY + 4, class: "axis" }, moneyShort(mwgTick)));
    }
  }

  const dateTicks = plotRows.length > 20 ? [0, 0.25, 0.5, 0.75, 1] : [0, 0.33, 0.67, 1];
  dateTicks.forEach((ratio) => {
    const target = first.timestamp + ratio * (last.timestamp - first.timestamp);
    const nearest = plotRows.reduce((best, row) => (
      Math.abs(row.timestamp - target) < Math.abs(best.timestamp - target) ? row : best
    ));
    const tickX = x(nearest.timestamp);
    svg.appendChild(svgEl("line", { x1: tickX, y1: height - pad.bottom, x2: tickX, y2: height - pad.bottom + 6, stroke: "rgba(255,255,255,0.55)" }));
    svg.appendChild(svgEl("text", { x: tickX, y: height - 24, "text-anchor": "middle", class: "axis" }, dateFmt.format(new Date(nearest.timestamp))));
  });

  svg.appendChild(svgEl("text", {
    x: 18,
    y: pad.top + plotHeight / 2,
    transform: `rotate(-90 18 ${pad.top + plotHeight / 2})`,
    "text-anchor": "middle",
    class: "axis",
  }, rebased ? "Rebased performance" : "VN-Index"));
  if (!rebased) {
    svg.appendChild(svgEl("text", {
      x: width - 18,
      y: pad.top + plotHeight / 2,
      transform: `rotate(90 ${width - 18} ${pad.top + plotHeight / 2})`,
      "text-anchor": "middle",
      class: "axis",
    }, "MWG price (VND)"));
  }

  svg.appendChild(svgEl("path", { d: linePath("indexValue", indexRange), fill: "none", stroke: "#aeb3bd", "stroke-width": 2.2, "stroke-linecap": "round", "stroke-linejoin": "round", opacity: 0.78 }));
  svg.appendChild(svgEl("path", { d: linePath("mwgValue", mwgRange), fill: "none", stroke: "#ffd200", "stroke-width": 4, "stroke-linecap": "round", "stroke-linejoin": "round" }));

  const hoverLine = svgEl("line", { y1: pad.top, y2: height - pad.bottom, stroke: "rgba(255,255,255,0.68)", "stroke-dasharray": "4 4", visibility: "hidden" });
  const indexDot = svgEl("circle", { r: 5, fill: "#aeb3bd", stroke: "#ffffff", "stroke-width": 2, visibility: "hidden" });
  const mwgDot = svgEl("circle", { r: 5.5, fill: "#ffd200", stroke: "#ffffff", "stroke-width": 2, visibility: "hidden" });
  svg.append(hoverLine, indexDot, mwgDot);

  const overlay = svgEl("rect", { x: pad.left, y: pad.top, width: plotWidth, height: plotHeight, fill: "transparent", style: "cursor: crosshair" });
  const showPoint = (event) => {
    const pointer = event.touches?.[0] ?? event;
    const bounds = svg.getBoundingClientRect();
    const localX = ((pointer.clientX - bounds.left) / bounds.width) * width;
    const targetTime = first.timestamp + clamp((localX - pad.left) / plotWidth, 0, 1) * (last.timestamp - first.timestamp);
    const row = plotRows.reduce((best, item) => (
      Math.abs(item.timestamp - targetTime) < Math.abs(best.timestamp - targetTime) ? item : best
    ));
    const pointX = x(row.timestamp);
    hoverLine.setAttribute("x1", pointX);
    hoverLine.setAttribute("x2", pointX);
    hoverLine.setAttribute("visibility", "visible");
    indexDot.setAttribute("cx", pointX);
    indexDot.setAttribute("cy", y(row.indexValue, indexRange));
    indexDot.setAttribute("visibility", "visible");
    mwgDot.setAttribute("cx", pointX);
    mwgDot.setAttribute("cy", y(row.mwgValue, mwgRange));
    mwgDot.setAttribute("visibility", "visible");
    const mwgText = rebased ? `${row.mwgValue.toFixed(1)} (index)` : `${money(row.mwg)} VND`;
    const indexText = rebased ? `${row.indexValue.toFixed(1)} (index)` : fmt0.format(row.index);
    showTooltip(pointer, `<b>${dateFmt.format(new Date(row.timestamp))}</b><br><span style="color:#aeb3bd">VN-Index: ${indexText}</span><br><span style="color:#ffd200">MWG: ${mwgText}</span>`);
  };
  const hidePoint = () => {
    hoverLine.setAttribute("visibility", "hidden");
    indexDot.setAttribute("visibility", "hidden");
    mwgDot.setAttribute("visibility", "hidden");
    hideTooltip();
  };
  overlay.addEventListener("mousemove", showPoint);
  overlay.addEventListener("touchmove", showPoint, { passive: true });
  overlay.addEventListener("mouseleave", hidePoint);
  overlay.addEventListener("touchend", hidePoint);
  svg.appendChild(overlay);
  el.replaceChildren(svg);

  setText(
    "#sharePriceMeta",
    `${performanceRangeLabels[state.performanceRange]} | Weekly Friday close | ${dateFmt.format(new Date(first.timestamp))} to ${dateFmt.format(new Date(last.timestamp))} | Relative performance = MWG return - VN-Index return (percentage points).`,
  );
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
      const type = sourceType(row);
      item.className = "anchor-item";
      item.innerHTML = `
        <div>
          <b>${row.data_point}</b>
          <span>${row.period}</span>
          <span class="source-meta">Source: ${sourceLabel(row)}</span>
          <span class="source-type ${sourceTypeClass(type)}">${type}</span>
        </div>
        <strong>${row.value}</strong>
      `;
      return item;
    }),
  );
}

function sourceTypeClass(type) {
  if (type === "Public actual") return "public";
  if (type === "Company guidance") return "guidance";
  if (type === "Analyst assumption") return "analyst";
  if (type === "Market data") return "market";
  if (type === "Valuation benchmark") return "benchmark";
  return "disclosure";
}

function renderModelChecks() {
  const el = document.querySelector("#modelChecks");
  if (!el) return;

  const baseDcf = num(byLine("DCF", "Target Price")?.base);
  const sensitivityBase = state.sensitivities.find(
    (row) =>
      row.table_id === "dcf_wacc_terminal_growth" &&
      Math.abs(num(row.x_value) - 0.112) < 0.000001 &&
      Math.abs(num(row.y_value) - 0.03) < 0.000001,
  );
  const sensitivityMatches =
    baseDcf != null && sensitivityBase && Math.abs(baseDcf - num(sensitivityBase.target_price)) < 1;
  const checks = [
    ...state.modelChecks,
    {
      label: "DCF base matches sensitivity",
      status: sensitivityMatches ? "OK" : "REVIEW",
      detail: sensitivityMatches
        ? `Base matches at 11.2% WACC / 3.0% terminal growth (${money(baseDcf)} VND/share).`
        : "Base DCF and sensitivity require review.",
      scope: "Valuation",
    },
  ];

  el.innerHTML = checks
    .map(
      (check) => `
        <div class="model-check ${check.status === "OK" ? "ok" : "review"}">
          <span>${check.status === "OK" ? "✓" : "!"}</span>
          <div>
            <b>${check.label}</b>
            <small>${check.detail}</small>
          </div>
        </div>
      `,
    )
    .join("");
}

function renderThesisMonitor() {
  const el = document.querySelector("#thesisMonitorGrid");
  if (!el) return;
  const findFpa = (metric, period) => state.fpa.find((row) => row.metric === metric && row.actual_period === period);
  const bhxRevenue = findFpa("BHX revenue", "5M2026");
  const bhxStores = findFpa("BHX new stores", "5M2026");
  const cards = [
    {
      label: "BHX revenue",
      value: bhxRevenue ? vndTnFromBn(bhxRevenue.actual) : "Loading",
      comparison: bhxRevenue ? `${pct(bhxRevenue.variance_pct_or_ppt)} vs simulated plan` : "Loading",
      status: "On track",
      statusClass: "on-track",
      source: "5M2026 public update; model-calculated actual vs external plan",
      consequence: "If it misses: lower BHX revenue and SOTP value.",
    },
    {
      label: "BHX new stores",
      value: bhxStores ? `${fmt0.format(num(bhxStores.actual))} stores` : "Loading",
      comparison: bhxStores ? `${pct(bhxStores.variance_pct_or_ppt)} vs phased plan` : "Loading",
      status: "Ahead",
      statusClass: "ahead",
      source: "Public actual; the plan is a model phasing of 2026 guidance.",
      consequence: "If rollout slows: revisit store count and BHX revenue assumptions.",
    },
    {
      label: "BHX RPSM",
      value: "Validate / watch",
      comparison: "Productivity needs confirmation after the store rollout.",
      status: "Watch",
      statusClass: "watch",
      source: "Forecast driver; not treated as a clean pass in the current export.",
      consequence: "If RPSM weakens: lower revenue/store and BHX SOTP value.",
    },
  ];

  el.innerHTML = cards
    .map(
      (card) => `
        <article class="monitor-card">
          <div class="monitor-card-head">
            <div>
              <span>${card.label}</span>
              <strong>${card.value}</strong>
            </div>
            <b class="monitor-status ${card.statusClass}">${card.status}</b>
          </div>
          <p class="monitor-comparison">${card.comparison}</p>
          <small>${card.source}</small>
          <p class="monitor-consequence"><b>${card.consequence}</b></p>
        </article>
      `,
    )
    .join("");
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

function fpaVarianceSummary(row) {
  const relative = row.metric.toLowerCase().includes("margin")
    ? `${fmt1.format(num(row.variance_pct_or_ppt))} ppt`
    : pct(row.variance_pct_or_ppt);
  return `${fpaVariance(row.metric, row.variance)} · ${relative}`;
}

function fpaStatusClass(status) {
  if (status === "Favorable") return "favorable";
  if (status === "Ahead of plan") return "ahead";
  return "watch";
}

function renderFpaTable() {
  const el = document.querySelector("#fpaTable");
  if (!el) return;
  const filter = document.querySelector("#fpaFilter")?.value ?? "all";
  const rows = state.fpa.filter((row) => filter === "all" || row.status === filter);

  el.innerHTML = `
    <table class="fpa-table">
      <caption class="sr-only">External FP&A simulation: budget versus actual variance</caption>
      <thead>
        <tr>
          <th>Metric</th>
          <th>Actual</th>
          <th>Plan</th>
          <th>Variance</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map((row) => {
            const favorable = row.status === "Favorable" || row.status === "Ahead of plan";
            return `
              <tr>
                <td data-label="Metric"><b>${row.metric}</b><small>${row.actual_period}</small></td>
                <td class="num" data-label="Actual">${fpaValue(row.metric, row.actual)}</td>
                <td class="num" data-label="Plan">${fpaValue(row.metric, row.budget)}</td>
                <td class="num ${favorable ? "positive" : "negative"}" data-label="Variance">${fpaVarianceSummary(row)}</td>
                <td data-label="Status"><span class="fpa-status ${fpaStatusClass(row.status)}">${row.status}</span></td>
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

function selectedScenarioName() {
  return state.scenario.charAt(0).toUpperCase() + state.scenario.slice(1);
}

function simulatorBase(scenario = selectedScenarioName()) {
  const bhxMultiple = valuationDetailNum("SOTP", "BHX", "BHX EV/Sales multiple", scenario) ?? 0.8;
  const bhxValue = valuationDetailNum("SOTP", "Segment Value", "BHX value", scenario) ?? 44400;
  const netDebt = valuationDetailNum("SOTP", "Equity Bridge", "Net Debt / (Net Cash)", scenario) ?? -18284.153128745;

  return {
    current: currentPrice() ?? 78500,
    shares:
      valuationDetailNum("SOTP", "Market Data", "Diluted Shares Outstanding", scenario) ??
      valuationDetailNum("DCF", "Market Data", "Diluted Shares Outstanding", scenario) ??
      1468423529,
    dmxValue: valuationDetailNum("SOTP", "DMX IPO Anchor", "DMX 100% post-money equity value", scenario) ?? 102460,
    dmxOwnership:
      valuationDetailNum("SOTP", "DMX IPO Anchor", "Implied MWG ownership after planned IPO", scenario) ?? 0.8598510283,
    bhxRevenue: bhxMultiple ? bhxValue / bhxMultiple : (segmentRevenue("2026E", "BHX Revenue") ?? 55500),
    bhxMultiple,
    anKhangValue: valuationDetailNum("SOTP", "Segment Value", "An Khang value", scenario) ?? 858,
    avaKidsValue: valuationDetailNum("SOTP", "Segment Value", "AVAKids value", scenario) ?? 840,
    otherValue: valuationDetailNum("SOTP", "Segment Value", "Other / unallocated value", scenario) ?? 0,
    holdingDiscount: valuationDetailNum("SOTP", "Holding Company", "Holding company discount", scenario) ?? 0.1,
    netCash: Math.abs(netDebt),
    netCashFactor: valuationDetailNum("SOTP", "Equity Bridge", "Consolidated net cash inclusion factor", scenario) ?? 0.5,
    wacc: valuationDetailNum("DCF", "Discount Rate", "WACC", scenario) ?? 0.112,
    terminalGrowth: valuationDetailNum("DCF", "Terminal Value", "Terminal Growth", scenario) ?? 0.03,
  };
}

function simulatorInput(id) {
  return num(document.querySelector(`#${id}`)?.value);
}

function setSimulatorInput(id, value) {
  const input = document.querySelector(`#${id}`);
  if (input && value != null) input.value = String(value);
}

function setSimulatorInputsForScenario() {
  const base = simulatorBase();
  setSimulatorInput("simDmxValue", base.dmxValue);
  setSimulatorInput("simBhxMultiple", base.bhxMultiple);
  setSimulatorInput("simHoldingDiscount", base.holdingDiscount);
  setSimulatorInput("simNetCash", base.netCashFactor);
  setSimulatorInput("simWacc", base.wacc);
  setSimulatorInput("simTerminalGrowth", base.terminalGrowth);
}

function resetSimulatorInputs(render = true) {
  setSimulatorInputsForScenario();
  if (render) renderSimulator();
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
  const scenario = selectedScenarioName();
  const scenarioWacc = valuationDetailNum("DCF", "Discount Rate", "WACC", scenario);
  const scenarioGrowth = valuationDetailNum("DCF", "Terminal Value", "Terminal Growth", scenario);
  const scenarioTarget = valuationDetailNum("DCF", "DCF Output", "Target Price", scenario);
  if (
    scenarioTarget != null &&
    Math.abs(wacc - scenarioWacc) < 0.000001 &&
    Math.abs(terminalGrowth - scenarioGrowth) < 0.000001
  ) {
    return scenarioTarget;
  }

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

  setText("#simReset", `Reset ${scenarioLabel[state.scenario]}`);

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
  renderThesisMonitor();
  renderModelChecks();
  renderSimulator();
  renderSharePriceChart();
  renderValuationRange();
  renderPeerChart();
  renderSegmentChart();
  renderRatioChart();
  renderAnchors();
  renderFpaTable();
  renderMonthlyChart();
  renderSensitivity();
}

function setPressedGroup(selector, activeButton) {
  document.querySelectorAll(selector).forEach((item) => {
    const isActive = item === activeButton;
    item.classList.toggle("active", isActive);
    item.setAttribute("aria-pressed", String(isActive));
  });
}

function wireControls() {
  document.querySelectorAll(".scenario").forEach((button) => {
    button.addEventListener("click", () => {
      setPressedGroup(".scenario", button);
      state.scenario = button.dataset.scenario;
      resetSimulatorInputs(false);
      renderAll();
    });
  });

  document.querySelector("#segmentSelect")?.addEventListener("change", renderSegmentChart);
  document.querySelectorAll(".driver-metric").forEach((button) => {
    button.addEventListener("click", () => {
      setPressedGroup(".driver-metric", button);
      state.driverMetric = button.dataset.driverMetric;
      renderSegmentChart();
    });
  });
  document.querySelector("#ratioSelect")?.addEventListener("change", renderRatioChart);
  document.querySelectorAll(".performance-mode").forEach((button) => {
    button.addEventListener("click", () => {
      setPressedGroup(".performance-mode", button);
      state.performanceMode = button.dataset.performanceMode;
      renderSharePriceChart();
    });
  });
  document.querySelectorAll(".performance-range").forEach((button) => {
    button.addEventListener("click", () => {
      setPressedGroup(".performance-range", button);
      state.performanceRange = button.dataset.performanceRange;
      renderSharePriceChart();
    });
  });
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
      modelChecks,
      sensitivities,
      pricePerformance,
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
      loadCSV("model_checks.csv"),
      loadCSV("sensitivity_tables.csv"),
      loadCSV("share_price_performance.csv"),
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
      modelChecks,
      sensitivities,
      pricePerformance,
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
