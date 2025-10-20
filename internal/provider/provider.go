package provider

import (
	"net/http"

	"github.com/ruqqq/simple-ai-gateway/internal/database"
	"github.com/ruqqq/simple-ai-gateway/internal/storage"
)

// Provider defines the interface that all AI providers must implement
type Provider interface {
	// Name returns the name of the provider (e.g., "openai")
	Name() string

	// GetBaseURL returns the base URL for this provider
	GetBaseURL() string

	// ShouldProxy checks if a request should be proxied through this provider
	// by examining the request URL/path
	ShouldProxy(path string) bool

	// GetProxyURL converts a request path to the provider's actual API URL
	GetProxyURL(path string) string

	// PrepareRequest modifies the request before sending to the provider
	// (e.g., adding authentication headers)
	PrepareRequest(req *http.Request) error

	// IsStreamingEndpoint checks if the given path is a streaming endpoint
	IsStreamingEndpoint(path string) bool

	// ProcessResponse handles post-response processing (e.g., downloading images)
	// This is optional - providers can implement a no-op version if not needed
	ProcessResponse(responseBody string, requestID, responseID string, fs *storage.FileStorage, db *database.DB) error
}
