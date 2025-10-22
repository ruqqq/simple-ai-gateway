package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/ruqqq/simple-ai-gateway/internal/database"
	"github.com/ruqqq/simple-ai-gateway/internal/override"
	"github.com/ruqqq/simple-ai-gateway/internal/storage"
)

// Handler handles API requests
type Handler struct {
	db          *database.DB
	fs          *storage.FileStorage
	broadcaster *SSEBroadcaster
}

// NewHandler creates a new API handler
func NewHandler(db *database.DB, fs *storage.FileStorage, broadcaster *SSEBroadcaster) *Handler {
	return &Handler{
		db:          db,
		fs:          fs,
		broadcaster: broadcaster,
	}
}

// ListRequests handles GET /api/requests
func (h *Handler) ListRequests(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()

	provider := query.Get("provider")
	pathPattern := query.Get("path_pattern")
	dateFromStr := query.Get("date_from")
	dateToStr := query.Get("date_to")
	limitStr := query.Get("limit")
	offsetStr := query.Get("offset")

	// Parse timestamps
	var dateFrom, dateTo time.Time
	if dateFromStr != "" {
		ts, err := strconv.ParseInt(dateFromStr, 10, 64)
		if err == nil {
			dateFrom = time.Unix(ts, 0)
		}
	}
	if dateToStr != "" {
		ts, err := strconv.ParseInt(dateToStr, 10, 64)
		if err == nil {
			dateTo = time.Unix(ts, 0)
		}
	}

	// Parse limit and offset
	limit := 50
	offset := 0
	if limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil && l > 0 && l <= 1000 {
			limit = l
		}
	}
	if offsetStr != "" {
		if o, err := strconv.Atoi(offsetStr); err == nil && o >= 0 {
			offset = o
		}
	}

	params := &database.ListRequestsParams{
		Provider:    provider,
		PathPattern: pathPattern,
		DateFrom:    dateFrom,
		DateTo:      dateTo,
		Limit:       limit,
		Offset:      offset,
	}

	requests, err := h.db.ListRequests(params)
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Convert to list items with response status
	items := make([]*RequestListItem, 0, len(requests))
	for _, req := range requests {
		item := &RequestListItem{
			ID:        req.ID,
			Provider:  req.Provider,
			Endpoint:  req.Endpoint,
			Method:    req.Method,
			CreatedAt: req.CreatedAt,
		}

		// Try to get response status code and error information
		resp, err := h.db.GetResponseByRequestID(req.ID)
		if err == nil && resp != nil {
			item.Status = resp.StatusCode
			item.IsError = resp.IsError
			if resp.ErrorMessage != nil && *resp.ErrorMessage != "" {
				item.ErrorMessage = *resp.ErrorMessage
			}
		}

		items = append(items, item)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"requests": items,
		"total":    len(items),
	})
}

