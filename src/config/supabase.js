const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
// Use service_role key for backend to bypass RLS (if provided in .env)
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const missingCredentialsError = () => {
  throw new Error('Missing Supabase credentials. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the backend environment.');
};

let supabase;

if (!supabaseUrl || !supabaseKey) {
  console.warn('Missing Supabase credentials in .env');
  supabase = {
    from: missingCredentialsError,
    rpc: missingCredentialsError,
    auth: {
      getUser: missingCredentialsError
    },
    storage: {
      from: missingCredentialsError
    }
  };
} else {
  supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

module.exports = supabase;
