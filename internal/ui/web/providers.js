// Provider Adapter Pattern for UI Logic
// This module provides a clean separation of provider-specific logic

/**
 * Base Provider Adapter Interface
 * All provider adapters must implement these methods
 */
class ProviderAdapter {
    /**
     * Get the provider name (e.g., "openai", "replicate")
     * @returns {string}
     */
    getName() {
        throw new Error('getName() must be implemented');
    }

    /**
     * Get a display name for the provider (e.g., "OpenAI", "Replicate")
     * @returns {string}
     */
    getDisplayName() {
        throw new Error('getDisplayName() must be implemented');
    }

    /**
     * Extract media items from request/response data
     * @param {Object} data - Parsed JSON data
     * @param {string} source - 'request' or 'response'
     * @param {Array} mediaItems - Array to populate with media items
     */
    extractMedia(data, source, mediaItems) {
        throw new Error('extractMedia() must be implemented');
    }

    /**
     * Redact base64 data from specific fields in the JSON data
     * @param {Object} data - Parsed JSON data (will be modified in place)
     * @param {Object} mediaItem - Media item with field path and base64 data
     */
    redactMediaField(data, mediaItem) {
        throw new Error('redactMediaField() must be implemented');
    }
}

/**
 * OpenAI Provider Adapter
 * Handles OpenAI-specific data formats for media extraction and redaction
 */
class OpenAIAdapter extends ProviderAdapter {
    getName() {
        return 'openai';
    }

    getDisplayName() {
        return 'OpenAI';
    }

    extractMedia(data, source, mediaItems) {
        // Format 1: Chat Completions API - messages[].content[].image_url.url
        if (data.messages && Array.isArray(data.messages)) {
            data.messages.forEach((msg, msgIdx) => {
                if (msg.content && Array.isArray(msg.content)) {
                    msg.content.forEach((item, itemIdx) => {
                        if (item.type === 'image_url' && item.image_url?.url) {
                            const url = item.image_url.url;
                            const match = url.match(/^data:([^;]*);base64,(.+)$/);
                            if (match) {
                                addMediaItem(mediaItems, match[2], match[1],
                                    `messages[${msgIdx}].content[${itemIdx}].image_url.url`, source);
                            }
                        }
                    });
                }
            });
        }

        // Format 2: Responses API (request) - input[].content[].image_url where type='input_image'
        if (data.input && Array.isArray(data.input)) {
            data.input.forEach((msg, msgIdx) => {
                if (msg.content && Array.isArray(msg.content)) {
                    msg.content.forEach((item, itemIdx) => {
                        if (item.type === 'input_image' && item.image_url) {
                            const url = item.image_url;
                            const match = url.match(/^data:([^;]*);base64,(.+)$/);
                            if (match) {
                                addMediaItem(mediaItems, match[2], match[1],
                                    `input[${msgIdx}].content[${itemIdx}].image_url`, source);
                            } else if (url.match(/^https?:\/\/.+\.(png|jpg|jpeg|gif|webp)$/i)) {
                                // Check for image URL
                                const ext = url.split('.').pop().toLowerCase();
                                const mimeTypes = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
                                const mediaType = mimeTypes[ext] || 'image/png';
                                addMediaItem(mediaItems, url, mediaType,
                                    `input[${msgIdx}].content[${itemIdx}].image_url`, source, true);
                            }
                        }
                    });
                }
            });
        }

        // Format 3: Responses API (response) - output[].result where type='image_generation_call'
        if (data.output && Array.isArray(data.output)) {
            data.output.forEach((item, idx) => {
                if (item.type === 'image_generation_call' && item.result && typeof item.result === 'string') {
                    const result = item.result;
                    const match = result.match(/^data:([^;]*);base64,(.+)$/);
                    if (match) {
                        addMediaItem(mediaItems, match[2], match[1], `output[${idx}].result`, source);
                    } else if (result.startsWith('iVBOR') || result.startsWith('/9j/')) {
                        // Handle base64 without data URI prefix (common with OpenAI responses)
                        // iVBOR = PNG header, /9j/ = JPEG header
                        let mediaType = 'image/png';
                        if (result.startsWith('/9j/')) {
                            mediaType = 'image/jpeg';
                        }
                        addMediaItem(mediaItems, result, mediaType, `output[${idx}].result`, source);
                    }
                }
            });
        }
    }

