package database

import (
	"database/sql"
	"embed"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	_ "github.com/mattn/go-sqlite3"
	"github.com/google/uuid"
)

//go:embed migrations/*.sql
var migrationFS embed.FS

type DB struct {
	conn *sql.DB
	mu   sync.RWMutex
}

// New creates a new database connection and runs migrations
func New(dbPath string) (*DB, error) {
	// Create parent directories if they don't exist
	if err := os.MkdirAll(filepath.Dir(dbPath), 0755); err != nil {
		return nil, fmt.Errorf("failed to create database directory: %w", err)
	}

	conn, err := sql.Open("sqlite3", dbPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	// Test the connection
	if err := conn.Ping(); err != nil {
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	// Set connection pool settings
	conn.SetMaxOpenConns(25)
	conn.SetMaxIdleConns(5)
	conn.SetConnMaxLifetime(5 * time.Minute)

	db := &DB{conn: conn}

	// Run migrations
	if err := db.migrate(); err != nil {
		conn.Close()
		return nil, fmt.Errorf("migration failed: %w", err)
	}

	return db, nil
}

func (db *DB) migrate() error {
	content, err := migrationFS.ReadFile("migrations/001_init.sql")
	if err != nil {
		return fmt.Errorf("failed to read migration file: %w", err)
	}

	_, err = db.conn.Exec(string(content))
	if err != nil {
		return fmt.Errorf("failed to execute migration: %w", err)
	}

	return nil
}

// Close closes the database connection
func (db *DB) Close() error {
	return db.conn.Close()
}

// StoreRequest stores a request in the database
func (db *DB) StoreRequest(input *StoreRequestInput) (string, error) {
	db.mu.Lock()
	defer db.mu.Unlock()

	id := uuid.New().String()
	headerJSON, err := headersToJSON(input.Headers)
	if err != nil {
		return "", fmt.Errorf("failed to marshal headers: %w", err)
	}

	_, err = db.conn.Exec(
		"INSERT INTO requests (id, provider, endpoint, method, headers, body) VALUES (?, ?, ?, ?, ?, ?)",
		id, input.Provider, input.Endpoint, input.Method, headerJSON, input.Body,
	)
	if err != nil {
		return "", fmt.Errorf("failed to store request: %w", err)
	}

	return id, nil
}

// StoreResponse stores a response in the database
func (db *DB) StoreResponse(input *StoreResponseInput) (string, error) {
	db.mu.Lock()
	defer db.mu.Unlock()

	id := uuid.New().String()
	headerJSON, err := headersToJSON(input.Headers)
	if err != nil {
		return "", fmt.Errorf("failed to marshal headers: %w", err)
	}

	_, err = db.conn.Exec(
		"INSERT INTO responses (id, request_id, status_code, headers, body, duration_ms) VALUES (?, ?, ?, ?, ?, ?)",
		id, input.RequestID, input.StatusCode, headerJSON, input.Body, input.DurationMs,
	)
	if err != nil {
		return "", fmt.Errorf("failed to store response: %w", err)
	}

	return id, nil
}

// StoreBinaryFile stores a reference to a binary file
func (db *DB) StoreBinaryFile(requestID, responseID, filePath, contentType string, size int64) (string, error) {
	db.mu.Lock()
	defer db.mu.Unlock()

	id := uuid.New().String()

	_, err := db.conn.Exec(
		"INSERT INTO binary_files (id, request_id, response_id, file_path, content_type, size) VALUES (?, ?, ?, ?, ?, ?)",
		id, requestID, responseID, filePath, contentType, size,
	)
	if err != nil {
		return "", fmt.Errorf("failed to store binary file: %w", err)
	}

	return id, nil
}

// GetRequest retrieves a request by ID
func (db *DB) GetRequest(id string) (*Request, error) {
	db.mu.RLock()
	defer db.mu.RUnlock()

	row := db.conn.QueryRow(
		"SELECT id, provider, endpoint, method, headers, body, created_at FROM requests WHERE id = ?",
		id,
	)

	var req Request
	var headerJSON string

	err := row.Scan(&req.ID, &req.Provider, &req.Endpoint, &req.Method, &headerJSON, &req.Body, &req.CreatedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("request not found")
		}
		return nil, fmt.Errorf("failed to get request: %w", err)
	}

	if headerJSON != "" {
		headers, err := headersFromJSON(headerJSON)
		if err != nil {
			return nil, fmt.Errorf("failed to unmarshal headers: %w", err)
		}
		req.Headers = headers
	}

	return &req, nil
}

// GetResponse retrieves a response by ID
func (db *DB) GetResponse(id string) (*Response, error) {
	db.mu.RLock()
	defer db.mu.RUnlock()

	row := db.conn.QueryRow(
		"SELECT id, request_id, status_code, headers, body, duration_ms, created_at FROM responses WHERE id = ?",
		id,
	)

	var resp Response
	var headerJSON string

	err := row.Scan(&resp.ID, &resp.RequestID, &resp.StatusCode, &headerJSON, &resp.Body, &resp.DurationMs, &resp.CreatedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("response not found")
		}
		return nil, fmt.Errorf("failed to get response: %w", err)
	}

	if headerJSON != "" {
		headers, err := headersFromJSON(headerJSON)
		if err != nil {
			return nil, fmt.Errorf("failed to unmarshal headers: %w", err)
		}
		resp.Headers = headers
	}

	return &resp, nil
}

