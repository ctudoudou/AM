IMAGE ?= ctudoudou/kura
TIMESTAMP := $(shell date +%Y%m%d%H%M%S)
TAG ?= $(TIMESTAMP)
LATEST_TAG ?= latest
TARGET ?= runner
PLATFORMS ?= linux/amd64,linux/arm64
DOCKER ?= docker

.PHONY: help build push release buildx worker-build worker-push worker-release worker-buildx

help:
	@echo "Usage:"
	@echo "  make build                 Build $(IMAGE):$(TAG) and $(IMAGE):$(LATEST_TAG) from Docker target '$(TARGET)'"
	@echo "  make push                  Push $(IMAGE):$(TAG) and $(IMAGE):$(LATEST_TAG)"
	@echo "  make release               Build and push $(IMAGE):$(TAG) and $(IMAGE):$(LATEST_TAG)"
	@echo "  make buildx                Build and push multi-arch image for $(PLATFORMS) with both tags"
	@echo "  make worker-release        Build and push $(IMAGE)-worker:$(TAG) and $(IMAGE)-worker:$(LATEST_TAG)"
	@echo "  make worker-buildx         Build and push multi-arch worker image for $(PLATFORMS) with both tags"
	@echo ""
	@echo "Variables:"
	@echo "  IMAGE=ctudoudou/kura TAG=<timestamp> LATEST_TAG=latest TARGET=runner PLATFORMS=linux/amd64,linux/arm64"

build:
	$(DOCKER) build --target $(TARGET) -t $(IMAGE):$(TAG) -t $(IMAGE):$(LATEST_TAG) .

push:
	$(DOCKER) push $(IMAGE):$(TAG)
	$(DOCKER) push $(IMAGE):$(LATEST_TAG)

release: build push

buildx:
	$(DOCKER) buildx build --target $(TARGET) --platform $(PLATFORMS) -t $(IMAGE):$(TAG) -t $(IMAGE):$(LATEST_TAG) --push .

worker-build:
	$(DOCKER) build --target worker -t $(IMAGE)-worker:$(TAG) -t $(IMAGE)-worker:$(LATEST_TAG) .

worker-push:
	$(DOCKER) push $(IMAGE)-worker:$(TAG)
	$(DOCKER) push $(IMAGE)-worker:$(LATEST_TAG)

worker-release: worker-build worker-push

worker-buildx:
	$(DOCKER) buildx build --target worker --platform $(PLATFORMS) -t $(IMAGE)-worker:$(TAG) -t $(IMAGE)-worker:$(LATEST_TAG) --push .
