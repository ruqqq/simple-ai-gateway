# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Simple AI Gateway** is a lightweight, self-hosted reverse proxy that intercepts API requests to multiple AI providers (OpenAI, Replicate) and logs all requests/responses to SQLite for auditing and debugging. It's designed as a transparent drop-in replacement for direct API calls, with path-based routing to support multiple providers.

### Key Architecture Decisions

1. **Multi-Provider Design**: The codebase is structured to easily add new providers (Anthropic, Google, etc.) beyond OpenAI. All providers implement a common `Provider` interface in `internal/provider/provider.go`.

2. **Request/Response Logging Flow**:
   - Incoming request → parse + log to SQLite (`requests` table)
   - Forward to provider API
   - Receive response (potentially compressed with gzip or Brotli)
   - **Decompress for storage** (responses are decompressed before storing in DB to keep data readable)
   - **Send original compressed response to client** (transparent proxy behavior)
   - Log decompressed response to SQLite (`responses` table)

3. **Binary File Handling**: Images and binary responses are detected by Content-Type header and saved to `data/files/{provider}/{date}/{uuid}.{ext}`. Database references are stored in the `binary_files` table for easy lookup.

4. **Streaming Support**: Server-sent events (SSE) from `/v1/chat/completions` and other streaming endpoints are captured in full using `io.TeeReader` while being forwarded live to the client.

## Development Commands

```bash
# Build the binary
make build

# Build and run immediately
make run

# Clean build artifacts
make clean

# Format code
make fmt

# Run linter (go vet)
make lint

# Download/sync dependencies
make deps

# Build with debug symbols
make dev

# Optimized release build
make release

# Run all checks (fmt, lint, test, build)
make all

# Show all make targets
make help
```

## Path-Based Routing

The gateway uses **path-based routing** to support multiple AI providers simultaneously:

- **OpenAI**: `/openai/v1/*` → `https://api.openai.com/v1/*`
  - Example: `POST http://gateway:8080/openai/v1/chat/completions`

- **Replicate**: `/replicate/v1/*` → `https://api.replicate.com/v1/*`
  - Example: `POST http://gateway:8080/replicate/v1/predictions`

The provider prefix (e.g., `/openai`, `/replicate`) is stripped before forwarding to the upstream API. This allows the same gateway instance to proxy requests to multiple providers.

**Breaking Change**: Existing OpenAI clients must update their `base_url` from `http://gateway:8080/v1` to `http://gateway:8080/openai/v1`.

## Database Schema

Three main tables in SQLite:

- **requests**: `id`, `provider`, `endpoint`, `method`, `headers` (JSON), `body`, `created_at`
- **responses**: `id`, `request_id`, `status_code`, `headers` (JSON), `body`, `duration_ms`, `created_at`
- **binary_files**: `id`, `request_id`, `response_id`, `file_path`, `content_type`, `size`, `created_at`

The `provider` field in the `requests` table indicates which provider handled each request (e.g., "openai" or "replicate").

Query the database: `sqlite3 data/gateway.db`

## Adding a New Provider

To add a new AI provider (e.g., Anthropic):

1. Create a new file `internal/provider/{provider_name}.go` implementing the `Provider` interface
2. Implement all 6 required methods:
   - `Name()`: Return the provider name (e.g., "anthropic")
   - `GetBaseURL()`: Return the provider's API base URL
   - `ShouldProxy(path)`: Check if path matches your provider's pattern (e.g., `/anthropic/v1/*`)
   - `GetProxyURL(path)`: Strip the provider prefix and return the upstream URL
   - `PrepareRequest(req)`: Handle provider-specific auth format (e.g., `x-api-key` header)
   - `IsStreamingEndpoint(path)`: Return true for endpoints that support streaming
3. Register the provider in `cmd/aigw/main.go` by adding it to the `providers` slice
4. Update README and CLAUDE.md documentation with the new endpoint paths
5. No changes needed to proxy/logging logic - it's provider-agnostic

**Path-Based Routing Pattern**: All providers use the same pattern: `/{provider_name}/v1/*` → provider API. The proxy handler iterates through registered providers and uses the first one where `ShouldProxy()` returns true.

## Configuration

Configured via environment variables with `.env` file support (optional):

- `PORT` (default: 8080)
- `DB_PATH` (default: ./data/gateway.db)
- `FILE_STORAGE_PATH` (default: ./data/files)

See `internal/config/config.go` for how defaults are applied.

## Important Implementation Details

### Response Decompression (`internal/proxy/proxy.go`)
- OpenAI sends compressed responses using gzip or Brotli based on client's `Accept-Encoding`
- The `decompressBody()` function handles both transparently:
  - `gzip`: Uses Go's standard `compress/gzip` package
  - `br` (Brotli): Uses `github.com/andybalholm/brotli` package
- Decompressed body is stored in database (readable JSON)
- Original compressed response is sent to client (bandwidth efficient)
- This applies to both regular and streaming responses
- Falls back to storing compressed if decompression fails

### Streaming Detection
- Checks if endpoint is in `streamingEndpoints` list (e.g., `/v1/chat/completions`)
- Also checks `stream=true` query parameter or request body field
- Uses `io.TeeReader` to capture stream while forwarding live

### Request Flow
1. `cmd/aigw/main.go`: Initialize config, DB, storage, providers, create chi router
2. `internal/proxy/proxy.go#Handle()`: Route request to appropriate provider, log request, detect if streaming
3. `handleRegularResponse()` or `handleStreamingResponse()`: Execute request, decompress if needed, log response, forward to client
4. Database and filesystem operations happen asynchronously with warnings logged if they fail (won't block proxying)

## Common Development Tasks

**Debugging a request/response:**
```sql
-- Find recent requests
SELECT id, endpoint, method, created_at FROM requests ORDER BY created_at DESC LIMIT 5;

-- Get full request+response pair
SELECT r.endpoint, r.method, r.body, resp.status_code, resp.body
FROM requests r
JOIN responses resp ON r.id = resp.request_id
WHERE r.id = '<request-id>';
```

**Testing with a real API call:**
```bash
# Start gateway
./aigw

# In another terminal, test via gateway
curl -X POST http://localhost:8080/openai/v1/chat/completions \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4","messages":[{"role":"user","content":"hi"}]}'

# Then query SQLite to see the logged data
sqlite3 data/gateway.db "SELECT body FROM responses ORDER BY created_at DESC LIMIT 1;"
```

## Web UI

The gateway includes a built-in web UI for browsing logged requests and responses:
- Located in `internal/ui/web/` (embedded into the binary via `go:embed`)
- Accessible at the gateway's root path (e.g., `http://localhost:8080`)
- Real-time updates using Server-Sent Events (SSE)
- Media preview for images extracted from requests/responses
- Request filtering by provider, date range, and endpoint pattern

## Known Limitations & Future Work

- Additional providers beyond OpenAI and Replicate need to be added (Anthropic, Google, etc.)
- Web UI could be enhanced with advanced search and filtering capabilities
- No request filtering, search, or export functionality at API level
- No rate limiting or quota management
- No request modification hooks (intercepting/modifying requests before forwarding)
