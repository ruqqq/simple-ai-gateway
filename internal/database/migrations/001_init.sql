-- Requests table: stores all API requests
CREATE TABLE IF NOT EXISTS requests (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    method TEXT NOT NULL,
    headers TEXT NOT NULL,  -- JSON
    body TEXT,              -- May be null for GET requests
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Responses table: stores all API responses
CREATE TABLE IF NOT EXISTS responses (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL,
    status_code INTEGER NOT NULL,
    headers TEXT NOT NULL,  -- JSON
    body TEXT,              -- May be null for streaming or binary
    duration_ms INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE
);

-- Binary files table: tracks binary files (images, etc.)
CREATE TABLE IF NOT EXISTS binary_files (
    id TEXT PRIMARY KEY,
    request_id TEXT,
    response_id TEXT,
    file_path TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE,
    FOREIGN KEY (response_id) REFERENCES responses(id) ON DELETE CASCADE
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_requests_created_at ON requests(created_at);
CREATE INDEX IF NOT EXISTS idx_requests_endpoint ON requests(endpoint);
CREATE INDEX IF NOT EXISTS idx_responses_request_id ON responses(request_id);
CREATE INDEX IF NOT EXISTS idx_responses_created_at ON responses(created_at);
CREATE INDEX IF NOT EXISTS idx_binary_files_request_id ON binary_files(request_id);
CREATE INDEX IF NOT EXISTS idx_binary_files_response_id ON binary_files(response_id);