// GetRequest handles GET /api/requests/:id
func (h *Handler) GetRequest(w http.ResponseWriter, r *http.Request) {
	requestID := r.PathValue("id")
	if requestID == "" {
		h.writeError(w, http.StatusBadRequest, "missing request id")
		return
	}

	// Get request
	req, err := h.db.GetRequest(requestID)
	if err != nil {
		h.writeError(w, http.StatusNotFound, "request not found")
		return
	}

	detail := &RequestDetail{
		Request: req,
	}

	// Get response (query by request_id from responses table)
	rows, err := h.db.GetResponseByRequestID(requestID)
	if err != nil {
		fmt.Printf("Warning: failed to get response for request %s: %v\n", requestID, err)
	}
	if err == nil && rows != nil {
		detail.Response = &ResponseDetail{
			ID:           rows.ID,
			StatusCode:   rows.StatusCode,
			Headers:      rows.Headers,
			Body:         rows.Body,
			DurationMs:   rows.DurationMs,
			IsError:      rows.IsError,
			ErrorMessage: rows.ErrorMessage,
			CreatedAt:    rows.CreatedAt,
		}
	}

	// Get binary files
	files, err := h.db.GetBinaryFilesByRequestID(requestID)
	if err == nil && len(files) > 0 {
		detail.BinaryFiles = make([]*BinaryFileDetail, 0, len(files))
		for _, f := range files {
			detail.BinaryFiles = append(detail.BinaryFiles, &BinaryFileDetail{
				ID:          f.ID,
				FilePath:    f.FilePath,
				ContentType: f.ContentType,
				Size:        f.Size,
			})
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(detail)
}

// GetFile handles GET /api/files/*
func (h *Handler) GetFile(w http.ResponseWriter, r *http.Request) {
	filePath := r.PathValue("*")
	if filePath == "" {
		h.writeError(w, http.StatusBadRequest, "missing file path")
		return
	}

	// Security: prevent path traversal
	if filepath.Clean(filePath) != filePath || len(filePath) > 0 && filePath[0] == '/' {
		h.writeError(w, http.StatusBadRequest, "invalid file path")
		return
	}

	fullPath := h.fs.GetFullPath(filePath)

	// Check file exists
	if _, err := os.Stat(fullPath); err != nil {
		h.writeError(w, http.StatusNotFound, "file not found")
		return
	}

	// Determine content type from file extension
	ext := filepath.Ext(filePath)
	contentType := getContentTypeFromExt(ext)
	if contentType != "" {
		w.Header().Set("Content-Type", contentType)
	}

	http.ServeFile(w, r, fullPath)
}

// GetEvents handles GET /api/events (SSE)
func (h *Handler) GetEvents(w http.ResponseWriter, r *http.Request) {
	// Set SSE headers
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	// Flush headers
	flusher, ok := w.(http.Flusher)
	if !ok {
		h.writeError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	// Create SSE client
	clientID := uuid.New().String()
	client := h.broadcaster.Subscribe(clientID)
	defer h.broadcaster.Unsubscribe(client)

	// Send initial connection message
	msg, _ := FormatSSEMessage(&EventMessage{
		Type: "connected",
	})
	fmt.Fprint(w, msg)
	flusher.Flush()

	// Stream events to client
	for {
		select {
		case event, ok := <-client.send:
			if !ok {
				return
			}
			msg, _ := FormatSSEMessage(event)
			fmt.Fprint(w, msg)
			flusher.Flush()

		case <-r.Context().Done():
			return
		}
	}
}

// GetStats handles GET /api/stats
func (h *Handler) GetStats(w http.ResponseWriter, r *http.Request) {
	// For now, return basic stats
	// This would require additional query methods for aggregation
	stats := &StatsResponse{
		RequestsByProvider: make(map[string]int),
		RequestsByStatus:   make(map[int]int),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(stats)
}

// BroadcastRequestCreated broadcasts a request created event
func (h *Handler) BroadcastRequestCreated(req *database.Request) {
	item := &RequestListItem{
		ID:        req.ID,
		Provider:  req.Provider,
		Endpoint:  req.Endpoint,
		Method:    req.Method,
		CreatedAt: req.CreatedAt,
	}

	event := &EventMessage{
		Type:    "request_created",
		Request: item,
	}

	h.broadcaster.BroadcastEvent(event)
}

// BroadcastResponseCreated broadcasts a response created event
func (h *Handler) BroadcastResponseCreated(resp *database.Response) {
	event := &EventMessage{
		Type: "response_created",
		Data: map[string]interface{}{
			"request_id":    resp.RequestID,
			"status_code":   resp.StatusCode,
			"duration_ms":   resp.DurationMs,
			"is_error":      resp.IsError,
			"error_message": resp.ErrorMessage,
		},
	}

	h.broadcaster.BroadcastEvent(event)
}

// BroadcastRequestPendingApproval broadcasts when a request is pending approval
func (h *Handler) BroadcastRequestPendingApproval(requestID, provider, endpoint string) {
	event := &EventMessage{
		Type: "request_pending_approval",
		Data: map[string]interface{}{
			"request_id": requestID,
			"provider":   provider,
			"endpoint":   endpoint,
		},
	}

	h.broadcaster.BroadcastEvent(event)
}

// Override Mode Handlers

// ToggleOverride handles POST /api/override/toggle
func (h *Handler) ToggleOverride(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		h.writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	mgr := override.GetManager()
	if mgr.IsEnabled() {
		mgr.Disable()
		fmt.Println("Override Mode: DISABLED")
	} else {
		mgr.Enable()
		fmt.Println("Override Mode: ENABLED - All incoming requests will require approval")
	}

	// Broadcast the mode change event
	event := &EventMessage{
		Type: "override_mode_changed",
		Data: map[string]interface{}{
			"enabled": mgr.IsEnabled(),
		},
	}
	h.broadcaster.BroadcastEvent(event)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"enabled": mgr.IsEnabled(),
	})
}

// GetOverrideStatus handles GET /api/override/status
func (h *Handler) GetOverrideStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		h.writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	mgr := override.GetManager()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"enabled":       mgr.IsEnabled(),
		"pending_count": mgr.GetPendingCount(),
	})
}

