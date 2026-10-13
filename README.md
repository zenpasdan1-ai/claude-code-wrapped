# Claude Code Wrapped

[![Tests](https://github.com/zenpasdan1-ai/claude-code-wrapped/actions/workflows/ci.yml/badge.svg)](https://github.com/zenpasdan1-ai/claude-code-wrapped/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-c8ff5a.svg)](LICENSE)

A Spotify-Wrapped-style story of your time with Claude Code, built from the transcripts
Claude Code already keeps in `~/.claude/projects`. Everything runs on your machine:
files are read locally and only counts are kept. Unofficial fan project, not affiliated
with Anthropic.

**Try it:** [zenpasdan1-ai.github.io/claude-code-wrapped](https://zenpasdan1-ai.github.io/claude-code-wrapped/) ·
[demo story](https://zenpasdan1-ai.github.io/claude-code-wrapped/#demo)

<p align="center">
  <img src="docs/demo.gif" width="300" alt="The story on a phone: hours, prompts, “You're absolutely right” count, cost, models, heatmap, streak, tools, languages, odds and ends, projects and the share card">
  &nbsp;&nbsp;
  <img src="docs/card-story.png" width="220" alt="9:16 story card: The Polite Coder, 150 hours, 2.6K prompts, 11 day streak, $396 API value, ×157 absolutely right">
</p>

## Get yours in one command

```sh
npx github:zenpasdan1-ai/claude-code-wrapped
```

It finds your transcripts (`$CLAUDE_CONFIG_DIR/projects`, `~/.claude/projects` or
`~/.config/claude/projects`), starts a tiny server on `127.0.0.1` and opens your story in the
browser. Pass a folder to read somewhere else: `npx github:zenpasdan1-ai/claude-code-wrapped /path/to/projects`.
Options: `--port <n>`, `--no-open`. Needs Node 18.17 or newer.

Prefer not to run anything? Open the [site](https://zenpasdan1-ai.github.io/claude-code-wrapped/)
and choose `~/.claude/projects` (on macOS press ⌘⇧. to show hidden folders), pick `.jsonl`
files, or drop the folder onto the page.

## What it shows

- Active hours with the agent (idle gaps over 30 minutes are not counted), sessions, longest session
- Prompts you typed, plus how often you wrote “please”, “thanks”, and words we won't print
- How many times Claude said “You're absolutely right”
- API-equivalent value of your usage (list prices; see `js/pricing.js`) and your priciest day
- Model mix, weekday × hour heatmap, longest streak, top tools
- The languages the agent edited for you, from file extensions (paths never leave memory)
- Odds and ends: your longest prompt, how often you hit stop, subagents launched
- Top projects, with names blurred until you reveal them
- An archetype (Night Owl, Polite Coder, Opus Maximalist…) and a share card in two sizes:
  1200×675 for posts and 1080×1920 for stories
- Any period: all time, this year, the last 90 or 30 days

![Six slides: ×157 absolutely right, API-equivalent cost, weekly rhythm, TypeScript as the top language, odds and ends, story card](docs/story-strip.png)

![Landing page: one-command start, choose ~/.claude/projects, pick .jsonl files or see a demo](docs/landing.png)

Every image here uses the built-in demo data. All 13 slides at phone size are in
[`docs/slides`](docs/slides), and the walkthrough as a video is [`docs/demo.mp4`](docs/demo.mp4).

## Privacy

- The page reads files with the browser's File API. Nothing is uploaded and there is no analytics.
- The CLI listens on `127.0.0.1` only. Its transcript routes need a random one-time token from
  the link it prints and refuse any other host name, so other sites can't read them.
- Project names are blurred on screen until you choose to show them; the card never includes them.

## Develop

```sh
npm start        # the site at http://127.0.0.1:8080 (open /#demo for sample data)
npm test         # parser, pricing, stats, CLI and server tests (node:test, no dependencies)
node bin/ccwrapped.mjs --help
```

No build step and no dependencies: plain ES modules, Canvas 2D for the cards, and Node's
standard library for the CLI. Pushing to `main` runs the tests on Node 18, 20 and 22 and
publishes the site to GitHub Pages.

## How it counts

| Number | Source |
| --- | --- |
| Prompts | `type: "user"` lines with typed text; tool results, slash commands and interrupts are excluded |
| Tokens and cost | `message.usage` on assistant lines, de-duplicated by `message.id` + `requestId` (streaming writes repeats) |
| Active time | Gaps between consecutive events in a session, each gap capped out if longer than 30 minutes |
| Streak | Consecutive local calendar days with at least one prompt |
| Languages | `file_path` of `Edit`, `MultiEdit`, `Write` and `NotebookEdit` calls, by extension |
| Subagents | `Task` and `Agent` tool calls |
| Period | Lines outside the chosen range are skipped before anything is counted |

Prices are API list prices per million tokens; cache writes at 1.25× input and cache
reads at 0.1× input unless a model publishes its own cache-read price. Rows marked
`legacy` are older published prices so old transcripts still count. It is an
estimate of value, not a bill.

## Prior art

Transcript parsing ideas (dedupe by message and request id, cost from usage fields) follow
open-source tools such as [ccusage](https://github.com/ryoppippi/ccusage) (MIT). No code is copied.
