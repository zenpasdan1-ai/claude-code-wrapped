import { renderCard } from "./card.js?v=19h";
import { demoAccumulator } from "./demo.js?v=19h";
import { lang, num, setLang, t } from "./i18n.js";
import { createAccumulator, readFiles } from "./parse.js?v=19h";
import { periodRange } from "./period.js?v=19h";
import { renderReport } from "./report.js?v=19h";
import { finalize } from "./stats.js?v=19h";
import { buildSlides, countUp } from "./story.js?v=19h";

const COPY_CMD = "cp -r ~/.claude/projects ~/Desktop/claude-transcripts";
const CLI_CMD = "npx github:zenpasdan1-ai/claude-code-wrapped";
const LANG_KEY = "ccw-lang";
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const $ = (s, root = document) => root.querySelector(s);

const landing = $(".landing");
const report = $(".report");
const story = $(".story");
const progress = $(".progress");
const errorBox = $(".pick-error");
let slides = [];
let index = 0;
let current = null;
let source = null; // { kind: "demo" } or { kind: "files", files, local? }
let format = "post";
let showNames = false;
let portrait = Promise.resolve(null); // the current archetype's image, loaded before any card is drawn

setLang(savedLang() || "en");
renderStatic();
paintPreview();

// ---- loading ----

$("#folder").addEventListener("change", (e) => pickFiles(e.target.files));
$("#files").addEventListener("change", (e) => pickFiles(e.target.files));
$(".demo").addEventListener("click", () => run({ kind: "demo" }));
for (const toggle of document.querySelectorAll(".lang-toggle")) {
  toggle.addEventListener("click", () => {
    setLang(lang === "ru" ? "en" : "ru");
    try {
      localStorage.setItem(LANG_KEY, lang);
    } catch {
      // Private mode or blocked storage: the choice just won't stick.
    }
    renderStatic();
    paintPreview();
    if (current && !story.hidden) showStory(index);
    else if (current && !report.hidden) showReport(current);
  });
}
$(".copy-cmd").addEventListener("click", () => copy(COPY_CMD, $(".cmd-status"), t("fixCopied")));
$(".copy-cli").addEventListener("click", () => copy(CLI_CMD, $(".cli-status"), t("fixCopied")));

// All period pickers stay in sync; changing one after loading re-reads the data in place.
for (const select of document.querySelectorAll(".period")) {
  select.addEventListener("change", () => {
    for (const other of document.querySelectorAll(".period")) other.value = select.value;
    if (source && landing.hidden) run(source, { view: story.hidden ? "report" : "story", at: index });
  });
}

const drop = $(".drop");
drop.addEventListener("dragover", (e) => {
  e.preventDefault();
  drop.classList.add("is-over");
});
drop.addEventListener("dragleave", () => drop.classList.remove("is-over"));
drop.addEventListener("drop", async (e) => {
  e.preventDefault();
  drop.classList.remove("is-over");
  pickFiles(await filesFromDrop(e.dataTransfer));
});

function pickFiles(fileList) {
  errorBox.textContent = "";
  const files = [...fileList].filter((f) => /\.jsonl$/i.test(f.name));
  if (!files.length) {
    errorBox.textContent = t("empty");
    return;
  }
  run({ kind: "files", files });
}

// Reads a source and opens the checkup (or the story when asked).
async function run(next, { view = "report", at = 0 } = {}) {
  const range = periodRange($(".period").value);
  let acc;
  if (next.kind === "demo") {
    acc = demoAccumulator(range);
  } else {
    progress.hidden = false;
    acc = createAccumulator(range);
    try {
      await readFiles(next.files, acc, ({ files: done, total, lines }) => {
        progress.textContent = t("reading", { files: num(done), total: num(total), lines: num(lines) });
      });
    } catch {
      progress.hidden = true;
      status(next.local ? t("localFailed") : t("empty"));
      return;
    }
    progress.hidden = true;
  }
  const stats = finalize(acc);
  if (!stats) {
    status(acc.lines && range ? t("emptyRange") : t("empty"));
    return;
  }
  source = next;
  status("");
  current = stats;
  if (view === "story") showStory(at);
  else showReport(stats);
}

// Messages go wherever the person is looking: the landing form or the open view.
function status(message) {
  errorBox.textContent = landing.hidden ? "" : message;
  for (const el of document.querySelectorAll(".view-status")) el.textContent = landing.hidden ? message : "";
}

