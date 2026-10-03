import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://oamuzyxmllttfklwkcha.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9hbXV6eXhtbGx0dGZrbHdrY2hhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA5MzE4NDMsImV4cCI6MjEwNjUwNzg0M30.9od7sTRMx3ikont9_UEzm4oO9zm4NomR0eAkLyJN5mA'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
