# Contributing

Thanks for helping! Pull requests are welcome.

## How it works
- Fork the repo and open a pull request against `main`. Nobody pushes to `main` directly.
- Every PR is reviewed and merged by the maintainer. Nothing is merged automatically.
- Keep a PR focused on one change, and say what it does and how you checked it.

## Before you open a PR
```bash
npm test          # provider readers, masking, incremental counts
node --check server.js
```

## Ground rules
- **Zero dependencies.** The bridge and the UI use only Node built-ins and plain browser APIs.
- **Local and read-only by default.** The server binds to `127.0.0.1`. Readers of Claude, Codex, Gemini and Grok data must never write to those tools' folders.
- **Nothing personal.** Never commit real session data, paths, project names, tokens or emails. Test fixtures must be made-up data. Run a quick `git grep` for your username and home path before pushing.
- **Secrets stay masked.** Anything shown from a transcript goes through `mask()` in `util.js`.
- **Skins and perks:** see [docs/RPG.md](docs/RPG.md). `ui/rpg-core.js` is shared by the server and the browser, so keep it free of Node-only or browser-only code.

By contributing you agree your work is released under the [MIT License](LICENSE).

## Security issues
Please do not open a public issue for a vulnerability. Use GitHub's "Report a vulnerability" button on the Security tab.
