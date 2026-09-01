/**
 * OS LOGOS DE VERDADE das integrações, cada um no ladrilho da própria marca.
 *
 * Os cartões usavam ícones genéricos do lucide -- um envelope para o Gmail, um
 * balão para o WhatsApp, uma câmera para o Instagram, um `Chrome` para o Google
 * Ads. Todos cinza, todos do mesmo desenho. O efeito é o que a referência
 * resolve: numa grade de seis, a marca é o que o olho acha primeiro, e seis
 * glifos cinza iguais obrigam a LER o nome de cada um.
 *
 * Cada logo é um ladrilho FECHADO -- fundo, cantos arredondados e glifo no mesmo
 * SVG. Assim o cartão não precisa decidir se põe borda (marca de fundo branco,
 * como Gmail e Slack) ou não (marca de fundo colorido, como WhatsApp): quem sabe
 * disso é o logo, e ele resolve dentro de si.
 *
 * Os `viewBox` internos são 24x24 porque é o tamanho em que esses caminhos são
 * publicados; o `translate`/`scale` encaixa no ladrilho de 40.
 */

import { useId } from "react";

type PropsLogo = { className?: string };

/** O ladrilho comum: 40x40, cantos de 10. `rx` igual em todos para a coluna de
 *  ícones não ficar com raios diferentes. */
function Ladrilho({
  fundo,
  borda,
  children,
  className,
  titulo,
}: {
  fundo: string;
  borda?: boolean;
  children: React.ReactNode;
  className?: string;
  titulo: string;
}) {
  return (
    <svg viewBox="0 0 40 40" className={className} role="img" aria-label={titulo}>
      <rect width="40" height="40" rx="10" fill={fundo} />
      {borda && (
        <rect
          x="0.5"
          y="0.5"
          width="39"
          height="39"
          rx="9.5"
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.12"
        />
      )}
      {children}
    </svg>
  );
}

export function LogoWhatsApp({ className }: PropsLogo) {
  return (
    <Ladrilho fundo="#25D366" className={className} titulo="WhatsApp">
      <g transform="translate(8 8) scale(1)">
        <path
          fill="#fff"
          transform="scale(1)"
          d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm0 18.15h-.01a8.23 8.23 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.19 8.19 0 0 1-1.26-4.38c0-4.54 3.7-8.23 8.25-8.23 2.2 0 4.27.86 5.83 2.42a8.18 8.18 0 0 1 2.41 5.82c0 4.54-3.7 8.23-8.24 8.23Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.24-.64.8-.78.97-.14.16-.29.18-.53.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.38.11-.5.11-.11.25-.29.37-.43.13-.15.17-.25.25-.41.09-.17.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.4-.42-.56-.42l-.47-.01c-.17 0-.43.06-.66.31-.23.25-.86.85-.86 2.07 0 1.21.88 2.39 1.01 2.55.12.17 1.74 2.66 4.22 3.73.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.47-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.1-.22-.16-.47-.28Z"
        />
      </g>
    </Ladrilho>
  );
}

export function LogoInstagram({ className }: PropsLogo) {
  /*
    `useId` porque `id` de SVG é GLOBAL do documento.
    O ladrilho aparece no cartão e de novo no painel ao mesmo tempo, então um id
    fixo daria dois elementos com o mesmo nome -- e todo `url(#...)` da página
    passaria a apontar para o primeiro. Funciona por acidente enquanto os dois
    degradês forem idênticos, e quebra no dia em que não forem.
  */
  const id = `vx-ig-${useId().replace(/:/g, "")}`;
  return (
    <svg viewBox="0 0 40 40" className={className} role="img" aria-label="Instagram">
      {/* O degradê é a marca do Instagram tanto quanto o desenho da câmera --
          em cor sólida ele lê como um ícone qualquer de câmera. */}
      <defs>
        <radialGradient id={id} cx="0.3" cy="1.05" r="1.2">
          <stop offset="0%" stopColor="#FFD776" />
          <stop offset="25%" stopColor="#F5983B" />
          <stop offset="50%" stopColor="#E9424B" />
          <stop offset="75%" stopColor="#C32F8D" />
          <stop offset="100%" stopColor="#6A48D6" />
        </radialGradient>
      </defs>
      <rect width="40" height="40" rx="10" fill={`url(#${id})`} />
      <g transform="translate(9 9)">
        <rect
          x="1.4"
          y="1.4"
          width="19.2"
          height="19.2"
          rx="5.6"
          fill="none"
          stroke="#fff"
          strokeWidth="2"
        />
        <circle cx="11" cy="11" r="5" fill="none" stroke="#fff" strokeWidth="2" />
        <circle cx="16.6" cy="5.4" r="1.4" fill="#fff" />
      </g>
    </svg>
  );
}

