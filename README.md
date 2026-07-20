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

- **Cronômetro de chamada** — aparece assim que a chamada conecta, formato mm:ss (ou h:mm:ss em chamadas longas). Funciona tanto em chamadas de vídeo quanto de voz.
- **Áudio com fallback de autoplay** — se o navegador bloquear a reprodução automática (política padrão de autoplay), aparece um botão "🔈 Toque p/ tocar".
- **Vídeo compartilhado transmitido de verdade** — usamos `captureStream()` + Web Audio API para transmitir ao vivo. Painel de controle com pausar/continuar, volume, **fechar (✖️)**, **minimizar (🔽)** e **arrastar** para qualquer canto do vídeo.
- **Compartilhar tela** — detecta quando o navegador/dispositivo não suporta (mobile) e avisa claramente. Também tenta capturar e transmitir o **áudio do sistema/aba**, quando o navegador permite (mais comum no Chrome desktop, compartilhando uma aba).
- **Tradutor (🌐)** — mais de 10 idiomas, tradução via `/api/translate` no servidor, sem chave de API.
- **Quadro branco sincronizado (🎨)** — cada traço desenhado por um lado agora aparece em tempo real no outro.
- **Chat ao lado da videochamada (💬)** — painel deslizante para continuar a escrever enquanto fala, com seletor de emojis (também disponível no chat normal).
- **Música partilhada na chamada (🔗)** — quem está a tocar uma música de fundo pode ligar a partilha para a outra pessoa também ouvir em tempo real durante a chamada. Botões de trocar (▶️/📁), parar (⏹️) e fechar (✖️) o player.
- **Correção do bug de rechamada** — antes, ao terminar uma chamada, os dois lados entravam num loop de eventos que impedia iniciar uma nova chamada depois. Corrigido com uma verificação de estado (`callActive`).
- **Autenticação de usuários** — tela de login/criar conta com nome, telemóvel, país, email e senha. As senhas são guardadas com hash `scrypt` (nunca em texto puro), num arquivo `users.json` no servidor (mesmo padrão de persistência do histórico de mensagens — ver aviso sobre deploys abaixo).
- **Painel de administrador (⚙️)** — visível apenas para o administrador, lista todos os usuários cadastrados (nome, telemóvel, país, email). Por padrão, o **primeiro usuário a se cadastrar** no servidor vira administrador automaticamente. Para escolher um telemóvel específico como admin, defina a variável de ambiente `ADMIN_PHONE` no Railway/Render (Settings → Variables) com o número exato usado no cadastro.
- **Contatos reais, com online/offline (🟢/⚪)** — todo usuário cadastrado no servidor aparece automaticamente na lista de conversas de todo mundo (não é preciso adicionar manualmente), com uma bolinha indicando se está ligado agora. As mensagens ficam salvas mesmo enviadas para quem está offline.
- **Grupos visíveis a todos** — qualquer grupo criado (botão 👥) aparece automaticamente para **todos os usuários cadastrados**, sem precisar de convite — funciona como um canal público. É guardado no servidor (`groups.json`), sobrevive a reinícios (mas não a redeploys — ver aviso abaixo).
- **Assistente de IA real (GitHub Models)** — a resposta automática do 🤖 Assistente IA deixou de ser um robô de palavras-chave e passou a usar a API gratuita da GitHub Models (a mesma infraestrutura do Copilot Chat). **Precisa de configuração** — ver secção abaixo.
- **Correção de chamadas/câmera no iPhone** — o Safari/iOS bloqueia por padrão a reprodução automática de áudio e vídeo que não seja resultado direto de um toque do usuário. Como isso acontecia bem depois do clique (só depois da negociação da chamada terminar), a chamada conectava mas ficava muda e com o vídeo preto no iPhone — parecia que "não funcionava". Agora, se isso acontecer, aparece um aviso "🔊 Toque para ativar o áudio e o vídeo" na tela da chamada — um toque resolve. Também adicionámos `webkit-playsinline` (compatibilidade com iOS mais antigo) e um aviso claro para quando o iPhone não suporta a transmissão de vídeo compartilhado em tempo real (limitação do Safari, não do app — nesse caso o vídeo compartilhado ainda toca localmente).
- **Localização em tempo real (📍, no cabeçalho da conversa)** — usa o GPS do próprio dispositivo (funciona em qualquer telemóvel ou computador) e mostra num mapa (OpenStreetMap, gratuito, sem chave) a posição de quem estiver a partilhar na conversa, com o **trajeto (rota)** desenhado no mapa e uma estimativa do **meio de transporte** (a pé, bicicleta/trânsito, veículo) calculada pela velocidade entre os pontos. Não fica gravado no servidor — é só "ao vivo", como a localização em tempo real do WhatsApp.

