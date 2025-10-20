package proxy

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/ruqqq/simple-ai-gateway/internal/database"
	"github.com/ruqqq/simple-ai-gateway/internal/provider"
	"github.com/ruqqq/simple-ai-gateway/internal/storage"
)

type ProxyHandler struct {
	db        *database.DB
	storage   *storage.FileStorage
	providers map[string]provider.Provider
}

// New creates a new proxy handler
func New(db *database.DB, fs *storage.FileStorage, providers []provider.Provider) *ProxyHandler {
	providerMap := make(map[string]provider.Provider)
	for _, p := range providers {
		providerMap[p.Name()] = p
	}

	return &ProxyHandler{
		db:        db,
		storage:   fs,
		providers: providerMap,
	}
}

// Handle is the main HTTP handler for proxying requests
func (ph *ProxyHandler) Handle(w http.ResponseWriter, r *http.Request) {
	start := time.Now()

	// Find the appropriate provider
	var selectedProvider provider.Provider
	for _, p := range ph.providers {
		if p.ShouldProxy(r.URL.Path) {
			selectedProvider = p
			break
		}
	}

	if selectedProvider == nil {
		http.Error(w, "No provider found for this request", http.StatusBadRequest)
		return
	}

	// Log the incoming request
	requestID, err := ph.logRequest(selectedProvider, r)
	if err != nil {
		fmt.Printf("Warning: failed to log request: %v\n", err)
		// Continue anyway, logging failure shouldn't block proxying
	}

	// Check if this is a streaming request
	isStreaming := ph.isStreamingRequest(selectedProvider, r)

	// Prepare the proxy request
	proxyReq, err := ph.prepareProxyRequest(selectedProvider, r)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to prepare request: %v", err), http.StatusBadRequest)
		return
	}

	// Execute the proxy request
	if isStreaming {
		ph.handleStreamingResponse(w, selectedProvider, proxyReq, requestID)
	} else {
		ph.handleRegularResponse(w, selectedProvider, proxyReq, requestID, start)
	}
}

// logRequest logs the incoming request to the database
func (ph *ProxyHandler) logRequest(prov provider.Provider, r *http.Request) (string, error) {
	// Read body
	bodyBytes, _ := io.ReadAll(r.Body)
	r.Body = io.NopCloser(bytes.NewBuffer(bodyBytes))

	// Convert headers to map
	headers := make(map[string]string)
	for key, values := range r.Header {
		if len(values) > 0 {
			headers[key] = values[0]
		}
	}

	input := &database.StoreRequestInput{
		Provider: prov.Name(),
		Endpoint: r.URL.Path,
		Method:   r.Method,
		Headers:  headers,
		Body:     string(bodyBytes),
	}

	return ph.db.StoreRequest(input)
}

// prepareProxyRequest prepares the request to be sent to the provider
func (ph *ProxyHandler) prepareProxyRequest(prov provider.Provider, r *http.Request) (*http.Request, error) {
	// Read the body
	bodyBytes, _ := io.ReadAll(r.Body)
	r.Body = io.NopCloser(bytes.NewBuffer(bodyBytes))

	// Create new request for the provider
	targetURL := prov.GetProxyURL(r.URL.RequestURI())
	proxyReq, err := http.NewRequest(r.Method, targetURL, bytes.NewBuffer(bodyBytes))
	if err != nil {
		return nil, fmt.Errorf("failed to create proxy request: %w", err)
	}

	// Copy headers
	proxyReq.Header = r.Header.Clone()

	// Let provider prepare the request (validate auth, etc.)
	if err := prov.PrepareRequest(proxyReq); err != nil {
		return nil, err
	}

	return proxyReq, nil
}

// isStreamingRequest checks if this request should be streamed
func (ph *ProxyHandler) isStreamingRequest(prov provider.Provider, r *http.Request) bool {
	if !prov.IsStreamingEndpoint(r.URL.Path) {
		return false
	}

	// Check if stream parameter is true
	queryParams := r.URL.Query()
	if queryParams.Get("stream") == "true" {
		return true
	}

	// Also check in request body for stream parameter
	bodyBytes, _ := io.ReadAll(r.Body)
	r.Body = io.NopCloser(bytes.NewBuffer(bodyBytes))

	var requestBody map[string]interface{}
	if err := json.Unmarshal(bodyBytes, &requestBody); err == nil {
		if stream, ok := requestBody["stream"].(bool); ok && stream {
			return true
		}
	}

	return false
}

