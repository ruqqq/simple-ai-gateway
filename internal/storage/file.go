package storage

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
)

type FileStorage struct {
	basePath string
}

// New creates a new file storage with the given base path
func New(basePath string) (*FileStorage, error) {
	// Create base directory if it doesn't exist
	if err := os.MkdirAll(basePath, 0755); err != nil {
		return nil, fmt.Errorf("failed to create storage directory: %w", err)
	}

	return &FileStorage{basePath: basePath}, nil
}

// SaveFile saves a file and returns the relative path
func (fs *FileStorage) SaveFile(provider string, contentType string, data io.Reader) (string, int64, error) {
	// Create provider-specific directory structure
	now := time.Now()
	dateDir := now.Format("2006-01-02")

	providerPath := filepath.Join(fs.basePath, provider, dateDir)
	if err := os.MkdirAll(providerPath, 0755); err != nil {
		return "", 0, fmt.Errorf("failed to create storage subdirectory: %w", err)
	}

	// Generate unique filename
	ext := getExtensionFromContentType(contentType)
	filename := uuid.New().String() + ext
	filePath := filepath.Join(providerPath, filename)

	// Create the file
	file, err := os.Create(filePath)
	if err != nil {
		return "", 0, fmt.Errorf("failed to create file: %w", err)
	}
	defer file.Close()

	// Copy data to file
	size, err := io.Copy(file, data)
	if err != nil {
		os.Remove(filePath)
		return "", 0, fmt.Errorf("failed to write file: %w", err)
	}

	// Return relative path
	relPath, err := filepath.Rel(fs.basePath, filePath)
	if err != nil {
		relPath = filePath
	}

	return relPath, size, nil
}

// GetFullPath returns the full filesystem path for a stored file
func (fs *FileStorage) GetFullPath(relativePath string) string {
	return filepath.Join(fs.basePath, relativePath)
}

// DeleteFile deletes a stored file
func (fs *FileStorage) DeleteFile(relativePath string) error {
	fullPath := fs.GetFullPath(relativePath)
	if err := os.Remove(fullPath); err != nil {
		return fmt.Errorf("failed to delete file: %w", err)
	}
	return nil
}

// getExtensionFromContentType returns file extension based on content type
func getExtensionFromContentType(contentType string) string {
	// Remove parameters from content type (e.g., "image/png; charset=utf-8" -> "image/png")
	contentType = strings.Split(contentType, ";")[0]
	contentType = strings.TrimSpace(contentType)

	// Map common content types to extensions
	extensionMap := map[string]string{
		"image/png":       ".png",
		"image/jpeg":      ".jpg",
		"image/jpg":       ".jpg",
		"image/gif":       ".gif",
		"image/webp":      ".webp",
		"image/svg+xml":   ".svg",
		"application/pdf": ".pdf",
		"audio/mpeg":      ".mp3",
		"audio/wav":       ".wav",
		"video/mp4":       ".mp4",
		"video/mpeg":      ".mpeg",
		"text/plain":      ".txt",
		"application/json":".json",
	}

	if ext, exists := extensionMap[contentType]; exists {
		return ext
	}

	// Fallback: try to extract from content type
	parts := strings.Split(contentType, "/")
	if len(parts) == 2 {
		return "." + parts[1]
	}

	// Default to binary
	return ".bin"
}
