# Version Bump Playbook

This document provides a checklist for bumping the version of FAST (Fullstack AgentCore Solution Template).

## Files Requiring Manual Updates (7 files)

1. **`VERSION`** - Root version file
2. **`pyproject.toml`** - Python package version (`version = "X.Y.Z"`)
3. **`frontend/package.json`** - Frontend package version (`"version": "X.Y.Z"`)
4. **`infra-cdk/package.json`** - CDK package version (`"version": "X.Y.Z"`)
5. **`infra-cdk/lib/fast-main-stack.ts`** - Stack description (`(vX.Y.Z)`)
6. **`infra-terraform/VERSION`** - Terraform compatibility version (`X.X.X-tf.X`)(only update if TF is verified compatible with the new FAST version; see `infra-terraform/TF_VERSION_BUMP_PLAYBOOK.md`)
7. **`infra-terraform/main.tf`** - Stack description (`(vX.X.X-tf.X)`) (only update if TF is verified compatible with the new FAST version; see `infra-terraform/TF_VERSION_BUMP_PLAYBOOK.md`)
8. **`CHANGELOG.md`** - Add new version entry at top

## Auto-Generated Files (DO NOT manually update)

- `frontend/package-lock.json`
- `infra-cdk/package-lock.json`
- `infra-cdk/lib/fast-main-stack.js`

## Procedure

### 1. Update Source Files
Manually update the 7 files listed above with the new version number.

### 2. Regenerate Auto-Generated Files
```bash
# Frontend
cd frontend && npm install

# Infrastructure  
cd infra-cdk && npm install && npm run build
```

### 3. Verification
Search for any remaining old version references:
```bash
find . -type f \( -name "*.md" -o -name "*.py" -o -name "*.js" -o -name "*.ts" -o -name "*.tsx" -o -name "*.json" -o -name "*.yaml" -o -name "*.yml" -o -name "VERSION" \) | grep -v node_modules | grep -v cdk.out | grep -v ".next" | grep -v "dist" | grep -v "build" | grep -v "__pycache__" | xargs grep -n "OLD_VERSION" 2>/dev/null
```

### 4. Testing
```bash
make all                    # Run linting
cd infra-cdk && cdk synth   # Test CDK synthesis
cd frontend && npm run build # Test frontend build
```

### 5. Git Operations
```bash
git add .
git commit -m "Bump version to X.Y.Z"
git push origin main

# Create and push tag
git tag vX.Y.Z
git push origin vX.Y.Z
```

## Notes

- Follow semantic versioning (MAJOR.MINOR.PATCH)
- Use `v` prefix for git tags (e.g., `v0.1.3`)
- Only update project version, not dependency versions
- Keep historical changelog entries unchanged