// Folders dropped from Finder/Explorer arrive as entries; walk them recursively.
async function filesFromDrop(dt) {
  const entries = [...(dt.items || [])].map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) return [...dt.files];
  const out = [];
  const walk = async (entry) => {
    if (entry.isFile) {
      out.push(await new Promise((res, rej) => entry.file(res, rej)));
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      for (;;) {
        const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const child of batch) await walk(child);
      }
    }
  };
  for (const e of entries) await walk(e);
  return out;
}

// The CLI serves this page with a one-time token; transcripts stream from that local helper.
async function loadLocal(token) {
  progress.hidden = false;
  progress.textContent = t("localLoading");
  const q = `?token=${encodeURIComponent(token)}`;
  try {
    const res = await fetch(`__local/manifest.json${q}`);
    if (!res.ok) throw new Error(`manifest ${res.status}`);
    const manifest = await res.json();
    const files = manifest.files.map((f) => ({
      name: f.name,
      webkitRelativePath: f.path,
      stream() {
        const pipe = new TransformStream();
        fetch(`__local/file/${f.id}${q}`)
          .then((r) => (r.ok ? r.body.pipeTo(pipe.writable) : Promise.reject(new Error(`file ${r.status}`))))
          .catch((error) => pipe.writable.abort(error).catch(() => {}));
        return pipe.readable;
      },
    }));
    if (!files.length) {
      progress.hidden = true;
      errorBox.textContent = t("empty");
      return;
    }
    await run({ kind: "files", files, local: true });
  } catch {
    progress.hidden = true;
    errorBox.textContent = t("localFailed");
  }
}

// ---- checkup ----

function showReport(stats) {
  current = stats;
  landing.hidden = true;
  story.hidden = true;
  report.hidden = false;
  $(".demo-tag", report).hidden = source?.kind !== "demo";
  const body = $(".report-body", report);
  body.innerHTML = renderReport(stats);
  applyNames(body);
  $(".play-story", body).addEventListener("click", () => showStory(0));
  for (const button of body.querySelectorAll(".copy-fix")) {
    const fix = button.closest(".fix");
    button.addEventListener("click", () => copy($("pre", fix).textContent, $(".fix-status", fix), t("fixCopied")));
  }
  window.scrollTo(0, 0);
}

$(".restart-report").addEventListener("click", () => {
  report.hidden = true;
  landing.hidden = false;
  current = null;
  $(".demo").focus();
});

// ---- story ----

function showStory(at = 0) {
  slides = buildSlides(current);
  landing.hidden = true;
  report.hidden = true;
  story.hidden = false;
  $(".demo-tag", story).hidden = source?.kind !== "demo";
  $(".bars-top", story).replaceChildren(
    ...slides.map(() => {
      const seg = document.createElement("span");
      seg.innerHTML = "<span></span>";
      return seg;
    })
  );
  portrait = loadPortrait(current.archetype);
  // Warm the backgrounds so a slide does not flash empty while its picture loads.
  for (const bg of new Set(slides.map((slide) => slide.bg))) new Image().src = `img/story/${bg}.webp`;
  go(at);
  window.scrollTo(0, 0);
}

function go(i) {
  index = Math.max(0, Math.min(slides.length - 1, i));
  const slide = slides[index];
  const stage = $(".slide", story);
  stage.dataset.id = slide.id;
  stage.dataset.bg = slide.bg;
  stage.innerHTML = slide.html;
  stage.setAttribute("aria-label", t("slideOf", { i: index + 1, n: slides.length }));
  [...$(".bars-top", story).children].forEach((seg, k) => seg.classList.toggle("is-done", k <= index));
  $(".prev", story).disabled = index === 0;
  $(".next", story).hidden = index === slides.length - 1;
  stage.classList.remove("is-in");
  void stage.offsetWidth;
  stage.classList.add("is-in");
  slide.mount?.(stage);
  countUp(stage, !reduceMotion);
  applyNames(stage);
  if (slide.id === "final") mountFinal(stage);
  (stage.querySelector("h2, .big, .line") || stage).setAttribute("tabindex", "-1");
  (stage.querySelector("h2, .big, .line") || stage).focus({ preventScroll: true });
}

function applyNames(stage) {
  document.body.classList.toggle("show-names", showNames);
  const box = $(".show-names", stage);
  if (!box) return;
  box.checked = showNames;
  box.addEventListener("change", () => {
    showNames = box.checked;
    document.body.classList.toggle("show-names", showNames);
  });
}

