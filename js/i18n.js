// Copy for both languages. {n}-style placeholders are filled by t().

const EN = {
  title: "Claude Code Wrapped",
  tagline: "Your year with the agent, in one story.",
  lead: "Drop your Claude Code transcripts folder and get hours, prompts, models, streaks, and the number of times Claude told you you're absolutely right.",
  privacy: "Runs entirely in your browser. Nothing is uploaded.",
  pickFolder: "Choose ~/.claude/projects",
  pickFiles: "or pick .jsonl files",
  orDrop: "or drop the folder here",
  demo: "See a demo",
  hiddenHint: "Can't see the .claude folder? On macOS press ⌘⇧. in the file dialog, or run:",
  copyCmd: "Copy",
  reading: "Reading {files} of {total} files · {lines} lines",
  empty: "No Claude Code transcripts found there. Pick ~/.claude/projects (or a folder of .jsonl files).",
  demoTag: "demo data",
  start: "Start",
  next: "Next",
  prev: "Back",
  restart: "Start over",
  slideOf: "Slide {i} of {n}",
  introKicker: "{from} – {to}",
  introBig: "Your Claude Code Wrapped",
  introLine: "{sessions} sessions across {files} transcript files. Let's see what happened.",
  timeKicker: "time together",
  timeUnit: "hours",
  timeLine: "of active time side by side with your agent.",
  timeSub: "Longest session: {h} h on {date}, in {project}.",
  promptsKicker: "you typed",
  promptsUnit: "prompts",
  promptsLine: "{words} words of instructions, nudges and pleas.",
  promptsSub: "“please” ×{please} · “thanks” ×{thanks} · words we won't print ×{swears} · interrupts ×{interrupts}",
  rightKicker: "the classic",
  rightLine: "times Claude told you “You're absolutely right.”",
  rightZero: "Zero. Not once. Either you're never wrong, or it stopped saying it.",
  costKicker: "if you'd paid API prices",
  costLine: "API-equivalent value of your usage.",
  costSub: "{tokens} tokens moved, {output} of them written by the model.",
  modelsKicker: "your main model",
  modelsLine: "wrote {share} of everything the agent produced.",
  rhythmKicker: "your rhythm",
  rhythmLine: "Peak hour: {hour}. {night} of prompts after 10 pm.",
  streakKicker: "longest streak",
  streakUnit: "days in a row",
  streakLine: "Active on {days} days. Busiest: {busiest} with {prompts} prompts.",
  toolsKicker: "your agent's hands",
  toolsUnit: "tool calls",
  toolsLine: "{per} per prompt. Favorite tool: {tool}.",
  projectsKicker: "where you spent it",
  projectsLine: "Top projects by prompts.",
  showNames: "Show project names",
  youAre: "You are",
  share: "Share",
  copyText: "Copy post text",
  saveHint: "Long-press or right-click the card to save it.",
  copied: "Copied. Paste it with the card image.",
  shareText: "My Claude Code Wrapped: {archetype}. {hours} h with the agent, {prompts} prompts, “you're absolutely right” ×{right}. Get yours (runs locally):",
  unofficial: "Unofficial fan project. Not affiliated with Anthropic.",
  weekdays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  cardHours: "hours",
  cardPrompts: "prompts",
  cardStreak: "day streak",
  cardValue: "API value",
  cardRight: "“absolutely right”",
  archetypes: {
    nightOwl: ["The Night Owl", "Most of your prompts land after 10 pm. The agent never sleeps, and apparently neither do you."],
    earlyBird: ["The Early Bird", "You and the agent ship before the coffee gets cold."],
    opusMaximalist: ["The Opus Maximalist", "Why use a smaller model when you can use the big one?"],
    fableFlyer: ["The Fable Flyer", "Only the most capable model will do."],
    marathoner: ["The Marathoner", "Sessions measured in hours, not minutes."],
    politeCoder: ["The Polite Coder", "When the machines take over, they'll remember you said please."],
    toolWhisperer: ["The Tool Whisperer", "One prompt, a dozen tool calls. You let the agent drive."],
    weekendWarrior: ["The Weekend Warrior", "Weekdays are for meetings. Weekends are for shipping."],
    streakMachine: ["The Streak Machine", "Day after day after day."],
    steadyShipper: ["The Steady Shipper", "Consistent, calm, always shipping."],
  },
};

