package main

import (
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/go-chi/chi/v5"
	"github.com/ruqqq/simple-ai-gateway/internal/config"
	"github.com/ruqqq/simple-ai-gateway/internal/database"
	"github.com/ruqqq/simple-ai-gateway/internal/provider"
	"github.com/ruqqq/simple-ai-gateway/internal/proxy"
	"github.com/ruqqq/simple-ai-gateway/internal/storage"
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

	// Create proxy handler
	proxyHandler := proxy.New(db, fs, providers)

	// Create router
	r := chi.NewRouter()

	// Add middleware
	r.Use(loggingMiddleware)

	// Proxy all requests
	r.HandleFunc("/*", proxyHandler.Handle)

	// Health check endpoint
	r.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		fmt.Fprintf(w, `{"status":"ok"}`)
	})

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

	if err := server.Close(); err != nil {
		fmt.Fprintf(os.Stderr, "Error during shutdown: %v\n", err)
	}

	fmt.Println("Server stopped")
}

// loggingMiddleware logs incoming requests
func loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Printf("%s %s %s\n", r.Method, r.RequestURI, r.RemoteAddr)
		next.ServeHTTP(w, r)
	})
}
