-- Add error tracking fields to responses table
ALTER TABLE responses ADD COLUMN is_error BOOLEAN DEFAULT 0;
ALTER TABLE responses ADD COLUMN error_message TEXT;

-- Create index for error filtering
CREATE INDEX IF NOT EXISTS idx_responses_is_error ON responses(is_error);