    redactMediaField(data, mediaItem) {
        if (!mediaItem.dataUri) return;

        // Handle OpenAI Chat Completions format: messages[].content[].image_url.url
        if (mediaItem.field.startsWith('messages[')) {
            const match = mediaItem.field.match(/messages\[(\d+)\]\.content\[(\d+)\]\.image_url\.url/);
            if (match) {
                const msgIdx = parseInt(match[1]);
                const itemIdx = parseInt(match[2]);
                if (data.messages?.[msgIdx]?.content?.[itemIdx]?.image_url) {
                    data.messages[msgIdx].content[itemIdx].image_url.url =
                        `[BASE64_IMAGE_REDACTED - ${mediaItem.base64.length} bytes - See Preview tab]`;
                }
            }
        }

        // Handle OpenAI Responses API (request) format: input[].content[].image_url
        if (mediaItem.field.startsWith('input[') && mediaItem.field.includes('.content[') && mediaItem.field.includes('.image_url')) {
            const match = mediaItem.field.match(/input\[(\d+)\]\.content\[(\d+)\]\.image_url/);
            if (match) {
                const msgIdx = parseInt(match[1]);
                const itemIdx = parseInt(match[2]);
                if (Array.isArray(data.input) && data.input[msgIdx]?.content?.[itemIdx]?.image_url) {
                    data.input[msgIdx].content[itemIdx].image_url =
                        `[BASE64_IMAGE_REDACTED - ${mediaItem.base64.length} bytes - See Preview tab]`;
                }
            }
        }

        // Handle OpenAI Responses API (response) format: output[].result
        if (mediaItem.field.startsWith('output[') && mediaItem.field.includes('.result')) {
            const match = mediaItem.field.match(/output\[(\d+)\]\.result/);
            if (match) {
                const idx = parseInt(match[1]);
                if (Array.isArray(data.output) && data.output[idx] && data.output[idx].result) {
                    data.output[idx].result =
                        `[BASE64_IMAGE_REDACTED - ${mediaItem.base64.length} bytes - See Preview tab]`;
                }
            }
        }
    }
}

/**
 * Replicate Provider Adapter
 * Handles Replicate-specific data formats for media extraction and redaction
 */
class ReplicateAdapter extends ProviderAdapter {
    getName() {
        return 'replicate';
    }

    getDisplayName() {
        return 'Replicate';
    }

    extractMedia(data, source, mediaItems) {
        // Input images - Replicate uses different field names (input.image or input.input_image)
        const inputFields = ['image', 'input_image'];
        inputFields.forEach(fieldName => {
            const inputImage = data.input?.[fieldName];
            if (inputImage && typeof inputImage === 'string') {
                // Check for data URI
                const dataMatch = inputImage.match(/^data:([^;]*);base64,(.+)$/);
                if (dataMatch) {
                    addMediaItem(mediaItems, dataMatch[2], dataMatch[1], `input.${fieldName}`, source);
                } else if (inputImage.match(/^https?:\/\/.+\.(png|jpg|jpeg|gif|webp)$/i)) {
                    // Check for image URL
                    const ext = inputImage.split('.').pop().toLowerCase();
                    const mimeTypes = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
                    const mediaType = mimeTypes[ext] || 'image/png';
                    addMediaItem(mediaItems, inputImage, mediaType, `input.${fieldName}`, source, true);
                }
            }
        });

        // Handle input_images array (plural)
        if (Array.isArray(data.input?.input_images)) {
            data.input.input_images.forEach((inputImage, idx) => {
                if (inputImage && typeof inputImage === 'string') {
                    // Check for data URI
                    const dataMatch = inputImage.match(/^data:([^;]*);base64,(.+)$/);
                    if (dataMatch) {
                        addMediaItem(mediaItems, dataMatch[2], dataMatch[1], `input.input_images[${idx}]`, source);
                    } else if (inputImage.match(/^https?:\/\/.+\.(png|jpg|jpeg|gif|webp)$/i)) {
                        // Check for image URL
                        const ext = inputImage.split('.').pop().toLowerCase();
                        const mimeTypes = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
                        const mediaType = mimeTypes[ext] || 'image/png';
                        addMediaItem(mediaItems, inputImage, mediaType, `input.input_images[${idx}]`, source, true);
                    }
                }
            });
        }

        // Output (can be string or array)
        if (data.output) {
            const outputs = Array.isArray(data.output) ? data.output : [data.output];
            outputs.forEach((output, idx) => {
                if (typeof output === 'string') {
                    const field = Array.isArray(data.output) ? `output[${idx}]` : 'output';

                    // Check for data URI
                    const dataMatch = output.match(/^data:([^;]*);base64,(.+)$/);
                    if (dataMatch) {
                        addMediaItem(mediaItems, dataMatch[2], dataMatch[1], field, source);
                    } else if (output.match(/^https?:\/\/.+\.(png|jpg|jpeg|gif|webp)$/i)) {
                        // Check for image URL
                        const ext = output.split('.').pop().toLowerCase();
                        const mimeTypes = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
                        const mediaType = mimeTypes[ext] || 'image/png';
                        addMediaItem(mediaItems, output, mediaType, field, source, true);
                    }
                }
            });
        }
    }

