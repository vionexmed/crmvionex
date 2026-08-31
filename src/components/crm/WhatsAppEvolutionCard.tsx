import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrg } from "@/hooks/useOrg";
import { useToast } from "@/hooks/use-toast";
import { mensagemErro } from "@/lib/erro-supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { QrCode, Loader2, Smartphone, TriangleAlert, Unplug } from "lucide-react";

/**
 * WhatsApp pela Evolution API — cadastro do servidor e pareamento por QR code.
 *
 * Duas metades com donos diferentes, e é por isso que estão no mesmo cartão:
 * o administrador cadastra o servidor UMA vez para a empresa, e depois CADA
 * pessoa parea o próprio aparelho. Separar em duas telas faria a segunda
 * parecer quebrada enquanto a primeira não tivesse acontecido.
 *
 * O QR é lido por polling e não por webhook de propósito: o evento
 * `connection.update` da Evolution se perde com facilidade, e uma tela travada
 * em "aguardando" depois de a pessoa já ter lido o código é pior do que um
 * pedido a cada três segundos enquanto o código está na frente dela.
 */

type Conta = {
  provider: string;
  server_url: string | null;
  is_active: boolean;
};

type Conexao = {
  id: string;
  instance_name: string | null;
  display_phone_number: string | null;
  verified_name: string | null;
};

type Pareamento = {
  instancia: string;
  estado: "aguardando" | "conectado" | "desconectado";
  qr: string | null;
  codigo: string | null;
  telefone: string | null;
  nomePerfil: string | null;
};

/** De quanto em quanto se pergunta ao servidor enquanto o QR está na tela. */
const INTERVALO_MS = 3000;

/**
 * `embutido` renderiza SEM a moldura de Card e sem o cabeçalho.
 *
 * Existe porque este cartão passou a viver dentro do diálogo de WhatsApp, ao
 * lado da opção oficial da Meta -- e Card dentro de Card fica com duas bordas e
 * dois títulos dizendo a mesma coisa. A lógica é a mesma nos dois modos; o que
 * muda é só quem desenha a caixa.
 */
