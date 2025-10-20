package ui

import (
	"embed"
	"io/fs"
	"net/http"
)

// embedFS contains the embedded web files
//go:embed all:web
var embedFS embed.FS

// GetFileSystem returns the embedded file system
func GetFileSystem() (fs.FS, error) {
	return fs.Sub(embedFS, "web")
}

// NewFileServer creates a new HTTP file server for embedded UI files
func NewFileServer() (http.Handler, error) {
	fsys, err := GetFileSystem()
	if err != nil {
		return nil, err
	}

	return http.FileServer(http.FS(fsys)), nil
}
