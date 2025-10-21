// Global state
const app = {
    requests: [],
    selectedRequestId: null,
    eventSource: null,
    filters: {
        provider: '',
        pathPattern: '',
        dateFrom: null,
        dateTo: null,
    },
    isLoadingRequests: false,
    isLoadingDetails: false,
    // SSE reconnection tracking
    reconnectTimer: null,
    reconnectAttempts: 0,
    isReconnecting: false,
    maxReconnectAttempts: 10,
    baseReconnectDelay: 3000, // 3 seconds
};

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    initializeEventListeners();
    loadRequests();
    connectSSE();
});

// Initialize event listeners
function initializeEventListeners() {
    // Desktop filter buttons
    document.getElementById('apply-filters-btn').addEventListener('click', applyFilters);
    document.getElementById('clear-filters-btn').addEventListener('click', clearFilters);

    // Mobile filter toggle
    const mobileFilterToggle = document.getElementById('mobile-filter-toggle');
    if (mobileFilterToggle) {
        mobileFilterToggle.addEventListener('click', toggleMobileFilters);
    }

    // Mobile filter buttons
    const mobileApplyBtn = document.getElementById('mobile-apply-filters-btn');
    const mobileClearBtn = document.getElementById('mobile-clear-filters-btn');
    if (mobileApplyBtn) mobileApplyBtn.addEventListener('click', applyMobileFilters);
    if (mobileClearBtn) mobileClearBtn.addEventListener('click', clearMobileFilters);

    // Tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => switchTab(e.target.dataset.tab));
    });
}

// Load requests from API
async function loadRequests() {
    if (app.isLoadingRequests) return;
    app.isLoadingRequests = true;

    showRequestsLoading(true);

    try {
        const params = new URLSearchParams();
        if (app.filters.provider) params.append('provider', app.filters.provider);
        if (app.filters.pathPattern) params.append('path_pattern', app.filters.pathPattern);
        if (app.filters.dateFrom) params.append('date_from', Math.floor(app.filters.dateFrom.getTime() / 1000));
        if (app.filters.dateTo) params.append('date_to', Math.floor(app.filters.dateTo.getTime() / 1000));
        params.append('limit', '100');

        const response = await fetch(`/api/requests?${params}`);
        if (!response.ok) throw new Error('Failed to load requests');

        const data = await response.json();
        app.requests = data.requests || [];
        renderRequestsList();
    } catch (error) {
        console.error('Error loading requests:', error);
        showError('Failed to load requests');
    } finally {
        app.isLoadingRequests = false;
        showRequestsLoading(false);
    }
}

// Render requests list
function renderRequestsList() {
    const container = document.getElementById('requests-container');
    container.innerHTML = '';

    if (app.requests.length === 0) {
        container.innerHTML = '<div class="loading">No requests found</div>';
        return;
    }

    app.requests.forEach(request => {
        const item = createRequestElement(request);
        container.appendChild(item);
        item.addEventListener('click', () => selectRequest(request.id));
    });

    // Re-select current request if it exists
    if (app.selectedRequestId) {
        const selected = container.querySelector(`[data-id="${app.selectedRequestId}"]`);
        if (selected) {
            selected.classList.add('active');
        }
    }
}

// Create request element
function createRequestElement(request) {
    const template = document.getElementById('request-item-template');
    const clone = template.content.cloneNode(true);

    const item = clone.querySelector('.request-item');
    item.dataset.id = request.id;

    const provider = request.provider.toLowerCase();
    clone.querySelector('.provider-badge').textContent = provider;
    clone.querySelector('.provider-badge').className = `provider-badge ${provider}`;

    clone.querySelector('.method-badge').textContent = request.method;

    const statusBadge = clone.querySelector('.status-badge');
    if (request.status) {
        const statusClass = getStatusClass(request.status);
        statusBadge.textContent = request.status;
        statusBadge.className = `status-badge ${statusClass}`;
    } else if (request.is_error) {
        // If there's no status but is_error is true, it means the request was cancelled
        statusBadge.textContent = 'Cancelled';
        statusBadge.className = 'status-badge status-cancelled';
    } else {
        statusBadge.textContent = 'Pending';
        statusBadge.className = 'status-badge status-pending';
    }

    // Add error badge if this is an error response
    if (request.is_error) {
        const errorBadge = document.createElement('span');
        errorBadge.className = 'error-badge';
        errorBadge.textContent = '⚠ Error';
        errorBadge.title = request.error_message || 'Request failed';
        item.insertBefore(errorBadge, item.querySelector('.request-timestamp'));
    }

    const endpointEl = clone.querySelector('.request-endpoint');
    endpointEl.querySelector('span').textContent = request.endpoint;
    endpointEl.title = request.endpoint;
    clone.querySelector('.request-timestamp').textContent = formatTime(new Date(request.created_at));

    return item;
}

