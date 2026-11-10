<!-- gitsmith:start hash=5f9e3b4a137b -->
<!-- Managed by gitsmith (`gitsmith agents`). Keep your own notes outside these markers. If you edit inside, gitsmith keeps your version and stops updating this section until you run `gitsmith agents --force`. -->
## Commit messages

This repo uses [gitsmith](https://www.npmjs.com/package/gitsmith). Every commit header must follow:

```
{type}({scope}): {message}
```

- **type** (required): `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `style`
- **scope** (required, must be from the list): `auth`, `ui`, `api`, `db`, `config`
- **breaking change**: pass `--breaking` (adds `!`)
- **message**: imperative mood, starts lowercase, no trailing period (enforced)
- **header length**: at most 72 characters

Example: `feat(auth): add short summary in imperative mood`

Commit without prompts (works for AI agents and scripts):

```bash
gitsmith -t feat -s auth -m "<imperative summary>"
```

Add `--body "..."` for a body, `--files <paths...>` to commit only some paths, `--dry-run --json` to preview, and `--json` for machine-readable output.
Check a message before committing with `gitsmith check "<header>"`. Run `gitsmith rules --json` for these rules as JSON.

If your agent supports MCP, prefer the `gitsmith` MCP server (`gitsmith mcp`): its `get_rules`, `get_status`, `get_diff`, `check_message` and `commit` tools do the same with structured results.
Never bypass a rejected commit with `git commit --no-verify`; fix the message instead.
<!-- gitsmith:end -->
