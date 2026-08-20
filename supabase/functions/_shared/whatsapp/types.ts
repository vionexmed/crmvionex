/**
 * Contrato de provedor de WhatsApp.
 *
 * Existe porque a Meta oficial não é a única saída: a Evolution API (auto-
 * hospedada, por cima do WhatsApp Web) está no plano. O projeto JÁ passou por
 * essa troca uma vez no sentido inverso — havia `whatsapp_instances` com
 * `provider_type` default 'evolution_self_hosted', tudo derrubado na migração
 * para a Meta, e sobrou código morto em process-automation chamando tabela que
 * não existe mais. Declarar o contrato agora é o que evita repetir isso.
 *
 * Só a Meta está implementada. `evolution.ts` é um stub explícito.
 */

/** Um número dentro do WABA (ou uma instância, na Evolution). */
export type NumeroDisponivel = {
  /** phone_number_id na Meta; nome da instância na Evolution. */
  id: string;
  telefone: string | null;
  nomeVerificado: string | null;
  /** GREEN | YELLOW | RED na Meta. null quando o provedor não informa. */
  qualidade: string | null;
};

/**
 * Credencial resolvida no servidor. O token NUNCA sai daqui para o navegador —
 * quem monta este objeto é sempre uma edge function com service role.
 */
export type Credencial = {
  provider: string;
  /** Meta: token de sistema do WABA. Evolution: api key do servidor. */
  token: string;
  /** Meta: id do WABA. */
  wabaId: string | null;
  /** Evolution: URL do servidor auto-hospedado. */
  serverUrl: string | null;
};

/** De onde sai e para quem vai. */
export type Rota = {
  /** phone_number_id na Meta; nome da instância na Evolution. */
  origem: string;
  /** Telefone do destinatário, só dígitos. */
  para: string;
};

export type Template = {
  name: string;
  language: string;
  components?: unknown[];
};

export type ResultadoEnvio = {
  ok: boolean;
  /** Id da mensagem no provedor. Vira whatsapp_messages.wa_message_id. */
  idMensagem: string | null;
  /** Resposta crua, para gravar em whatsapp_messages.raw e depurar. */
  bruto: unknown;
  /** Preenchido só quando ok é false. */
  erro: string | null;
};

/**
 * Evento de webhook já normalizado.
 *
 * A forma é a da Meta porque é o único provedor implementado — quando a
 * Evolution entrar, é aqui que a tradução dos eventos do Baileys vai acontecer,
 * e este tipo pode precisar crescer. Está declarado assim de propósito: melhor
 * um tipo honesto que revela sua origem do que uma abstração inventada sem um
 * segundo provedor para validá-la.
 */
export type EventoWebhook =
  | {
      tipo: "mensagem";
      /** Número que RECEBEU — resolve de quem é a conexão. */
      origem: string;
      idMensagem: string;
      de: string;
      para: string;
      texto: string | null;
      tipoConteudo: string;
      /** Nome do perfil do WhatsApp, quando vem. Serve para criar o contato. */
      nomePerfil: string | null;
      bruto: unknown;
    }
  | {
      tipo: "status";
      idMensagem: string;
      status: string;
      erro: string | null;
    };

export interface ProvedorWhatsApp {
  readonly nome: string;
  enviarTexto(cred: Credencial, rota: Rota, texto: string): Promise<ResultadoEnvio>;
  enviarTemplate(cred: Credencial, rota: Rota, template: Template): Promise<ResultadoEnvio>;
  /** Valida a credencial sem enviar mensagem. Usado no cadastro do WABA. */
  verificarCredencial(cred: Credencial): Promise<{ ok: boolean; erro: string | null }>;
  /** Números que a credencial alcança. Alimenta a lista de reivindicação. */
  listarNumeros(cred: Credencial): Promise<NumeroDisponivel[]>;
  lerWebhook(payload: unknown): EventoWebhook[];
}