// Select request and show details
async function selectRequest(requestId) {
    app.selectedRequestId = requestId;

    // Update UI
    document.querySelectorAll('.request-item').forEach(item => item.classList.remove('active'));
    const selected = document.querySelector(`[data-id="${requestId}"]`);
    if (selected) selected.classList.add('active');

    // Load and display details
    await loadRequestDetails(requestId);

    // Scroll to details on mobile
    if (window.innerWidth < 768) {
        scrollToDetails();
    }
}

// Load request details
async function loadRequestDetails(requestId) {
    if (app.isLoadingDetails) return;
    app.isLoadingDetails = true;

    showDetailsLoading(true);

    try {
        const response = await fetch(`/api/requests/${requestId}`);
        if (!response.ok) throw new Error('Failed to load request details');

        const detail = await response.json();
        renderRequestDetails(detail);
    } catch (error) {
        console.error('Error loading request details:', error);
        showError('Failed to load request details');
    } finally {
        app.isLoadingDetails = false;
        showDetailsLoading(false);
    }
}

// Attach copy button listeners
function attachCopyButtonListeners(container, detail) {
    const copyButtons = container.querySelectorAll('.copy-btn');

    copyButtons.forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();

            const targetId = btn.dataset.copyTarget;
            const format = btn.dataset.copyFormat;
            const targetElement = container.querySelector(`#${targetId}`);

            if (!targetElement) return;

            let textToCopy = '';

            // Handle different target types
            if (targetId === 'detail-endpoint') {
                // Copy endpoint text
                textToCopy = targetElement.textContent || '';
            } else if (targetId === 'detail-request-headers' || targetId === 'detail-response-headers') {
                // Copy headers (already formatted JSON)
                const codeElement = targetElement.querySelector('code');
                textToCopy = codeElement ? codeElement.textContent : '';
            } else if (targetId === 'detail-request-body' || targetId === 'detail-response-body') {
                // Handle body copying - raw vs redacted
                if (format === 'raw') {
                    // Use the raw body data stored in the element
                    textToCopy = targetElement.dataset.rawBody || '';
                } else if (format === 'redacted') {
                    // Use the displayed (redacted) version
                    const codeElement = targetElement.querySelector('code');
                    textToCopy = codeElement ? codeElement.textContent : '';
                }
            }

            if (textToCopy) {
                await copyToClipboard(textToCopy, btn);
            }
        });
    });
}

