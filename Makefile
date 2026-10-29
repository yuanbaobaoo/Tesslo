SHELL := /bin/bash
.PHONY: sync patch build test clean hap verify

sync:
	bash scripts/sync-upstream.sh

patch: sync
	bash scripts/apply-patches.sh

build: patch
	bash scripts/build-desktop.sh

test:
	npm test

hap:
	bash scripts/build-hap.sh

verify:
	bash scripts/verify-hap.sh $(TARGET)

clean:
	rm -rf build build-output packages/*/node_modules node_modules
