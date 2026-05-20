# Dockman — release automation.
#
# Cut a release with:   make release VERSION=0.2.0
#
# `make release` bumps the version in package.json, src-tauri/Cargo.toml and
# src-tauri/tauri.conf.json, commits the bump, creates a v<VERSION> tag and
# pushes it. Pushing the tag triggers the build in
# .github/workflows/release.yml, which publishes installers for macOS,
# Windows and Linux.

REPO_URL := https://github.com/AbyAbyss/abyss_pod

.DEFAULT_GOAL := help
.PHONY: help release

help: ## Show available commands
	@echo "Dockman — make targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-9s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "Example:  make release VERSION=0.2.0"

release: ## Bump version, tag and push to trigger the release build (VERSION=x.y.z)
	@test -n "$(VERSION)" \
		|| { echo "ERROR: set VERSION, e.g. make release VERSION=0.2.0"; exit 1; }
	@echo "$(VERSION)" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$$' \
		|| { echo "ERROR: VERSION must be semver like 0.2.0 (got '$(VERSION)')"; exit 1; }
	@test -z "$$(git status --porcelain)" \
		|| { echo "ERROR: working tree is dirty — commit or stash changes first"; exit 1; }
	@! git rev-parse -q --verify "refs/tags/v$(VERSION)" >/dev/null \
		|| { echo "ERROR: tag v$(VERSION) already exists"; exit 1; }
	@echo "==> Bumping version to $(VERSION)"
	@npm version --no-git-tag-version --allow-same-version "$(VERSION)" >/dev/null
	@perl -i -pe 's/^version = ".*"/version = "$(VERSION)"/' src-tauri/Cargo.toml
	@perl -i -pe 's/"version": "[^"]*"/"version": "$(VERSION)"/' src-tauri/tauri.conf.json
	@echo "==> Committing and tagging v$(VERSION)"
	git add package.json package-lock.json src-tauri/Cargo.toml src-tauri/tauri.conf.json
	@git diff --cached --quiet || git commit -m "Release v$(VERSION)"
	git tag -a "v$(VERSION)" -m "Dockman v$(VERSION)"
	@echo "==> Pushing commit and tag"
	git push origin HEAD
	git push origin "v$(VERSION)"
	@echo "==> Done. Release build started: $(REPO_URL)/actions"
