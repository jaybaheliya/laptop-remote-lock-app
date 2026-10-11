-- Non-destructive migration to support failure diagnostics in remote lock history
ALTER TABLE public.commands
ADD COLUMN IF NOT EXISTS failure_reason text;

COMMENT ON COLUMN public.commands.failure_reason IS 'Sanitized diagnostic reason reported by the device agent when a command fails.';

