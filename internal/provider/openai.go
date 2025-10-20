package provider

import (
	"fmt"
	"net/http"
	"strings"
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
// For now, proxy all /v1/* requests
func (p *OpenAIProvider) ShouldProxy(path string) bool {
	return strings.HasPrefix(path, "/v1/")
}

// GetProxyURL returns the full OpenAI API URL
func (p *OpenAIProvider) GetProxyURL(path string) string {
	return p.baseURL + path
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
		"/v1/chat/completions",
		"/v1/completions",
	}

	for _, endpoint := range streamingEndpoints {
		if strings.Contains(path, endpoint) {
			return true
		}
	}

	return false
}
