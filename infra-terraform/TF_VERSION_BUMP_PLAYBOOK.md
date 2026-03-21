# Terraform Version Bump Playbook

`infra-terraform/VERSION` is a compatibility declaration — it states which FAST version the Terraform code is verified compatible with. It always includes a `-tf.N` suffix that matches the corresponding git tag.

## When to Bump

| Scenario | VERSION file | Git tag |
|----------|-------------|---------|
| FAST release, TF verified compatible | `0.X.Y-tf.0` | `v0.X.Y-tf.0` |
| FAST release, TF not yet verified | Leave unchanged | No `-tf` tag |
| TF catches up to a FAST release | `0.X.Y-tf.0` | `v0.X.Y-tf.0` |
| TF-specific bug fix | `0.X.Y-tf.N` | `v0.X.Y-tf.N` |
| CDK-only or backend/frontend changes | Leave unchanged | No `-tf` tag |

## Changes That Typically Require TF Updates

- New AWS resources added to the architecture
- IAM policy changes
- Infrastructure topology changes (API Gateway routes, Cognito config)
- New deployment modes
- New CDK input configuration settings (`config.yaml`) that need corresponding TF variables

## Changes That Typically Don't Require TF Updates

- Frontend changes (React, Vite, UI features)
- Backend/Python changes (agent patterns, dependency bumps)
- CDK-specific fixes (construct refactoring, CDK dependency updates)
- Docs/CI changes
- Security patches in non-infra dependencies

## Git Tagging

- FAST releases get a regular `v0.X.Y` tag (CDK always covered)
- TF verified for that version gets a `v0.X.Y-tf.0` tag (may be same day or later)
- TF-specific bug fixes get `v0.X.Y-tf.1`, `v0.X.Y-tf.2`, etc.
- No `-tf.*` tags for a FAST version = TF not yet verified

Users find the right TF version with: `git tag --list 'v0.X.Y-tf*'`

## CHANGELOG

Terraform changes are tracked in the existing project-level `CHANGELOG.md` — there is no separate Terraform changelog. Use a `[Terraform]` label to distinguish TF-specific entries. Entries without a label apply to all deployment paths.

Example:
```markdown
## [0.4.0] - 2026-04-01

### Added
- [Terraform] Support for new deployment configuration variables
- New agent pattern for multi-turn conversations

### Fixed
- [Terraform] IAM policy for Lambda execution role
```

## Procedure

1. Update `infra-terraform/VERSION` with the new version
2. Update `infra-terraform/main.tf` with the new version in the Cloudformation stack description
3. Update `CHANGELOG.md` with `[Terraform]` labeled entries
4. Commit, tag with `v<VERSION-tf.X>`, and push

```bash
git tag v$(cat infra-terraform/VERSION)
git push origin v$(cat infra-terraform/VERSION)
```
