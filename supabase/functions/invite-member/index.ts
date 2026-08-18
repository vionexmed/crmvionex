import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify the caller
    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user: callerUser }, error: callerError } = await anonClient.auth.getUser();
    if (callerError || !callerUser) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const callerId = callerUser.id;

    const { email, role, org_id } = await req.json();

    if (!email || !org_id) {
      return new Response(JSON.stringify({ error: "Email and org_id are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check caller is admin/owner
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: callerRole } = await serviceClient
      .from("user_roles")
      .select("role")
      .eq("user_id", callerId)
      .eq("org_id", org_id)
      .single();

    if (!callerRole || (callerRole.role !== "owner" && callerRole.role !== "admin")) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // IMPORTANTE: registrar o convite ANTES de enviar o e-mail —
    // o trigger handle_new_user lê a tabela invitations para atribuir
    // org e papel quando o convidado abre o link.
    // Reenvio: substitui convite pendente anterior (atualiza papel também).
    await serviceClient.from("invitations").delete()
      .eq("org_id", org_id).ilike("email", email).is("accepted_at", null);
    const { error: recordError } = await serviceClient.from("invitations").insert({
      org_id,
      email,
      role: role || "member",
      invited_by: callerId,
    });
    if (recordError) {
      return new Response(JSON.stringify({ error: recordError.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Send magic link invite → landing na página de aceite (nome + senha)
    //
    // O destino NÃO é opcional. Antes, sem origin, o redirectTo simplesmente
    // não era enviado — e aí o Supabase usa o Site URL do projeto, que é a
    // raiz. O convidado entrava JÁ AUTENTICADO no CRM sem nunca passar pela
    // página que define a senha. O convite parecia funcionar e deixava atrás
    // uma conta sem senha, sem erro em lugar nenhum.
    //
    // Recusar o envio é melhor que enviar para o lugar errado: convite se
    // reenvia, conta sem senha só se resolve pelo "esqueci minha senha".
    //
    // ATENÇÃO: isto cobre só metade da falha. Se o destino for enviado mas não
    // estiver na allowlist de Redirect URLs do projeto, o Supabase o descarta
    // em silêncio e cai no Site URL do mesmo jeito — e não há como detectar
    // isso daqui. A allowlist precisa conter o domínio de produção e o de
    // desenvolvimento.
    const origin = req.headers.get("origin") || Deno.env.get("SITE_URL") || "";
    if (!origin) {
      // O convite foi registrado acima; sem envio ele viraria pendência morta.
      await serviceClient.from("invitations").delete()
        .eq("org_id", org_id).ilike("email", email).is("accepted_at", null);
      return new Response(
        JSON.stringify({
          error:
            "Não foi possível determinar o endereço de retorno do convite, então " +
            "nada foi enviado — um convite sem destino cria conta sem senha. " +
            "Defina SITE_URL nas variáveis das Edge Functions do Supabase.",
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const destino = `${origin}/accept-invite`;

    const { data: inviteData, error: inviteError } =
      await serviceClient.auth.admin.inviteUserByEmail(email, {
        data: { org_id, role: role || "member" },
        redirectTo: destino,
      });

    if (inviteError) {
      const emailExists =
        (inviteError as { code?: string }).code === "email_exists" ||
        /already.*(registered|exists)/i.test(inviteError.message || "");

      if (emailExists) {
        // O usuário auth já existe (convite anterior ou cadastro próprio).
        // Se já é membro DESTA org, não há o que convidar.
        const { data: existingProfile } = await serviceClient
          .from("profiles")
          .select("id, org_id")
          .ilike("email", email)
          .maybeSingle();
        if (existingProfile?.org_id === org_id) {
          await serviceClient.from("invitations").delete()
            .eq("org_id", org_id).eq("email", email).is("accepted_at", null);
          return new Response(JSON.stringify({ error: "Este e-mail já é membro da sua equipe." }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Usuário existe mas está fora da org: mantém o convite pendente e
        // envia um magic link de LOGIN. Ao entrar, claim_pending_invitation()
        // move o usuário para esta org com o papel convidado.
        const plainClient = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_ANON_KEY")!,
        );
        const { error: otpError } = await plainClient.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: destino },
        });
        if (otpError) {
          await serviceClient.from("invitations").delete()
            .eq("org_id", org_id).eq("email", email).is("accepted_at", null);
          return new Response(JSON.stringify({ error: `Falha ao reenviar acesso: ${otpError.message}` }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ success: true, resent: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Outro erro no envio → remove o registro de convite para não deixar lixo
      await serviceClient.from("invitations").delete()
        .eq("org_id", org_id).eq("email", email).is("accepted_at", null);
      return new Response(JSON.stringify({ error: inviteError.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true, user: inviteData.user }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