// GetResponseByRequestID retrieves the first response for a request
func (db *DB) GetResponseByRequestID(requestID string) (*Response, error) {
	db.mu.RLock()
	defer db.mu.RUnlock()

	row := db.conn.QueryRow(
		"SELECT id, request_id, status_code, headers, body, duration_ms, created_at FROM responses WHERE request_id = ? LIMIT 1",
		requestID,
	)

	var resp Response
	var headerJSON string

	err := row.Scan(&resp.ID, &resp.RequestID, &resp.StatusCode, &headerJSON, &resp.Body, &resp.DurationMs, &resp.CreatedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("response not found")
		}
		return nil, fmt.Errorf("failed to get response: %w", err)
	}

	if headerJSON != "" {
		headers, err := headersFromJSON(headerJSON)
		if err != nil {
			return nil, fmt.Errorf("failed to unmarshal headers: %w", err)
		}
		resp.Headers = headers
	}

	return &resp, nil
}

// ListRequestsParams contains filter parameters for listing requests
type ListRequestsParams struct {
	Provider    string
	PathPattern string
	DateFrom    time.Time
	DateTo      time.Time
	Limit       int
	Offset      int
}

// ListRequests returns a list of requests with optional filtering
func (db *DB) ListRequests(params *ListRequestsParams) ([]*Request, error) {
	db.mu.RLock()
	defer db.mu.RUnlock()

	query := "SELECT id, provider, endpoint, method, headers, body, created_at FROM requests WHERE 1=1"
	args := []interface{}{}

	if params.Provider != "" {
		query += " AND provider = ?"
		args = append(args, params.Provider)
	}

	if params.PathPattern != "" {
		query += " AND endpoint LIKE ?"
		args = append(args, "%"+params.PathPattern+"%")
	}

	if !params.DateFrom.IsZero() {
		query += " AND created_at >= ?"
		args = append(args, params.DateFrom)
	}

	if !params.DateTo.IsZero() {
		query += " AND created_at <= ?"
		args = append(args, params.DateTo)
	}

	query += " ORDER BY created_at DESC"

	if params.Limit > 0 {
		query += " LIMIT ?"
		args = append(args, params.Limit)
	}

	if params.Offset > 0 {
		query += " OFFSET ?"
		args = append(args, params.Offset)
	}

	rows, err := db.conn.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to query requests: %w", err)
	}
	defer rows.Close()

	var requests []*Request

	for rows.Next() {
		var req Request
		var headerJSON string

		err := rows.Scan(&req.ID, &req.Provider, &req.Endpoint, &req.Method, &headerJSON, &req.Body, &req.CreatedAt)
		if err != nil {
			return nil, fmt.Errorf("failed to scan request: %w", err)
		}

		if headerJSON != "" {
			headers, err := headersFromJSON(headerJSON)
			if err != nil {
				return nil, fmt.Errorf("failed to unmarshal headers: %w", err)
			}
			req.Headers = headers
		}

		requests = append(requests, &req)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating requests: %w", err)
	}

	return requests, nil
}

// GetBinaryFilesByRequestID retrieves all binary files for a request
func (db *DB) GetBinaryFilesByRequestID(requestID string) ([]*BinaryFile, error) {
	db.mu.RLock()
	defer db.mu.RUnlock()

	rows, err := db.conn.Query(
		"SELECT id, request_id, response_id, file_path, content_type, size, created_at FROM binary_files WHERE request_id = ? ORDER BY created_at",
		requestID,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to query binary files: %w", err)
	}
	defer rows.Close()

	var files []*BinaryFile

	for rows.Next() {
		var file BinaryFile
		err := rows.Scan(&file.ID, &file.RequestID, &file.ResponseID, &file.FilePath, &file.ContentType, &file.Size, &file.CreatedAt)
		if err != nil {
			return nil, fmt.Errorf("failed to scan binary file: %w", err)
		}
		files = append(files, &file)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating binary files: %w", err)
	}

	return files, nil
}
