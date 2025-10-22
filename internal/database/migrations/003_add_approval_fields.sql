-- Add approval tracking fields to requests table
ALTER TABLE requests ADD COLUMN approval_status TEXT DEFAULT 'approved';
ALTER TABLE requests ADD COLUMN override_action TEXT;
ALTER TABLE requests ADD COLUMN approved_at DATETIME;

-- Create index for filtering pending approvals
CREATE INDEX IF NOT EXISTS idx_requests_approval_status ON requests(approval_status);
