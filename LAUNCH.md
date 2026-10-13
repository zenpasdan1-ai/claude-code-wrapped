# Launch plan: Claude Code Wrapped

## Why it can spread

- **Right audience at the right time.** Claude Code tooling is what's trending on GitHub and dev X this month.
- **Wrapped is a proven format.** People already know what to do with it: screenshot and post.
- **The meme is built in.** “You're absolutely right ×N” is a running joke among Claude Code users; every card carries the number.
- **Everyone's card is different.** The archetype, the count and the top language invite replies (“Night Owl, ×412, mostly Rust”).
- **Zero friction and zero risk.** One command or one folder pick, no login, nothing uploaded, which is the first question devs will ask.

## Others doing this

Two terminal-only packages already exist on npm: `claude-code-wrapped` and `claude-wrapped`
(both December 2025). Lead with what they don't have: a story you can open from a phone link,
a 9:16 card for stories, the period picker, and the languages and odds-and-ends slides.

## Before posting

1. Turn on Pages: Settings → Pages → Build and deployment → Source: **GitHub Actions**, then re-run the
   Pages workflow. The site goes live at https://zenpasdan1-ai.github.io/claude-code-wrapped/ and link
   previews pick up `og.png`.
2. Optional: publish the CLI so the command gets short. `npm login`, then `npm publish` in the repo; after
   that `npx ccwrapped` works and the README and landing command can switch to it (`CLI_CMD` in `js/main.js`).
3. Repo page: add the description, the topics `claude-code`, `claude`, `wrapped`, `spotify-wrapped`,
   `year-in-review`, `developer-tools`, and upload `og.png` as the social preview (Settings → General).
4. Run your own data once and keep both cards for the post.

## X / Twitter post

> I built Claude Code Wrapped.
>
> One command reads your ~/.claude transcripts locally (nothing uploaded) and tells you your hours with the agent, your streak, your top language, your API-equivalent spend — and how many times Claude said “You're absolutely right.”
>
> Mine: ×120. What's yours? ↓

Attach your card image. Put the link in the first reply, then a 10-second screen recording of the story in a
second reply. Post the 9:16 card to stories the same day.

## Reddit

- r/ClaudeAI — title: “I made a local-only ‘Wrapped’ for Claude Code — it counts how many times Claude told you you're absolutely right”
- r/webdev or r/SideProject — focus on the build: zero dependencies, in-browser JSONL parsing, a token-guarded localhost CLI.

Lead with the card image and the privacy line. Answer every “what's your count?” reply in the first hour.

## Hacker News

“Show HN: Claude Code Wrapped – a local-only year-in-review from your transcripts”. Mention that there is no
build step and no dependencies, the tests run on Node 18–22, and no data leaves the machine.
