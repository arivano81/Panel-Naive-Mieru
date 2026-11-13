[🇷🇺 Русский](SECURITY.md) | [🇬🇧 English](SECURITY.en.md)

# Security policy

## Supported versions

Security fixes are prepared for the current `main` branch and the newest published release.
Older installations should be upgraded before troubleshooting.

## Reporting a vulnerability

Do not publish an exploit, credentials, subscription links, private keys, production server
addresses, or diagnostic archives in an issue, discussion, or public chat.

Use **Security → Advisories → Report a vulnerability** in the private repository and include only:

- the affected commit or release;
- the affected component and prerequisites;
- impact and a safe reproduction sequence;
- sanitized logs with secrets removed;
- a known temporary mitigation, if available.

The maintainer should acknowledge the report within 72 hours. Repair time depends on severity,
exploitability, and safe rollout. Disclosure is coordinated only after a fixed release is available.

## Administrator response

1. Restrict panel access to SSH/loopback and stop affected optional profiles.
2. Preserve a root-only backup and sanitized diagnostic evidence.
3. Rotate the panel password, HTTP Basic Auth, TOTP, user passwords, subscription tokens,
   VLESS UUIDs, and OpenFlux keys that may have been exposed.
4. Replace the affected binary or release only with a project-published checksum, then rebuild
   all managed configurations.
5. Review the administrator audit log and systemd journals before restoring public access.

## Release revocation

Only a project maintainer may revoke a release. The maintainer must:

1. Mark the GitHub release as compromised and remove downloadable artifacts; never silently
   reuse or replace the same version tag.
2. Publish an advisory with affected versions, indicators, containment, and required rotations.
3. Block the affected version in installer/update metadata or pinned constants and publish a new
   version with new checksums.
4. Run the complete Debian 12/13 CI and real Xray/OpenFlux canaries for the replacement commit.
5. Record the incident and recovery steps in `CHANGELOG.md`, then notify administrators through
   the release notes.

Deleting a tag alone is not revocation: installed servers and cached artifacts remain affected
until administrators upgrade and rotate exposed secrets.
