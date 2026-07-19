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

- `server.js` — servidor Express + Socket.IO (mensagens em tempo real e
  sinalização WebRTC)
- `index.html` — frontend completo (interface, lógica do chat, chamadas)
- `package.json` — dependências
