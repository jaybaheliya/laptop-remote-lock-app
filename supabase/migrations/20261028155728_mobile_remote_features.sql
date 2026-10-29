ALTER TABLE public.commands
  ADD COLUMN IF NOT EXISTS payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS result JSONB;

ALTER TABLE public.commands DROP CONSTRAINT IF EXISTS commands_action_check;
ALTER TABLE public.commands ADD CONSTRAINT commands_action_check
  CHECK (action IN (
    'lock', 'sleep', 'shutdown', 'screenshot', 'unlock',
    'panic', 'display_message', 'task_list', 'end_task', 'refresh_status', 'save_note'
  ));

DROP POLICY IF EXISTS "Create remote commands for own devices" ON public.commands;
CREATE POLICY "Create remote commands for own devices"
  ON public.commands
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (select auth.uid()) = user_id
    AND action IN (
      'lock', 'sleep', 'shutdown', 'screenshot', 'unlock',
      'panic', 'display_message', 'task_list', 'end_task', 'refresh_status', 'save_note'
    )
    AND status = 'pending'
    AND EXISTS (
      SELECT 1 FROM public.devices d
      WHERE d.id = commands.device_id AND d.user_id = (select auth.uid())
    )
  );

ALTER TABLE public.devices
  ADD COLUMN IF NOT EXISTS network_name TEXT,
  ADD COLUMN IF NOT EXISTS network_type TEXT,
  ADD COLUMN IF NOT EXISTS local_ip TEXT,
  ADD COLUMN IF NOT EXISTS disk_free_gb NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS disk_total_gb NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS memory_used_gb NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS memory_total_gb NUMERIC(10, 2);

CREATE TABLE IF NOT EXISTS public.quick_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Quick note' CHECK (char_length(title) BETWEEN 1 AND 100),
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 5000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS quick_notes_device_user_updated_idx
  ON public.quick_notes (device_id, user_id, updated_at DESC);

ALTER TABLE public.quick_notes ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.quick_notes TO authenticated;

CREATE POLICY "Users can view their own laptop notes"
  ON public.quick_notes FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);
CREATE POLICY "Users can create notes for their own laptops"
  ON public.quick_notes FOR INSERT TO authenticated
  WITH CHECK (
    (select auth.uid()) = user_id
    AND EXISTS (SELECT 1 FROM public.devices d WHERE d.id = device_id AND d.user_id = (select auth.uid()))
  );
CREATE POLICY "Users can update their own laptop notes"
  ON public.quick_notes FOR UPDATE TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK (
    (select auth.uid()) = user_id
    AND EXISTS (SELECT 1 FROM public.devices d WHERE d.id = device_id AND d.user_id = (select auth.uid()))
  );
CREATE POLICY "Users can delete their own laptop notes"
  ON public.quick_notes FOR DELETE TO authenticated
  USING ((select auth.uid()) = user_id);
