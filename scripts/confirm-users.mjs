import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const { data, error } = await supabase.auth.admin.listUsers();
if (error) { console.error("ERROR listing:", error.message); process.exit(1); }
console.log(`Found ${data.users.length} user(s):`);
for (const u of data.users) {
  const confirmed = Boolean(u.email_confirmed_at);
  if (!confirmed) {
    const { error: e2 } = await supabase.auth.admin.updateUserById(u.id, { email_confirm: true });
    console.log(`  • ${u.email}  —  was UNCONFIRMED → ${e2 ? "FAILED: " + e2.message : "NOW CONFIRMED ✓"}`);
  } else {
    console.log(`  • ${u.email}  —  already confirmed`);
  }
}
process.exit(0);
