import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Upload, X, Loader2 } from "lucide-react";

export function LogoUploadField({
  value,
  onChange,
  bucket = "email-logos",
  rotulo = "logo",
  redondo = false,
}: {
  value: string;
  onChange: (url: string) => void;
  bucket?: string;
  /** Aparece nos botões e avisos. "logo" da empresa, "foto" da pessoa. */
  rotulo?: string;
  /** Prévia redonda, para foto de pessoa. */
  redondo?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const { toast } = useToast();

  const handleFile = async (file: File) => {
    if (file.size > 2 * 1024 * 1024) {
      toast({ title: "Arquivo muito grande", description: "Máximo 2MB", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) throw new Error("Usuário não autenticado");
      const ext = file.name.split(".").pop() || "png";
      const path = `${uid}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from(bucket).upload(path, file, {
        upsert: false,
        contentType: file.type,
      });
      if (error) throw error;
      const { data } = supabase.storage.from(bucket).getPublicUrl(path);
      onChange(data.publicUrl);
      toast({ title: `${rotulo[0].toUpperCase()}${rotulo.slice(1)} enviada` });
    } catch (e: any) {
      toast({ title: "Erro ao enviar", description: e.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex items-center gap-3">
      {value ? (
        <div className={`relative h-16 w-16 border border-border bg-muted/40 flex items-center justify-center overflow-hidden ${redondo ? "rounded-full" : "rounded"}`}>
          <img src={value} alt="" className={redondo ? "h-full w-full object-cover" : "max-h-full max-w-full object-contain"} />
          <button
            type="button"
            onClick={() => onChange("")}
            className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full h-4 w-4 flex items-center justify-center"
            aria-label="Remover"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : (
        <div className={`h-16 w-16 border border-dashed border-border bg-muted/40 flex items-center justify-center ${redondo ? "rounded-full" : "rounded"}`}>
          <Upload className="h-5 w-5 text-muted-foreground" />
        </div>
      )}
      <div className="flex-1 space-y-1">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = "";
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="h-8 text-xs"
        >
          {uploading ? <><Loader2 className="mr-1 h-3 w-3 animate-spin" />Enviando...</> : <><Upload className="mr-1 h-3 w-3" />{value ? "Trocar" : `Enviar ${rotulo}`}</>}
        </Button>
        <p className="text-label text-muted-foreground">PNG ou JPG, máx. 2MB</p>
      </div>
    </div>
  );
}