// handleRegularResponse handles non-streaming responses
func (ph *ProxyHandler) handleRegularResponse(
	w http.ResponseWriter,
	prov provider.Provider,
	proxyReq *http.Request,
	requestID string,
	start time.Time,
) {
	client := &http.Client{}
	resp, err := client.Do(proxyReq)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to reach provider: %v", err), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	// Read response body
	respBody, _ := io.ReadAll(resp.Body)
	duration := int(time.Since(start).Milliseconds())

	// Check if this is a binary response
	contentType := resp.Header.Get("Content-Type")
	isBinary := strings.HasPrefix(contentType, "image/") ||
		strings.HasPrefix(contentType, "audio/") ||
		strings.HasPrefix(contentType, "video/")

	// If binary, save to filesystem
	var binaryFilePath string
	var binaryFileSize int64
	if isBinary {
		var err error
		binaryFilePath, binaryFileSize, err = ph.storage.SaveFile(prov.Name(), contentType, bytes.NewBuffer(respBody))
		if err != nil {
			fmt.Printf("Warning: failed to save binary file: %v\n", err)
		}
	}

	// Log the response
	headers := make(map[string]string)
	for key, values := range resp.Header {
		if len(values) > 0 {
			headers[key] = values[0]
		}
	}

	respInput := &database.StoreResponseInput{
		RequestID:  requestID,
		StatusCode: resp.StatusCode,
		Headers:    headers,
		Body:       string(respBody),
		DurationMs: duration,
	}

	responseID, err := ph.db.StoreResponse(respInput)
	if err != nil {
		fmt.Printf("Warning: failed to log response: %v\n", err)
	}

	// Store binary file reference if applicable
	if binaryFilePath != "" && responseID != "" {
		_, err := ph.db.StoreBinaryFile("", responseID, binaryFilePath, contentType, binaryFileSize)
		if err != nil {
			fmt.Printf("Warning: failed to store binary file reference: %v\n", err)
		}
	}

	// Write response headers
	for key, values := range resp.Header {
		for _, value := range values {
			w.Header().Add(key, value)
		}
	}
	w.WriteHeader(resp.StatusCode)

	// Write response body
	w.Write(respBody)
}

// handleStreamingResponse handles server-sent event streaming responses
func (ph *ProxyHandler) handleStreamingResponse(
	w http.ResponseWriter,
	prov provider.Provider,
	proxyReq *http.Request,
	requestID string,
) {
	start := time.Now()

	client := &http.Client{}
	resp, err := client.Do(proxyReq)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to reach provider: %v", err), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	// Set up response headers for streaming
	w.Header().Set("Content-Type", resp.Header.Get("Content-Type"))
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	// Copy other headers
	for key, values := range resp.Header {
		if key != "Content-Type" && key != "Cache-Control" && key != "Connection" {
			for _, value := range values {
				w.Header().Add(key, value)
			}
		}
	}

	w.WriteHeader(resp.StatusCode)

	// Stream the response while capturing it
	var bufferedResponse bytes.Buffer
	reader := io.TeeReader(resp.Body, &bufferedResponse)

	// Use flusher to ensure data is sent immediately
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming not supported", http.StatusBadRequest)
		return
	}

	// Copy the streaming data
	_, _ = io.Copy(w, reader)
	flusher.Flush()

	// Log the response
	duration := int(time.Since(start).Milliseconds())

	headers := make(map[string]string)
	for key, values := range resp.Header {
		if len(values) > 0 {
			headers[key] = values[0]
		}
	}

	respInput := &database.StoreResponseInput{
		RequestID:  requestID,
		StatusCode: resp.StatusCode,
		Headers:    headers,
		Body:       bufferedResponse.String(),
		DurationMs: duration,
	}

	_, err = ph.db.StoreResponse(respInput)
	if err != nil {
		fmt.Printf("Warning: failed to log streaming response: %v\n", err)
	}
}