// Render request details
function renderRequestDetails(detail) {
    const container = document.getElementById('details-container');
    const template = document.getElementById('details-template');
    const clone = template.content.cloneNode(true);

    // Find media items from request/response bodies
    const mediaItems = findBase64Media(detail);

    // Request tab
    clone.getElementById('detail-provider').textContent = detail.request.provider;
    clone.getElementById('detail-endpoint').textContent = detail.request.endpoint;
    clone.getElementById('detail-method').textContent = detail.request.method;
    clone.getElementById('detail-created-at').textContent = formatTime(new Date(detail.request.created_at));

    const requestBody = detail.request.body || '';
    const requestMediaItems = mediaItems.filter(m => m.source === 'request');
    const displayRequestBody = requestMediaItems.length > 0
        ? redactBase64FromJSON(requestBody, requestMediaItems, detail.request.provider)
        : formatJSON(requestBody);
    const requestBodyEl = clone.getElementById('detail-request-body');
    requestBodyEl.querySelector('code').textContent = displayRequestBody || '(empty)';
    // Store raw body for copy functionality
    requestBodyEl.dataset.rawBody = requestBody || '';

    // Response tab
    if (detail.response) {
        clone.getElementById('detail-status-code').textContent = `${detail.response.status_code} ${getStatusText(detail.response.status_code)}`;
        clone.getElementById('detail-duration').textContent = `${detail.response.duration_ms}ms`;

        // Show error information if this is an error response
        if (detail.response.is_error) {
            const errorMessageEl = clone.querySelector('.response-error-message');
            if (errorMessageEl) {
                errorMessageEl.innerHTML = `<strong>Error:</strong> ${escapeHtml(detail.response.error_message || 'Unknown error')}`;
                errorMessageEl.style.display = 'block';
            }
        }

        const responseBody = detail.response.body || '';
        const responseMediaItems = mediaItems.filter(m => m.source === 'response');
        const displayResponseBody = responseMediaItems.length > 0
            ? redactBase64FromJSON(responseBody, responseMediaItems, detail.request.provider)
            : formatJSON(responseBody);
        const responseBodyEl = clone.getElementById('detail-response-body');
        responseBodyEl.querySelector('code').textContent = displayResponseBody || '(empty)';
        // Store raw body for copy functionality
        responseBodyEl.dataset.rawBody = responseBody || '';

        // Check if response is an image
        if (isImageResponse(detail.response)) {
            const bodyContainer = clone.getElementById('detail-response-body-container');
            bodyContainer.innerHTML = '';
            const img = document.createElement('img');
            img.src = `/api/files/${getBinaryFilePath(detail.binary_files)}`;
            img.alt = 'Response image';
            bodyContainer.appendChild(img);
        }
    } else {
        clone.getElementById('detail-status-code').textContent = 'Pending';
        clone.getElementById('detail-duration').textContent = '-';
        clone.getElementById('detail-response-body').querySelector('code').textContent = '(waiting for response)';
    }

    // Headers tab
    clone.getElementById('detail-request-headers').querySelector('code').textContent =
        JSON.stringify(detail.request.headers || {}, null, 2);

    if (detail.response) {
        clone.getElementById('detail-response-headers').querySelector('code').textContent =
            JSON.stringify(detail.response.headers || {}, null, 2);
    } else {
        clone.getElementById('detail-response-headers').querySelector('code').textContent = '(no response)';
    }

    // Files tab
    const filesContainer = clone.getElementById('detail-files-container');
    if (detail.binary_files && detail.binary_files.length > 0) {
        filesContainer.innerHTML = '';
        detail.binary_files.forEach(file => {
            const fileEl = createFileElement(file);
            filesContainer.appendChild(fileEl);
        });
    }

    // Preview tab
    const previewContainer = clone.getElementById('detail-preview-container');
    if (mediaItems.length > 0) {
        previewContainer.innerHTML = '';
        renderMediaPreview(previewContainer, mediaItems);
    }

    // Hide empty tabs
    // Hide Preview tab if no media items
    if (mediaItems.length === 0) {
        const previewBtn = clone.querySelector('.tab-btn[data-tab="preview"]');
        const previewPane = clone.querySelector('.tab-pane[data-tab="preview"]');
        if (previewBtn) previewBtn.style.display = 'none';
        if (previewPane) previewPane.style.display = 'none';
    }

    // Hide Binary Files tab if no files
    if (!detail.binary_files || detail.binary_files.length === 0) {
        const filesBtn = clone.querySelector('.tab-btn[data-tab="files"]');
        const filesPane = clone.querySelector('.tab-pane[data-tab="files"]');
        if (filesBtn) filesBtn.style.display = 'none';
        if (filesPane) filesPane.style.display = 'none';
    }

    // Replace content
    container.innerHTML = '';
    container.appendChild(clone);

    // Re-attach tab listeners
    container.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => switchTab(e.target.dataset.tab, container));
    });

    // Attach copy button listeners
    attachCopyButtonListeners(container, detail);
}

