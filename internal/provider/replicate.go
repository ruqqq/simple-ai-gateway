package provider

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/ruqqq/simple-ai-gateway/internal/database"
	"github.com/ruqqq/simple-ai-gateway/internal/storage"
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

// ProcessResponse handles post-response processing for Replicate
// Downloads and stores images from the output field locally
func (p *ReplicateProvider) ProcessResponse(responseBody string, requestID, responseID string, fs *storage.FileStorage, db *database.DB) error {
	// Parse the response JSON
	var response map[string]interface{}
	if err := json.Unmarshal([]byte(responseBody), &response); err != nil {
		return fmt.Errorf("failed to parse response JSON: %w", err)
	}

	// Extract output field
	output, exists := response["output"]
	if !exists {
		return nil // No output field, nothing to do
	}

	// Handle different output formats
	var urls []string
	switch v := output.(type) {
	case string:
		// Single URL
		if isImageURL(v) {
			urls = []string{v}
		}
	case []interface{}:
		// Array of URLs
		for _, item := range v {
			if str, ok := item.(string); ok && isImageURL(str) {
				urls = append(urls, str)
			}
		}
	}

	// Download and store each image
	httpClient := &http.Client{
		Timeout: 30 * time.Second,
	}

	for _, url := range urls {
		if err := downloadAndStoreImage(url, requestID, responseID, fs, db, httpClient); err != nil {
			fmt.Printf("Warning: failed to download/store image from %s: %v\n", url, err)
			// Continue with other images if one fails
		}
	}

	return nil
}

// Helper function to check if a string is an image URL
func isImageURL(url string) bool {
	if !strings.HasPrefix(url, "http://") && !strings.HasPrefix(url, "https://") {
		return false
	}
	return strings.HasSuffix(strings.ToLower(url), ".png") ||
		strings.HasSuffix(strings.ToLower(url), ".jpg") ||
		strings.HasSuffix(strings.ToLower(url), ".jpeg") ||
		strings.HasSuffix(strings.ToLower(url), ".gif") ||
		strings.HasSuffix(strings.ToLower(url), ".webp")
}

// Helper function to download and store an image
func downloadAndStoreImage(url, requestID, responseID string, fs *storage.FileStorage, db *database.DB, client *http.Client) error {
	// Download the image
	resp, err := client.Get(url)
	if err != nil {
		return fmt.Errorf("failed to download image: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download returned status %d", resp.StatusCode)
	}

	// Save to storage
	contentType := resp.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "image/png" // Default to PNG
	}

	filePath, size, err := fs.SaveFile("replicate", contentType, resp.Body)
	if err != nil {
		return fmt.Errorf("failed to save file: %w", err)
	}

	// Store binary file reference
	_, err = db.StoreBinaryFile(requestID, responseID, filePath, contentType, size)
	if err != nil {
		return fmt.Errorf("failed to store binary file reference: %w", err)
	}

	fmt.Printf("Stored Replicate output image: %s (%d bytes)\n", filePath, size)
	return nil
}
