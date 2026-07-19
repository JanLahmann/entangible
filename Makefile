# Entangible (QAMPoser-physical) — dev & demo targets.
# M2 kiosk host: FastAPI + WS broadcast hub, live vision loop, replay demo mode.
# Entangible One: ONE app (pocket-app) — served at / (standalone/viewer/camera),
# /?kiosk (big-screen booth skin) and /debug (staff).

REPLAY_DIR ?= tests/fixtures/recordings/bell-sequence
PORT ?= 8443

.PHONY: dev demo test help
.DEFAULT_GOAL := help

help:
	@echo "Entangible make targets:"
	@echo "  make dev   - uv sync, then run the host on the replay source with autoreload"
	@echo "               (run 'npm run dev' in pocket-app/ separately for the Vite UI)"
	@echo "  make demo  - full no-camera demo: build the app + serve the replay loop"
	@echo "  make test  - run the test suite (uv run pytest -q)"

dev:
	uv sync
	@echo "== host: http://localhost:$(PORT) (autoreload) — vision loop on replay source"
	@echo "== for the live UI, in another shell: cd pocket-app && npm install && npm run dev"
	QAMPOSER_SOURCE="replay:$(REPLAY_DIR)" QAMPOSER_PORT="$(PORT)" QAMPOSER_NO_TLS=1 \
		uv run uvicorn qamposer_host.main:app_from_env --factory --reload \
		--host 0.0.0.0 --port $(PORT)

demo: uv-sync-quiet replay-fixture app-build
	@echo "== Entangible demo: replay loop on $(REPLAY_DIR)"
	@echo "== --open launches the big-screen kiosk skin (/?kiosk&connect=1)"
	uv run qamposer-physical run --source "replay:$(REPLAY_DIR)" --port $(PORT) --open

test:
	uv run pytest -q

# --- demo helpers ---------------------------------------------------------

uv-sync-quiet:
	uv sync

replay-fixture:
	@if [ ! -d "$(REPLAY_DIR)" ]; then \
		if [ -f tests/utils/make_recording.py ]; then \
			echo "== generating replay fixture -> $(REPLAY_DIR)"; \
			uv run python tests/utils/make_recording.py; \
		else \
			echo "!! replay fixture $(REPLAY_DIR) missing and tests/utils/make_recording.py not found"; \
			echo "!! the demo needs a recording; continuing (host will serve without frames)"; \
		fi; \
	else \
		echo "== replay fixture present: $(REPLAY_DIR)"; \
	fi

app-build:
	@if [ -f pocket-app/package.json ]; then \
		if [ -d pocket-app/dist ]; then \
			echo "== app already built (pocket-app/dist)"; \
		elif command -v npm >/dev/null 2>&1; then \
			echo "== building the app (npm ci && npm run build)"; \
			cd pocket-app && npm ci && npm run build; \
		else \
			echo "!! npm not found — skipping app build; host will show the 'not built' page"; \
		fi; \
	else \
		echo "== no pocket-app/package.json — skipping app build"; \
	fi
