import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors'

// Public endpoint - no JWT required
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const url = new URL(req.url)

  // GET = webhook verification (Meta handshake)
  if (req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode')
    const token = url.searchParams.get('hub.verify_token')
    const challenge = url.searchParams.get('hub.challenge')

    if (mode !== 'subscribe' || !token) {
      return new Response('Bad request', { status: 400 })
    }

    // Find a config matching the verify token
    const { data: cfg } = await admin
      .from('whatsapp_config')
      .select('id')
      .eq('webhook_verify_token', token)
      .maybeSingle()

    if (!cfg) return new Response('Forbidden', { status: 403 })
    return new Response(challenge ?? '', { status: 200 })
  }

  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  try {
    // Verify Meta signature (X-Hub-Signature-256) if app secret is configured
    const appSecret = Deno.env.get('META_APP_SECRET')
    const rawBody = await req.text()
    if (appSecret) {
      const sig = req.headers.get('x-hub-signature-256') || ''
      const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(appSecret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      )
      const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody))
      const expected = 'sha256=' + Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, '0')).join('')
      // timing-safe compare
      if (sig.length !== expected.length) {
        return new Response('Forbidden', { status: 403 })
      }
      let diff = 0
      for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i)
      if (diff !== 0) return new Response('Forbidden', { status: 403 })
    } else {
      // FALHA FECHADA. Antes isto só avisava e seguia processando o corpo, o
      // que deixava qualquer pessoa na internet injetar mensagem falsa de
      // WhatsApp no CRM — criando contato, conversa e histórico. Sem o segredo
      // não há como distinguir a Meta de um impostor, então recusa.
      console.error('META_APP_SECRET ausente — webhook recusado')
      return new Response(
        JSON.stringify({ error: 'Webhook não configurado: META_APP_SECRET ausente' }),
        { status: 503, headers: { 'Content-Type': 'application/json' } },
      )
    }
    const body = JSON.parse(rawBody)
    // Each entry can have multiple changes
    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value || {}
        const phoneNumberId = value.metadata?.phone_number_id
        if (!phoneNumberId) continue

        const { data: cfg } = await admin
          .from('whatsapp_config')
          .select('id, org_id, display_phone_number')
          .eq('phone_number_id', phoneNumberId)
          .maybeSingle()
        if (!cfg) continue

        const orgId = cfg.org_id

        // Inbound messages
        for (const msg of value.messages || []) {
          const from = msg.from as string
          const wamid = msg.id as string
          const type = msg.type as string
          let text: string | null = null
          if (type === 'text') text = msg.text?.body ?? null
          else if (type === 'button') text = msg.button?.text ?? null
          else if (type === 'interactive') text = msg.interactive?.button_reply?.title ?? msg.interactive?.list_reply?.title ?? null
          else text = `[${type}]`

          // Try to match contact by phone (last 8+ digits)
          let contactId: string | null = null
          const tail = from.replace(/\D/g, '').slice(-8)
          if (tail) {
            const { data: c } = await admin
              .from('contacts')
              .select('id')
              .eq('org_id', orgId)
              .ilike('phone', `%${tail}%`)
              .limit(1)
              .maybeSingle()
            contactId = c?.id ?? null

            // Auto-create if missing
            if (!contactId) {
              const profileName = value.contacts?.[0]?.profile?.name || `WhatsApp +${from}`
              const { data: nc } = await admin
                .from('contacts')
                .insert({
                  org_id: orgId,
                  first_name: profileName,
                  phone: `+${from}`,
                  status: 'lead',
                })
                .select('id')
                .single()
              contactId = nc?.id ?? null
            }
          }

          await admin.from('whatsapp_messages').upsert({
            org_id: orgId,
            contact_id: contactId,
            direction: 'inbound',
            wa_message_id: wamid,
            from_number: from,
            to_number: cfg.display_phone_number || '',
            body: text,
            message_type: type,
            status: 'delivered',
            raw: msg,
          }, { onConflict: 'wa_message_id' })
        }

        // Status updates
        for (const status of value.statuses || []) {
          const wamid = status.id as string
          const newStatus = status.status as string
          if (!wamid || !newStatus) continue
          await admin.from('whatsapp_messages').update({
            status: newStatus,
            error_message: status.errors?.[0]?.message ?? null,
          }).eq('wa_message_id', wamid)
        }
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    console.error('whatsapp-webhook error', e)
    // Always return 200 so Meta doesn't disable the webhook
    return new Response(JSON.stringify({ ok: false }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
