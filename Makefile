# Dockman — build, install and release automation.
#
#   make deps        install the npm packages
#   make dev         run the app in development mode
#   make check       type-check the frontend and the Rust backend
#   make build       build the installers for this OS
#   make install     build and install Dockman on this machine
#   make uninstall   remove an installed Dockman
#   make release VERSION=x.y.z   bump, tag and push a release
#
# Building needs Node.js 20+, Rust (stable) and Tauri's platform
# dependencies: https://tauri.app/start/prerequisites/

REPO_URL := https://github.com/AbyAbyss/dockman
BUNDLE   := src-tauri/target/release/bundle

# OS detection. Git Bash / MSYS on Windows reports MINGW* / MSYS*.
ifeq ($(OS),Windows_NT)
  HOST := windows
else
  UNAME_S := $(shell uname -s)
  ifeq ($(UNAME_S),Darwin)
    HOST := macos
  else
    HOST := linux
  endif
endif

# Run privileged steps through sudo unless we already are root.
SUDO := $(shell [ "$$(id -u 2>/dev/null)" = "0" ] || echo sudo)

# Which bundle `make install` builds: the one this machine can install.
ifeq ($(HOST),macos)
  INSTALL_BUNDLE := app
else ifeq ($(HOST),windows)
  INSTALL_BUNDLE := nsis
else ifneq ($(shell command -v dpkg 2>/dev/null),)
  INSTALL_BUNDLE := deb
else ifneq ($(shell command -v rpm 2>/dev/null),)
  INSTALL_BUNDLE := rpm
else
  INSTALL_BUNDLE := appimage
endif

.DEFAULT_GOAL := help
.PHONY: help deps dev check build install uninstall clean release

help: ## Show available commands
	@echo "Dockman — make targets (host: $(HOST)):"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "Examples:  make install"
	@echo "           make release VERSION=0.3.1"

node_modules: package.json package-lock.json
	npm ci
	@touch node_modules

deps: node_modules ## Install the npm packages

dev: node_modules ## Run the app in development mode (hot reload)
	npm run tauri dev

check: node_modules ## Type-check the frontend and the Rust backend
	npm run typecheck
	cargo check --manifest-path src-tauri/Cargo.toml

build: node_modules ## Build the installers for this OS into src-tauri/target/release/bundle
	npm run tauri build
	@echo "==> Installers:"
	@find $(BUNDLE) -maxdepth 2 -type f \
		\( -name '*.dmg' -o -name '*.msi' -o -name '*.exe' -o -name '*.deb' \
		   -o -name '*.rpm' -o -name '*.AppImage' \) 2>/dev/null | sed 's/^/    /'

install: node_modules ## Build and install Dockman on this machine
	@echo "==> Building the $(INSTALL_BUNDLE) bundle for $(HOST)"
	npm run tauri build -- --bundles $(INSTALL_BUNDLE)
ifeq ($(HOST),macos)
	@app="$(BUNDLE)/macos/Dockman.app"; \
	test -d "$$app" || { echo "ERROR: $$app was not built"; exit 1; }; \
	echo "==> Installing $$app to /Applications"; \
	rm -rf /Applications/Dockman.app && ditto "$$app" /Applications/Dockman.app
	@echo "==> Installed. Open it from Launchpad or: open -a Dockman"
else ifeq ($(HOST),windows)
	@exe="$$(ls -t $(BUNDLE)/nsis/*-setup.exe 2>/dev/null | head -n1)"; \
	test -n "$$exe" || { echo "ERROR: no NSIS installer was built"; exit 1; }; \
	echo "==> Running $$exe"; \
	"$$exe" /S
	@echo "==> Installed. Start Dockman from the Start menu."
else ifeq ($(INSTALL_BUNDLE),deb)
	@pkg="$$(ls -t $(BUNDLE)/deb/*.deb 2>/dev/null | head -n1)"; \
	test -n "$$pkg" || { echo "ERROR: no .deb was built"; exit 1; }; \
	echo "==> Installing $$pkg"; \
	$(SUDO) apt-get install -y "./$$pkg" 2>/dev/null || $(SUDO) dpkg -i "$$pkg"
	@echo "==> Installed. Start it from your app menu or run: dockman"
else ifeq ($(INSTALL_BUNDLE),rpm)
	@pkg="$$(ls -t $(BUNDLE)/rpm/*.rpm 2>/dev/null | head -n1)"; \
	test -n "$$pkg" || { echo "ERROR: no .rpm was built"; exit 1; }; \
	echo "==> Installing $$pkg"; \
	$(SUDO) rpm -Uvh --replacepkgs "$$pkg"
	@echo "==> Installed. Start it from your app menu or run: dockman"
else
	@img="$$(ls -t $(BUNDLE)/appimage/*.AppImage 2>/dev/null | head -n1)"; \
	test -n "$$img" || { echo "ERROR: no AppImage was built"; exit 1; }; \
	mkdir -p "$$HOME/.local/bin"; \
	install -m 755 "$$img" "$$HOME/.local/bin/dockman"; \
	echo "==> Installed to ~/.local/bin/dockman"
endif

uninstall: ## Remove an installed Dockman
ifeq ($(HOST),macos)
	rm -rf /Applications/Dockman.app
else ifeq ($(HOST),windows)
	@un="$$LOCALAPPDATA/Dockman/uninstall.exe"; \
	test -f "$$un" && "$$un" /S || echo "Dockman is not installed for this user"
else ifeq ($(INSTALL_BUNDLE),deb)
	$(SUDO) dpkg -r dockman
else ifeq ($(INSTALL_BUNDLE),rpm)
	$(SUDO) rpm -e dockman
else
	rm -f "$$HOME/.local/bin/dockman"
endif
	@echo "==> Dockman removed. Settings in ~/.config/dockman are kept."

clean: ## Remove build output (dist/ and the Rust target directory)
	rm -rf dist src-tauri/target

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
	@# Keep Cargo.lock's own entry in step, or the next build dirties the tree.
	@cargo update --workspace --offline --manifest-path src-tauri/Cargo.toml 2>/dev/null \
		|| cargo update --workspace --manifest-path src-tauri/Cargo.toml
	@echo "==> Committing and tagging v$(VERSION)"
	git add package.json package-lock.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json
	@git diff --cached --quiet || git commit -m "Release v$(VERSION)"
	git tag -a "v$(VERSION)" -m "Dockman v$(VERSION)"
	@echo "==> Pushing commit and tag"
	git push origin HEAD
	git push origin "v$(VERSION)"
	@echo "==> Done. Release build started: $(REPO_URL)/actions"
