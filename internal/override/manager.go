package override

import (
	"sync"
	"time"
)

type ApprovalDecision string

const (
	ApprovalApproved         ApprovalDecision = "approved"
	ApprovalError400         ApprovalDecision = "error_400"
	ApprovalError500         ApprovalDecision = "error_500"
	ApprovalContentSensitive ApprovalDecision = "content_sensitive"
	ApprovalTimeout          ApprovalDecision = "timeout"
)

type PendingRequest struct {
	RequestID string
	Decision  chan ApprovalDecision
}

type Manager struct {
	mu               sync.RWMutex
	enabled          bool
	pendingRequests  map[string]*PendingRequest
}

var instance *Manager
var once sync.Once

// GetManager returns the singleton instance of the override manager
func GetManager() *Manager {
	once.Do(func() {
		instance = &Manager{
			pendingRequests: make(map[string]*PendingRequest),
		}
	})
	return instance
}

// Enable turns on override mode
func (m *Manager) Enable() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.enabled = true
}

// Disable turns off override mode
func (m *Manager) Disable() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.enabled = false
}

// IsEnabled returns whether override mode is currently enabled
func (m *Manager) IsEnabled() bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.enabled
}

// WaitForApproval blocks until a decision is made for the request or timeout occurs
// Returns the decision (approved, error_400, error_500, or timeout)
func (m *Manager) WaitForApproval(requestID string, timeout time.Duration) ApprovalDecision {
	m.mu.Lock()

	// Create pending request with decision channel
	pending := &PendingRequest{
		RequestID: requestID,
		Decision:  make(chan ApprovalDecision, 1), // Buffered to prevent goroutine leak
	}
	m.pendingRequests[requestID] = pending

	m.mu.Unlock()

	// Wait for decision or timeout
	select {
	case decision := <-pending.Decision:
		m.mu.Lock()
		delete(m.pendingRequests, requestID)
		m.mu.Unlock()
		return decision
	case <-time.After(timeout):
		m.mu.Lock()
		delete(m.pendingRequests, requestID)
		m.mu.Unlock()
		return ApprovalTimeout
	}
}

// Approve approves a pending request
func (m *Manager) Approve(requestID string) bool {
	m.mu.RLock()
	pending, exists := m.pendingRequests[requestID]
	m.mu.RUnlock()

	if !exists {
		return false
	}

	select {
	case pending.Decision <- ApprovalApproved:
		return true
	default:
		return false
	}
}

// Override sends an override decision (error_400, error_500, or content_sensitive) for a pending request
func (m *Manager) Override(requestID string, action ApprovalDecision) bool {
	if action != ApprovalError400 && action != ApprovalError500 && action != ApprovalContentSensitive {
		return false
	}

	m.mu.RLock()
	pending, exists := m.pendingRequests[requestID]
	m.mu.RUnlock()

	if !exists {
		return false
	}

	select {
	case pending.Decision <- action:
		return true
	default:
		return false
	}
}

// GetPendingCount returns the number of pending approval requests
func (m *Manager) GetPendingCount() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return len(m.pendingRequests)
}

// GetPendingRequests returns a list of pending request IDs
func (m *Manager) GetPendingRequests() []string {
	m.mu.RLock()
	defer m.mu.RUnlock()

	requests := make([]string, 0, len(m.pendingRequests))
	for id := range m.pendingRequests {
		requests = append(requests, id)
	}
	return requests
}
