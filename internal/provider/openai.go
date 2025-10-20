package provider

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/ruqqq/simple-ai-gateway/internal/database"
	"github.com/ruqqq/simple-ai-gateway/internal/storage"
)

const (
	OpenAIBaseURL = "https://api.openai.com"
)

// OpenAIProvider implements the Provider interface for OpenAI
type OpenAIProvider struct {
	baseURL string
}

// NewOpenAIProvider creates a new OpenAI provider
func NewOpenAIProvider() *OpenAIProvider {
	return &OpenAIProvider{
		baseURL: OpenAIBaseURL,
	}
}

// Name returns "openai"
func (p *OpenAIProvider) Name() string {
	return "openai"
}

// GetBaseURL returns the OpenAI base URL
func (p *OpenAIProvider) GetBaseURL() string {
	return p.baseURL
}

// ShouldProxy checks if a request should be proxied to OpenAI
// Proxy requests with /openai/v1/* prefix
func (p *OpenAIProvider) ShouldProxy(path string) bool {
	return strings.HasPrefix(path, "/openai/v1/")
}

// GetProxyURL returns the full OpenAI API URL
// Strips the /openai prefix before forwarding
func (p *OpenAIProvider) GetProxyURL(path string) string {
	// Remove /openai prefix: /openai/v1/chat/completions -> /v1/chat/completions
	strippedPath := strings.TrimPrefix(path, "/openai")
	return p.baseURL + strippedPath
}

// PrepareRequest adds OpenAI-specific headers
func (p *OpenAIProvider) PrepareRequest(req *http.Request) error {
	// OpenAI API key should already be in the Authorization header
	// passed by the client. We validate it exists.
	authHeader := req.Header.Get("Authorization")
	if authHeader == "" {
		return fmt.Errorf("missing Authorization header")
	}

	// Remove hop-by-hop headers that shouldn't be forwarded
	req.Header.Del("Connection")
	req.Header.Del("Keep-Alive")
	req.Header.Del("Proxy-Authenticate")
	req.Header.Del("Proxy-Authorization")
	req.Header.Del("TE")
	req.Header.Del("Trailers")
	req.Header.Del("Transfer-Encoding")
	req.Header.Del("Upgrade")

	return nil
}

// IsStreamingEndpoint checks if this endpoint returns server-sent events
func (p *OpenAIProvider) IsStreamingEndpoint(path string) bool {
	// Endpoints that support streaming (when stream=true parameter is present)
	streamingEndpoints := []string{
		"/openai/v1/chat/completions",
		"/openai/v1/completions",
	}

	for _, endpoint := range streamingEndpoints {
		if strings.Contains(path, endpoint) {
			return true
		}
	}

	return false
}

// ProcessResponse is a no-op for OpenAI
// OpenAI responses don't need post-processing
func (p *OpenAIProvider) ProcessResponse(responseBody string, requestID, responseID string, fs *storage.FileStorage, db *database.DB) error {
	// No-op: OpenAI responses don't require post-processing
	return nil
}
