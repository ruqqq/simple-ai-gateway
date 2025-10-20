.PHONY: build clean run test help

# Variables
BINARY_NAME=gateway
GO_FILES=$(shell find . -type f -name '*.go')
VERSION?=$(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")

# Default target
help:
	@echo "Simple AI Gateway - Makefile targets"
	@echo ""
	@echo "  make build        - Build the gateway binary"
	@echo "  make clean        - Remove built binaries and cache"
	@echo "  make run          - Build and run the gateway"
	@echo "  make test         - Run tests"
	@echo "  make fmt          - Format code with gofmt"
	@echo "  make lint         - Run go vet"
	@echo "  make deps         - Download dependencies"
	@echo "  make dev          - Build with debug info"
	@echo "  make release      - Build optimized release binary"
	@echo ""

# Build the binary
build: deps
	@echo "Building $(BINARY_NAME)..."
	@go build -o $(BINARY_NAME) ./cmd/gateway
	@echo "✓ Built: $(BINARY_NAME)"

# Build with debug symbols
dev: deps
	@echo "Building $(BINARY_NAME) (debug)..."
	@go build -gcflags="all=-N -l" -o $(BINARY_NAME) ./cmd/gateway
	@echo "✓ Built: $(BINARY_NAME) (with debug symbols)"

# Build optimized release binary
release: deps clean
	@echo "Building $(BINARY_NAME) (release)..."
	@go build -ldflags="-s -w -X main.Version=$(VERSION)" -o $(BINARY_NAME) ./cmd/gateway
	@echo "✓ Built: $(BINARY_NAME) (optimized)"

# Run the gateway
run: build
	@echo "Running $(BINARY_NAME)..."
	@./$(BINARY_NAME)

# Run tests
test: deps
	@echo "Running tests..."
	@go test -v ./...
	@echo "✓ Tests passed"

# Format code
fmt:
	@echo "Formatting code..."
	@go fmt ./...
	@echo "✓ Code formatted"

# Lint code
lint: deps
	@echo "Linting code..."
	@go vet ./...
	@echo "✓ Lint passed"

# Download dependencies
deps:
	@go mod download
	@go mod tidy

# Clean build artifacts and cache
clean:
	@echo "Cleaning..."
	@rm -f $(BINARY_NAME)
	@go clean -cache -testcache
	@echo "✓ Cleaned"

# All checks (fmt, lint, test, build)
all: fmt lint test build
	@echo "✓ All checks passed"
