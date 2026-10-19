import { test } from "node:test";
import assert from "node:assert/strict";
import { setImmediate as nextTurn } from "node:timers/promises";
import { createAccumulator, ingestLine } from "../js/parse.js";
import { periodRange } from "../js/period.js";
import { finalize } from "../js/stats.js";
import { renderReport } from "../js/report.js";
import { buildSlides } from "../js/story.js";
import { t } from "../js/i18n.js";

const NOW = Date.now();
const HOUR = 3_600_000;
const TRANSCRIPTS = [[line(40 * 24), line(20)], [line(1)]];
let instance = 0;

test("rapid period changes ignore stale progress and completion while the latest read is pending", async (ctx) => {
  const ui = await loadUI(ctx);
  const initial = ui.html();
  const older = ui.select("30");
  const middle = ui.select("90");
  const latest = ui.select("19h");
  const pending = ui.snapshot();

  await ui.finishFile(older, 0);
  assert.deepEqual(ui.snapshot(), pending, "old progress must not overwrite the latest progress");
  await ui.finishFile(older, 1);
  await ui.finish(middle);
  assert.deepEqual(ui.snapshot(), pending, "old completion must not clear progress or render");
  assert.equal(ui.html(), initial);

  await ui.finishFile(latest, 0);
  ui.assertBusy(true);
  assert.equal(ui.progress.textContent, t("reading", { files: 1, total: 2, lines: 2 }));
  await ui.finishFile(latest, 1);
  ui.assertBusy(false);
  assert.equal(ui.html(), expectedReport("19h"));
  assert.notEqual(ui.html(), initial);
  assert.ok(ui.periods.every((select) => select.value === "19h"));
});

test("an older success cannot overwrite an already completed newer period", async (ctx) => {
  const ui = await loadUI(ctx);
  const older = ui.select("30");
  const latest = ui.select("19h");
  await ui.finish(latest);
  const completed = ui.snapshot();
  await ui.finishFile(older, 0);
  assert.deepEqual(ui.snapshot(), completed, "late progress must stay hidden");
  await ui.finishFile(older, 1);
  assert.deepEqual(ui.snapshot(), completed, "late results must not replace the selected period");
  assert.equal(ui.html(), expectedReport("19h"));
});

for (const completeLatest of [false, true]) {
  test(`an older failure cannot affect a ${completeLatest ? "completed" : "pending"} newer read`, async (ctx) => {
    const ui = await loadUI(ctx);
    const older = ui.select("30");
    const latest = ui.select("19h");
    if (completeLatest) await ui.finish(latest);
    const before = ui.snapshot();
    await ui.fail(older);
    assert.deepEqual(ui.snapshot(), before);
    if (!completeLatest) await ui.finish(latest);
    ui.assertBusy(false);
    assert.equal(ui.html(), expectedReport("19h"));
  });
}

test("the latest failure clears progress and is not replaced by an older success", async (ctx) => {
  const ui = await loadUI(ctx);
  const initial = ui.html();
  const older = ui.select("30");
  const latest = ui.select("19h");
  await ui.fail(latest);
  ui.assertBusy(false);
  assert.equal(ui.statuses[0].textContent, t("empty"));
  const failed = ui.snapshot();
  await ui.finish(older);
  assert.deepEqual(ui.snapshot(), failed);
  assert.equal(ui.html(), initial);
});

test("an empty latest period keeps its message when an older read completes", async (ctx) => {
  const ui = await loadUI(ctx, [[line(40 * 24)], [line(20)]]);
  const initial = ui.html();
  const older = ui.select("30");
  const latest = ui.select("19h");
  await ui.finish(latest);
  ui.assertBusy(false);
  assert.equal(ui.statuses[0].textContent, t("emptyRange"));
  const empty = ui.snapshot();
  await ui.finish(older);
  assert.deepEqual(ui.snapshot(), empty);
  assert.equal(ui.html(), initial);
});

test("period changes preserve the active story slide and ignore older results", async (ctx) => {
  const ui = await loadUI(ctx);
  ui.reportBody.querySelector(".play-story").click();
  for (let i = 0; i < 4; i++) ui.story.querySelector(".next").click();
  const older = ui.select("30", 2);
  const latest = ui.select("19h", 2);
  await ui.finish(latest);
  ui.assertBusy(false);
  assert.equal(ui.story.hidden, false);
  assert.equal(ui.report.hidden, true);
  const slide = ui.story.querySelector(".slide");
  assert.equal(slide.dataset.id, "cost");
  assert.equal(slide.innerHTML, buildSlides(expectedStats("19h"))[4].html);
  const completed = ui.snapshot();
  await ui.finish(older);
  assert.deepEqual(ui.snapshot(), completed);
});

test("choosing the demo supersedes a pending file read and clears its progress", async (ctx) => {
  const ui = await loadUI(ctx);
  const older = ui.select("30");
  ui.document.querySelector(".restart-report").click();
  ui.document.querySelector(".demo").click();
  ui.assertBusy(false);
  assert.equal(ui.report.querySelector(".demo-tag").hidden, false);
  const demo = ui.snapshot();
  await ui.finish(older);
  assert.deepEqual(ui.snapshot(), demo);
  assert.equal(ui.report.querySelector(".demo-tag").hidden, false);
});

