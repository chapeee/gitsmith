# gitsmith

GitSmith: configurable conventional commits CLI for teams and solo developers.

`gitsmith` is installed once, then adapts to each project using a local `.commitconfig.json`.  
No hardcoded commit format, no heavy setup, and no memorizing templates.

## Features (v1)

- Project-aware commit format via `.commitconfig.json`
- Interactive prompts powered by `enquirer`
- Config validation with clear errors (`zod`)
- Config file discovery by walking up directories (`find-up`)
- Git safety checks (must be git repo, must have staged files)
- Commit preview + confirmation before running `git commit`
- `init` command that generates a conventional default config

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

2. Initialize config:

```bash
gitsmith init
```

3. Edit `.commitconfig.json` as needed.
4. Stage files:

```bash
git add .
```

5. Run commit flow:

```bash
gitsmith
```

## Commands

- `gitsmith` or `gitsmith commit`: Start interactive commit flow
- `gitsmith init`: Create `.commitconfig.json` in current directory
- `gitsmith init --force`: Overwrite existing config

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
  "headerMaxLength": 72
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