async function mountFinal(stage) {
  let canvas;
  const img = $(".card", stage);
  const save = $(".save", stage);
  $(".portrait", stage)?.addEventListener("error", (e) => e.target.remove());
  const art = await portrait;
  const paint = () => {
    canvas = renderCard(current, format, art);
    const url = canvas.toDataURL("image/png");
    img.src = url;
    img.classList.toggle("is-story", format === "story");
    save.href = url;
    save.download = `claude-code-wrapped-${format}.png`;
    for (const b of stage.querySelectorAll(".fmt")) b.setAttribute("aria-pressed", String(b.dataset.format === format));
  };
  paint();
  for (const b of stage.querySelectorAll(".fmt")) {
    b.addEventListener("click", () => {
      format = b.dataset.format;
      paint();
    });
  }

  const status = $(".status", stage);
  const [name] = t("archetypes")[current.archetype];
  const text = `${t("shareText", { archetype: name, hours: num(Math.round(current.hours)), prompts: num(current.prompts), right: num(current.absolutelyRight) })} ${location.href.split("#")[0]} #ClaudeCodeWrapped`;

  $(".copy", stage).addEventListener("click", () => copy(text, status, t("copied")));
  $(".share", stage).addEventListener("click", async () => {
    try {
      const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
      const file = new File([blob], `claude-code-wrapped-${format}.png`, { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text });
        return;
      }
    } catch {
      // Share sheet unavailable or cancelled: fall back to copying the text.
    }
    copy(text, status, t("copied"));
  });
}

$(".next", story).addEventListener("click", () => go(index + 1));
$(".prev", story).addEventListener("click", () => go(index - 1));
$(".restart", story).addEventListener("click", () => showReport(current));

// Tap the right two-thirds to advance, the left third to go back.
$(".slide", story).addEventListener("click", (e) => {
  if (e.target.closest("button, a, input, label, img, select")) return;
  const rect = e.currentTarget.getBoundingClientRect();
  go(e.clientX - rect.left < rect.width / 3 ? index - 1 : index + 1);
});

window.addEventListener("keydown", (e) => {
  if (story.hidden || e.target.closest("input, textarea, select")) return;
  if (e.key === "ArrowRight" || e.key === " ") {
    e.preventDefault();
    go(index + 1);
  } else if (e.key === "ArrowLeft") {
    go(index - 1);
  } else if (e.key === "Escape") {
    $(".restart", story).click();
  }
});

// ---- helpers ----

function savedLang() {
  try {
    return localStorage.getItem(LANG_KEY);
  } catch {
    return null;
  }
}

function renderStatic() {
  for (const node of document.querySelectorAll("[data-t]")) node.textContent = t(node.dataset.t);
  $(".hidden-help .cmd").textContent = COPY_CMD;
  $(".cli").textContent = CLI_CMD;
  for (const toggle of document.querySelectorAll(".lang-toggle")) {
    toggle.textContent = lang === "ru" ? "EN" : "RU";
    toggle.setAttribute("aria-label", lang === "ru" ? "Switch to English" : "Переключить на русский");
  }
  document.title = t("title");
}

async function paintPreview() {
  const preview = $(".preview");
  const stats = finalize(demoAccumulator());
  preview.src = renderCard(stats, "post", await loadPortrait(stats.archetype)).toDataURL("image/png");
  preview.alt = `${t("demoTag")}: ${t("archetypes")[stats.archetype][0]}`;
}

// Resolves to the loaded image, or null when it is missing so the card falls back to text only.
function loadPortrait(archetype) {
  return new Promise((done) => {
    const img = new Image();
    img.onload = () => done(img);
    img.onerror = () => done(null);
    img.src = `img/archetypes/${archetype}.webp`;
  });
}

async function copy(text, statusEl, ok) {
  try {
    await navigator.clipboard.writeText(text);
    statusEl.textContent = ok;
  } catch {
    const area = $("#fallback-text");
    area.value = text;
    area.hidden = false;
    area.select();
  }
}

// Deep links: #demo opens the sample checkup, #demo-story the sample Wrapped,
// #local=<token> comes from the CLI helper. Runs last so every binding is initialized.
const hash = location.hash;
if (hash === "#demo") run({ kind: "demo" });
else if (hash === "#demo-story") run({ kind: "demo" }, { view: "story" });
else if (hash.startsWith("#local=")) loadLocal(hash.slice("#local=".length));