    redactMediaField(data, mediaItem) {
        if (!mediaItem.dataUri) return;

        // Handle Replicate format: input.image or input.input_image
        if (mediaItem.field === 'input.image' && data.input?.image) {
            data.input.image = `[BASE64_IMAGE_REDACTED - ${mediaItem.base64.length} bytes - See Preview tab]`;
        }
        if (mediaItem.field === 'input.input_image' && data.input?.input_image) {
            data.input.input_image = `[BASE64_IMAGE_REDACTED - ${mediaItem.base64.length} bytes - See Preview tab]`;
        }
        if (mediaItem.field.startsWith('input.input_images[') && Array.isArray(data.input?.input_images)) {
            const match = mediaItem.field.match(/input\.input_images\[(\d+)\]/);
            if (match) {
                const idx = parseInt(match[1]);
                data.input.input_images[idx] = `[BASE64_IMAGE_REDACTED - ${mediaItem.base64.length} bytes - See Preview tab]`;
            }
        }
        if (mediaItem.field === 'output' && data.output && typeof data.output === 'string') {
            data.output = `[BASE64_IMAGE_REDACTED - ${mediaItem.base64.length} bytes - See Preview tab]`;
        }
        if (mediaItem.field.startsWith('output[') && !mediaItem.field.includes('.result') && Array.isArray(data.output)) {
            const match = mediaItem.field.match(/output\[(\d+)\](?!\.)/);
            if (match) {
                const idx = parseInt(match[1]);
                data.output[idx] = `[BASE64_IMAGE_REDACTED - ${mediaItem.base64.length} bytes - See Preview tab]`;
            }
        }
    }
}

/**
 * Provider Registry
 * Manages all registered provider adapters
 */
class ProviderRegistry {
    constructor() {
        this.adapters = new Map();
        this.defaultAdapter = null;
    }

    /**
     * Register a provider adapter
     * @param {ProviderAdapter} adapter
     */
    register(adapter) {
        this.adapters.set(adapter.getName(), adapter);
    }

    /**
     * Get adapter for a specific provider
     * @param {string} providerName
     * @returns {ProviderAdapter|null}
     */
    getAdapter(providerName) {
        return this.adapters.get(providerName) || this.defaultAdapter;
    }

    /**
     * Get all registered provider names
     * @returns {string[]}
     */
    getProviderNames() {
        return Array.from(this.adapters.keys());
    }

    /**
     * Get all registered adapters
     * @returns {ProviderAdapter[]}
     */
    getAllAdapters() {
        return Array.from(this.adapters.values());
    }

    /**
     * Set a default adapter for unknown providers
     * @param {ProviderAdapter} adapter
     */
    setDefaultAdapter(adapter) {
        this.defaultAdapter = adapter;
    }
}

// Global provider registry instance
const providerRegistry = new ProviderRegistry();

// Register built-in providers
providerRegistry.register(new OpenAIAdapter());
providerRegistry.register(new ReplicateAdapter());

// Helper functions (moved from app.js to keep them with the adapters)

function detectMediaTypeFromBase64(base64Data) {
    // Detect media type from base64 magic bytes/signatures
    try {
        const bytes = atob(base64Data.substring(0, 50));
        if (bytes.charCodeAt(0) === 0x89 && bytes.charCodeAt(1) === 0x50) {
            return 'image/png';
        } else if (bytes.charCodeAt(0) === 0xFF && bytes.charCodeAt(1) === 0xD8) {
            return 'image/jpeg';
        } else if (bytes.substring(0, 3) === 'GIF') {
            return 'image/gif';
        } else if (bytes.charCodeAt(0) === 0x52 && bytes.charCodeAt(1) === 0x49 && bytes.charCodeAt(2) === 0x46) {
            return 'image/webp';
        }
    } catch (e) {
        // Default if parsing fails
    }
    return 'image/png'; // Default fallback
}

function addMediaItem(mediaItems, data, mediaType, field, source, isUrl = false) {
    if (!data || data.length < 10) return;

    if (isUrl) {
        // For URLs, just store them as-is
        mediaItems.push({
            url: data,
            field: field,
            source: source,
            mediaType: mediaType,
            isUrl: true
        });
    } else {
        // For base64 data
        if (data.length < 50) return;

        // Verify media type or guess from header
        let detectedType = mediaType;
        if (!mediaType || mediaType.length === 0) {
            // Media type is empty, detect from base64 header
            detectedType = detectMediaTypeFromBase64(data);
        } else if (mediaType === 'image/png') {
            // If explicitly PNG, verify or detect
            try {
                const bytes = atob(data.substring(0, 50));
                if (bytes.charCodeAt(0) === 0x89 && bytes.charCodeAt(1) === 0x50) {
                    detectedType = 'image/png';
                } else if (bytes.charCodeAt(0) === 0xFF && bytes.charCodeAt(1) === 0xD8) {
                    detectedType = 'image/jpeg';
                } else if (bytes.substring(0, 3) === 'GIF') {
                    detectedType = 'image/gif';
                } else if (bytes.charCodeAt(0) === 0x52 && bytes.charCodeAt(1) === 0x49 && bytes.charCodeAt(2) === 0x46) {
                    detectedType = 'image/webp';
                }
            } catch (e) {
                // Default if parsing fails
            }
        }

        mediaItems.push({
            base64: data,
            field: field,
            source: source,
            mediaType: detectedType,
            dataUri: `data:${detectedType};base64,${data}`,
            isUrl: false
        });
    }
}