function expectedStats(period) {
  const acc = createAccumulator(periodRange(period, NOW));
  acc.files = TRANSCRIPTS.length;
  for (const lines of TRANSCRIPTS) for (const text of lines) ingestLine(acc, text);
  return finalize(acc);
}

function expectedReport(period) {
  return renderReport(expectedStats(period));
}

function line(hoursAgo) {
  return JSON.stringify({
    type: "assistant", sessionId: "session", cwd: "/app/project",
    timestamp: new Date(NOW - hoursAgo * HOUR).toISOString(),
    message: {
      id: `message-${hoursAgo}`, model: "claude-opus-5-5", role: "assistant",
      content: [{ type: "text", text: "ok" }],
      usage: { input_tokens: 100, output_tokens: 100000 },
    },
  });
}

// Only browser surfaces are stubbed. Import the complete, unmodified entry point;
// its actual listeners, parser, period filter, stats and renderers handle the test.
async function loadUI(ctx, transcripts = TRANSCRIPTS) {
  const document = new Element();
  document.body = new Element();
  document.documentElement = new Element();
  document.createElement = () => new Element();
  const periods = Array.from({ length: 3 }, () => Object.assign(new Element(), { value: "all" }));
  const statuses = [new Element(), new Element()];
  document.nodes.set(".period", periods[0]);
  document.querySelectorAll = (selector) => selector === ".period" ? periods : selector === ".view-status" ? statuses : [];
  const globals = {
    document,
    window: { matchMedia: () => ({ matches: true }), addEventListener() {}, scrollTo() {} },
    location: { hash: "" },
    // Image loading/canvas painting is unrelated to reading; leave previews unloaded.
    Image: class {},
  };
  for (const [key, value] of Object.entries(globals)) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    ctx.after(() => original ? Object.defineProperty(globalThis, key, original) : delete globalThis[key]);
  }
  const report = document.querySelector(".report");
  const story = document.querySelector(".story");
  const progress = document.querySelector(".progress");
  report.hidden = story.hidden = progress.hidden = true;
  const reportBody = report.querySelector(".report-body");
  const files = transcripts.map((lines, i) => ({
    name: `transcript-${i}.jsonl`, reads: [], lines,
    stream() {
      return new ReadableStream({ start: (controller) => this.reads.push(controller) });
    },
  }));
  const continuations = new Map();
  const ui = {
    document, periods, statuses, report, story, reportBody, progress,
    html: () => reportBody.innerHTML,
    select(value, picker = 1) {
      periods[picker].value = value;
      periods[picker].dispatchEvent(new Event("change"));
      return files[0].reads.length - 1;
    },
    async finishFile(run, file) {
      const { reads, lines } = files[file];
      const controller = file === 0 ? reads[run] : continuations.get(`${run}:${file}`);
      controller.enqueue(new TextEncoder().encode(lines.join("\n") + "\n"));
      controller.close();
      // Drain the real stream pipeline and its promise continuations, without sleeps.
      await nextTurn();
      // Later files open in completion order, which can differ from run order.
      if (file + 1 < files.length) continuations.set(`${run}:${file + 1}`, files[file + 1].reads.at(-1));
    },
    async finish(run) {
      for (let file = 0; file < files.length; file++) await this.finishFile(run, file);
    },
    async fail(run) {
      files[0].reads[run].error(new Error("transcript read failed"));
      await nextTurn();
    },
    assertBusy(busy) {
      assert.equal(document.body.classList.contains("is-reading"), busy);
      assert.equal(progress.hidden, !busy);
      for (const status of statuses) assert.equal(status.classList.contains("is-progress"), busy);
    },
    snapshot() {
      const slide = story.querySelector(".slide");
      return {
        progress: [progress.hidden, progress.textContent],
        busy: document.body.classList.contains("is-reading"),
        statuses: statuses.map((el) => [el.textContent, el.classList.contains("is-progress")]),
        error: document.querySelector(".pick-error").textContent,
        report: [report.hidden, reportBody.innerHTML],
        story: [story.hidden, slide.dataset.id, slide.innerHTML],
      };
    },
  };
  await import(`../js/main.js?test=${++instance}`);
  const picker = document.querySelector("#files");
  picker.files = files;
  picker.dispatchEvent(new Event("change"));
  await ui.finish(0);
  assert.equal(report.hidden, false);
  return ui;
}

class Element extends EventTarget {
  hidden = false;
  textContent = "";
  innerHTML = "";
  dataset = {};
  children = [];
  nodes = new Map();
  classes = new Set();
  classList = {
    add: (name) => this.classes.add(name),
    remove: (name) => this.classes.delete(name),
    contains: (name) => this.classes.has(name),
    toggle: (name, on) => on ? this.classes.add(name) : this.classes.delete(name),
  };
  querySelector(selector) {
    if (!this.nodes.has(selector)) this.nodes.set(selector, new Element());
    return this.nodes.get(selector);
  }
  querySelectorAll() { return []; }
  replaceChildren(...children) { this.children = children; }
  setAttribute() {}
  focus() {}
  click() { this.dispatchEvent(new Event("click")); }
}
