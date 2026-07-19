# ChatApp em Tempo Real

Chat com mensagens instantâneas e chamadas de voz/vídeo (WebRTC), usando
Express + Socket.IO.

## Rodar localmente

```bash
npm install
npm start
```

Acesse `http://localhost:3000`.

## Deploy no Railway (recomendado, mais simples)

1. Crie uma conta em https://railway.app
2. "New Project" → "Deploy from GitHub repo" (suba esta pasta para um repositório
   no GitHub primeiro) — ou use o Railway CLI: `railway up` dentro desta pasta
3. O Railway detecta o `package.json` e o `Procfile` automaticamente e roda `npm start`
4. Ele já fornece HTTPS automático — necessário para câmera/microfone funcionarem
   fora de `localhost`
5. Pegue a URL pública gerada (ex: `https://seu-app.up.railway.app`) e é isso —
   qualquer pessoa acessa dali, de qualquer rede

## Deploy no Render (alternativa, tem camada gratuita)

1. Crie uma conta em https://render.com
2. "New" → "Web Service" → conecte o repositório do GitHub
3. Build Command: `npm install`
4. Start Command: `npm start`
5. Render também fornece HTTPS automático

## Persistência de mensagens

O servidor agora salva o histórico de cada conversa num arquivo `messages.json`
(criado automaticamente). Isso significa:
- Recarregar a página não apaga mais as conversas
- Novos dispositivos que entram numa sala recebem o histórico salvo

**Importante:** no Railway (e a maioria dos serviços "serverless"/free tier), o
disco é **recriado do zero a cada novo deploy** — ou seja, sobrevive a reinícios
normais do servidor, mas um novo `git push` apaga o histórico. Para persistência
garantida entre deploys, o próximo passo é usar um banco de dados de verdade
(ex: Postgres, que o Railway oferece como plugin) em vez do arquivo local.

## Sobre as chamadas de vídeo (WebRTC)

O código já inclui:
- **STUN** (Google) — resolve a maioria das conexões na mesma rede ou redes simples
- **TURN** (OpenRelay, gratuito para testes) — retransmite a mídia quando os dois
  lados estão atrás de NAT/roteadores restritivos (a situação mais comum entre
  redes diferentes, ex: um no Wi-Fi de casa e outro no 4G)

Para um app em produção com uso real, o TURN gratuito do OpenRelay tem limite de
banda. Vale migrar para:
- Seu próprio servidor **coturn** (open-source, instala num VPS)
- Um serviço pago como **metered.ca** ou **Twilio STUN/TURN**

## Estrutura

- `server.js` — servidor Express + Socket.IO (mensagens em tempo real,
  sinalização WebRTC e proxy do tradutor)
- `index.html` — frontend completo (interface, lógica do chat, chamadas)
- `package.json` — dependências

## Novidades desta versão

- **Cronômetro de chamada** — aparece assim que a chamada conecta, formato mm:ss (ou h:mm:ss em chamadas longas).
- **Áudio com fallback de autoplay** — se o navegador bloquear a reprodução automática (política padrão de autoplay), aparece um botão "🔈 Toque p/ tocar" no player de música.
- **Vídeo compartilhado transmitido de verdade** — antes só tocava localmente para quem compartilhava; agora usamos `captureStream()` do próprio `<video>` + Web Audio API (`GainNode`) para substituir as faixas de vídeo/áudio enviadas na chamada, então o outro lado assiste ao vivo, em tempo real. O painel de controle (canto superior esquerdo do vídeo) permite pausar/continuar para todos e ajustar o volume do que é transmitido. Funciona com arquivos locais ou links diretos `.mp4`/`.webm` — links do YouTube não funcionam com essa técnica (o YouTube não expõe o `<video>` para captura).
- **Compartilhar tela em dispositivo móvel** — a maioria dos navegadores mobile (Android/iOS) não permite capturar a tela via navegador. Agora o app detecta isso e avisa claramente em vez de falhar silenciosamente.
- **Tradutor (🌐 no cabeçalho)** — escolha um idioma entre mais de 10 dos mais falados do mundo (português, inglês, espanhol, chinês, hindi, árabe, francês, russo, alemão, japonês, italiano). Toque no 🌐 de qualquer mensagem para traduzi-la; a tradução é feita pelo servidor (`/api/translate`) usando o endpoint público do Google Translate — sem chave de API. Requer Node.js 18+ (usa `fetch` nativo).
