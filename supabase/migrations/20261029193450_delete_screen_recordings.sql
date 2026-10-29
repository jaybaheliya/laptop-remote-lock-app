-- Allow an authenticated device owner to request deletion of a saved local clip.
ALTER TABLE public.commands DROP CONSTRAINT IF EXISTS commands_action_check;
ALTER TABLE public.commands ADD CONSTRAINT commands_action_check
  CHECK (action IN (
    'lock', 'sleep', 'shutdown', 'screenshot', 'unlock', 'panic',
    'display_message', 'task_list', 'end_task', 'refresh_status', 'save_note',
    'screen_record', 'rename_recording', 'delete_recording'
  ));

DROP POLICY IF EXISTS "Create remote commands for own devices" ON public.commands;
CREATE POLICY "Create remote commands for own devices"
  ON public.commands FOR INSERT TO authenticated
  WITH CHECK (
    (select auth.uid()) = user_id
    AND action IN (
      'lock', 'sleep', 'shutdown', 'screenshot', 'unlock', 'panic',
      'display_message', 'task_list', 'end_task', 'refresh_status', 'save_note',
      'screen_record', 'rename_recording', 'delete_recording'
    )
    AND status = 'pending'
    AND EXISTS (
      SELECT 1 FROM public.devices d
      WHERE d.id = commands.device_id AND d.user_id = (select auth.uid())
    )
  );
