package provider

import (
	"fmt"
	"net/http"
	"strings"
)

const (
	ReplicateBaseURL = "https://api.replicate.com"
)

// ReplicateProvider implements the Provider interface for Replicate
type ReplicateProvider struct {
	baseURL string
}

// NewReplicateProvider creates a new Replicate provider
func NewReplicateProvider() *ReplicateProvider {
	return &ReplicateProvider{
		baseURL: ReplicateBaseURL,
	}
}

// Name returns "replicate"
func (p *ReplicateProvider) Name() string {
	return "replicate"
}

// GetBaseURL returns the Replicate base URL
func (p *ReplicateProvider) GetBaseURL() string {
	return p.baseURL
}

// ShouldProxy checks if a request should be proxied to Replicate
// Proxy requests with /replicate/v1/* prefix
func (p *ReplicateProvider) ShouldProxy(path string) bool {
	return strings.HasPrefix(path, "/replicate/v1/")
}

// GetProxyURL returns the full Replicate API URL
// Strips the /replicate prefix before forwarding
func (p *ReplicateProvider) GetProxyURL(path string) string {
	// Remove /replicate prefix: /replicate/v1/predictions -> /v1/predictions
	strippedPath := strings.TrimPrefix(path, "/replicate")
	return p.baseURL + strippedPath
}

// PrepareRequest validates and prepares the request for Replicate
func (p *ReplicateProvider) PrepareRequest(req *http.Request) error {
	// Replicate API key should be in Authorization header with "Token" format
	// Format: "Authorization: Token <token>" (not Bearer)
	authHeader := req.Header.Get("Authorization")
	if authHeader == "" {
		return fmt.Errorf("missing Authorization header")
	}

	// Validate it's using Token format (Replicate uses Token, not Bearer like OpenAI)
	if !strings.HasPrefix(authHeader, "Token ") && !strings.HasPrefix(authHeader, "Bearer ") {
		return fmt.Errorf("invalid Authorization format, expected 'Token <token>' or 'Bearer <token>'")
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

// IsStreamingEndpoint checks if this endpoint supports streaming
func (p *ReplicateProvider) IsStreamingEndpoint(path string) bool {
	// Replicate predictions endpoint supports streaming when stream parameter is present
	streamingEndpoints := []string{
		"/replicate/v1/predictions",
	}

	for _, endpoint := range streamingEndpoints {
		if strings.Contains(path, endpoint) {
			return true
		}
	}

	return false
}
