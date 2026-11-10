# gitsmith

GitSmith: AI powered configurable conventional commits CLI for teams and solo developers.

[![npm version](https://img.shields.io/npm/v/gitsmith?color=cb3837)](https://www.npmjs.com/package/gitsmith)
[![npm downloads](https://img.shields.io/npm/dm/gitsmith?color=blue)](https://www.npmjs.com/package/gitsmith)
[![license](https://img.shields.io/github/license/chapeee/gitsmith?color=orange)](https://github.com/chapeee/gitsmith/blob/main/LICENSE)
[![node](https://img.shields.io/node/v/gitsmith?color=339933)](https://nodejs.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/chapeee/gitsmith/pulls)
[![issues](https://img.shields.io/github/issues/chapeee/gitsmith)](https://github.com/chapeee/gitsmith/issues)

**gitsmith** is a AI powered configurable Conventional Commits CLI that adapts to every project through a single `.commitconfig.json` file. Install it once globally, drop a config in any repo, and ship clean, consistent commits every time. Optional AI assist turns "what did you do?" into a perfectly formatted commit using a free NVIDIA model, so you stop fighting the type, scope, and wording every time you commit.

## Screenshots

### Commit flow

![GitSmith commit flow](./assets/commit.gif)

### AI flow (NVIDIA API)

Use `gitsmith --ai` to force the AI prompt and generate suggestions from your NVIDIA AI API key.

## Quick Links

- [Features](#features-v1)
- [Quick Start](#quick-start)
- [Commands](#commands)
- [AI-assisted commits](#ai-assisted-commits)
- [Local Development](#local-development)
- [Open Source](#open-source)

## Why GitSmith

- Keeps commit messages consistent across teams and repos
- Supports custom project formats through `.commitconfig.json`
- Uses optional NVIDIA AI API suggestions for faster commit writing
- Falls back to manual prompts when AI is disabled or key is missing
- Runs safety checks before commit to reduce mistakes

## Features (v1)

- Project-aware commit format via `.commitconfig.json`
- Interactive prompts powered by `enquirer`
- Config validation with clear errors (`zod`)
- Config file discovery by walking up directories (`find-up`)
- Git safety checks (must be git repo, must have staged files)
- Commit preview + confirmation before running `git commit`
- `init` command that generates a conventional default config
- Optional AI suggestions powered by the NVIDIA AI API

## Install

```bash
npm install -g gitsmith
```

Then run the CLI command:

```bash
gitsmith --help
```

## Quick Start

1. Go to your project:

```bash
cd your-project
```

1. Initialize config:

```bash
gitsmith init
```

1. Edit `.commitconfig.json` as needed.
2. Stage files:

```bash
git add .
```

1. Run commit flow:

```bash
gitsmith
```

## Commands

- `gitsmith` or `gitsmith commit`: Start interactive commit flow
- `gitsmith --ai`: Force AI prompt for this run
- `gitsmith --no-ai`: Skip AI prompt for this run
- `gitsmith init`: Create `.commitconfig.json` in current directory
- `gitsmith init --force`: Overwrite existing config
- `gitsmith key:set [key]`: Save or overwrite NVIDIA API key
- `gitsmith key:show`: Show masked key
- `gitsmith key:remove`: Remove saved key
- `gitsmith key:reset`: Alias for `key:remove`
- `gitsmith key:status`: Show saved key status
- `gitsmith -t <type> -s <scope> -m "<message>"`: Commit without prompts (see [Scripts and AI agents](#scripts-and-ai-agents))
- `gitsmith check "<message>"`: Check a message against the config without committing
- `gitsmith rules [--json]`: Print the commit rules
- `gitsmith hook install` / `gitsmith hook uninstall`: Manage the `commit-msg` hook
- `gitsmith agents [--file <path...>]`: Write the commit rules into `AGENTS.md` and similar files

## Scripts and AI agents

AI coding agents (Claude Code, Cursor, Copilot and others) and CI scripts can't answer prompts. gitsmith gives them a way to commit in your format, and blocks commits that break it.

### Commit without prompts

Passing any commit part as a flag switches gitsmith to no-prompt mode:

```bash
gitsmith -t feat -s api -m "add retry logic"
gitsmith -t fix -s ui -m "handle empty input" --body "Longer explanation." --breaking
gitsmith -t feat -s api -m "add retry logic" --dry-run --json
```

| Flag | Meaning |
| --- | --- |
| `-t, --type` | commit type (must be in `types`) |
| `-s, --scope` | scope (required when `scopes` is set) |
| `-m, --message` | summary |
| `--ticket` | ticket id; `ticketPrefix` is added if missing |
| `-b, --breaking` | adds the `!` marker |
| `--body` | commit body |
| `--dry-run` | validate and show the header, commit nothing |
| `--json` | machine-readable result: `{ ok, hash, header, body, files, warnings }` or `{ ok: false, errors }` |

Invalid input exits with code 1 and says what to fix, for example `type "feet" is not allowed. Allowed: feat, fix, ...`. If gitsmith is run without flags and without a terminal, it exits with a hint instead of waiting for input.

### Enforce the format for every commit

```bash
gitsmith hook install
```

This installs a `commit-msg` hook that runs `gitsmith check` on every commit, including plain `git commit` from people, IDEs and agents. Rejected messages list what is wrong and show an example. Merge, revert and `fixup!` messages are skipped. The hook respects `core.hooksPath`, and it won't overwrite an existing hook unless you pass `--force`.

### Tell agents the rules

```bash
gitsmith agents                       # writes AGENTS.md
gitsmith agents --file AGENTS.md CLAUDE.md .cursorrules
gitsmith rules --json                 # rules as JSON, for tools
```

`gitsmith agents` keeps its section between `<!-- gitsmith:start -->` and `<!-- gitsmith:end -->` markers, so re-running it updates the rules and leaves the rest of the file alone.

### Check a message

```bash
gitsmith check "feat(api): add retry logic"
git log -1 --format=%B | gitsmith check --stdin
gitsmith check --file .git/COMMIT_EDITMSG --json
```

## Config Schema

`.commitconfig.json` supports:

- `types: string[]` (required)
- `askScope: boolean` (required)
- `scopes?: string[]`
- `askTicket: boolean` (required)
- `ticketPrefix?: string`
- `askBreaking: boolean` (required)
- `format: string` (required)
- `headerMaxLength?: number`
- `strictScopes?: boolean`: when `true`, only scopes in `scopes` are allowed everywhere: the interactive flow hides "Other", AI can't invent scopes, and `check`, the hook and no-prompt mode reject unknown scopes. When `false` or missing, unknown scopes only get a warning. `gitsmith init` sets it to `true`.
- `messageStyle?: "conventional" | "off"`: `"conventional"` (the default) requires the summary to start lowercase and have no trailing period. Acronyms such as `API` are allowed at the start. `"off"` turns the check off.

Available format tokens:

- `{type}`
- `{scope}`
- `{ticket}`
- `{message}`
- `{breaking}` (`!` when true, otherwise empty)

### Default Config

```json
{
  "types": ["feat", "fix", "docs", "chore", "refactor", "test", "style"],
  "askScope": true,
  "scopes": ["auth", "ui", "api", "db", "config"],
  "askTicket": false,
  "askBreaking": true,
  "format": "{type}({scope}): {message}",
  "headerMaxLength": 72,
  "strictScopes": true,
  "messageStyle": "conventional",
  "ai": {
    "enabled": true,
    "askByDefault": true
  }
}
```

## Example

Given:

- `type = feat`
- `scope = auth`
- `ticket = PROJ-123`
- `message = add login flow`

and format:

```text
{type}({scope}): {ticket} {message}
```

final commit header:

```text
feat(auth): PROJ-123 add login flow
```

## AI-assisted commits

AI is optional and fully additive. If your project has no `ai` block, behavior stays exactly the same.

### Quick start

```bash
npm install -g gitsmith
gitsmith key:set
gitsmith
```

### NVIDIA AI API key

Get a free key from [build.nvidia.com](https://build.nvidia.com).

### Enable AI in `.commitconfig.json`

```json
{
  "types": ["feat", "fix", "docs", "chore", "refactor", "test", "style"],
  "askScope": true,
  "scopes": ["auth", "ui", "api", "db", "config"],
  "askTicket": false,
  "askBreaking": true,
  "format": "{type}({scope}): {message}",
  "ai": {
    "enabled": true,
    "provider": "nvidia",
    "model": "nvidia/llama-3.3-nemotron-super-49b-v1",
    "endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
    "askByDefault": true,
    "allowNewScopes": true
  }
}
```

### Key management

| Command                  | Purpose                         |
| ------------------------ | ------------------------------- |
| `gitsmith key:set`       | Prompt and save key             |
| `gitsmith key:set <key>` | Save key non-interactively      |
| `gitsmith key:show`      | Show masked key                 |
| `gitsmith key:remove`    | Remove key after confirmation   |
| `gitsmith key:reset`     | Alias for `key:remove`          |
| `gitsmith key:status`    | Show provider/source/saved time |

### CI and scripting

Set `GITSMITH_AI_KEY` in the environment. It overrides the saved local file.

### Privacy note

Only the free-text description entered by the user is sent to AI. Source code and git diffs are not sent.

### AI flags

- `gitsmith --ai`: force AI prompt for this run
- `gitsmith --no-ai`: skip AI prompt for this run

## Local Development

```bash
npm install
npm link
```

Now test in any git repo:

```bash
gitsmith init
git add .
gitsmith
```

## Publish Checklist

- Set final npm package name in `package.json`
- Ensure version is correct (first release: `0.1.0`)
- Run:

```bash
npm run lint
npm publish
```

## Open Source

- License: MIT
- Contributions welcome via pull requests
- See `CONTRIBUTING.md` and `CODE_OF_CONDUCT.md`
