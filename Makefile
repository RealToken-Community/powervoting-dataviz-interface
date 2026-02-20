.PHONY: dev-build dev-run dev-kill generate-manifest

generate-manifest:
	npm run generate-manifest

dev-build:
	docker compose build

dev-run: generate-manifest
	docker compose up

dev-kill:
	docker compose down
