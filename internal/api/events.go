package api

import (
	"encoding/json"
	"fmt"
	"sync"
)

// SSEClient represents a connected SSE client
type SSEClient struct {
	id   string
	send chan *EventMessage
	done chan struct{}
}

// SSEBroadcaster manages SSE connections and broadcasts events
type SSEBroadcaster struct {
	mu           sync.RWMutex
	clients      map[string]*SSEClient
	subscribe    chan *SSEClient
	unsubscribe  chan *SSEClient
	broadcast    chan *EventMessage
	quit         chan struct{}
}

// NewSSEBroadcaster creates a new SSE broadcaster
func NewSSEBroadcaster() *SSEBroadcaster {
	b := &SSEBroadcaster{
		clients:     make(map[string]*SSEClient),
		subscribe:   make(chan *SSEClient),
		unsubscribe: make(chan *SSEClient),
		broadcast:   make(chan *EventMessage, 100),
		quit:        make(chan struct{}),
	}

	// Start the broadcaster goroutine
	go b.run()

	return b
}

// run processes subscribe/unsubscribe/broadcast operations
func (b *SSEBroadcaster) run() {
	for {
		select {
		case client := <-b.subscribe:
			b.mu.Lock()
			b.clients[client.id] = client
			b.mu.Unlock()

		case client := <-b.unsubscribe:
			b.mu.Lock()
			if _, exists := b.clients[client.id]; exists {
				delete(b.clients, client.id)
				close(client.send)
			}
			b.mu.Unlock()

		case event := <-b.broadcast:
			b.mu.RLock()
			for _, client := range b.clients {
				select {
				case client.send <- event:
				default:
					// Non-blocking send - skip client if channel is full
				}
			}
			b.mu.RUnlock()

		case <-b.quit:
			return
		}
	}
}

// Subscribe creates a new SSE client and subscribes to events
func (b *SSEBroadcaster) Subscribe(clientID string) *SSEClient {
	client := &SSEClient{
		id:   clientID,
		send: make(chan *EventMessage, 10),
		done: make(chan struct{}),
	}

	b.subscribe <- client
	return client
}

// Unsubscribe removes a client from the broadcaster
func (b *SSEBroadcaster) Unsubscribe(client *SSEClient) {
	b.unsubscribe <- client
}

// BroadcastEvent sends an event to all connected clients
func (b *SSEBroadcaster) BroadcastEvent(event *EventMessage) {
	select {
	case b.broadcast <- event:
	case <-b.quit:
	}
}

// Send sends an event to a specific client
func (client *SSEClient) Send(event *EventMessage) error {
	select {
	case client.send <- event:
		return nil
	case <-client.done:
		return fmt.Errorf("client closed")
	}
}

// Receive receives an event from the client channel
func (client *SSEClient) Receive() (*EventMessage, error) {
	select {
	case event, ok := <-client.send:
		if !ok {
			return nil, fmt.Errorf("channel closed")
		}
		return event, nil
	case <-client.done:
		return nil, fmt.Errorf("client closed")
	}
}

// FormatSSEMessage formats an event as SSE message
func FormatSSEMessage(event *EventMessage) (string, error) {
	data, err := json.Marshal(event)
	if err != nil {
		return "", err
	}

	return fmt.Sprintf("event: %s\ndata: %s\n\n", event.Type, string(data)), nil
}

// Close closes the broadcaster
func (b *SSEBroadcaster) Close() {
	close(b.quit)
}
