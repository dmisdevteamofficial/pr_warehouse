import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL_MWM
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY_MWM

export const supabase = createClient(supabaseUrl, supabaseKey)
// ======================================Employee Project ======================================
const employeeProjectUrl = import.meta.env.VITE_SUPABASE_EMPLOYEE_PROJECT2_DB
const employeeProjectKey = import.meta.env.VITE_SUPABASE_DB_ANON_KEY_EMPLOYEE_PROJECT2

export const supabaseEmployee =
  employeeProjectUrl && employeeProjectKey ? createClient(employeeProjectUrl, employeeProjectKey) : null
