package proxy

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/andybalholm/brotli"
	"github.com/ruqqq/simple-ai-gateway/internal/api"
	"github.com/ruqqq/simple-ai-gateway/internal/database"
	"github.com/ruqqq/simple-ai-gateway/internal/provider"
	"github.com/ruqqq/simple-ai-gateway/internal/storage"
)

type ProxyHandler struct {
	db          *database.DB
	storage     *storage.FileStorage
	providers   map[string]provider.Provider
	broadcaster *api.SSEBroadcaster
	apiHandler  *api.Handler
}

// New creates a new proxy handler
func New(db *database.DB, fs *storage.FileStorage, providers []provider.Provider, broadcaster *api.SSEBroadcaster, apiHandler *api.Handler) *ProxyHandler {
	providerMap := make(map[string]provider.Provider)
	for _, p := range providers {
		providerMap[p.Name()] = p
	}

	return &ProxyHandler{
		db:          db,
		storage:     fs,
		providers:   providerMap,
		broadcaster: broadcaster,
		apiHandler:  apiHandler,
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
	requestID, reqData, err := ph.logRequest(selectedProvider, r)
	if err != nil {
		fmt.Printf("Warning: failed to log request: %v\n", err)
		// Continue anyway, logging failure shouldn't block proxying
	} else if reqData != nil {
		// Emit request created event asynchronously
		go ph.apiHandler.BroadcastRequestCreated(reqData)
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

// logErrorResponse logs an error response to the database
func (ph *ProxyHandler) logErrorResponse(requestID string, err error, start time.Time) (string, error) {
	duration := int(time.Since(start).Milliseconds())

	respInput := &database.StoreResponseInput{
		RequestID:    requestID,
		StatusCode:   http.StatusBadGateway,
		Headers:      make(map[string]string),
		Body:         "",
		DurationMs:   duration,
		IsError:      true,
		ErrorMessage: err.Error(),
	}

	responseID, dbErr := ph.db.StoreResponse(respInput)
	if dbErr != nil {
		fmt.Printf("Warning: failed to log error response: %v\n", dbErr)
	}

	return responseID, nil
}

// decompressBody decompresses the response body based on Content-Encoding header
func decompressBody(body []byte, contentEncoding string) ([]byte, error) {
	contentEncoding = strings.ToLower(strings.TrimSpace(contentEncoding))

	switch contentEncoding {
	case "gzip":
		reader, err := gzip.NewReader(bytes.NewBuffer(body))
		if err != nil {
			return nil, fmt.Errorf("failed to create gzip reader: %w", err)
		}
		defer reader.Close()

		decompressed, err := io.ReadAll(reader)
		if err != nil {
			return nil, fmt.Errorf("failed to decompress gzip: %w", err)
		}
		return decompressed, nil

	case "br":
		decompressed := brotli.NewReader(bytes.NewBuffer(body))
		result, err := io.ReadAll(decompressed)
		if err != nil {
			return nil, fmt.Errorf("failed to decompress brotli: %w", err)
		}
		return result, nil

	case "deflate", "compress":
		// These encodings are not supported yet, return original
		fmt.Printf("Warning: unsupported Content-Encoding: %s, storing compressed\n", contentEncoding)
		return body, nil

	case "", "identity":
		// No compression
		return body, nil

	default:
		// Unknown encoding, return original
		return body, nil
	}
}

// logRequest logs the incoming request to the database
func (ph *ProxyHandler) logRequest(prov provider.Provider, r *http.Request) (string, *database.Request, error) {
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

	id, err := ph.db.StoreRequest(input)
	if err != nil {
		return "", nil, err
	}

	// Retrieve the stored request to get its creation time
	storedReq, err := ph.db.GetRequest(id)
	if err != nil {
		return id, nil, err
	}

	return id, storedReq, nil
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
	// Log outgoing request
	fmt.Printf("[OUT] → %s %s %s\n", prov.Name(), proxyReq.Method, proxyReq.URL.String())

	client := &http.Client{}
	resp, err := client.Do(proxyReq)
	if err != nil {
		fmt.Printf("Error reaching provider: %v\n", err)
		// Log error to database
		ph.logErrorResponse(requestID, err, start)
		// Return error to client
		http.Error(w, fmt.Sprintf("Failed to reach provider: %v", err), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	// Read response body (may be compressed)
	respBody, _ := io.ReadAll(resp.Body)
	duration := int(time.Since(start).Milliseconds())

	// Log response status
	fmt.Printf("[RESP] ← %s %d (%dms)\n", prov.Name(), resp.StatusCode, duration)

	// Decompress body for storage (keep original for client)
	contentEncoding := resp.Header.Get("Content-Encoding")
	decompressedBody := respBody
	if contentEncoding != "" {
		var err error
		decompressedBody, err = decompressBody(respBody, contentEncoding)
		if err != nil {
			fmt.Printf("Warning: failed to decompress response: %v, storing compressed\n", err)
			decompressedBody = respBody
		}
	}

	// Check if this is a binary response
	contentType := resp.Header.Get("Content-Type")
	isBinary := strings.HasPrefix(contentType, "image/") ||
		strings.HasPrefix(contentType, "audio/") ||
		strings.HasPrefix(contentType, "video/")

	// If binary, save to filesystem (use original body for binary data)
	var binaryFilePath string
	var binaryFileSize int64
	if isBinary {
		var err error
		binaryFilePath, binaryFileSize, err = ph.storage.SaveFile(prov.Name(), contentType, bytes.NewBuffer(respBody))
		if err != nil {
			fmt.Printf("Warning: failed to save binary file: %v\n", err)
		}
	}

	// Log the response (with decompressed body)
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
		Body:       string(decompressedBody),
		DurationMs: duration,
	}

	responseID, err := ph.db.StoreResponse(respInput)
	if err != nil {
		fmt.Printf("Warning: failed to log response: %v\n", err)
	} else {
		// Update binary file reference with request ID
		if binaryFilePath != "" {
			_, err := ph.db.StoreBinaryFile(requestID, responseID, binaryFilePath, contentType, binaryFileSize)
			if err != nil {
				fmt.Printf("Warning: failed to store binary file reference: %v\n", err)
			}
		}

		// Call provider's post-response processing asynchronously
		go func() {
			if err := prov.ProcessResponse(string(decompressedBody), requestID, responseID, ph.storage, ph.db); err != nil {
				fmt.Printf("Warning: provider post-response processing failed: %v\n", err)
			}

			// Emit response created event
			storedResp, err := ph.db.GetResponse(responseID)
			if err == nil && storedResp != nil {
				ph.apiHandler.BroadcastResponseCreated(storedResp)
			}
		}()
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

	// Log outgoing request
	fmt.Printf("[OUT] → %s %s %s\n", prov.Name(), proxyReq.Method, proxyReq.URL.String())

	client := &http.Client{}
	resp, err := client.Do(proxyReq)
	if err != nil {
		fmt.Printf("Error reaching provider: %v\n", err)
		// Log error to database
		ph.logErrorResponse(requestID, err, start)
		// Return error to client
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

	// Log response status
	fmt.Printf("[RESP] ← %s %d (%dms)\n", prov.Name(), resp.StatusCode, duration)

	// Decompress body for storage (keep original for client)
	contentEncoding := resp.Header.Get("Content-Encoding")
	storedBody := bufferedResponse.String()
	if contentEncoding != "" {
		decompressedBody, err := decompressBody(bufferedResponse.Bytes(), contentEncoding)
		if err != nil {
			fmt.Printf("Warning: failed to decompress streaming response: %v, storing compressed\n", err)
		} else {
			storedBody = string(decompressedBody)
		}
	}

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
		Body:       storedBody,
		DurationMs: duration,
	}

	responseID, err := ph.db.StoreResponse(respInput)
	if err != nil {
		fmt.Printf("Warning: failed to log streaming response: %v\n", err)
	} else {
		// Emit response created event asynchronously
		go func() {
			storedResp, err := ph.db.GetResponse(responseID)
			if err == nil && storedResp != nil {
				ph.apiHandler.BroadcastResponseCreated(storedResp)
			}
		}()
	}
}
