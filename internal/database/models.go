package database

import (
	"encoding/json"
	"time"
)

// Request represents a stored API request
type Request struct {
	ID        string            `json:"id"`
	Provider  string            `json:"provider"`
	Endpoint  string            `json:"endpoint"`
	Method    string            `json:"method"`
	Headers   map[string]string `json:"headers"`
	Body      string            `json:"body"`
	CreatedAt time.Time         `json:"created_at"`
}

// Response represents a stored API response
type Response struct {
	ID           string            `json:"id"`
	RequestID    string            `json:"request_id"`
	StatusCode   int               `json:"status_code"`
	Headers      map[string]string `json:"headers"`
	Body         string            `json:"body"`
	DurationMs   int               `json:"duration_ms"`
	IsError      bool              `json:"is_error"`
	ErrorMessage string            `json:"error_message,omitempty"`
	CreatedAt    time.Time         `json:"created_at"`
}

// BinaryFile represents a stored binary file reference
type BinaryFile struct {
	ID          string    `json:"id"`
	RequestID   string    `json:"request_id"`
	ResponseID  string    `json:"response_id"`
	FilePath    string    `json:"file_path"`
	ContentType string    `json:"content_type"`
	Size        int64     `json:"size"`
	CreatedAt   time.Time `json:"created_at"`
}

// StoreRequestInput is input for storing a request
type StoreRequestInput struct {
	Provider string
	Endpoint string
	Method   string
	Headers  map[string]string
	Body     string
}

// StoreResponseInput is input for storing a response
type StoreResponseInput struct {
	RequestID  string
	StatusCode int
	Headers    map[string]string
	Body       string
	DurationMs int
	IsError    bool
	ErrorMessage string
}

// Helper functions for JSON serialization
func headersToJSON(h map[string]string) (string, error) {
	data, err := json.Marshal(h)
	return string(data), err
}

func headersFromJSON(s string) (map[string]string, error) {
	var h map[string]string
	err := json.Unmarshal([]byte(s), &h)
	return h, err
}
