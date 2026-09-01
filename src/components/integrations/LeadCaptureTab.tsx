import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Key, Copy, Check, Code, BookOpen, Webhook, Zap } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type ApiKey = {
  id: string; org_id: string; name: string; key_prefix: string; key_hash: string;
  created_at: string | null; last_used_at: string | null; is_active: boolean; request_count: number;
};

/**
 * Bloco de código com botão de copiar.
 *
 * Estava dentro do render -- e como o `<pre>` tem `overflow-y-auto max-h-64`, a
 * remontagem zerava a ROLAGEM do trecho: rolar o código, clicar em copiar, e o
 * bloco voltava ao topo.
 */
function CodeBlock({
  code,
  id,
  copiedId,
  onCopy,
}: {
  code: string;
  id: string;
  copiedId: string | null;
  onCopy: (code: string, id: string) => void;
}) {
  const copiado = copiedId === id;
  return (
    <div className="relative">
      <pre className="rounded-md bg-muted p-4 text-label font-mono overflow-x-auto max-h-64 overflow-y-auto whitespace-pre">
        {code}
      </pre>
      <Button
        variant="outline" size="sm"
        className="absolute top-2 right-2 h-8 text-label"
        onClick={() => onCopy(code, id)}
      >
        {copiado ? <Check className="mr-1 h-3 w-3" /> : <Copy className="mr-1 h-3 w-3" />}
        {copiado ? "Copiado!" : "Copiar"}
      </Button>
    </div>
  );
}

