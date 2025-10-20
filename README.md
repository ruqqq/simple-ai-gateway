# Simple AI Gateway

A lightweight, self-hosted gateway that proxies API requests to AI providers (starting with OpenAI) while logging all requests and responses to SQLite for audit and debugging purposes.

## Features

- **Request/Response Logging**: All requests and responses are persisted to SQLite with full headers, bodies, status codes, and timing information
- **Streaming Support**: Handles both regular and streaming (Server-Sent Events) responses
- **Binary File Storage**: Images and other binary responses are stored on the filesystem with database references for easy lookup
- **Multi-Provider Ready**: Extensible architecture supports adding multiple AI providers (currently OpenAI)
- **Simple Deployment**: Zero-config with sensible defaults, uses environment variables with optional `.env` file
- **Transparent Proxy**: Drop-in replacement - just change your API base URL from `https://api.openai.com` to your gateway URL

## Getting Started

### Prerequisites

- Go 1.21 or higher
- SQLite3 (usually pre-installed)

### Installation

1. Clone the repository
```bash
git clone https://github.com/ruqqq/simple-ai-gateway.git
cd simple-ai-gateway
```

2. Build the application
```bash
go build -o gateway ./cmd/gateway
```

### Configuration

The gateway uses environment variables for configuration. Create a `.env` file (optional) or set environment variables directly:

```env
# Server Configuration
PORT=8080

# Database Configuration
DB_PATH=./data/gateway.db

# File Storage Configuration
FILE_STORAGE_PATH=./data/files
```

All values have sensible defaults and are optional.

### Running the Gateway

```bash
./gateway
```

Or with custom configuration:
```bash
PORT=3000 DB_PATH=/var/lib/gateway/gateway.db ./gateway
```

The gateway will start listening on the configured port (default: 8080).

### Using the Gateway

Instead of pointing your client to `https://api.openai.com`, point it to your gateway:

**Before:**
```python
from openai import OpenAI

client = OpenAI(api_key="your-api-key")
```

**After:**
```python
from openai import OpenAI

client = OpenAI(
    api_key="your-api-key",
    base_url="http://localhost:8080/v1"
)
```

The API key is passed through to OpenAI, so your existing authentication remains unchanged.

## Supported Endpoints

The gateway currently supports:

- `/v1/chat/completions` - Chat completions (with streaming support)
- `/v1/images/generations` - Image generation
- `/v1/images/edits` - Image editing
- `/v1/images/variations` - Image variations
- And generally proxies all `/v1/*` endpoints

## Database Schema

### requests
Stores all API requests:
- `id`: Unique request ID
- `provider`: Provider name (e.g., "openai")
- `endpoint`: API endpoint path
- `method`: HTTP method (GET, POST, etc.)
- `headers`: Request headers (JSON)
- `body`: Request body
- `created_at`: Timestamp

### responses
Stores all API responses:
- `id`: Unique response ID
- `request_id`: Reference to the request
- `status_code`: HTTP status code
- `headers`: Response headers (JSON)
- `body`: Response body
- `duration_ms`: Request duration in milliseconds
- `created_at`: Timestamp

### binary_files
Tracks binary files (images, audio, video):
- `id`: Unique file ID
- `request_id`: Reference to the request
- `response_id`: Reference to the response
- `file_path`: Path to the stored file
- `content_type`: MIME type
- `size`: File size in bytes
- `created_at`: Timestamp

## Accessing Logged Data

The gateway stores data in SQLite. You can query it using any SQLite client:

### Using SQLite CLI
```bash
sqlite3 data/gateway.db
```

### Example Queries

Get recent requests:
```sql
SELECT id, provider, endpoint, method, created_at
FROM requests
ORDER BY created_at DESC
LIMIT 10;
```

Get request with full response:
```sql
SELECT r.id, r.method, r.endpoint, resp.status_code, resp.body
FROM requests r
LEFT JOIN responses resp ON r.id = resp.request_id
WHERE r.id = 'some-request-id';
```

Find all image requests:
```sql
SELECT r.id, r.created_at, bf.file_path, bf.size
FROM requests r
JOIN binary_files bf ON r.id = bf.request_id
WHERE r.endpoint LIKE '%/images/%'
ORDER BY r.created_at DESC;
```

## Architecture

```
simple-ai-gateway/
├── cmd/gateway/main.go              # Entry point
├── internal/
│   ├── config/                      # Configuration management
│   ├── database/                    # SQLite database layer
│   │   └── migrations/              # Database schema
│   ├── storage/                     # File storage layer
│   ├── provider/                    # Provider interface & implementations
│   │   ├── provider.go              # Provider interface
│   │   └── openai.go                # OpenAI provider
│   └── proxy/                       # Request proxying & logging
```

## Future Features

- [ ] Additional providers (Anthropic, Google, etc.)
- [ ] Web UI for browsing logged requests/responses
- [ ] Request filtering and search
- [ ] Export functionality (CSV, JSON)
- [ ] Rate limiting and quota management
- [ ] Request modification/interception hooks
- [ ] Response caching

## Health Check

The gateway provides a health check endpoint:

```bash
curl http://localhost:8080/health
```

Response:
```json
{"status":"ok"}
```

## Development

### Running Tests

```bash
go test ./...
```

### Building a Release

```bash
go build -o gateway ./cmd/gateway
```

## Troubleshooting

### Database locked error
If you see "database is locked" errors, check that:
1. Only one instance of the gateway is running
2. No other process is using the database file
3. Database file permissions are correct

### Binary files not saving
Ensure the file storage directory is writable:
```bash
mkdir -p data/files
chmod 755 data/files
```

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