// Create file element
function createFileElement(file) {
    const template = document.getElementById('file-item-template');
    const clone = template.content.cloneNode(true);

    // Make file path a clickable link
    const fileNameEl = clone.querySelector('.file-name');
    const link = document.createElement('a');
    link.href = `/api/files/${file.file_path}`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = file.file_path;
    link.style.color = 'var(--color-primary)';
    link.style.textDecoration = 'underline';
    link.style.cursor = 'pointer';
    fileNameEl.replaceChildren(link);

    clone.querySelector('.file-type').textContent = file.content_type;
    clone.querySelector('.file-size').textContent = `${formatSize(file.size)}`;

    // Hide preview section - just show file info
    const preview = clone.querySelector('.file-preview');
    if (preview) {
        preview.style.display = 'none';
    }

    return clone;
}

// Switch tabs (scoped to container)
function switchTab(tabName, container = document) {
    // Hide all tabs within the container
    container.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));
    container.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));

    // Show selected tab within the container (be specific to avoid selecting buttons)
    const pane = container.querySelector(`.tab-pane[data-tab="${tabName}"]`);
    const btn = container.querySelector(`.tab-btn[data-tab="${tabName}"]`);
    if (pane) pane.classList.add('active');
    if (btn) btn.classList.add('active');
}

// Apply filters
function applyFilters() {
    const btn = document.getElementById('apply-filters-btn');
    btn.classList.add('btn-loading');
    btn.innerHTML = '<span class="spinner"></span>Applying...';

    app.filters.provider = document.getElementById('provider-filter').value;
    app.filters.pathPattern = document.getElementById('path-filter').value;

    const dateFromStr = document.getElementById('date-from-filter').value;
    const dateToStr = document.getElementById('date-to-filter').value;

    app.filters.dateFrom = dateFromStr ? new Date(dateFromStr) : null;
    app.filters.dateTo = dateToStr ? new Date(dateToStr) : null;

    loadRequests().finally(() => {
        btn.classList.remove('btn-loading');
        btn.innerHTML = 'Apply Filters';
    });
}

// Clear filters
function clearFilters() {
    app.filters = {
        provider: '',
        pathPattern: '',
        dateFrom: null,
        dateTo: null,
    };

    document.getElementById('provider-filter').value = '';
    document.getElementById('path-filter').value = '';
    document.getElementById('date-from-filter').value = '';
    document.getElementById('date-to-filter').value = '';

    loadRequests();
}

// Mobile Filters Functions
function toggleMobileFilters() {
    const mobileFilters = document.getElementById('mobile-filters');
    mobileFilters.classList.toggle('expanded');
}

function applyMobileFilters() {
    app.filters.provider = document.getElementById('mobile-provider-filter').value;
    app.filters.pathPattern = document.getElementById('mobile-path-filter').value;

    const dateFromStr = document.getElementById('mobile-date-from-filter').value;
    const dateToStr = document.getElementById('mobile-date-to-filter').value;

    app.filters.dateFrom = dateFromStr ? new Date(dateFromStr) : null;
    app.filters.dateTo = dateToStr ? new Date(dateToStr) : null;

    const btn = document.getElementById('mobile-apply-filters-btn');
    btn.classList.add('btn-loading');
    btn.innerHTML = '<span class="spinner"></span>Applying...';

    loadRequests().finally(() => {
        btn.classList.remove('btn-loading');
        btn.innerHTML = 'Apply';

        // Close filters and scroll to requests
        document.getElementById('mobile-filters').classList.remove('expanded');
        scrollToRequests();
    });
}

function clearMobileFilters() {
    app.filters = {
        provider: '',
        pathPattern: '',
        dateFrom: null,
        dateTo: null,
    };

    document.getElementById('mobile-provider-filter').value = '';
    document.getElementById('mobile-path-filter').value = '';
    document.getElementById('mobile-date-from-filter').value = '';
    document.getElementById('mobile-date-to-filter').value = '';

    loadRequests();
}

