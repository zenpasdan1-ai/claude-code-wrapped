import { renderCard } from "./card.js";
import { demoAccumulator } from "./demo.js";
import { lang, num, setLang, t } from "./i18n.js";
import { createAccumulator, readFiles } from "./parse.js";
import { finalize } from "./stats.js";
import { buildSlides, countUp } from "./story.js";

const COPY_CMD = "cp -r ~/.claude/projects ~/Desktop/claude-transcripts";
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const $ = (s, root = document) => root.querySelector(s);

const landing = $(".landing");
const story = $(".story");
const progress = $(".progress");
const errorBox = $(".pick-error");
let slides = [];
let index = 0;
let current = null;
let isDemo = false;

setLang(lang);
renderStatic();
paintPreview();

// ---- loading ----

$("#folder").addEventListener("change", (e) => load(e.target.files));
$("#files").addEventListener("change", (e) => load(e.target.files));
$(".demo").addEventListener("click", () => show(finalize(demoAccumulator()), true));
$(".lang-toggle").addEventListener("click", () => {
  setLang(lang === "ru" ? "en" : "ru");
  renderStatic();
  paintPreview();
  if (current) show(current, isDemo, index);
});
$(".copy-cmd").addEventListener("click", () => copy(COPY_CMD, $(".cmd-status"), t("copied")));

const drop = $(".drop");
drop.addEventListener("dragover", (e) => {
  e.preventDefault();
  drop.classList.add("is-over");
});
drop.addEventListener("dragleave", () => drop.classList.remove("is-over"));
drop.addEventListener("drop", async (e) => {
  e.preventDefault();
  drop.classList.remove("is-over");
  const files = await filesFromDrop(e.dataTransfer);
  load(files);
});

async function load(fileList) {
  errorBox.textContent = "";
  const files = [...fileList].filter((f) => /\.jsonl$/i.test(f.name));
  if (!files.length) {
    errorBox.textContent = t("empty");
    return;
  }
  progress.hidden = false;
  const acc = createAccumulator();
  await readFiles(files, acc, ({ files: done, total, lines }) => {
    progress.textContent = t("reading", { files: num(done), total: num(total), lines: num(lines) });
  });
  progress.hidden = true;
  const stats = finalize(acc);
  if (!stats) {
    errorBox.textContent = t("empty");
    return;
  }
  show(stats, false);
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

// ---- story ----

function show(stats, demo, at = 0) {
  current = stats;
  isDemo = demo;
  slides = buildSlides(stats);
  landing.hidden = true;
  story.hidden = false;
  $(".demo-tag", story).hidden = !demo;
  $(".bars-top", story).replaceChildren(
    ...slides.map(() => {
      const seg = document.createElement("span");
      seg.innerHTML = "<span></span>";
      return seg;
    })
  );
  go(at);
}

function go(i) {
  index = Math.max(0, Math.min(slides.length - 1, i));
  const slide = slides[index];
  const stage = $(".slide", story);
  stage.dataset.id = slide.id;
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

let showNames = false;
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

function mountFinal(stage) {
  const canvas = renderCard(current);
  const img = $(".card", stage);
  img.src = canvas.toDataURL("image/png");
  const status = $(".status", stage);
  const [name] = t("archetypes")[current.archetype];
  const text = `${t("shareText", { archetype: name, hours: num(Math.round(current.hours)), prompts: num(current.prompts), right: num(current.absolutelyRight) })} ${location.href.split("#")[0]} #ClaudeCodeWrapped`;

  $(".copy", stage).addEventListener("click", () => copy(text, status, t("copied")));
  $(".share", stage).addEventListener("click", async () => {
    try {
      const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
      const file = new File([blob], "claude-code-wrapped.png", { type: "image/png" });
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
$(".restart", story).addEventListener("click", () => {
  story.hidden = true;
  landing.hidden = false;
  current = null;
  $(".demo").focus();
});

// Tap the right two-thirds to advance, the left third to go back.
$(".slide", story).addEventListener("click", (e) => {
  if (e.target.closest("button, a, input, label, img")) return;
  const rect = e.currentTarget.getBoundingClientRect();
  go(e.clientX - rect.left < rect.width / 3 ? index - 1 : index + 1);
});

window.addEventListener("keydown", (e) => {
  if (story.hidden || e.target.closest("input, textarea")) return;
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

function renderStatic() {
  for (const node of document.querySelectorAll("[data-t]")) node.textContent = t(node.dataset.t);
  $(".cmd").textContent = COPY_CMD;
  $(".lang-toggle").textContent = lang === "ru" ? "EN" : "RU";
  $(".lang-toggle").setAttribute("aria-label", lang === "ru" ? "Switch to English" : "Переключить на русский");
  document.title = t("title");
}

function paintPreview() {
  const preview = $(".preview");
  const stats = finalize(demoAccumulator());
  preview.src = renderCard(stats).toDataURL("image/png");
  preview.alt = `${t("demoTag")}: ${t("archetypes")[stats.archetype][0]}`;
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

// A shareable link straight into the sample story, for people without transcripts at hand.
// Runs last so every binding the story uses is already initialized.
if (location.hash === "#demo") show(finalize(demoAccumulator()), true);
