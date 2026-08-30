import { Building2 } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/layout/EstadoDaLista";

/**
 * O que a tela mostra quando a pessoa ainda não tem organização.
 *
 * Onze páginas tratavam isso, em DUAS mensagens diferentes: seis diziam "Crie
 * uma organização em Configurações primeiro" e cinco diziam só "Crie uma
 * organização primeiro" — sem dizer onde.
 *
 * E nenhuma das onze levava lá. A pessoa lia uma instrução e tinha que
 * encontrar o caminho sozinha, num menu que ela ainda não conhece porque acabou
 * de entrar.
 */
export function SemOrganizacao() {
  return (
    <EmptyState
      icone={Building2}
      titulo="Nenhuma organização ainda"
      descricao="O CRM guarda contatos, negócios e conversas dentro de uma organização. Crie a sua para começar."
      acao={
        <Button asChild size="sm">
          {/* Um link de verdade, não uma instrução. */}
          <Link to="/settings">Ir para Configurações</Link>
        </Button>
      }
    />
  );
}