// ApproveRequest handles POST /api/requests/{id}/approve
func (h *Handler) ApproveRequest(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		h.writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	// Extract request ID from path: /api/requests/{id}/approve
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/requests/"), "/")
	if len(parts) < 2 {
		h.writeError(w, http.StatusBadRequest, "Invalid request ID")
		return
	}
	requestID := parts[0]

	mgr := override.GetManager()
	if !mgr.Approve(requestID) {
		h.writeError(w, http.StatusBadRequest, "Request not pending approval")
		return
	}

	fmt.Printf("Override Mode: Request %s approved\n", requestID)

	// Update DB to mark as approved
	if err := h.db.ApproveRequest(requestID); err != nil {
		fmt.Printf("Warning: failed to update request approval status: %v\n", err)
	}

	// Broadcast approval event
	event := &EventMessage{
		Type: "request_approved",
		Data: map[string]interface{}{
			"request_id": requestID,
		},
	}
	h.broadcaster.BroadcastEvent(event)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"request_id": requestID,
		"status":     "approved",
	})
}

// OverrideRequestAction handles POST /api/requests/{id}/override
func (h *Handler) OverrideRequestAction(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		h.writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	// Extract request ID from path: /api/requests/{id}/override
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/requests/"), "/")
	if len(parts) < 2 {
		h.writeError(w, http.StatusBadRequest, "Invalid request ID")
		return
	}
	requestID := parts[0]

	// Parse request body
	var req struct {
		Action string `json:"action"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	// Validate action
	var decision override.ApprovalDecision
	var dbAction string
	switch req.Action {
	case "error_400":
		decision = override.ApprovalError400
		dbAction = "error_400"
	case "error_500":
		decision = override.ApprovalError500
		dbAction = "error_500"
	case "content_sensitive":
		decision = override.ApprovalContentSensitive
		dbAction = "content_sensitive"
	default:
		h.writeError(w, http.StatusBadRequest, "Invalid action: must be error_400, error_500, or content_sensitive")
		return
	}

	mgr := override.GetManager()
	if !mgr.Override(requestID, decision) {
		h.writeError(w, http.StatusBadRequest, "Request not pending approval")
		return
	}

	fmt.Printf("Override Mode: Request %s overridden with %s\n", requestID, dbAction)

	// Update DB to mark as overridden
	if err := h.db.OverrideRequest(requestID, dbAction); err != nil {
		fmt.Printf("Warning: failed to update request override status: %v\n", err)
	}

	// Broadcast override event
	event := &EventMessage{
		Type: "request_overridden",
		Data: map[string]interface{}{
			"request_id": requestID,
			"action":     dbAction,
		},
	}
	h.broadcaster.BroadcastEvent(event)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"request_id": requestID,
		"action":     dbAction,
	})
}

// Helper functions

func (h *Handler) writeError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(&ErrorResponse{Error: message})
}

func getContentTypeFromExt(ext string) string {
	contentTypes := map[string]string{
		".png":  "image/png",
		".jpg":  "image/jpeg",
		".jpeg": "image/jpeg",
		".gif":  "image/gif",
		".webp": "image/webp",
		".svg":  "image/svg+xml",
		".pdf":  "application/pdf",
		".mp3":  "audio/mpeg",
		".wav":  "audio/wav",
		".mp4":  "video/mp4",
		".mpeg": "video/mpeg",
		".txt":  "text/plain",
		".json": "application/json",
	}

	if ct, exists := contentTypes[ext]; exists {
		return ct
	}

	return ""
}
