-- Índices que faltavam nos caminhos quentes do painel
--
-- As funções do painel (`sdr_metrics`, `sdr_series`, `sdr_metric_leads`,
-- `sdr_by_owner`) recortam janela por CONCLUSÃO, não por criação:
-- `activities.completed_at` e `emails.sent_at`. Nenhuma das duas colunas
-- tinha índice em 90 migrations -- o único índice de activities é
-- `(org_id, type, created_at DESC)`, que não serve para esse recorte.
--
-- Efeito prático: cada carga do painel fazia três varreduras completas das
-- atividades da organização (card, série e drill-down são consultas
-- separadas), e o custo cresce com o uso do CRM -- justamente quando a
-- empresa passa a depender dele.

-- Parcial: quem não concluiu não entra em nenhuma janela de conclusão, então
-- a fatia com NULL não precisa ser indexada.
CREATE INDEX IF NOT EXISTS idx_activities_org_completed
  ON public.activities (org_id, completed_at)
  WHERE completed_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_emails_org_sent
  ON public.emails (org_id, sent_at)
  WHERE sent_at IS NOT NULL;

-- `deals.owner_id` é filtro de primeira classe (por vendedor) no painel, nos
-- relatórios e na lista de negócios, e não tinha índice nenhum.
CREATE INDEX IF NOT EXISTS idx_deals_owner
  ON public.deals (owner_id);