const RU = {
  title: "Claude Code Wrapped",
  tagline: "Ваш год с агентом в одной истории.",
  lead: "Перетащите папку с транскриптами Claude Code и узнайте часы, промпты, модели, серии дней и сколько раз Claude сказал, что вы абсолютно правы.",
  privacy: "Всё считается в браузере. Ничего не загружается.",
  pickFolder: "Выбрать ~/.claude/projects",
  pickFiles: "или выбрать файлы .jsonl",
  orDrop: "или перетащите папку сюда",
  demo: "Посмотреть демо",
  hiddenHint: "Не видно папку .claude? В macOS нажмите ⌘⇧. в окне выбора или выполните:",
  copyCmd: "Скопировать",
  reading: "Читаю {files} из {total} файлов · {lines} строк",
  empty: "Транскриптов Claude Code там нет. Выберите ~/.claude/projects или папку с файлами .jsonl.",
  demoTag: "демо-данные",
  start: "Начать",
  next: "Дальше",
  prev: "Назад",
  restart: "Сначала",
  slideOf: "Слайд {i} из {n}",
  introKicker: "{from} – {to}",
  introBig: "Ваш Claude Code Wrapped",
  introLine: "{sessions} сессий в {files} файлах транскриптов. Посмотрим, что было.",
  timeKicker: "время вместе",
  timeUnit: "часов",
  timeLine: "активной работы бок о бок с агентом.",
  timeSub: "Самая длинная сессия: {h} ч, {date}, проект {project}.",
  promptsKicker: "вы написали",
  promptsUnit: "промптов",
  promptsLine: "{words} слов инструкций, подсказок и просьб.",
  promptsSub: "«please/пожалуйста» ×{please} · «спасибо» ×{thanks} · непечатное ×{swears} · прерываний ×{interrupts}",
  rightKicker: "классика",
  rightLine: "раз Claude сказал вам «You're absolutely right».",
  rightZero: "Ноль. Ни разу. Либо вы никогда не ошибаетесь, либо он перестал так говорить.",
  costKicker: "если бы платили по ценам API",
  costLine: "стоило бы ваше использование.",
  costSub: "{tokens} токенов прокачано, {output} из них написала модель.",
  modelsKicker: "ваша главная модель",
  modelsLine: "написала {share} всего, что выдал агент.",
  rhythmKicker: "ваш ритм",
  rhythmLine: "Пиковый час: {hour}. {night} промптов после 22:00.",
  streakKicker: "самая длинная серия",
  streakUnit: "дней подряд",
  streakLine: "Активных дней: {days}. Самый загруженный — {busiest}, {prompts} промптов.",
  toolsKicker: "руки агента",
  toolsUnit: "вызовов инструментов",
  toolsLine: "{per} на промпт. Любимый инструмент: {tool}.",
  projectsKicker: "куда ушло время",
  projectsLine: "Топ проектов по числу промптов.",
  showNames: "Показать названия проектов",
  youAre: "Вы —",
  share: "Поделиться",
  copyText: "Скопировать текст поста",
  saveHint: "Сохраните карточку долгим нажатием или правой кнопкой мыши.",
  copied: "Скопировано. Вставьте в пост вместе с картинкой.",
  shareText: "Мой Claude Code Wrapped: {archetype}. {hours} ч с агентом, {prompts} промптов, «you're absolutely right» ×{right}. Узнай свой (считается локально):",
  unofficial: "Неофициальный фан-проект. Не связан с Anthropic.",
  weekdays: ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"],
  cardHours: "часов",
  cardPrompts: "промптов",
  cardStreak: "дней подряд",
  cardValue: "по ценам API",
  cardRight: "«absolutely right»",
  archetypes: {
    nightOwl: ["Ночная сова", "Большинство ваших промптов — после 22:00. Агент не спит, и вы, похоже, тоже."],
    earlyBird: ["Ранняя пташка", "Вы с агентом успеваете отгрузить код, пока не остыл кофе."],
    opusMaximalist: ["Опус-максималист", "Зачем модель поменьше, если есть самая большая?"],
    fableFlyer: ["Пилот Fable", "Только самая способная модель."],
    marathoner: ["Марафонец", "Сессии измеряются часами, а не минутами."],
    politeCoder: ["Вежливый кодер", "Когда машины захватят мир, они вспомнят, что вы говорили «пожалуйста»."],
    toolWhisperer: ["Заклинатель инструментов", "Один промпт — дюжина вызовов. Вы даёте агенту рулить."],
    weekendWarrior: ["Воин выходного дня", "Будни для созвонов. Выходные — чтобы шипать."],
    streakMachine: ["Машина серий", "День за днём за днём."],
    steadyShipper: ["Стабильный шиппер", "Спокойно, ровно, всегда в продакшн."],
  },
};

const DICTS = { en: EN, ru: RU };

export let lang = (navigator.language || "en").toLowerCase().startsWith("ru") ? "ru" : "en";

export function setLang(next) {
  lang = DICTS[next] ? next : "en";
  document.documentElement.lang = lang;
}

export function t(key, vars = {}) {
  const value = DICTS[lang][key] ?? EN[key] ?? key;
  if (typeof value !== "string") return value;
  return value.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? `{${k}}`));
}

export const num = (n, digits = 0) => Number(n).toLocaleString(lang === "ru" ? "ru-RU" : "en-US", { maximumFractionDigits: digits });

export function compact(n) {
  return new Intl.NumberFormat(lang === "ru" ? "ru-RU" : "en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export const money = (n) =>
  new Intl.NumberFormat(lang === "ru" ? "ru-RU" : "en-US", { style: "currency", currency: "USD", maximumFractionDigits: n < 100 ? 2 : 0 }).format(n);

export const date = (t) => new Date(t).toLocaleDateString(lang === "ru" ? "ru-RU" : "en-US", { month: "short", day: "numeric", year: "numeric" });

export const hourLabel = (h) => (lang === "ru" ? `${String(h).padStart(2, "0")}:00` : `${h % 12 || 12} ${h < 12 ? "am" : "pm"}`);

export const percent = (x) => `${Math.round(x * 100)}%`;
