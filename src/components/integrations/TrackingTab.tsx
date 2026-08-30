import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Globe, Copy, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export function TrackingTab({ orgId }: { orgId: string | null }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const trackingUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/tracking`;
  const snippet = `<!-- VIONEX Tracking -->
<script>
(function() {
  var ORG_ID = "${orgId || 'SEU_ORG_ID'}";
  var ENDPOINT = "${trackingUrl}";
  var vid = localStorage.getItem("fc_vid") || (function() {
    var id = "v_" + Math.random().toString(36).substr(2, 12) + Date.now().toString(36);
    localStorage.setItem("fc_vid", id);
    return id;
  })();

  function track(eventType, extra) {
    var payload = {
      org_id: ORG_ID,
      visitor_id: vid,
      event_type: eventType || "pageview",
      page_url: location.href,
      page_title: document.title,
      referrer: document.referrer,
      metadata: extra || {}
    };
    navigator.sendBeacon(ENDPOINT, JSON.stringify(payload));
  }

  // Track pageview on load
  track("pageview");

  // Track navigation (SPA support)
  var oldPush = history.pushState;
  history.pushState = function() {
    oldPush.apply(this, arguments);
    setTimeout(function() { track("pageview"); }, 100);
  };

  // Expose for custom events
  window.VIONEX = {
    track: track,
    identify: function(email) {
      vid = email;
      localStorage.setItem("fc_vid", email);
      track("identify", { email: email });
    }
  };
})();
</script>`;

  const copySnippet = () => {
    navigator.clipboard.writeText(snippet);
    setCopied(true);
    toast({ title: "Snippet copiado!" });
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-4 w-4" />
            Rastreamento de Website
          </CardTitle>
          <CardDescription>
            Adicione este snippet ao seu site para rastrear visitantes e aumentar o lead score automaticamente
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="relative">
            <pre className="rounded-md bg-muted p-4 text-micro font-mono overflow-x-auto max-h-64 overflow-y-auto whitespace-pre">
              {snippet}
            </pre>
            <Button
              variant="outline" size="sm"
              className="absolute top-2 right-2 h-7 text-micro"
              onClick={copySnippet}
            >
              {copied ? <Check className="mr-1 h-3 w-3" /> : <Copy className="mr-1 h-3 w-3" />}
              {copied ? "Copiado!" : "Copiar"}
            </Button>
          </div>

          <div className="space-y-2 rounded-md border border-border p-3">
            <p className="text-xs font-medium">Como funciona:</p>
            <ul className="text-label text-muted-foreground space-y-1">
              <li>• <strong>Pageviews</strong> são registrados automaticamente como atividades</li>
              <li>• <strong>Identificação</strong>: chame <code className="bg-muted px-1 rounded">VIONEX.identify("email@exemplo.com")</code> após formulários</li>
              <li>• <strong>Eventos customizados</strong>: <code className="bg-muted px-1 rounded">{'VIONEX.track("demo_request", {"plan": "pro"})'}</code></li>
              <li>• <strong>Lead Score</strong>: +1 ponto por pageview, +5 por identify, +10 por evento customizado</li>
              <li>• Suporte a SPA (intercepta <code className="bg-muted px-1 rounded">history.pushState</code>)</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
