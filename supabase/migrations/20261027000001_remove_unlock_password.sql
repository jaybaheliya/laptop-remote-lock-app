-- Windows credentials must not be stored or sent through the remote agent.
ALTER TABLE public.devices
  DROP COLUMN IF EXISTS unlock_password;
