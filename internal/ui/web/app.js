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
    fetchOverrideStatus();  // Sync override mode state on page load
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

    // Override mode toggle
    const overrideModeInput = document.getElementById('override-mode-input');
    if (overrideModeInput) {
        overrideModeInput.addEventListener('change', handleOverrideModeToggle);
    }

    // Tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => switchTab(e.target.dataset.tab));
    });

    // Initialize approval action buttons (will be bound when details are loaded)
    // These will be set up in the selectRequest function
}

// Fetch and sync override mode status on page load
async function fetchOverrideStatus() {
    try {
        const response = await fetch('/api/override/status');
        if (response.ok) {
            const data = await response.json();
            updateOverrideModeUI(data.enabled);
        } else {
            console.warn('Failed to fetch override status');
        }
    } catch (error) {
        console.warn('Error fetching override status:', error);
        // Don't block page load if this fails - it's non-critical
    }
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
        ? redactBase64FromJSON(requestBody, requestMediaItems)
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
            ? redactBase64FromJSON(responseBody, responseMediaItems)
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

    // Handle approval banner (before appending to container)
    const approvalBanner = clone.getElementById('approval-banner');
    if (approvalBanner) {
        if (detail.request.approval_status === 'pending_approval') {
            approvalBanner.style.display = 'block';
        } else {
            approvalBanner.style.display = 'none';
        }
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

    // Setup approval action handlers (after appending to container)
    if (detail.request.approval_status === 'pending_approval') {
        setupApprovalActionHandlers(detail.request.id);
    }
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

        // Handle override mode changes
        app.eventSource.addEventListener('override_mode_changed', (event) => {
            const data = JSON.parse(event.data).data;
            updateOverrideModeUI(data.enabled);
        });

        // Handle request pending approval
        app.eventSource.addEventListener('request_pending_approval', (event) => {
            const data = JSON.parse(event.data).data;

            // Play notification beep
            playNotificationBeep();

            // Add visual indicator to request in list
            addPendingApprovalIndicator(data.request_id);

            // Reload the specific request to show pending status
            if (data.request_id === app.selectedRequestId) {
                loadRequestDetails(data.request_id);
            }
        });

        // Handle request approved
        app.eventSource.addEventListener('request_approved', (event) => {
            const data = JSON.parse(event.data).data;

            // Remove pending approval indicator
            removePendingApprovalIndicator(data.request_id);

            // Reload details if this is the selected request
            if (data.request_id === app.selectedRequestId) {
                loadRequestDetails(data.request_id);
            }
        });

        // Handle request overridden
        app.eventSource.addEventListener('request_overridden', (event) => {
            const data = JSON.parse(event.data).data;

            // Remove pending approval indicator
            removePendingApprovalIndicator(data.request_id);

            // Reload details if this is the selected request
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

// Base64 Media Detection - Provider-Aware
function findBase64Media(detail) {
    const mediaItems = [];
    const provider = detail.request?.provider || 'default';

    try {
        if (detail.request?.body) {
            const requestMedia = extractMediaByProvider(detail.request.body, provider, 'request');
            mediaItems.push(...requestMedia);
        }
        if (detail.response?.body) {
            const responseMedia = extractMediaByProvider(detail.response.body, provider, 'response');
            mediaItems.push(...responseMedia);
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

function extractMediaByProvider(jsonString, provider, source) {
    const mediaItems = [];

    try {
        const data = typeof jsonString === 'string' ? JSON.parse(jsonString) : jsonString;

        if (provider === 'openai') {
            extractOpenAIImages(data, source, mediaItems);
        } else if (provider === 'replicate') {
            extractReplicateImages(data, source, mediaItems);
        }
    } catch (e) {
        // Invalid JSON, skip
    }

    return mediaItems;
}

function extractOpenAIImages(data, source, mediaItems) {
    // Format 1: Chat Completions API - messages[].content[].image_url.url
    if (data.messages && Array.isArray(data.messages)) {
        data.messages.forEach((msg, msgIdx) => {
            if (msg.content && Array.isArray(msg.content)) {
                msg.content.forEach((item, itemIdx) => {
                    if (item.type === 'image_url' && item.image_url?.url) {
                        const url = item.image_url.url;
                        const match = url.match(/^data:([^;]*);base64,(.+)$/);
                        if (match) {
                            addMediaItem(mediaItems, match[2], match[1], `messages[${msgIdx}].content[${itemIdx}].image_url.url`, source);
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
                            addMediaItem(mediaItems, match[2], match[1], `input[${msgIdx}].content[${itemIdx}].image_url`, source);
                        } else if (url.match(/^https?:\/\/.+\.(png|jpg|jpeg|gif|webp)$/i)) {
                            // Check for image URL
                            const ext = url.split('.').pop().toLowerCase();
                            const mimeTypes = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
                            const mediaType = mimeTypes[ext] || 'image/png';
                            addMediaItem(mediaItems, url, mediaType, `input[${msgIdx}].content[${itemIdx}].image_url`, source, true);
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

function extractReplicateImages(data, source, mediaItems) {
    // Input images - Replicate uses different field names (input.image or input.input_image)
    const inputFields = ['image', 'input_image'];
    inputFields.forEach(fieldName => {
        const inputImage = data.input?.[fieldName];
        if (inputImage && typeof inputImage === 'string') {
            // Check for data URI (media type is optional - make it handle malformed data URIs like "data:;base64,...")
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
                // Check for data URI (media type is optional - make it handle malformed data URIs like "data:;base64,...")
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

                // Check for data URI (media type is optional - make it handle malformed data URIs like "data:;base64,...")
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

function redactBase64FromJSON(jsonString, mediaItems) {
    if (!mediaItems || mediaItems.length === 0 || !jsonString) return jsonString;

    try {
        const data = JSON.parse(jsonString);

        // Redact all media items (caller already filtered by source)
        mediaItems.forEach(item => {
            if (!item.dataUri) return;

            // Handle OpenAI Chat Completions format: messages[].content[].image_url.url
            if (item.field.startsWith('messages[')) {
                const match = item.field.match(/messages\[(\d+)\]\.content\[(\d+)\]\.image_url\.url/);
                if (match) {
                    const msgIdx = parseInt(match[1]);
                    const itemIdx = parseInt(match[2]);
                    if (data.messages?.[msgIdx]?.content?.[itemIdx]?.image_url) {
                        data.messages[msgIdx].content[itemIdx].image_url.url = `[BASE64_IMAGE_REDACTED - ${item.base64.length} bytes - See Preview tab]`;
                    }
                }
            }

            // Handle OpenAI Responses API (request) format: input[].content[].image_url
            if (item.field.startsWith('input[') && item.field.includes('.content[') && item.field.includes('.image_url')) {
                const match = item.field.match(/input\[(\d+)\]\.content\[(\d+)\]\.image_url/);
                if (match) {
                    const msgIdx = parseInt(match[1]);
                    const itemIdx = parseInt(match[2]);
                    if (Array.isArray(data.input) && data.input[msgIdx]?.content?.[itemIdx]?.image_url) {
                        data.input[msgIdx].content[itemIdx].image_url = `[BASE64_IMAGE_REDACTED - ${item.base64.length} bytes - See Preview tab]`;
                    }
                }
            }

            // Handle OpenAI Responses API (response) format: output[].result
            if (item.field.startsWith('output[') && item.field.includes('.result')) {
                const match = item.field.match(/output\[(\d+)\]\.result/);
                if (match) {
                    const idx = parseInt(match[1]);
                    if (Array.isArray(data.output) && data.output[idx] && data.output[idx].result) {
                        data.output[idx].result = `[BASE64_IMAGE_REDACTED - ${item.base64.length} bytes - See Preview tab]`;
                    }
                }
            }

            // Handle Replicate format: input.image or input.input_image
            if (item.field === 'input.image' && data.input?.image) {
                data.input.image = `[BASE64_IMAGE_REDACTED - ${item.base64.length} bytes - See Preview tab]`;
            }
            if (item.field === 'input.input_image' && data.input?.input_image) {
                data.input.input_image = `[BASE64_IMAGE_REDACTED - ${item.base64.length} bytes - See Preview tab]`;
            }
            if (item.field.startsWith('input.input_images[') && Array.isArray(data.input?.input_images)) {
                const match = item.field.match(/input\.input_images\[(\d+)\]/);
                if (match) {
                    const idx = parseInt(match[1]);
                    data.input.input_images[idx] = `[BASE64_IMAGE_REDACTED - ${item.base64.length} bytes - See Preview tab]`;
                }
            }
            if (item.field === 'output' && data.output && typeof data.output === 'string') {
                data.output = `[BASE64_IMAGE_REDACTED - ${item.base64.length} bytes - See Preview tab]`;
            }
            if (item.field.startsWith('output[') && !item.field.includes('.result') && Array.isArray(data.output)) {
                const match = item.field.match(/output\[(\d+)\](?!\.)/);
                if (match) {
                    const idx = parseInt(match[1]);
                    data.output[idx] = `[BASE64_IMAGE_REDACTED - ${item.base64.length} bytes - See Preview tab]`;
                }
            }
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

// Override Mode Handler
async function handleOverrideModeToggle(e) {
    const isChecked = e.target.checked;
    try {
        const response = await fetch('/api/override/toggle', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) throw new Error('Failed to toggle override mode');

        const data = await response.json();
        updateOverrideModeUI(data.enabled);
    } catch (error) {
        console.error('Error toggling override mode:', error);
        // Reset checkbox on error
        e.target.checked = !isChecked;
        showError('Failed to toggle override mode');
    }
}

function updateOverrideModeUI(enabled) {
    const modeLabel = document.getElementById('override-mode-label');
    const modeInput = document.getElementById('override-mode-input');
    if (modeLabel) {
        modeLabel.textContent = enabled ? 'ON' : 'OFF';
        modeLabel.style.color = enabled ? 'var(--color-warning)' : 'var(--color-text)';
    }
    if (modeInput) {
        modeInput.checked = enabled;
    }
}

// Approval Action Handlers
function setupApprovalActionHandlers(requestId) {
    const approveBtn = document.getElementById('approve-btn');
    const error400Btn = document.getElementById('error-400-btn');
    const error500Btn = document.getElementById('error-500-btn');
    const contentSensitiveBtn = document.getElementById('content-sensitive-btn');

    if (approveBtn) {
        approveBtn.onclick = () => handleRequestApproval(requestId);
    }
    if (error400Btn) {
        error400Btn.onclick = () => handleRequestOverride(requestId, 'error_400');
    }
    if (error500Btn) {
        error500Btn.onclick = () => handleRequestOverride(requestId, 'error_500');
    }
    if (contentSensitiveBtn) {
        contentSensitiveBtn.onclick = () => handleRequestOverride(requestId, 'content_sensitive');
    }
}

async function handleRequestApproval(requestId) {
    try {
        const response = await fetch(`/api/requests/${requestId}/approve`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to approve request');
        }

        // Hide approval banner and reload details
        const banner = document.getElementById('approval-banner');
        if (banner) banner.style.display = 'none';

        // Reload the selected request to show it's approved
        if (app.selectedRequestId) {
            loadRequestDetails(app.selectedRequestId);
        }
        showSuccess('Request approved');
    } catch (error) {
        console.error('Error approving request:', error);
        showError(error.message || 'Failed to approve request');
    }
}

async function handleRequestOverride(requestId, action) {
    try {
        const response = await fetch(`/api/requests/${requestId}/override`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ action })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to override request');
        }

        // Hide approval banner and reload details
        const banner = document.getElementById('approval-banner');
        if (banner) banner.style.display = 'none';

        // Reload the selected request to show the override response
        if (app.selectedRequestId) {
            loadRequestDetails(app.selectedRequestId);
        }
        showSuccess(`Request overridden with ${action}`);
    } catch (error) {
        console.error('Error overriding request:', error);
        showError(error.message || 'Failed to override request');
    }
}

// Update SSE message handlers
function setupSSEMessageHandlers() {
    // This function is called after app.eventSource is created
    // We need to add handlers for the new approval events in the handleSSEMessage function
}

// Notification System - Audio Beep
function playNotificationBeep() {
    try {
        // Create audio context
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();

        // Create oscillator for beep sound
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        // Connect nodes
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        // Set beep parameters
        oscillator.frequency.setValueAtTime(1000, audioContext.currentTime); // 1000 Hz
        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime); // 30% volume
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2); // Fade out over 200ms

        // Play beep
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.2); // 200ms duration
    } catch (error) {
        console.log('Audio notification not available:', error.message);
        // Silently fail - audio may not be available in some environments
    }
}

// Visual Indicator for Pending Approval
function addPendingApprovalIndicator(requestId) {
    const requestItem = document.querySelector(`[data-id="${requestId}"]`);
    if (!requestItem) return;

    // Check if badge already exists
    if (requestItem.querySelector('.pending-approval-badge')) {
        return;
    }

    // Create pending approval badge
    const badge = document.createElement('span');
    badge.className = 'pending-approval-badge';
    badge.textContent = '⏳ APPROVAL NEEDED';
    badge.title = 'Request is pending approval';

    // Also update status badge
    const statusBadge = requestItem.querySelector('.status-badge');
    if (statusBadge) {
        statusBadge.style.display = 'none';
    }

    // Insert badge at the position where status badge was
    const timestamp = requestItem.querySelector('.request-timestamp');
    if (timestamp) {
        timestamp.parentNode.insertBefore(badge, timestamp);
    } else {
        requestItem.appendChild(badge);
    }
}

function removePendingApprovalIndicator(requestId) {
    const requestItem = document.querySelector(`[data-id="${requestId}"]`);
    if (!requestItem) return;

    // Remove pending approval badge
    const badge = requestItem.querySelector('.pending-approval-badge');
    if (badge) {
        badge.remove();
    }

    // Show status badge again
    const statusBadge = requestItem.querySelector('.status-badge');
    if (statusBadge) {
        statusBadge.style.display = '';
    }
}

// Success notification helper
function showSuccess(message) {
    console.log(message);
    // Could be enhanced with toast notifications
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
