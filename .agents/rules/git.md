# Git Rules — Assessment 2

## Commit granularity

- One commit per logical unit of work — a single route, a single handler, a single schema change, a single fix. Not one commit per file, not one commit for a whole feature area at once.
- The scaffolding step ends with its own commit before any feature logic begins.
- Never batch multiple unrelated changes into one commit.
- Target: by submission, the commit log should read as a story of how the slice was built — a reviewer should be able to reconstruct the build order from `git log` alone.

## Commit messages

- Present tense, imperative mood: "Add proration calculation for upgrade," not "Added" or "Adds."
- One line summarizing what changed, specific enough to be useful without opening the diff.
- If a commit is a fix for something logged in `problems.md`, reference it.

## Before every commit

- Run `git diff --staged` and actually read it before committing.
- Confirm no real secret, Flutterwave API key, webhook secret, or `.env` file is staged. If `.env` ever appears in `git status`, stop and flag it immediately.
- Confirm `.gitignore` includes `.env`, `.env.local`, `node_modules`, and any local Prisma dev artifacts.

## What must never happen

- Never commit `.env` or any file containing a real secret, even once, even if removed in a later commit.
- Never use `git commit --amend` or force-push to rewrite history that's already been shared or reviewed.
- Never leave uncommitted work at a stopping point in a session — commit or explicitly flag why not before ending a task.

## Branching

- Work directly on `main` for this slice.

## Before final submission

- Confirm, by opening the repository in a private/incognito browser window, that no `.env` or secret is visible anywhere in the repo or its history.