export function WhatsAppEvolutionCard({ embutido = false }: { embutido?: boolean } = {}) {
  const { orgId } = useOrg();
  const { user, isAdmin } = useAuth();
  const { toast } = useToast();

  const [carregando, setCarregando] = useState(true);
  const [conta, setConta] = useState<Conta | null>(null);
  const [conexao, setConexao] = useState<Conexao | null>(null);

  const [form, setForm] = useState({ server_url: "", access_token: "" });
  const [salvando, setSalvando] = useState(false);

  const [pareamento, setPareamento] = useState<Pareamento | null>(null);
  const [pareando, setPareando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (!orgId || !user) return;
    setCarregando(true);
    try {
      const [{ data: c }, { data: cx }] = await Promise.all([
        supabase.from("whatsapp_business_accounts")
          .select("provider, server_url, is_active").eq("org_id", orgId).maybeSingle(),
        supabase.from("whatsapp_connections")
          .select("id, instance_name, display_phone_number, verified_name")
          .eq("org_id", orgId).eq("user_id", user.id).eq("is_active", true).maybeSingle(),
      ]);
      setConta((c as Conta) ?? null);
      setConexao((cx as Conexao) ?? null);
      if (c?.server_url) setForm((f) => ({ ...f, server_url: c.server_url as string }));
    } finally {
      setCarregando(false);
    }
  }, [orgId, user]);

  useEffect(() => { void carregar(); }, [carregar]);

  /**
   * O intervalo vive num ref para o efeito de limpeza alcançá-lo mesmo quando a
   * pessoa sai da tela no meio do pareamento — um `setInterval` órfão seguiria
   * batendo no servidor Evolution até a aba fechar.
   */
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const pararRelogio = useCallback(() => {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
  }, []);
  useEffect(() => pararRelogio, [pararRelogio]);

  const consultar = useCallback(async () => {
    const { data, error } = await supabase.functions.invoke("whatsapp-pair", {
      body: { acao: "consultar" },
    });
    if (error || !data?.ok) {
      setErro(data?.error ?? mensagemErro(error));
      pararRelogio();
      setPareando(false);
      return;
    }

    const p = data.pareamento as Pareamento;
    setPareamento(p);

    if (p.estado === "conectado") {
      pararRelogio();
      setPareando(false);
      setPareamento(null);
      toast({ title: "WhatsApp conectado", description: p.telefone ? `+${p.telefone}` : undefined });
      await carregar();
    }
  }, [carregar, pararRelogio, toast]);

  const iniciar = useCallback(async () => {
    setPareando(true);
    setErro(null);
    setAviso(null);
    try {
      const { data, error } = await supabase.functions.invoke("whatsapp-pair", {
        body: { acao: "iniciar" },
      });
      if (error || !data?.ok) {
        setErro(data?.error ?? mensagemErro(error));
        setPareando(false);
        return;
      }
      setPareamento(data.pareamento as Pareamento);
      // Sem webhook o envio funciona e só o recebimento fica mudo — vale
      // conectar assim mesmo e dizer o que está faltando.
      if (data.avisoWebhook) {
        setAviso(
          "Conectado, mas não consegui configurar o recebimento de mensagens no " +
          `servidor Evolution: ${data.avisoWebhook}`,
        );
      }
      pararRelogio();
      timer.current = setInterval(() => { void consultar(); }, INTERVALO_MS);
    } catch (e) {
      setErro(mensagemErro(e));
      setPareando(false);
    }
  }, [consultar, pararRelogio]);

  const cancelar = useCallback(() => {
    pararRelogio();
    setPareando(false);
    setPareamento(null);
  }, [pararRelogio]);

  const salvarServidor = async () => {
    if (!form.server_url.trim() || !form.access_token.trim()) {
      toast({ title: "Preencha a URL e a chave", variant: "destructive" });
      return;
    }
    setSalvando(true);
    try {
      const { data, error } = await supabase.functions.invoke("whatsapp-waba-setup", {
        body: {
          provider: "evolution",
          server_url: form.server_url.trim(),
          access_token: form.access_token.trim(),
        },
      });
      if (error || !data?.ok) {
        toast({ title: "Não deu para salvar", description: data?.error ?? mensagemErro(error), variant: "destructive" });
        return;
      }
      // A chave sai do estado assim que é aceita: não há motivo para ela seguir
      // viva na memória da aba depois de gravada.
      setForm((f) => ({ ...f, access_token: "" }));
      toast({ title: "Servidor Evolution conectado" });
      await carregar();
    } finally {
      setSalvando(false);
    }
  };

  const desconectar = async () => {
    if (!conexao) return;
    const { data, error } = await supabase.functions.invoke("whatsapp-disconnect", {
      body: { connection_id: conexao.id },
    });
    if (error || !data?.ok) {
      toast({ title: "Não deu para desconectar", description: data?.error ?? mensagemErro(error), variant: "destructive" });
      return;
    }
    toast({ title: "WhatsApp desconectado" });
    await carregar();
  };

  if (carregando) {
    const espera = (
      <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
      </p>
    );
    return embutido ? espera : <Card><CardContent>{espera}</CardContent></Card>;
  }

  // A empresa está na Meta: quem manda nessa tela é o outro cartão.
  if (conta?.is_active && conta.provider !== "evolution") return null;

  const configurado = !!conta?.is_active && conta.provider === "evolution";

  const corpo = <div className="space-y-4">
        {/* ---------- 1. servidor da empresa ---------- */}
        {!configurado && (
          isAdmin ? (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Um servidor Evolution por empresa. Depois disso, cada pessoa conecta o próprio aparelho.
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="evo-url">URL do servidor</Label>
                <Input
                  id="evo-url"
                  value={form.server_url}
                  onChange={(e) => setForm((f) => ({ ...f, server_url: e.target.value }))}
                  placeholder="https://evolution.suaempresa.com.br"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="evo-key">Chave da API</Label>
                <Input
                  id="evo-key"
                  type="password"
                  value={form.access_token}
                  onChange={(e) => setForm((f) => ({ ...f, access_token: e.target.value }))}
                  placeholder="a chave global do servidor"
                />
                <p className="text-label text-muted-foreground">
                  É a <code>AUTHENTICATION_API_KEY</code> do seu servidor. Fica guardada no
                  servidor do CRM e nunca volta para o navegador.
                </p>
              </div>
              <Button onClick={salvarServidor} disabled={salvando}>
                {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Conectar servidor
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              O WhatsApp da empresa ainda não foi configurado. Peça a um administrador.
            </p>
          )
        )}

        {/* ---------- 2. o aparelho da pessoa ---------- */}
        {configurado && conexao && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
            <div className="flex items-center gap-3 min-w-0">
              <Smartphone className="h-4 w-4 shrink-0 text-primary" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">
                  {conexao.display_phone_number ? `+${conexao.display_phone_number}` : "Aparelho conectado"}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {conexao.verified_name || conexao.instance_name}
                </p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={desconectar}>
              <Unplug className="mr-1.5 h-3.5 w-3.5" />
              Desconectar
            </Button>
          </div>
        )}

        {configurado && !conexao && !pareamento && (
          <Button onClick={iniciar} disabled={pareando}>
            {pareando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <QrCode className="mr-2 h-4 w-4" />}
            Conectar meu WhatsApp
          </Button>
        )}

        {/* ---------- 3. o código ---------- */}
        {pareamento?.qr && (
          <div className="space-y-3 rounded-lg border border-border p-4">
            <ol className="list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
              <li>Abra o WhatsApp no celular</li>
              <li>Toque em <strong>Aparelhos conectados</strong> → <strong>Conectar aparelho</strong></li>
              <li>Aponte a câmera para o código abaixo</li>
            </ol>
            <div className="flex justify-center">
              {/* Fundo branco fixo: o QR é preto sobre transparente, e no tema
                  escuro ele fica preto sobre preto — ilegível para a câmera. */}
              <img
                src={pareamento.qr}
                alt="Código QR para conectar o WhatsApp"
                className="h-56 w-56 rounded-md bg-white p-2"
              />
            </div>
            {pareamento.codigo && (
              <p className="text-center text-xs text-muted-foreground">
                Ou digite o código <span className="font-mono font-semibold text-foreground">{pareamento.codigo}</span>
              </p>
            )}
            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Esperando a leitura… o código se renova sozinho.
            </div>
            <div className="flex justify-center">
              <Button variant="ghost" size="sm" onClick={cancelar}>Cancelar</Button>
            </div>
          </div>
        )}

        {aviso && (
          <p className="flex items-start gap-2 rounded-md bg-warning/10 p-2.5 text-xs text-warning">
            <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" />
            {aviso}
          </p>
        )}
        {erro && (
          <p className="flex items-start gap-2 rounded-md bg-destructive/10 p-2.5 text-xs text-destructive">
            <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" />
            {erro}
          </p>
        )}
  </div>;

  if (embutido) return corpo;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2">
              <QrCode className="h-4 w-4 text-primary" />
              WhatsApp por QR code
            </CardTitle>
            <CardDescription>
              Evolution API — conecta o seu WhatsApp lendo um código, sem passar pela Meta.
            </CardDescription>
          </div>
          {conexao && <Badge variant="secondary">Conectado</Badge>}
        </div>
      </CardHeader>

      <CardContent>{corpo}</CardContent>
    </Card>
  );
}
