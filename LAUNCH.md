# Launch plan

## The pitch

**“Your Claude Code habits cost you money. Here's how much, and the fix.”** One command reads your
local transcripts and puts dollar figures on oversized context, re-caching after breaks and premium
models doing read-only work, shows where the agent gets stuck, and gives concrete fixes. Then it
hands you a Wrapped card to share. Nothing is uploaded.

Why it can spread:

- **A number people want to know about themselves.** “I was wasting 30% on context” gets replies.
- **Useful, not just cute.** People act on it and come back weekly (`--report --days 7`).
- **Wrapped is the share hook.** The card and the “You're absolutely right ×N” stamp travel on their own.
- **Zero risk.** Local only, open source, no login.

## Others doing this

- `ccusage` and similar tools track usage and cost. They show *how much*; this shows *why* and *what to change*.
- `claude-code-wrapped` and `claude-wrapped` on npm (December 2025) are terminal-only Wrapped stories.

## Before posting

1. Turn on Pages: Settings → Pages → Build and deployment → Source: **GitHub Actions**, then re-run the
   Pages workflow. The site goes live at https://zenpasdan1-ai.github.io/claude-code-wrapped/.
2. Optional: `npm login` and `npm publish` so the command becomes `npx ccwrapped`; then switch `CLI_CMD`
   in `js/main.js` and the README.
3. Repo page: description, topics (`claude-code`, `claude`, `developer-tools`, `cost`, `wrapped`,
   `spotify-wrapped`), and `og.png` as the social preview (Settings → General).
4. Run it on your own transcripts and screenshot your checkup and your card.

## X / Twitter thread

> I built a checkup for Claude Code.
>
> One command reads your local transcripts and tells you what your habits cost: mine was spending 32% on re-reading context past 100k tokens and 28% on re-caching after breaks.
>
> Fixes included. Nothing uploaded. ↓

1. Screenshot of your checkup (the top cards and the first finding).
2. “And because it's that time of year, it also makes you a Wrapped.” + your card.
3. The link and `npx github:zenpasdan1-ai/claude-code-wrapped --report`.

## Reddit

- r/ClaudeAI — “I measured what my Claude Code habits cost: 60% of spend was context bloat and cache misses. Made a local tool that checks yours.”
- r/ChatGPTCoding, r/LocalLLaMA (cost angle), r/SideProject (build angle: zero dependencies, token-guarded localhost CLI).

Lead with your own numbers and the privacy line. Answer every “what were yours?” in the first hour.

## Hacker News

“Show HN: A local checkup for Claude Code – what context bloat and cache misses cost you”. Mention the
method (list prices, heuristics stated in the README), no dependencies, tests on Node 18–22.
