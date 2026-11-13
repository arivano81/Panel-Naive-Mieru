[🇷🇺 Русский](CONTRIBUTING.md) | [🇬🇧 English](CONTRIBUTING.en.md)

# Contributing

## Before starting

1. Check `ROADMAP.md` and existing issues to avoid duplicate work.
2. For a bug, describe reproduction, expected behavior, and actual behavior.
3. Never add secrets, production server addresses, client profiles, or unsanitized logs.
4. Changes to VPN binaries, firewall, routing, or systemd need an explicit test and rollback plan.

## Change requirements

- preserve existing installations and keep new protocols disabled by default;
- validate configuration before restarting one service and never restart unrelated VPN components;
- pin downloaded binaries and verify SHA-256;
- add the smallest regression test for changed behavior;
- run `npm test --prefix panel`; Bash must also pass `bash -n` and ShellCheck in CI;
- keep unrelated changes in separate commits.

## Documentation

User-visible installation, configuration, access, security, or behavior changes must update the
primary Russian `README.md` in plain language and the matching `README.en.md` in the same change.
Instructions must explain what changed, what to do, how to verify it, and how to roll it back.
Copy-ready commands and warnings must appear before risky actions. Update `CHANGELOG.md` and,
when planning changes, `ROADMAP.md` as well.

## Pre-publish check

```bash
npm test --prefix panel
git diff --check
```

GitHub CI additionally covers Debian 12/13, Bash syntax, ShellCheck, pinned binaries, SBOM, and
isolated canaries. A change is ready only after green CI.

Report vulnerabilities through [SECURITY.en.md](SECURITY.en.md), never through an issue.
