package api

import (
	"time"

	"github.com/ruqqq/simple-ai-gateway/internal/database"
)

// RequestListItem represents a request in the list view
type RequestListItem struct {
	ID           string    `json:"id"`
	Provider     string    `json:"provider"`
	Endpoint     string    `json:"endpoint"`
	Method       string    `json:"method"`
	CreatedAt    time.Time `json:"created_at"`
	Status       int       `json:"status,omitempty"`        // From response if available
	IsError      bool      `json:"is_error,omitempty"`      // True if response indicates error
	ErrorMessage string    `json:"error_message,omitempty"` // Error message if available
}

// ResponseDetail represents a response with details
type ResponseDetail struct {
	ID           string            `json:"id"`
	StatusCode   int               `json:"status_code"`
	Headers      map[string]string `json:"headers"`
	Body         string            `json:"body"`
	DurationMs   int               `json:"duration_ms"`
	IsError      bool              `json:"is_error"`
	ErrorMessage *string           `json:"error_message,omitempty"`
	CreatedAt    time.Time         `json:"created_at"`
}

// BinaryFileDetail represents a binary file reference
type BinaryFileDetail struct {
	ID          string `json:"id"`
	FilePath    string `json:"file_path"`
	ContentType string `json:"content_type"`
	Size        int64  `json:"size"`
}

// RequestDetail represents full request details with response and binary files
type RequestDetail struct {
	Request      *database.Request  `json:"request"`
	Response     *ResponseDetail    `json:"response,omitempty"`
	BinaryFiles  []*BinaryFileDetail `json:"binary_files,omitempty"`
}

// EventMessage represents an SSE event
type EventMessage struct {
	Type    string        `json:"type"` // "request_created", "response_created"
	Request *RequestListItem `json:"request,omitempty"`
	Data    interface{}   `json:"data,omitempty"`
}

// ListRequestsRequest represents query parameters for listing requests
type ListRequestsRequest struct {
	Provider    string `json:"provider"`
	PathPattern string `json:"path_pattern"`
	DateFrom    int64  `json:"date_from"` // Unix timestamp
	DateTo      int64  `json:"date_to"`   // Unix timestamp
	Limit       int    `json:"limit"`
	Offset      int    `json:"offset"`
}

// ListRequestsResponse represents the response for listing requests
type ListRequestsResponse struct {
	Requests []*RequestListItem `json:"requests"`
	Total    int                `json:"total"`
}

// StatsResponse represents statistics about requests
type StatsResponse struct {
	TotalRequests      int                 `json:"total_requests"`
	RequestsByProvider map[string]int      `json:"requests_by_provider"`
	RequestsByStatus   map[int]int         `json:"requests_by_status"`
}

// ErrorResponse represents an error response
type ErrorResponse struct {
	Error string `json:"error"`
}
