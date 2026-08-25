import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const invalidCredentials = { error: "Invalid username or password" };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anonKey || !serviceKey) return json({ error: "Server configuration error" }, 500);

    const payload = await request.json() as { username?: string; password?: string };
    const username = payload.username?.trim().toLowerCase() ?? "";
    const password = payload.password ?? "";
    if (!/^[a-z0-9._-]{3,50}$/.test(username) || !password) {
      return json(invalidCredentials, 401);
    }

    const admin = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("id, is_active")
      .eq("username", username)
      .maybeSingle();
    if (profileError || !profile?.is_active) return json(invalidCredentials, 401);

    const { data: authUser, error: authUserError } = await admin.auth.admin.getUserById(profile.id);
    const email = authUser.user?.email;
    if (authUserError || !email) return json(invalidCredentials, 401);

    const authClient = createClient(url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await authClient.auth.signInWithPassword({ email, password });
    if (error || !data.session) return json(invalidCredentials, 401);

    return json({
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
    });
  } catch {
    return json(invalidCredentials, 401);
  }
});
