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
    isLoading: false,
};

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    initializeEventListeners();
    loadRequests();
    connectSSE();
});

// Initialize event listeners
function initializeEventListeners() {
    // Filter buttons
    document.getElementById('apply-filters-btn').addEventListener('click', applyFilters);
    document.getElementById('clear-filters-btn').addEventListener('click', clearFilters);

    // Tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => switchTab(e.target.dataset.tab));
    });
}

// Load requests from API
async function loadRequests() {
    if (app.isLoading) return;
    app.isLoading = true;

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
        app.isLoading = false;
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
    } else {
        statusBadge.textContent = 'Pending';
        statusBadge.className = 'status-badge';
    }

    clone.querySelector('.request-endpoint').textContent = request.endpoint;
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
}

// Load request details
async function loadRequestDetails(requestId) {
    try {
        const response = await fetch(`/api/requests/${requestId}`);
        if (!response.ok) throw new Error('Failed to load request details');

        const detail = await response.json();
        renderRequestDetails(detail);
    } catch (error) {
        console.error('Error loading request details:', error);
        showError('Failed to load request details');
    }
}

// Render request details
function renderRequestDetails(detail) {
    const container = document.getElementById('details-container');
    const template = document.getElementById('details-template');
    const clone = template.content.cloneNode(true);

    // Request tab
    clone.getElementById('detail-provider').textContent = detail.request.provider;
    clone.getElementById('detail-endpoint').textContent = detail.request.endpoint;
    clone.getElementById('detail-method').textContent = detail.request.method;

    const requestBody = detail.request.body || '';
    clone.getElementById('detail-request-body').querySelector('code').textContent =
        formatJSON(requestBody) || '(empty)';

    // Response tab
    if (detail.response) {
        clone.getElementById('detail-status-code').textContent = `${detail.response.status_code} ${getStatusText(detail.response.status_code)}`;
        clone.getElementById('detail-duration').textContent = `${detail.response.duration_ms}ms`;

        const responseBody = detail.response.body || '';
        const formatted = formatJSON(responseBody) || '(empty)';
        clone.getElementById('detail-response-body').querySelector('code').textContent = formatted;

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

    // Replace content
    container.innerHTML = '';
    container.appendChild(clone);

    // Re-attach tab listeners
    container.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => switchTab(e.target.dataset.tab, container));
    });
}

// Create file element
function createFileElement(file) {
    const template = document.getElementById('file-item-template');
    const clone = template.content.cloneNode(true);

    clone.querySelector('.file-name').textContent = file.file_path;
    clone.querySelector('.file-type').textContent = file.content_type;
    clone.querySelector('.file-size').textContent = `${formatSize(file.size)}`;

    const preview = clone.querySelector('.file-preview');
    if (isImageContentType(file.content_type)) {
        const img = document.createElement('img');
        img.src = `/api/files/${file.file_path}`;
        img.alt = file.file_path;
        preview.appendChild(img);
    } else {
        preview.innerHTML = '<p class="no-data">Binary file - not displayable in browser</p>';
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
    app.filters.provider = document.getElementById('provider-filter').value;
    app.filters.pathPattern = document.getElementById('path-filter').value;

    const dateFromStr = document.getElementById('date-from-filter').value;
    const dateToStr = document.getElementById('date-to-filter').value;

    app.filters.dateFrom = dateFromStr ? new Date(dateFromStr) : null;
    app.filters.dateTo = dateToStr ? new Date(dateToStr) : null;

    loadRequests();
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

// Connect to SSE
function connectSSE() {
    if (app.eventSource) return;

    try {
        app.eventSource = new EventSource('/api/events');

        app.eventSource.addEventListener('request_created', (event) => {
            const request = JSON.parse(event.data).request;
            addRequestToList(request);
        });

        app.eventSource.addEventListener('response_created', (event) => {
            const data = JSON.parse(event.data).data;
            updateRequestStatus(data.request_id, data.status_code);
        });

        app.eventSource.addEventListener('connected', () => {
            updateConnectionStatus(true);
        });

        app.eventSource.onerror = () => {
            updateConnectionStatus(false);
            app.eventSource = null;
            // Try to reconnect after 3 seconds
            setTimeout(connectSSE, 3000);
        };

        updateConnectionStatus(true);
    } catch (error) {
        console.error('Error connecting to SSE:', error);
        updateConnectionStatus(false);
    }
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
function updateRequestStatus(requestId, statusCode) {
    const request = app.requests.find(r => r.id === requestId);
    if (request) {
        request.status = statusCode;

        // Update in list
        const item = document.querySelector(`[data-id="${requestId}"]`);
        if (item) {
            const statusBadge = item.querySelector('.status-badge');
            statusBadge.textContent = statusCode;
            statusBadge.className = `status-badge ${getStatusClass(statusCode)}`;
        }
    }
}

// Update connection status
function updateConnectionStatus(connected) {
    const indicator = document.getElementById('status-indicator');
    const text = document.getElementById('status-text');

    if (connected) {
        indicator.classList.remove('status-disconnected');
        indicator.classList.add('status-connected');
        text.textContent = 'Connected';
    } else {
        indicator.classList.remove('status-connected');
        indicator.classList.add('status-disconnected');
        text.textContent = 'Disconnected';
    }
}

// Helper functions

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

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (app.eventSource) {
        app.eventSource.close();
    }
});
