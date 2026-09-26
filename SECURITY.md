# Security policy

## Supported versions

Security fixes are prepared for the current `main` branch and the newest
published release. Older snapshots should be upgraded before troubleshooting.

## Reporting a vulnerability

Do not publish an exploit, credentials, subscription links, private keys, server
addresses or diagnostic archives in an issue, discussion or chat.

Use **Security → Advisories → Report a vulnerability** in this private GitHub
repository. Include only the minimum reproducible details:

- affected commit or release;
- affected component and prerequisites;
- impact and a safe reproduction sequence;
- sanitized logs with secrets removed;
- a proposed mitigation, if known.

The maintainer should acknowledge the report within 72 hours. No fixed repair
deadline is promised: severity, exploitability and safe rollout determine it.
The reporter and maintainer coordinate disclosure only after a fixed release is
available to administrators.

## Administrator response

If compromise is suspected:

1. Restrict panel access to SSH/loopback and stop experimental profiles.
2. Preserve a root-only backup and sanitized diagnostic evidence.
3. Rotate the panel password, HTTP Basic Auth password, TOTP secret, user
   passwords, subscription tokens, VLESS UUIDs and OpenFlux profile keys that
   may have been exposed.
4. Replace the affected binary or release only with a version whose checksum is
   recorded by the project, then rebuild all managed configurations.
5. Review the administrator audit log and service journals for unexpected
   changes before reopening access.

## Release revocation procedure

Only a maintainer may revoke a project release. The maintainer must:

1. Mark the GitHub release as compromised and remove downloadable artifacts;
   never silently reuse or replace the same version tag.
2. Add a prominent advisory naming the affected versions, indicators of
   compromise, immediate containment and required secret rotations.
3. Disable the affected version in installer/update metadata or pinned component
   constants and publish a new version with new checksums.
4. Run the complete Debian 12/13 CI and real Xray/OpenFlux canaries for the
   replacement commit.
5. Record the incident and recovery instructions in `CHANGELOG.md`, then notify
   administrators through the release notes.

Deleting a tag alone is not revocation: existing servers and cached artifacts
remain affected until administrators upgrade and rotate exposed credentials.
