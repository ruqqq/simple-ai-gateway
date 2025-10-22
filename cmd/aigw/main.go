package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/ruqqq/simple-ai-gateway/internal/api"
	"github.com/ruqqq/simple-ai-gateway/internal/config"
	"github.com/ruqqq/simple-ai-gateway/internal/database"
	"github.com/ruqqq/simple-ai-gateway/internal/provider"
	"github.com/ruqqq/simple-ai-gateway/internal/proxy"
	"github.com/ruqqq/simple-ai-gateway/internal/storage"
	"github.com/ruqqq/simple-ai-gateway/internal/ui"
)

func main() {
	// Load configuration
	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to load configuration: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("Starting Simple AI Gateway\n")
	fmt.Printf("  Port: %d\n", cfg.Port)
	fmt.Printf("  Database: %s\n", cfg.DBPath)
	fmt.Printf("  File Storage: %s\n", cfg.FileStoragePath)

	// Initialize database
	db, err := database.New(cfg.DBPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to initialize database: %v\n", err)
		os.Exit(1)
	}
	defer db.Close()

	// Initialize file storage
	fs, err := storage.New(cfg.FileStoragePath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to initialize file storage: %v\n", err)
		os.Exit(1)
	}

	// Initialize providers
	providers := []provider.Provider{
		provider.NewOpenAIProvider(),
		provider.NewReplicateProvider(),
	}

	// Initialize SSE broadcaster
	broadcaster := api.NewSSEBroadcaster()
	// Note: broadcaster.Close() is called explicitly during shutdown, not deferred

	// Create API handler
	apiHandler := api.NewHandler(db, fs, broadcaster)

	// Create shutdown context for graceful termination
	shutdownCtx, shutdownCancel := context.WithCancel(context.Background())
	defer shutdownCancel()

	// Create proxy handler with shutdown context
	proxyHandler := proxy.New(db, fs, providers, broadcaster, apiHandler)
	proxyHandler.SetShutdownContext(shutdownCtx)

	// Create router
	r := chi.NewRouter()

	// Add middleware
	r.Use(loggingMiddleware)

	// API routes
	r.Route("/api", func(r chi.Router) {
		r.Get("/requests", apiHandler.ListRequests)
		r.Get("/requests/{id}", apiHandler.GetRequest)
		r.Get("/files/*", apiHandler.GetFile)
		r.Get("/events", apiHandler.GetEvents)
		r.Get("/stats", apiHandler.GetStats)

		// Override mode routes
		r.Post("/override/toggle", apiHandler.ToggleOverride)
		r.Get("/override/status", apiHandler.GetOverrideStatus)
		r.Post("/requests/{id}/approve", apiHandler.ApproveRequest)
		r.Post("/requests/{id}/override", apiHandler.OverrideRequestAction)
	})

	// UI routes
	uiFS, err := ui.NewFileServer()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to load UI files: %v\n", err)
		os.Exit(1)
	}
	r.Handle("/ui/*", http.StripPrefix("/ui", uiFS))
	r.Get("/", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/ui/", http.StatusMovedPermanently)
	})

	// Health check endpoint
	r.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		fmt.Fprintf(w, `{"status":"ok"}`)
	})

	// Proxy all other requests
	r.HandleFunc("/*", proxyHandler.Handle)

	// Start server in a goroutine
	addr := fmt.Sprintf(":%d", cfg.Port)
	server := &http.Server{
		Addr:    addr,
		Handler: r,
	}

	go func() {
		fmt.Printf("Server listening on %s\n", addr)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			fmt.Fprintf(os.Stderr, "Server error: %v\n", err)
		}
	}()

	// Handle graceful shutdown
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	<-sigChan
	fmt.Println("\nShutting down server...")

	// 1. Close SSE broadcaster first (disconnect all SSE clients immediately)
	broadcaster.Close()

	// 2. Signal proxy handler to abort new provider requests and in-flight ones if timeout exceeded
	shutdownCancel()

	// 3. Wait ONLY for in-flight proxy requests (up to 10 seconds)
	shutdownTimeout := 10 * time.Second
	timeoutCtx, timeoutCancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer timeoutCancel()
	proxyHandler.WaitForInflightRequests(timeoutCtx)

	// 4. Force close the server (don't wait for other HTTP connections like keep-alive)
	if err := server.Close(); err != nil {
		fmt.Fprintf(os.Stderr, "Error closing server: %v\n", err)
	}

	fmt.Println("Server stopped")
}

// loggingMiddleware logs incoming requests
func loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Printf("[IN] %s %s\n", r.Method, r.RequestURI)
		next.ServeHTTP(w, r)
	})
}