/** Gmail: ladrilho branco, envelope colorido. É assim que a marca é publicada. */
export function LogoGmail({ className }: PropsLogo) {
  return (
    <Ladrilho fundo="#fff" borda className={className} titulo="Gmail">
      <g transform="translate(8 11)">
        <path d="M2 18h4V9l-6-4.5V16a2 2 0 0 0 2 2Z" fill="#4285F4" />
        <path d="M18 18h4a2 2 0 0 0 2-2V4.5L18 9v9Z" fill="#34A853" />
        <path d="M18 2v7l6-4.5V3a2 2 0 0 0-3.2-1.6L18 2Z" fill="#FBBC04" />
        <path d="M6 9V2l6 4.5L18 2v7l-6 4.5L6 9Z" fill="#EA4335" />
        <path d="M0 3v1.5L6 9V2L3.2.4A2 2 0 0 0 0 3Z" fill="#C5221F" />
      </g>
    </Ladrilho>
  );
}

export function LogoMeta({ className }: PropsLogo) {
  return (
    <Ladrilho fundo="#0866FF" className={className} titulo="Meta">
      {/*
        O "f" DESENHADO, e não o disco do simple-icons.

        Aquele caminho traz o círculo E o "f" como um recorte só: preenchido de
        branco sobre o ladrilho azul, saía um disco branco com um "f" azul
        vazado no meio -- o negativo do ícone que todo mundo conhece, e a razão
        de ele parecer errado sem que se soubesse dizer o quê.
      */}
      <path
        fill="#fff"
        transform="translate(8 8) scale(1)"
        d="M15.12 5.32H17V2.14A26.11 26.11 0 0 0 14.26 2C11.54 2 9.68 3.66 9.68 6.7v2.62H6.61v3.56h3.07V22h3.68v-9.12h3.06l.46-3.56h-3.52V7.05c0-1.05.28-1.73 1.76-1.73Z"
      />
    </Ladrilho>
  );
}

/** Slack é multicolor por definição: em cor única vira um floco de neve. */
export function LogoSlack({ className }: PropsLogo) {
  return (
    <Ladrilho fundo="#fff" borda className={className} titulo="Slack">
      <g transform="translate(9 9) scale(0.917)">
        <path fill="#E01E5A" d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52z" />
        <path fill="#E01E5A" d="M6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z" />
        <path fill="#36C5F0" d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834z" />
        <path fill="#36C5F0" d="M8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z" />
        <path fill="#2EB67D" d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834z" />
        <path fill="#2EB67D" d="M17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312z" />
        <path fill="#ECB22E" d="M15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52z" />
        <path fill="#ECB22E" d="M15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" />
      </g>
    </Ladrilho>
  );
}

export function LogoZapier({ className }: PropsLogo) {
  return (
    <Ladrilho fundo="#FF4F00" className={className} titulo="Zapier">
      {/* A estrela de seis pontas do Zapier: três barras cruzadas no centro. */}
      <g stroke="#fff" strokeWidth="3.4" strokeLinecap="round">
        <line x1="20" y1="11" x2="20" y2="29" />
        <line x1="12.2" y1="15.5" x2="27.8" y2="24.5" />
        <line x1="12.2" y1="24.5" x2="27.8" y2="15.5" />
      </g>
    </Ladrilho>
  );
}

export function LogoGoogleAds({ className }: PropsLogo) {
  return (
    <Ladrilho fundo="#fff" borda className={className} titulo="Google Ads">
      {/*
        As duas barras em "Λ" e o ponto verde na ponta esquerda -- o desenho do
        Google Ads. Eram dois `<rect>` rotacionados, que numa caixa de 40px
        chegavam com as pontas quadradas e sem se encontrar no ápice. Traçado
        com `stroke-linecap="round"` resolve as duas coisas: a ponta arredonda
        sozinha e o vértice fecha porque as duas linhas partem do mesmo ponto.
      */}
      <g strokeLinecap="round" strokeWidth="7.4" fill="none">
        <line x1="20" y1="10.5" x2="12" y2="26" stroke="#FBBC04" />
        <line x1="20" y1="10.5" x2="28" y2="26" stroke="#4285F4" />
      </g>
      <circle cx="12" cy="26" r="4.6" fill="#34A853" />
    </Ladrilho>
  );
}

/** Webhook genérico (Zapier/Make e afins sem marca própria no cartão). */
export function LogoWebhook({ className }: PropsLogo) {
  return (
    <Ladrilho fundo="#64748B" className={className} titulo="Webhook">
      <g stroke="#fff" strokeWidth="2.4" fill="none" strokeLinecap="round">
        <circle cx="20" cy="14" r="3.2" />
        <circle cx="13.5" cy="25.5" r="3.2" />
        <circle cx="26.5" cy="25.5" r="3.2" />
        <path d="M17.4 16.6 15 21.9M22.6 16.6 25 21.9M16.7 25.5h6.6" />
      </g>
    </Ladrilho>
  );
}