// Connect to SSE with proper reconnection logic
function connectSSE() {
    // Prevent concurrent reconnection attempts
    if (app.isReconnecting || app.eventSource) {
        return;
    }

    app.isReconnecting = true;

    try {
        app.eventSource = new EventSource('/api/events');

        // Reset reconnection attempts on successful connection
        app.eventSource.addEventListener('connected', () => {
            console.log('SSE connected successfully');
            app.reconnectAttempts = 0;
            app.isReconnecting = false;
            // Clear any pending reconnection timer
            if (app.reconnectTimer) {
                clearTimeout(app.reconnectTimer);
                app.reconnectTimer = null;
            }
            updateConnectionStatus(true);
        });

        app.eventSource.addEventListener('request_created', (event) => {
            const request = JSON.parse(event.data).request;
            addRequestToList(request);
        });

        app.eventSource.addEventListener('response_created', (event) => {
            const data = JSON.parse(event.data).data;
            updateRequestStatus(data.request_id, data.status_code, data.is_error || false, data.error_message || '');

            // Auto-reload details if this response is for the currently selected request
            if (data.request_id === app.selectedRequestId) {
                loadRequestDetails(data.request_id);
            }
        });

        app.eventSource.onerror = () => {
            console.warn('SSE error occurred, attempting to reconnect...');
            closeSSEConnection();
            scheduleReconnect();
        };

        updateConnectionStatus(true, false);
    } catch (error) {
        console.error('Error connecting to SSE:', error);
        app.isReconnecting = false;
        closeSSEConnection();
        scheduleReconnect();
    }
}

// Helper function to properly close SSE connection
function closeSSEConnection() {
    if (app.eventSource) {
        app.eventSource.close();
        app.eventSource = null;
    }
    updateConnectionStatus(false);
}

// Helper function to schedule reconnection with exponential backoff
function scheduleReconnect() {
    // Don't try to reconnect if we've exceeded max attempts
    if (app.reconnectAttempts >= app.maxReconnectAttempts) {
        console.error(`Max reconnection attempts (${app.maxReconnectAttempts}) reached. Please refresh the page or check the server status.`);
        updateConnectionStatus(false, true);
        return;
    }

    // Clear any existing pending reconnection timer
    if (app.reconnectTimer) {
        clearTimeout(app.reconnectTimer);
    }

    app.reconnectAttempts++;

    // Calculate exponential backoff: 3s, 6s, 12s, ..., capped at 30s
    const delay = Math.min(
        app.baseReconnectDelay * Math.pow(2, app.reconnectAttempts - 1),
        30000 // 30 second max
    );

    console.log(`Scheduling reconnection attempt ${app.reconnectAttempts}/${app.maxReconnectAttempts} in ${delay}ms`);
    updateConnectionStatus(false, false, app.reconnectAttempts);

    app.reconnectTimer = setTimeout(() => {
        app.isReconnecting = false;
        app.reconnectTimer = null;
        connectSSE();
    }, delay);
}

// Add request to list (real-time update)
function addRequestToList(request) {
    // Check if request already exists
    if (app.requests.some(r => r.id === request.id)) {
        return;
    }

    // Add to beginning of list
    app.requests.unshift(request);

    // Keep only last 200 requests in memory
    if (app.requests.length > 200) {
        app.requests = app.requests.slice(0, 200);
    }

    // Re-render list
    const container = document.getElementById('requests-container');
    const item = createRequestElement(request);
    container.insertBefore(item, container.firstChild);
    item.addEventListener('click', () => selectRequest(request.id));
}

// Update request status (real-time update)
function updateRequestStatus(requestId, statusCode, isError = false, errorMessage = '') {
    const request = app.requests.find(r => r.id === requestId);
    if (request) {
        request.status = statusCode;
        request.is_error = isError;
        request.error_message = errorMessage;

        // Update in list
        const item = document.querySelector(`[data-id="${requestId}"]`);
        if (item) {
            const statusBadge = item.querySelector('.status-badge');
            statusBadge.textContent = statusCode;
            statusBadge.className = `status-badge ${getStatusClass(statusCode)}`;

            // Add error badge if error
            if (isError) {
                let errorBadge = item.querySelector('.error-badge');
                if (!errorBadge) {
                    errorBadge = document.createElement('span');
                    errorBadge.className = 'error-badge';
                    errorBadge.textContent = '⚠ Error';
                    errorBadge.title = errorMessage || 'Request failed';
                    item.querySelector('.request-header').appendChild(errorBadge);
                }
            }
        }
    }
}

