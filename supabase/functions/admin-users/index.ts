import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type AdminUserPayload = {
  action: "list" | "create" | "update" | "delete";
  userId?: string;
  email?: string;
  password?: string;
  username?: string;
  displayName?: string;
  role?: "admin" | "engineer" | "user";
  title?: string;
  active?: boolean;
  jobsiteIds?: string[];
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const authorization = request.headers.get("Authorization");
    if (!url || !serviceKey || !authorization) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const token = authorization.replace(/^Bearer\s+/i, "");
    const { data: callerData, error: callerError } = await admin.auth.getUser(token);
    if (callerError || !callerData.user) return json({ error: "Invalid session" }, 401);
    const { data: caller } = await admin.from("profiles").select("role, is_active").eq("id", callerData.user.id).single();
    if (!caller?.is_active || caller.role !== "admin") return json({ error: "Admin permission required" }, 403);

    const payload = await request.json() as AdminUserPayload;
    if (payload.action === "list") {
      const [{ data: profiles, error: profileError }, { data: assignments, error: assignmentError }] = await Promise.all([
        admin.from("profiles").select("id, username, display_name, role, title, is_active").order("display_name"),
        admin.from("user_jobsites").select("user_id, jobsite_id"),
      ]);
      if (profileError || assignmentError) throw profileError ?? assignmentError;
      return json({ profiles, assignments });
    }

    if (payload.action === "create") {
      if (!payload.email || !payload.password || !payload.username || !payload.displayName || !payload.role) return json({ error: "Missing required fields" }, 400);
      const { data, error } = await admin.auth.admin.createUser({ email: payload.email.trim().toLowerCase(), password: payload.password, email_confirm: true, user_metadata: { username: payload.username, display_name: payload.displayName } });
      if (error || !data.user) throw error ?? new Error("Unable to create user");
      payload.userId = data.user.id;
    }

    if (!payload.userId) return json({ error: "userId is required" }, 400);
    if (payload.action === "delete") {
      if (payload.userId === callerData.user.id) return json({ error: "Cannot delete the current account" }, 409);
      const { error } = await admin.auth.admin.deleteUser(payload.userId);
      if (error) throw error;
      return json({ ok: true });
    }

    if (payload.email || payload.password) {
      const { error } = await admin.auth.admin.updateUserById(payload.userId, { email: payload.email?.trim().toLowerCase(), password: payload.password || undefined });
      if (error) throw error;
    }
    const { error: profileError } = await admin.from("profiles").update({ username: payload.username?.trim().toLowerCase(), display_name: payload.displayName, role: payload.role, title: payload.title, is_active: payload.active ?? true }).eq("id", payload.userId);
    if (profileError) throw profileError;
    if (payload.jobsiteIds) {
      const { error: deleteError } = await admin.from("user_jobsites").delete().eq("user_id", payload.userId);
      if (deleteError) throw deleteError;
      if (payload.jobsiteIds.length) {
        const { error: assignmentError } = await admin.from("user_jobsites").insert(payload.jobsiteIds.map((jobsiteId) => ({ user_id: payload.userId, jobsite_id: jobsiteId, assigned_by: callerData.user.id })));
        if (assignmentError) throw assignmentError;
      }
    }
    return json({ ok: true, userId: payload.userId });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});