### Sobre o visual "estilo WhatsApp"

As cores do app (fundo escuro, verde de destaque, bolhas de mensagem) já foram desenhadas a partir da paleta oficial do WhatsApp Web no modo escuro — não foi preciso mudar a estrutura para isso. As funcionalidades extra (tradutor, quadro branco em tempo real, chat ao lado da videochamada, música partilhada na chamada, localização com trajeto, assistente de IA real, admin, transportes em tempo real) já vão além do que o WhatsApp oferece.

## Transportes em tempo real (🚌, no cabeçalho)

Três separadores num mapa (Leaflet + OpenStreetMap, gratuito, sem chave):
- **🚌 Autocarros** — posição ao vivo de cada autocarro da Carris Metropolitana (Área Metropolitana de Lisboa), via API oficial gratuita e sem chave.
- **✈️ Aviões** — tráfego aéreo ao vivo sobre Portugal e Espanha, via OpenSky Network (gratuita, sem chave, uso razoável).
- **🚇 Metro/Comboio** — mostra a localização das estações de Metro de Lisboa e das estações de comboio, mas **sem posição ao vivo** dos veículos (nem o Metro de Lisboa nem a CP/Renfe têm uma API gratuita e sem registo para isso — ver nota abaixo).

### Se quiseres dados ao vivo do Metro de Lisboa
O Metro de Lisboa tem uma API oficial pública (`api.metrolisboa.pt`), mas exige registo próprio (é um portal de API, tipo "API Store"). Se quiseres, posso integrar assim que tiveres uma chave — o processo seria parecido com o que fizeste para o `GITHUB_TOKEN`. Comboios (CP) e Renfe (Espanha) não têm API pública fiável, gratuita ou paga, disponível para uso comunitário — nesses casos o mais realista é linkar para os sites oficiais (cp.pt / renfe.com) em vez de simular dados.

## Novidades nas mensagens

- **Responder a uma mensagem (↩️)** — toca no ícone por baixo de qualquer mensagem para responder a ela; aparece uma citação da mensagem original.
- **Apagar mensagem (🗑️)** — apaga para todos (só nas tuas próprias mensagens); fica um aviso "Mensagem apagada" no lugar.
- **Reações (😀)** — reage com 👍❤️😂😮😢🙏, aparecem como selos por baixo da mensagem.
- **"a escrever..."** — aparece no subtítulo da conversa quando a outra pessoa está a digitar.
- **Confirmação de leitura (✓/✓✓)** — ✓ cinzento quando enviada, ✓✓ azul quando a outra pessoa abre a conversa e lê.

### Ainda por vir (próxima entrega)
Áudios (mensagens de voz), fotos/documentos no chat, PWA (instalar como app + notificações), foto de perfil, bloquear utilizadores.


### Como ativar o Assistente de IA (GitHub Models)

1. Cria um Personal Access Token em https://github.com/settings/tokens (não precisa marcar nenhum scope especial para uso básico dos modelos).
2. No Railway/Render, vai a Settings → Variables e adiciona `GITHUB_TOKEN` com o valor do token.
3. (Opcional) Define `GITHUB_MODEL` para escolher outro modelo — o padrão é `openai/gpt-4o-mini`. Lista de modelos disponíveis: https://github.com/marketplace/models
4. Sem o `GITHUB_TOKEN` configurado, o chat da IA continua a funcionar mas mostra um aviso a pedir a configuração, em vez de travar.

### Sobre os arquivos `messages.json`, `users.json` e `groups.json`

Todos são criados automaticamente pelo servidor e **não devem ser enviados ao GitHub** (já estão no `.gitignore`). Como nos serviços gratuitos o disco é recriado a cada novo deploy, um `git push` novo apaga o histórico de conversas, a lista de usuários cadastrados e os grupos criados. Para persistência permanente entre deploys, o próximo passo é trocar por um banco de dados real (ex: Postgres, oferecido como plugin no Railway).