// Update connection status with reconnection info
function updateConnectionStatus(connected, maxRetriesExceeded = false, reconnectAttempt = 0) {
    const indicator = document.getElementById('status-indicator');
    const text = document.getElementById('status-text');

    if (connected) {
        indicator.classList.remove('status-disconnected');
        indicator.classList.add('status-connected');
        text.textContent = 'Connected';
    } else if (maxRetriesExceeded) {
        indicator.classList.remove('status-connected');
        indicator.classList.add('status-disconnected');
        text.textContent = 'Connection Failed - Max Retries Exceeded';
        text.title = 'Please refresh the page or check the server status';
    } else if (reconnectAttempt > 0) {
        indicator.classList.remove('status-connected');
        indicator.classList.add('status-disconnected');
        text.textContent = `Reconnecting... (Attempt ${reconnectAttempt}/${app.maxReconnectAttempts})`;
    } else {
        indicator.classList.remove('status-connected');
        indicator.classList.add('status-disconnected');
        text.textContent = 'Disconnected';
    }
}

// Copy to clipboard helper function
async function copyToClipboard(text, buttonElement) {
    try {
        await navigator.clipboard.writeText(text);

        // Visual feedback
        const originalContent = buttonElement.textContent;
        buttonElement.textContent = '✓';
        buttonElement.classList.add('copied');

        // Reset after 1.5 seconds
        setTimeout(() => {
            buttonElement.textContent = originalContent;
            buttonElement.classList.remove('copied');
        }, 1500);
    } catch (err) {
        console.error('Failed to copy to clipboard:', err);
    }
}

// Helper functions

function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
}

function getStatusClass(status) {
    if (status >= 200 && status < 300) return 'status-2xx';
    if (status >= 400 && status < 500) return 'status-4xx';
    if (status >= 500) return 'status-5xx';
    return '';
}

function getStatusText(status) {
    const statusTexts = {
        200: 'OK',
        201: 'Created',
        400: 'Bad Request',
        401: 'Unauthorized',
        403: 'Forbidden',
        404: 'Not Found',
        500: 'Internal Server Error',
        503: 'Service Unavailable',
    };
    return statusTexts[status] || 'Unknown';
}

function formatTime(date) {
    return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
}

function formatSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

function formatJSON(str) {
    if (!str) return '';
    try {
        const parsed = JSON.parse(str);
        return JSON.stringify(parsed, null, 2);
    } catch (e) {
        return str;
    }
}

function isImageResponse(response) {
    const contentType = (response.headers['content-type'] || '').toLowerCase();
    return contentType.startsWith('image/');
}

function isImageContentType(contentType) {
    return contentType.toLowerCase().startsWith('image/');
}

function getBinaryFilePath(files) {
    if (files && files.length > 0) {
        return files[0].file_path;
    }
    return '';
}

function showError(message) {
    // Simple error notification
    console.error(message);
    // Could be enhanced with toast notifications
}

