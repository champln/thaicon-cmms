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
      const [{ data: profiles, error: profileError }, { data: assignments, error: assignmentError }, { data: authUsers, error: authError }] = await Promise.all([
        admin.from("profiles").select("id, username, display_name, role, title, is_active").order("display_name"),
        admin.from("user_jobsites").select("user_id, jobsite_id"),
        admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
      ]);
      if (profileError || assignmentError || authError) throw profileError ?? assignmentError ?? authError;
      const emailById = new Map(authUsers.users.map((user) => [user.id, user.email ?? ""]));
      return json({ profiles: (profiles ?? []).map((profile) => ({ ...profile, email: emailById.get(profile.id) ?? "" })), assignments });
    }

    if (payload.action === "create") {
      if (!payload.email || !payload.password || !payload.username || !payload.displayName || !payload.role) return json({ error: "Missing required fields" }, 400);
      const { data, error } = await admin.auth.admin.createUser({ email: payload.email.trim().toLowerCase(), password: payload.password, email_confirm: true, user_metadata: { username: payload.username, display_name: payload.displayName } });
      if (error || !data.user) throw error ?? new Error("Unable to create user");
      payload.userId = data.user.id;
    }

    if (!payload.userId) return json({ error: "userId is required" }, 400);
    const { data: targetProfile, error: targetError } = await admin.from("profiles").select("role, is_active").eq("id", payload.userId).single();
    if (targetError || !targetProfile) return json({ error: "User profile not found" }, 404);
    if (payload.userId === callerData.user.id && (payload.action === "delete" || payload.active === false || (payload.role && payload.role !== "admin"))) {
      return json({ error: "Cannot delete, disable, or demote the current admin account" }, 409);
    }
    const removesActiveAdmin = targetProfile.role === "admin" && targetProfile.is_active && (
      payload.action === "delete" || payload.active === false || (payload.role !== undefined && payload.role !== "admin")
    );
    if (removesActiveAdmin) {
      const { count, error: countError } = await admin.from("profiles").select("id", { count: "exact", head: true }).eq("role", "admin").eq("is_active", true);
      if (countError) throw countError;
      if ((count ?? 0) <= 1) return json({ error: "At least one active administrator is required" }, 409);
    }
    if (payload.action === "delete") {
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
