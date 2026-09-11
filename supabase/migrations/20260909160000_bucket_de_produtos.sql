-- ============================================================================
-- O BUCKET DA FOTO DE PRODUTO
-- ============================================================================
-- O catálogo nasceu com foto (`produtos.foto_url`) e com o campo de envio na
-- tela, mas o bucket nunca foi criado. O efeito: escolher a imagem no
-- formulário devolvia "Bucket not found" e não havia como cadastrar produto com
-- foto -- metade do cartão do catálogo, que é foto em cima e nome embaixo.
--
-- PÚBLICO, como `email-logos`, e não por preguiça: a URL que `getPublicUrl`
-- devolve vai para um `<img src>` e o navegador a busca SEM a sessão do
-- Supabase. Bucket restrito faria a foto subir, o produto salvar, e o cartão
-- ficar com a imagem quebrada. O caminho carrega um UUID, então não é
-- enumerável, e o conteúdo é catálogo de produto.
--
-- O CAMINHO É `<user_id>/<uuid>.<ext>`, que é o que `LogoUploadField` grava. As
-- políticas de escrita conferem o primeiro segmento: cada um mexe na própria
-- pasta.
-- ============================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('produtos', 'produtos', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "produtos_leitura_publica" ON storage.objects;
CREATE POLICY "produtos_leitura_publica" ON storage.objects
  FOR SELECT USING (bucket_id = 'produtos');

DROP POLICY IF EXISTS "produtos_envio" ON storage.objects;
CREATE POLICY "produtos_envio" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'produtos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "produtos_substituicao" ON storage.objects;
CREATE POLICY "produtos_substituicao" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'produtos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "produtos_remocao" ON storage.objects;
CREATE POLICY "produtos_remocao" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'produtos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
