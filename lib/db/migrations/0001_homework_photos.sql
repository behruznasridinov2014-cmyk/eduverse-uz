-- Additive, idempotent. Also applied automatically by the API on first request.
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS topic_id text;
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS topic_title text;
ALTER TABLE assignment_submissions ADD COLUMN IF NOT EXISTS attachment_count integer NOT NULL DEFAULT 0;
ALTER TABLE assignment_submissions ADD COLUMN IF NOT EXISTS signature text;
ALTER TABLE assignment_submissions ADD COLUMN IF NOT EXISTS signed_by text;
ALTER TABLE assignment_submissions ADD COLUMN IF NOT EXISTS signed_at timestamptz;
CREATE TABLE IF NOT EXISTS submission_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES assignment_submissions(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  data text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS submission_files_submission_idx ON submission_files(submission_id);
