package provider

import (
	"encoding/json"
)

// ErrorResponse represents a generic error response
type ErrorResponse struct {
	Error map[string]interface{} `json:"error,omitempty"`
	Detail string                `json:"detail,omitempty"`
}

// GetCannedError returns a canned error response body and headers for the given provider and error type
// errorType can be: "error_400", "error_500", or "content_sensitive"
func GetCannedError(providerName string, errorType string) (body string, headers map[string]string) {
	headers = map[string]string{
		"Content-Type": "application/json",
	}

	switch providerName {
	case "openai":
		return getCannedOpenAIError(errorType)
	case "replicate":
		return getCannedReplicateError(errorType)
	default:
		// Generic error for unknown providers
		return getCannedGenericError(errorType)
	}
}

// getCannedOpenAIError returns OpenAI-formatted error responses
func getCannedOpenAIError(errorType string) (body string, headers map[string]string) {
	headers = map[string]string{
		"Content-Type": "application/json",
	}

	var message, errType string
	var code interface{}

	switch errorType {
	case "error_400":
		message = "Your request was rejected as a result of our safety system. Please modify your request and try again."
		errType = "invalid_request_error"
		code = nil
	case "error_500":
		message = "The server had an error processing your request. Sorry about that! You can retry your request, or contact us through our help center at help.openai.com if you encounter this error repeatedly."
		errType = "server_error"
		code = nil
	case "content_sensitive":
		message = "Your request was rejected by the safety system. If you believe this is an error, contact us at help.openai.com and include the request ID req_f8c01da06be29e95a9293561d10b3a80. safety_violations=[sexual]."
		errType = "image_generation_user_error"
		code = "moderation_blocked"
	default:
		message = "An error occurred while processing your request."
		errType = "api_error"
		code = nil
	}

	errorObj := map[string]interface{}{
		"error": map[string]interface{}{
			"message": message,
			"type":    errType,
			"param":   nil,
			"code":    code,
		},
	}

	jsonBody, _ := json.Marshal(errorObj)
	return string(jsonBody), headers
}

// getCannedReplicateError returns Replicate-formatted error responses
func getCannedReplicateError(errorType string) (body string, headers map[string]string) {
	headers = map[string]string{
		"Content-Type": "application/json",
	}

	var message string

	switch errorType {
	case "error_400":
		message = "Invalid request: request does not match the API specification"
	case "error_500":
		message = "Internal server error"
	case "content_sensitive":
		message = "The input or output was flagged as sensitive. Please try again with different inputs. (E005)"
	default:
		message = "An error occurred"
	}

	errorObj := map[string]interface{}{
		"detail": message,
	}

	jsonBody, _ := json.Marshal(errorObj)
	return string(jsonBody), headers
}

// getCannedGenericError returns a generic error response
func getCannedGenericError(errorType string) (body string, headers map[string]string) {
	headers = map[string]string{
		"Content-Type": "application/json",
	}

	var message string

	switch errorType {
	case "error_400":
		message = "Bad request: the request was invalid or malformed"
	case "error_500":
		message = "Internal server error: an error occurred while processing your request"
	case "content_sensitive":
		message = "The request was flagged as sensitive and could not be processed"
	default:
		message = "An error occurred"
	}

	errorObj := map[string]interface{}{
		"error": message,
	}

	jsonBody, _ := json.Marshal(errorObj)
	return string(jsonBody), headers
}
