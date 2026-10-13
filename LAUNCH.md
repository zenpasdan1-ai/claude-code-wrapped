# Launch plan: Claude Code Wrapped

## Why it can spread

- **Right audience at the right time.** Claude Code tooling is what's trending on GitHub and dev X this month.
- **Wrapped is a proven format.** People already know what to do with it: screenshot and post.
- **The meme is built in.** “You're absolutely right ×N” is a running joke among Claude Code users; every card carries the number.
- **Everyone's card is different.** The archetype and the count invite replies (“I'm a Night Owl, ×412”).
- **Zero friction and zero risk.** No login, nothing uploaded, which is the first question devs will ask.

## Before posting

1. Host it on a real URL (GitHub Pages, Netlify or Vercel; it is static). Put the absolute URL of `og.png` in `og:image` so the link preview shows the card.
2. Run your own data once and keep your card for the post.

## X / Twitter post

> I built Claude Code Wrapped.
>
> It reads your ~/.claude transcripts locally (nothing uploaded) and tells you your hours with the agent, your streak, your API-equivalent spend — and how many times Claude said “You're absolutely right.”
>
> Mine: ×120. What's yours? ↓

Attach your card image. Put the link in the first reply, then a 10-second screen recording of the story in a second reply.

## Reddit

- r/ClaudeAI — title: “I made a local-only ‘Wrapped’ for Claude Code — it counts how many times Claude told you you're absolutely right”
- r/webdev or r/SideProject — focus on the build: zero-dependency, in-browser JSONL parsing.

Lead with the card image and the privacy line. Answer every “what's your count?” reply in the first hour.

## Hacker News

“Show HN: Claude Code Wrapped – a local-only year-in-review from your transcripts”. Mention that the parser is ~200 lines, tested with node:test, and no data leaves the machine.