export function LeadCaptureTab({ orgId }: { orgId: string | null }) {
  const { toast } = useToast();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [pipelines, setPipelines] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    if (!orgId) return;
    supabase.from("api_keys").select("id,key_prefix,name,is_active").eq("org_id", orgId).then(({ data }) => {
      setApiKeys((data as any) || []);
    });
    supabase.from("pipelines").select("id,name").eq("org_id", orgId).then(({ data }) => {
      setPipelines((data as any) || []);
    });
  }, [orgId]);

  const baseUrl = import.meta.env.VITE_SUPABASE_URL;
  const endpoint = `${baseUrl}/functions/v1/lead-capture`;
  const activeKey = apiKeys.find((k) => k.is_active);
  const keyPlaceholder = activeKey ? `${activeKey.key_prefix}...` : "fc_SUA_CHAVE_AQUI";

  const copy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    toast({ title: "Copiado!" });
    setTimeout(() => setCopiedId(null), 2000);
  };

  const curlExample = `curl -X POST "${endpoint}" \\
  -H "X-Api-Key: ${keyPlaceholder}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "João Silva",
    "email": "joao@email.com",
    "phone": "(11) 99999-9999",
    "source": "landing_page",
    "utm_source": "google",
    "utm_campaign": "campanha-maio"
  }'`;

  const fetchExample = `// Cole no seu site ou landing page
fetch("${endpoint}", {
  method: "POST",
  headers: {
    "X-Api-Key": "${keyPlaceholder}",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    name: document.getElementById("nome").value,
    email: document.getElementById("email").value,
    phone: document.getElementById("telefone").value,
    source: "minha-landing-page",
    utm_source: new URLSearchParams(location.search).get("utm_source") || "",
    utm_campaign: new URLSearchParams(location.search).get("utm_campaign") || ""
  })
})
.then(r => r.json())
.then(data => {
  if (data.success) {
    // Redirecionar ou mostrar mensagem de sucesso
    window.location.href = "/obrigado";
  }
});`;

  const htmlFormExample = `<!DOCTYPE html>
<html>
<head><title>Formulário de Lead</title></head>
<body>
  <form id="lead-form">
    <input id="nome" placeholder="Seu nome" required />
    <input id="email" type="email" placeholder="Seu e-mail" required />
    <input id="telefone" placeholder="Seu telefone" />
    <button type="submit">Quero saber mais</button>
  </form>

  <script>
    document.getElementById("lead-form").addEventListener("submit", async function(e) {
      e.preventDefault();
      const res = await fetch("${endpoint}", {
        method: "POST",
        headers: {
          "X-Api-Key": "${keyPlaceholder}",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          name: document.getElementById("nome").value,
          email: document.getElementById("email").value,
          phone: document.getElementById("telefone").value,
          source: "landing_page"
        })
      });
      const data = await res.json();
      if (data.success) alert("Lead capturado com sucesso!");
    });
  </script>
</body>
</html>`;

  const phpExample = `<?php
$apiKey = "${keyPlaceholder}";
$endpoint = "${endpoint}";

$data = [
  "name"     => $_POST["nome"],
  "email"    => $_POST["email"],
  "phone"    => $_POST["telefone"],
  "source"   => "site-php",
  "utm_source"   => $_GET["utm_source"] ?? "",
  "utm_campaign" => $_GET["utm_campaign"] ?? "",
];

$ch = curl_init($endpoint);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
curl_setopt($ch, CURLOPT_HTTPHEADER, [
  "X-Api-Key: $apiKey",
  "Content-Type: application/json"
]);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
$response = json_decode(curl_exec($ch), true);
curl_close($ch);

if ($response["success"]) {
  header("Location: /obrigado.php");
}
?>`;

  const withPipelineExample = `// Criar lead E negócio ao mesmo tempo
fetch("${endpoint}", {
  method: "POST",
  headers: { "X-Api-Key": "${keyPlaceholder}", "Content-Type": "application/json" },
  body: JSON.stringify({
    name: "Maria Souza",
    email: "maria@empresa.com",
    company: "Empresa XYZ",
    source: "webinar",
    pipeline_id: "${pipelines[0]?.id || "ID_DO_PIPELINE"}",
    deal_name: "Lead do Webinar - Maria Souza",
    deal_value: 0,
    tags: ["webinar", "interesse-alto"],
    utm_source: "email",
    utm_campaign: "webinar-maio"
  })
});`;

  const fields = [
    { name: "name", type: "string", req: false, desc: "Nome completo (alternativa a first_name)" },
    { name: "first_name", type: "string", req: true, desc: "Primeiro nome (obrigatório se name não fornecido)" },
    { name: "last_name", type: "string", req: false, desc: "Sobrenome" },
    { name: "email", type: "string", req: false, desc: "E-mail do lead" },
    { name: "phone", type: "string", req: false, desc: "Telefone" },
    { name: "company", type: "string", req: false, desc: "Nome da empresa (cria ou vincula automaticamente)" },
    { name: "source", type: "string", req: false, desc: "Origem do lead (ex: 'landing_page_hero')" },
    { name: "notes", type: "string", req: false, desc: "Notas ou mensagem do lead" },
    { name: "pipeline_id", type: "uuid", req: false, desc: "ID do funil — cria um negócio automaticamente" },
    { name: "deal_name", type: "string", req: false, desc: "Título do negócio (padrão: 'Lead: Nome')" },
    { name: "deal_value", type: "number", req: false, desc: "Valor do negócio (padrão: 0)" },
    { name: "tags", type: "string[]", req: false, desc: "Tags para aplicar ao contato" },
    { name: "utm_source", type: "string", req: false, desc: "Parâmetro UTM source" },
    { name: "utm_medium", type: "string", req: false, desc: "Parâmetro UTM medium" },
    { name: "utm_campaign", type: "string", req: false, desc: "Parâmetro UTM campaign" },
    { name: "utm_content", type: "string", req: false, desc: "Parâmetro UTM content" },
    { name: "utm_term", type: "string", req: false, desc: "Parâmetro UTM term" },
    { name: "custom_fields", type: "object", req: false, desc: "Campos customizados (armazenados em metadata)" },
  ];

  return (
    <div className="space-y-6">
      {/* Header info */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-yellow-500" />
            API de Captação de Leads
          </CardTitle>
          <CardDescription>
            Endpoint dedicado para receber leads de landing pages, formulários e qualquer sistema externo.
            Cria o contato automaticamente no CRM com status <strong>Lead</strong>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
            <Badge variant="default" className="text-label shrink-0">POST</Badge>
            <code className="text-label font-mono break-all">{endpoint}</code>
            <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => copy(endpoint, "url")}>
              {copiedId === "url" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            </Button>
          </div>
          <div className="flex items-center gap-2 text-label text-muted-foreground">
            <Key className="h-3 w-3" />
            <span>Autenticação: header <code className="bg-muted px-1 rounded">X-Api-Key: sua_chave</code></span>
            {!activeKey && (
              <Badge variant="outline" className="text-label text-yellow-600 border-yellow-400">
                Gere uma API Key na aba "API Keys" primeiro
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Response format */}
      <Card>
        <CardHeader>
          <CardTitle>Resposta</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <p className="text-label font-medium text-green-600 mb-1">✓ Sucesso (201)</p>
              <CodeBlock code={`{ "success": true, "contact_id": "uuid", "deal_id": "uuid ou null" }`} id="resp-ok" copiedId={copiedId} onCopy={copy} />
            </div>
            <div>
              <p className="text-label font-medium text-red-500 mb-1">✗ Erro (400/401)</p>
              <CodeBlock code={`{ "error": "mensagem de erro" }`} id="resp-err" copiedId={copiedId} onCopy={copy} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Fields reference */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="h-3.5 w-3.5" />
            Campos Disponíveis
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="vx-table">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-label">Campo</TableHead>
                  <TableHead className="text-label">Tipo</TableHead>
                  <TableHead className="text-label">Obrigatório</TableHead>
                  <TableHead className="text-label">Descrição</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fields.map((f) => (
                  <TableRow key={f.name}>
                    <TableCell className="font-mono text-label">{f.name}</TableCell>
                    <TableCell className="text-label text-muted-foreground">{f.type}</TableCell>
                    <TableCell className="text-label">
                      {f.req ? <Badge variant="destructive" className="text-label">sim</Badge> : <span className="text-muted-foreground">não</span>}
                    </TableCell>
                    <TableCell className="text-label text-muted-foreground">{f.desc}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Code examples */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Code className="h-3.5 w-3.5" />
            Exemplos de Integração
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="text-label font-semibold mb-2">1. cURL (terminal / backend)</p>
            <CodeBlock code={curlExample} id="curl" copiedId={copiedId} onCopy={copy} />
          </div>
          <div>
            <p className="text-label font-semibold mb-2">2. JavaScript (fetch) — direto no browser</p>
            <CodeBlock code={fetchExample} id="fetch" copiedId={copiedId} onCopy={copy} />
          </div>
          <div>
            <p className="text-label font-semibold mb-2">3. Formulário HTML completo pronto para copiar</p>
            <CodeBlock code={htmlFormExample} id="html" copiedId={copiedId} onCopy={copy} />
          </div>
          <div>
            <p className="text-label font-semibold mb-2">4. PHP</p>
            <CodeBlock code={phpExample} id="php" copiedId={copiedId} onCopy={copy} />
          </div>
          <div>
            <p className="text-label font-semibold mb-2">5. Criar lead + negócio em um único request</p>
            {pipelines.length === 0 && (
              <p className="text-label text-yellow-600 mb-1">⚠ Crie um pipeline primeiro para usar pipeline_id</p>
            )}
            <CodeBlock code={withPipelineExample} id="pipeline" copiedId={copiedId} onCopy={copy} />
          </div>
        </CardContent>
      </Card>

      {/* Pipelines helper */}
      {pipelines.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>IDs dos seus funis</CardTitle>
            <CardDescription>Use estes IDs no campo pipeline_id</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {pipelines.map((p) => (
                <div key={p.id} className="flex items-center gap-2">
                  <span className="text-label font-medium w-32 truncate">{p.name}</span>
                  <code className="text-label font-mono text-muted-foreground flex-1 truncate">{p.id}</code>
                  <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => copy(p.id, `pipe-${p.id}`)}>
                    {copiedId === `pipe-${p.id}` ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Webhook integration note */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Webhook className="h-3.5 w-3.5" />
            Receba notificações quando um lead chegar
          </CardTitle>
          <CardDescription>
            Configure webhooks de saída na aba "Webhooks" para receber uma chamada HTTP sempre que um lead for captado.
            Eventos disponíveis: <code className="bg-muted px-1 rounded">contact.created</code> e <code className="bg-muted px-1 rounded">deal.created</code>
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
