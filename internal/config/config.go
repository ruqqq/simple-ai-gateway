package config

import (
	"fmt"
	"os"
	"strconv"

	"github.com/joho/godotenv"
)

type Config struct {
	Port            int
	DBPath          string
	FileStoragePath string
}

var (
	defaultPort            = 8080
	defaultDBPath          = "./data/gateway.db"
	defaultFileStoragePath = "./data/files"
)

// Load reads configuration from .env file and environment variables with defaults
func Load() (*Config, error) {
	// Load .env file if it exists (ignore error if not found)
	_ = godotenv.Load()

	cfg := &Config{
		Port:            getEnvInt("PORT", defaultPort),
		DBPath:          getEnv("DB_PATH", defaultDBPath),
		FileStoragePath: getEnv("FILE_STORAGE_PATH", defaultFileStoragePath),
	}

	return cfg, nil
}

func getEnv(key, defaultVal string) string {
	if val, exists := os.LookupEnv(key); exists {
		return val
	}
	return defaultVal
}

func getEnvInt(key string, defaultVal int) int {
	if val, exists := os.LookupEnv(key); exists {
		if intVal, err := strconv.Atoi(val); err == nil {
			return intVal
		}
		fmt.Fprintf(os.Stderr, "Warning: invalid integer value for %s\n", key)
	}
	return defaultVal
}
