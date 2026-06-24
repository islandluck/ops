// Dev utility: create a pre-confirmed user via the Supabase admin API.
// Usage: node scripts/create-confirmed-user.mjs <email> <password> "<Full Name>"
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const [email = "founder@northwindstudio.com", password = "demo-password-123", name = "Alex Rivera"] =
  process.argv.slice(2);

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data, error } = await supabase.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { full_name: name },
});

if (error) {
  console.error("ERROR:", error.message);
  process.exit(1);
}
console.log("CREATED user:", data.user.email, "(confirmed)");
