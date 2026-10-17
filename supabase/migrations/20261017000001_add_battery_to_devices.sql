-- Add battery status columns to devices table
ALTER TABLE devices 
  ADD COLUMN IF NOT EXISTS battery_level INT,
  ADD COLUMN IF NOT EXISTS is_charging BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS power_online BOOLEAN DEFAULT true;