// Scroll Helper Functions
function scrollToDetails() {
    const detailsSection = document.querySelector('.request-details');
    if (detailsSection) {
        setTimeout(() => {
            detailsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
    }
}

function scrollToRequests() {
    const requestsSection = document.querySelector('.requests-list');
    if (requestsSection) {
        setTimeout(() => {
            requestsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
    }
}

// Loading indicator helpers
function showRequestsLoading(show) {
    const container = document.getElementById('requests-container');
    if (!container) return;

    if (show) {
        // Show skeleton loaders
        const skeletons = Array(5).fill(0).map(() => {
            const div = document.createElement('div');
            div.className = 'skeleton-request-item';
            div.innerHTML = `
                <div class="skeleton-loader"></div>
                <div class="skeleton-loader"></div>
                <div class="skeleton-loader"></div>
            `;
            return div;
        });

        container.innerHTML = '';
        skeletons.forEach(skeleton => container.appendChild(skeleton));
    }
}

function showDetailsLoading(show) {
    const container = document.getElementById('details-container');
    if (!container) return;

    if (show) {
        container.classList.add('loading');
    } else {
        container.classList.remove('loading');
    }
}

// Base64 Media Detection - Provider-Aware (using adapter pattern)
function findBase64Media(detail) {
    const mediaItems = [];
    const providerName = detail.request?.provider || 'default';
    const adapter = providerRegistry.getAdapter(providerName);

    try {
        if (detail.request?.body && adapter) {
            const data = typeof detail.request.body === 'string'
                ? JSON.parse(detail.request.body)
                : detail.request.body;
            adapter.extractMedia(data, 'request', mediaItems);
        }
        if (detail.response?.body && adapter) {
            const data = typeof detail.response.body === 'string'
                ? JSON.parse(detail.response.body)
                : detail.response.body;
            adapter.extractMedia(data, 'response', mediaItems);
        }
    } catch (e) {
        console.error('Error detecting media:', e);
    }

    // Add locally stored binary files
    if (detail.binary_files && Array.isArray(detail.binary_files)) {
        detail.binary_files.forEach(file => {
            mediaItems.push({
                url: `/api/files/${file.file_path}`,
                field: `(Local file: ${file.file_path})`,
                source: 'response',  // Binary files are from response
                mediaType: file.content_type,
                isUrl: true,
                isLocalFile: true
            });
        });
    }

    return mediaItems;
}

function redactBase64FromJSON(jsonString, mediaItems, providerName) {
    if (!mediaItems || mediaItems.length === 0 || !jsonString) return jsonString;

    const adapter = providerRegistry.getAdapter(providerName);
    if (!adapter) return formatJSON(jsonString);

    try {
        const data = JSON.parse(jsonString);

        // Redact all media items using the provider adapter
        mediaItems.forEach(item => {
            adapter.redactMediaField(data, item);
        });

        return JSON.stringify(data, null, 2);
    } catch (e) {
        return jsonString;
    }
}

function renderMediaPreview(container, mediaItems) {
    // Group by source
    const bySource = {};
    mediaItems.forEach(item => {
        if (!bySource[item.source]) {
            bySource[item.source] = [];
        }
        bySource[item.source].push(item);
    });

    // Render each source group
    Object.entries(bySource).forEach(([source, items]) => {
        const section = document.createElement('div');
        section.className = 'preview-section';

        const label = document.createElement('div');
        label.className = 'preview-label';
        label.textContent = source === 'request' ? '📨 Request Media' : '📩 Response Media';
        section.appendChild(label);

        const itemsContainer = document.createElement('div');
        itemsContainer.className = 'preview-items';

        items.forEach(item => {
            const previewItem = document.createElement('div');
            previewItem.className = 'preview-item';

            const img = document.createElement('img');
            img.className = 'preview-item-image';
            img.src = item.isUrl ? item.url : item.dataUri;
            img.alt = item.field;
            previewItem.appendChild(img);

            const info = document.createElement('div');
            info.className = 'preview-item-info';

            const field = document.createElement('div');
            field.className = 'preview-item-field';
            field.textContent = item.field;
            info.appendChild(field);

            const type = document.createElement('div');
            type.style.marginTop = '0.25rem';
            type.style.fontSize = '0.7rem';
            type.style.color = 'var(--color-text-secondary)';
            type.textContent = item.mediaType;
            info.appendChild(type);

            previewItem.appendChild(info);
            itemsContainer.appendChild(previewItem);
        });

        section.appendChild(itemsContainer);
        container.appendChild(section);
    });
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    // Close SSE connection
    closeSSEConnection();

    // Clear any pending reconnection timer
    if (app.reconnectTimer) {
        clearTimeout(app.reconnectTimer);
        app.reconnectTimer = null;
    }
});
