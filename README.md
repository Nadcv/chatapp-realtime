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
- **TURN** — retransmite a mídia quando os dois lados estão atrás de NAT/roteadores
  restritivos (a situação mais comum entre redes diferentes, ex: um no Wi-Fi de
  casa e outro no 4G). Sem TURN fiável, as chamadas ligam mas ficam com "Ligação
  instável — a tentar recuperar", vídeo preto e sem som.

Por padrão usa o TURN público e gratuito do OpenRelay — funciona, mas é partilhado
por muita gente e fica sobrecarregado, causando quedas de ligação. **Recomendo
configurar um TURN dedicado (grátis, sem cartão):**

1. Cria uma conta grátis em https://dashboard.metered.ca/register (não pede cartão)
2. No painel, cria uma aplicação e copia o **nome da aplicação** (ex.: `oteuapp` de `oteuapp.metered.live`) e a **API Key**
3. No Railway/Render, define `METERED_APP_NAME` (o nome da aplicação) e `METERED_API_KEY` (a chave)
4. Sem essas variáveis, continua a usar o TURN público partilhado — nunca trava, só fica menos fiável

Se preferires, também dá para usar o **Cloudflare Realtime** (TURN com cota generosa, mas pede cartão associado à conta mesmo no plano grátis) — define `CF_TURN_KEY_ID` e `CF_TURN_API_TOKEN`. A prioridade é: Cloudflare (se configurado) → Metered.ca (se configurado) → TURN público partilhado.

Para uso ainda maior, dá para migrar para o teu próprio servidor **coturn** (open-source, instala num VPS).

## Estrutura

- `server.js` — servidor Express + Socket.IO (mensagens em tempo real,
  sinalização WebRTC e proxy do tradutor)
- `index.html` — frontend completo (interface, lógica do chat, chamadas)
- `package.json` — dependências

## Novidades desta versão

- **Responsividade no telemóvel corrigida** — o app usava `100vh`, que nos navegadores móveis conta a barra de endereço como espaço de ecrã, escondendo conteúdo até rodar o telemóvel. Trocado por `100dvh` (altura real visível). Também corrigido um desalinhamento no quadro branco (o desenho tinha resolução fixa 600×400 mas era mostrado mais pequeno no telemóvel, fazendo o traço não seguir o dedo corretamente).
- **Aviões mundiais** — a aba de Transportes já não fica presa a Portugal/Espanha: consulta a área do mapa que estiveres a ver, em qualquer parte do mundo (OpenSky Network). Nota: a OpenSky gratuita tem uma cota diária baixa, por isso só pede a área visível (não o mundo inteiro de cada vez).
- **Sala "Conduzir e Ouvir" (🚗)** — inspirada no driveandlisten.app: escolhe uma cidade (Lisboa, Paris, Londres, Nova Iorque, Tóquio, por agora) e vê um vídeo de condução pela cidade enquanto ouves uma rádio real do país, obtida ao vivo pela Radio Browser (base de dados aberta e mundial de rádios, sem chave). Tem controlo de tocar/pausar e volume. Para adicionar mais cidades, edita `DRIVE_LISTEN_CITIES` em `server.js` — só precisas de um ID de vídeo do YouTube (condução pela cidade) e do nome do país.
- **Comboios/metros** — mantidos com estações reais (sem posição ao vivo dos veículos): tentámos usar o mesmo tipo de dados que o comboios.ruicosta.pt usa, mas esse é um endpoint interno e não documentado da CP — só é possível descobrir inspecionando o tráfego de rede ao vivo no navegador (não algo que dá para automatizar à distância). Fica como possível melhoria futura, se alguém conseguir capturar e partilhar esse endereço.

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
O Metro de Lisboa tem uma API oficial pública (`api.metrolisboa.pt`), mas exige registo próprio (é um portal de API, tipo "API Store"). Se quiseres, posso integrar assim que tiveres uma chave — o processo seria parecido com o que fizeste para o `GITHUB_TOKEN`. A CP (Comboios de Portugal) e a Renfe (Espanha) não têm posição ao vivo dos comboios disponível gratuitamente — a CP publica os **horários programados** (não a posição em tempo real) em formato aberto GTFS através do portal de dados abertos português; dá para mostrar "que comboio parte a que horas de que estação" sem ser ao vivo, mas é mais trabalho (implica processar ficheiros GTFS) e fica para uma fase seguinte, se quiseres. A Renfe não disponibiliza nada de aberto/gratuito.

## Novidades nas mensagens

- **Responder a uma mensagem (↩️)** — toca no ícone por baixo de qualquer mensagem para responder a ela; aparece uma citação da mensagem original.
- **Apagar mensagem (🗑️)** — apaga para todos (só nas tuas próprias mensagens); fica um aviso "Mensagem apagada" no lugar.
- **Reações (😀)** — reage com 👍❤️😂😮😢🙏, aparecem como selos por baixo da mensagem.
- **"a escrever..."** — aparece no subtítulo da conversa quando a outra pessoa está a digitar.
- **Confirmação de leitura (✓/✓✓)** — ✓ cinzento quando enviada, ✓✓ azul quando a outra pessoa abre a conversa e lê.

### Ainda por vir
Linha de comboios/metro ao vivo — sem solução gratuita e fiável disponível (ver secção de Transportes); PWA (instalar como app + notificações); foto de perfil.

## Correção: chamadas que ligavam mas não davam para falar

Encontrei duas causas distintas para isto:

1. **TURN sobrecarregado.** O app usa um serviço gratuito e partilhado (openrelay) para ajudar duas pessoas a ligarem-se quando ambas estão atrás de router/NAT normal — é o caso mais comum. Esse serviço gratuito é usado por muita gente ao mesmo tempo e pode ficar lento ou recusar ligações em picos de utilização, o que faz a chamada "ligar" na sinalização (por isso o cronómetro arranca) mas o áudio/vídeo nunca chega a fluir de verdade.

   **Correção aplicada:** o app agora deteta quando isto acontece (ligação que cai ou nunca chega a "connected" de verdade) e tenta recuperar sozinho automaticamente. Além disso, se quiseres uma solução bem mais fiável e ainda gratuita (até 1TB/mês), podes ligar o TURN da Cloudflare:
   1. Cria uma conta grátis em https://dash.cloudflare.com
   2. Vai a "Calls" no menu → cria uma "TURN key"
   3. No Railway/Render, define as variáveis de ambiente `CF_TURN_KEY_ID` (o Token ID) e `CF_TURN_API_TOKEN` (o API token)
   4. Sem essas variáveis, o app continua a funcionar com o TURN gratuito partilhado de sempre — só é menos estável em horas de pico.

2. **Sem deteção de falha.** Antes, se a ligação caísse a meio, o ecrã ficava preso em "Conectado ✅" para sempre, sem nenhum aviso. Agora mostra "⚠️ Ligação instável" ou "🔄 A tentar reconectar..." e tenta recuperar sozinho.

## Correção: algumas conversas "não conseguiam desencriptar"

Esta era uma falha de tempo (race condition), não uma perda de dados real. A chave de encriptação do dispositivo demorava uns instantes a ficar pronta depois do login, mas o pedido do histórico das conversas podia chegar antes disso — nesses casos a mensagem aparecia como "não foi possível desencriptar" mesmo sendo perfeitamente decifrável, só porque a chave ainda não estava pronta no momento exato em que a mensagem chegou. Corrigido: agora qualquer tentativa de desencriptar espera sempre a chave estar pronta primeiro.

Isto não cobre o outro cenário (documentado desde o início): se abrires a conversa num dispositivo ou navegador diferente, esse aparelho gera uma chave nova, e mensagens antigas cifradas com a chave anterior continuam ilegíveis nesse aparelho novo — isso é esperado, não é bug.


## IA que trabalha por ti

- **📝 Resumir conversa** — botão no cabeçalho da conversa; pede à IA (GitHub Models) um resumo das últimas mensagens.
- **🎤 Transcrição de mensagens de voz** — ao gravar um áudio, se o navegador suportar (Chrome/Android; suporte limitado no Safari), corre em paralelo um reconhecimento de fala e guarda a transcrição junto da mensagem.
- **💬🌐 Legendas ao vivo traduzidas nas chamadas** — botão na barra da chamada; transcreve o que dizes em tempo real e mostra à outra pessoa já traduzido para o idioma que ela escolheu no tradutor. Depende do reconhecimento de fala do navegador (melhor suporte no Chrome/Android; limitado no Safari/iPhone).

## Cargos e moderação em grupos

Quem cria um grupo torna-se automaticamente administrador (👑, botão no cabeçalho do grupo, só visível para admins). Um admin pode:
- Promover alguém a **moderador** ou **administrador**
- **Silenciar** uma pessoa (impede-a de escrever, mas continua a ver o grupo)
- **Remover** alguém do grupo (deixa de o ver na lista de conversas)

Moderadores podem silenciar/reativar, mas só administradores podem promover ou remover pessoas. O criador do grupo nunca pode ser removido.

## "A caminho" — ETA automático

Quando duas pessoas estão a partilhar localização em tempo real na mesma conversa (📍), o app calcula automaticamente a distância e o tempo estimado de chegada de cada uma até à outra, com base na velocidade atual (ou uma estimativa de caminhada, se estiver parada). Aparece por baixo do mapa, atualizado a cada posição nova.

## Encriptação ponta-a-ponta (conversas 1-para-1)

Cada dispositivo gera o seu próprio par de chaves (ECDH, via Web Crypto API nativa do navegador — sem bibliotecas externas). A chave privada nunca sai do aparelho; o servidor só guarda e vê a chave pública, que é seguro partilhar. Quando escreves a alguém pela primeira vez, os dois lados combinam a chave privada de um com a pública do outro para chegar à mesma chave secreta, usada para cifrar as mensagens com AES-GCM — o servidor só vê texto cifrado.

**Importante ser honesto sobre os limites disto:**
- Só protege conversas **1-para-1** — grupos e o Assistente de IA continuam sem encriptação nesta versão (ficou para uma fase seguinte, por ser bem mais complexo de fazer em segurança).
- Só o **texto** é encriptado — fotos, documentos e áudios ainda não.
- A chave fica presa a este navegador/dispositivo. Se entrares noutro telemóvel ou computador, gera-se um par de chaves novo, e as mensagens antigas cifradas com a chave anterior deixam de poder ser lidas nesse aparelho novo.
- Não há verificação de "número de segurança" (como no Signal/WhatsApp) nem troca de chaves com rotação por mensagem — é encriptação real, mas mais simples do que a de apps especializados em privacidade.


## Correção crítica: chamadas que não ligavam dos dois lados

Encontrei a causa: quando alguém recebia uma chamada, os primeiros "candidatos ICE" (a informação de rede que o WebRTC troca para encontrar o melhor caminho entre os dois aparelhos) chegavam **antes** de existir a ligação para os receber, e eram silenciosamente descartados. Isto acontecia com mais frequência em redes móveis (4G/5G) e é a explicação mais provável para "um lado mostra o cronómetro e o outro fica preso em Conectado". Agora esses candidatos ficam numa fila e são aplicados assim que a ligação é criada.

Também troquei o `confirm()` do navegador (uma caixa de diálogo simples) por um ecrã de chamada a chegar com botões reais de Aceitar/Recusar — assim o pedido de acesso à câmara/microfone parte diretamente de um toque genuíno do usuário, o que ajuda a evitar bloqueios de permissão no Safari/iPhone.

## Chamadas em grupo de verdade

A "Conferência" antes usava a mesma ligação 1-para-1 de sempre (só funcionava entre 2 pessoas, mesmo em grupos). Agora, para grupos, cada participante liga diretamente a todos os outros que já estão na chamada (uma "malha" de ligações) — funciona bem até **cerca de 6-8 pessoas com vídeo ligado**. Quando alguém inicia uma chamada num grupo, os outros membros recebem um aviso para entrar. Passar disto (dezenas de pessoas) exigiria um servidor central de vídeo (SFU), que não existe numa opção gratuita — se um dia precisares de mais participantes em simultâneo, terias de contratar um serviço deste tipo.

## Fotos, documentos e mensagens de voz

- **📎 Fotos e documentos** — botão ao lado da caixa de mensagem, limite de **10MB** por ficheiro.
- **🎤 Mensagens de voz** — toca para começar a gravar, toca outra vez para enviar (limite de 2 minutos por mensagem).

**Aviso sobre armazenamento:** fotos e áudios ficam guardados como parte da própria mensagem no `messages.json` do servidor. Como o histórico atual guarda até 200 mensagens por conversa, muitas fotos grandes podem fazer esse ficheiro crescer bastante. Não é um problema para uso normal, mas se um dia sentires o servidor lento ou o disco a encher, o próximo passo seria guardar os ficheiros à parte (ex: num serviço de armazenamento como o Cloudinary ou AWS S3) em vez de embutidos na mensagem.



### Como ativar o Assistente de IA (Gemini)

A GitHub retirou por completo o **GitHub Models** a 30 de julho de 2026 (o serviço deixou de existir, não é possível voltar a usá-lo) — por isso o contacto "🤖 Assistente IA" que usava esse serviço foi removido da app. O assistente de IA agora é só o **"✨ Gemini"**, que já suportava tudo o mesmo (texto, fotos, vídeos e documentos):

1. Cria uma conta gratuita em https://aistudio.google.com/apikey e gera uma API key.
2. No Railway/Render, vai a Settings → Variables e adiciona `GEMINI_API_KEY` com o valor da chave.
3. (Opcional) Define `GEMINI_MODEL` para escolher outro modelo — o padrão é `gemini-flash-latest` (um "alias" que a Google mantém sempre a apontar para a versão Flash mais recente, para a app não voltar a partir se um modelo específico for desativado).
4. Sem o `GEMINI_API_KEY` configurado, o chat da IA continua a abrir mas mostra um aviso a pedir a configuração, em vez de travar.

### Sobre os arquivos `messages.json`, `users.json` e `groups.json`

Só são usados como **reserva** quando não tens uma base de dados MongoDB ligada (ver secção seguinte). Nesse caso, não devem ser enviados ao GitHub (já estão no `.gitignore`) e os dados apagam a cada novo deploy nos serviços gratuitos.

## Base de dados MongoDB (persistência permanente)

O servidor já suporta gravar tudo (contas, conversas, grupos) numa base de dados MongoDB gratuita, que **sobrevive a atualizações e redeploys** — ao contrário dos ficheiros locais.

1. Cria uma conta grátis em https://www.mongodb.com/cloud/atlas/register
2. Cria um cluster gratuito (M0 — grátis para sempre, 512MB, sem cartão de crédito)
3. Em "Database Access", cria um utilizador com password
4. Em "Network Access", permite o acesso de qualquer IP (`0.0.0.0/0`) — necessário porque o Railway/Render não tem IP fixo
5. Em "Connect" → "Drivers", copia a "connection string" (parece com `mongodb+srv://utilizador:password@cluster0.xxxxx.mongodb.net/`)
6. No Railway/Render, define a variável de ambiente `MONGO_URI` com esse valor

Sem essa variável, o app continua a funcionar normalmente com os ficheiros locais de sempre (não obriga a nada).

**Correções importantes feitas nesta versão** (encontrei estes bugs a rever o código):
- Faltava o pacote `mongoose` no `package.json` — o servidor falharia logo ao arrancar num deploy novo, mesmo com tudo bem configurado.
- O esquema da base de dados não guardava alguns campos importantes — mensagens encriptadas (ponta-a-ponta) perdiam o texto cifrado, e fotos/áudios perdiam o nome e tipo do ficheiro, sempre que o servidor reiniciava.
- Quando a base de dados NÃO estava configurada, o histórico de mensagens e os grupos eram gravados em disco mas nunca recarregados ao reiniciar (só funcionava gravar, nunca ler de volta).
- O servidor começava a aceitar pedidos antes de a base de dados terminar de ligar, o que podia fazer os primeiros registos a seguir a um reinício irem parar ao sítio errado.

Todos corrigidos.

## Procurar por nome de utilizador (🔍)

Antes, todas as pessoas cadastradas apareciam automaticamente na lista de conversas de toda a gente. Agora, tal como no WhatsApp/Telegram, só apareces na lista de alguém se: (a) essa pessoa te procurar pelo teu nome de utilizador (@username, escolhido no registo) e escolher "Iniciar conversa", ou (b) já lhe tiveres mandado uma mensagem antes (assim consegues sempre responder a quem te escreve, mesmo sem te terem procurado). Ninguém consegue "navegar" e ver a lista de todos os utilizadores — só encontra quem já sabe o nome de utilizador exato.

## Mensagens de voz até 4 minutos

Aumentado de 2 para 4 minutos por mensagem, como pedido.

## Barra de ícones do cabeçalho agora desliza para o lado

Com tantos ícones acumulados (tradutor, música, grupos, chamadas, admin, pesquisa, transportes, conduzir e ouvir), a barra ficava cortada em ecrãs pequenos. Agora desliza horizontalmente.

## Correção: vídeos "indisponível" no Conduzir e Ouvir (Portugal, Tóquio, França)

A causa real não era só os vídeos em si — era o leitor não ter **nenhuma deteção de erro**. Quando um vídeo do YouTube deixa de estar disponível (o dono remove, desativa a partilha/incorporação, etc.), isso vai continuar a acontecer de vez em quando no futuro, com qualquer vídeo. Por isso, em vez de só trocar os IDs (o que resolvia hoje mas voltaria a acontecer mais tarde), também corrigi a causa:
- Cada cidade agora tem um **vídeo alternativo** — se o principal falhar, tenta automaticamente o segundo antes de desistir.
- Se mesmo assim falhar, aparece uma mensagem clara a convidar a escolher outra cidade, em vez de ficar preso sem explicação.
- Também troquei o vídeo de Portugal, Tóquio e França por uns verificados e mais recentes.

## Sala de Realidade Virtual — já existia! 🕶️

Boas notícias: esta funcionalidade **já estava construída** (avatares em 3D, cada pessoa com o seu boneco e nome, movimento com WASD/setas no computador ou um manípulo virtual no telemóvel, câmara que segue o teu avatar). Só não tinha sido usada ainda. Para a encontrar:

1. Abre uma **conversa de grupo** (só funciona em grupos, não em conversas 1-para-1)
2. No cabeçalho da conversa, toca no ícone 🕶️
3. Todos os que estiverem no mesmo grupo e abrirem a sala ao mesmo tempo veem-se uns aos outros a mover-se pelo espaço 3D

(Tinha uma segunda versão desta funcionalidade duplicada e incompatível no código, que teria causado um erro ao arrancar o servidor — removida.)

## A IA agora vê fotos e "ouve" mensagens de voz

- **📷 Fotos** — envia uma foto na conversa do 🤖 Assistente IA e ela descreve o que vê / responde a perguntas sobre a imagem (usa visão multimodal do modelo, via GitHub Models).
- **🎤 Mensagens de voz** — durante a gravação, o navegador tenta transcrever automaticamente o que disseste (Chrome/Android tem bom suporte; Safari/iPhone é mais limitado). Essa transcrição aparece por baixo do áudio em qualquer conversa, e é isso que a assistente de IA "lê" quando lhe envias uma mensagem de voz. Se o navegador não conseguir transcrever, a IA avisa que não conseguiu perceber o áudio, em vez de inventar uma resposta.

## Apagar grupos

Só quem **criou** o grupo (não basta ser administrador promovido) pode apagá-lo — botão 🗑️ no painel de gestão (👑), disponível só para o criador. Apaga o grupo e todo o histórico de mensagens dele, para sempre. Pede confirmação antes.


O ChatApp agora pode ser **instalado no ecrã inicial** do telemóvel ou computador, como uma app nativa:
- **Android (Chrome)**: menu (⋮) → "Instalar aplicação" ou "Adicionar ao ecrã principal"
- **iPhone (Safari)**: botão de partilha → "Adicionar ao ecrã principal"
- **Computador (Chrome/Edge)**: ícone de instalação na barra de endereço

Depois de instalado, abre como uma janela própria (sem a barra do navegador) e já tem ícone.

**Notificações push** — ao entrares na app, é pedida autorização para notificações; se aceitares, passas a receber um aviso mesmo com a app fechada quando alguém te manda uma mensagem, tanto em conversas 1-para-1 como em grupos. As chaves necessárias (VAPID) são geradas automaticamente pelo servidor na primeira vez que arranca — não precisas de configurar nada.

### Notificações de grupo

Como os grupos funcionam como canais públicos (visíveis a todos os utilizadores cadastrados, ver secção acima), a notificação de uma mensagem de grupo alcança a mesma "audiência" que já recebe a mensagem ao vivo — todos os utilizadores registados, exceto quem enviou. Continua a respeitar quem **silenciou** aquele grupo especificamente (🔔 no cabeçalho da conversa) ou está em **"não incomodar"** — essas pessoas não recebem a notificação. Testei com 4 contas: quem silenciou o grupo não recebeu, quem enviou não recebeu (não faz sentido notificar-te da tua própria mensagem), e uma conta "normal" recebeu.

## Correção: erros da IA apareciam em inglês, sem traduzir

Acontecia nos dois assistentes:
- **Gemini** — quando sobrecarregado (erro 503, diferente do 429 de limite esgotado que já tinha mensagem em português), mostrava o texto de erro original da Google em inglês. Agora tem mensagem própria em português, e o servidor tenta automaticamente mais uma vez antes de desistir.
- **Assistente IA (GitHub Models)** — já tentava de novo sozinho em caso de sobrecarga (429/503), mas qualquer **outro** tipo de erro (ex.: pedido inválido) ainda mostrava o texto cru devolvido pela API, por vezes em inglês. Corrigido para sempre mostrar uma mensagem em português nesse caso, com o detalhe técnico só no log do servidor (para eu poder investigar se voltar a acontecer).

## Ficheiros em armazenamento externo (Cloudinary)

Por padrão, fotos/áudios/documentos continuam a ser guardados dentro da própria mensagem (em base64) — funciona sem configuração nenhuma, mas enche depressa os 512MB grátis do MongoDB Atlas. Se ligares o Cloudinary (gratuito até 25GB), os ficheiros passam a ficar lá guardados e a mensagem só leva o link, muito mais leve:

1. Cria uma conta grátis em https://cloudinary.com/users/register/free
2. No "Dashboard" principal, copia: **Cloud Name**, **API Key**, **API Secret**
3. Define as variáveis de ambiente `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` no Railway/Render

Sem essas variáveis, continua tudo a funcionar como antes.

## 🏃 Atividades (estilo Strava)

Nova aba no cabeçalho, com dois separadores:

- **📍 Registar** — escolhe corrida, caminhada ou bicicleta, toca em "Começar" e o telemóvel acompanha o percurso pelo GPS em tempo real (distância, tempo, ritmo/velocidade), desenhando a rota no mapa. Ao terminar, revê e guarda.
- **📰 Feed** — mostra as tuas atividades e as dos teus contactos (a mesma lista de "quem já falaste ou procuraste" usada no resto da app), com distância, tempo, velocidade média, e um botão de **👏 Kudos** (like) — toca outra vez para tirar. Também dá para ver a rota completa de qualquer atividade no mapa.

Guarda tudo na base de dados (MongoDB, se estiver ligado — ou ficheiro local `activities.json`, senão). As rotas são guardadas com uma amostragem dos pontos (não todos), para não pesarem demasiado.


## Editar mensagens enviadas (✏️)

Novo botão ao lado de "Apagar" — só nas tuas próprias mensagens de texto simples (não funciona em fotos/áudios/ficheiros, nem em conversas com encriptação ponta-a-ponta ativa, porque nesses casos o servidor nunca vê o conteúdo para poder validar e guardar a edição). Mensagens editadas ficam marcadas com "(editada)".

## 🎨 Aparência personalizável (cor + fundo das conversas)

A cor de destaque padrão deixou de ser o verde clássico de app de chat — agora é um violeta (`#7c5cff`), para o app ter uma identidade visual própria. No botão 🎨 do cabeçalho abre uma janela "Personalizar aparência" com duas secções:

- **Cor de destaque** — escolhe **qualquer cor** (seletor de cor nativo do navegador, com mistura livre de RGB) ou uma das 8 sugestões rápidas. Aplica-se ao vivo em toda a app: botões, bolhas de mensagem enviadas, marcadores no mapa, ícone da barra do navegador.
- **Fundo das conversas** — escolhe uma cor/gradiente pronto (Grafite, Meia-noite, Oceano, Pôr do sol, Floresta, Ameixa) ou envia a tua própria imagem (🖼️ Imagem personalizada) para usar como fundo por trás das mensagens.

**A escolha fica guardada na tua conta** (não só no aparelho) — faz login noutro telemóvel ou computador e a cor e o fundo aparecem automaticamente, sem precisar de configurar de novo. Cada secção tem o seu próprio botão "Repor padrão".

**Aviso sobre a imagem de fundo:** segue o mesmo aviso de armazenamento das fotos de perfil/mensagens — sem o Cloudinary configurado, a imagem fica guardada como base64 dentro da tua conta (ver secção "Ficheiros em armazenamento externo" abaixo), o que é normal para uso pessoal mas enche mais depressa os 512MB grátis do MongoDB Atlas se muitas pessoas usarem imagens grandes.

## 📰 Notícias (Portugal + Mundo + Futebol)

Novo botão 📰 no cabeçalho. Agrega notícias via RSS público (sem chave, sem scraping), com 3 abas:
- **🇵🇹 Portugal** — Público, Observador, RTP Notícias
- **🌍 Mundo** — BBC World, Euronews, CNN, RTP África, El País e ABC (Espanha), Le Monde (França), G1 (Brasil), Téla Nón (São Tomé e Príncipe)
- **⚽ Futebol** — Record

O servidor atualiza a lista sozinho a cada 10 minutos e, assim que sai uma notícia nova, avisa quem estiver ligado — com um toast dentro do ecrã de notícias, ou uma bolinha vermelha no ícone 📰 do cabeçalho se a pessoa estiver noutra parte da app — parecido com o Google Notícias. Tocar numa notícia abre-a dentro da própria app.

**Nota de honestidade:** as fontes RSS têm o endereço mais estável e conhecido de cada site, mas alguns sites mudam esse endereço de vez em quando sem avisar. Se alguma fonte aparecer sempre vazia (dá para ver no log do Railway: "⚠️ Erro ao obter notícias de X"), diz-me qual e arranjo o link novo — é só trocar uma linha em `NEWS_FEEDS` no `server.js`, as outras fontes continuam a funcionar normalmente enquanto isso.

## 🧮 Calculadora científica e gráfica

Novo botão 🧮 no cabeçalho, com duas abas:
- **🔢 Científica** — as operações básicas mais seno/cosseno/tangente (e as inversas), raiz quadrada, potência, logaritmo (base 10 e natural), π, e, alternância entre graus/radianos.
- **📈 Gráfica** — escreve uma função de `x` (ex.: `sin(x)`, `x^2`, `sqrt(x)+2`) e vê o gráfico desenhado ao vivo, com zoom (➕/➖) e arrastar para navegar pelo plano.

Os cálculos correm todos no teu aparelho (não precisa de internet nem passa pelo servidor) — foi escrito um pequeno interpretador de expressões matemáticas próprio para isto, em vez de usar `eval()`.

## 😂 Vídeos engraçados (feed estilo TikTok/Reels)

Novo botão 😂 no cabeçalho — um feed de vídeos engraçados do YouTube, em ecrã inteiro, que passa para o próximo ao deslizares para cima (ou no botão "⬆️ Próximo"), como no TikTok/Instagram Reels. Os vídeos tocam sem som por padrão (os navegadores exigem isso para autoplay) — toca em "🔈" para ativar o som.

A lista de vídeos é curada à mão, no mesmo espírito da lista de cidades do "Conduzir e Ouvir" (constante `FUNNY_VIDEOS` no `index.html`) — fica fácil de trocar/adicionar mais. **Nota de honestidade:** não tenho como testar ao vivo se cada vídeo específico ainda está disponível a partir daqui — mas se algum já não existir ou tiver a partilha desativada, o feed deteta o erro sozinho e salta automaticamente para o próximo, sem travar (o mesmo mecanismo já usado no "Conduzir e Ouvir"). Se algum vídeo não tocar, diz-me quais e eu troco.

## 🤳 Tirar self durante as chamadas

Novo botão 🤳 na barra da videochamada. Abre uma câmera de self por cima da tua própria imagem (espelhada, como uma câmera frontal normal), com:

- **Enquadramentos** — Quadrado, Retrato, Paisagem ou Original, para escolher o corte da foto como numa câmera de telemóvel de verdade.
- **Filtros ao vivo** — Normal, P&B, Sépia, Vívido, Frio, Quente, Suave, Vintage e Negativo — aplicados em tempo real na pré-visualização antes de tirar a foto.

Depois de tirar a foto: dá para **repetir**, **guardar no aparelho** ou **enviar direto na conversa** (aparece como uma foto normal, com o mesmo mecanismo de armazenamento — Cloudinary se estiver configurado, senão base64).

## 🔥 Incêndios em tempo real (Portugal + mundo)

Novo botão 🔥 no cabeçalho: mapa com os focos de incêndio detetados por satélite nas últimas 24h, em qualquer parte do mundo (incluindo Portugal), via **NASA FIRMS** — o mesmo tipo de dados que alimenta a maioria dos mapas de incêndios usados por jornais e serviços de emergência. Tal como os aviões/autocarros, pede só a área do mapa que estás a ver (não o mundo inteiro de cada vez), com um botão 🔄 para atualizar.

**Precisa de configuração** (grátis):
1. Pede uma chave gratuita em https://firms.modaps.eosdis.nasa.gov/api/map_key/ (só um email, sem cartão de crédito)
2. No Railway/Render, define a variável de ambiente `NASA_FIRMS_KEY` com essa chave
3. Sem essa variável, o ecrã mostra um aviso claro a pedir a configuração, em vez de travar

**Sobre "ligar/enviar SMS aos bombeiros":** por segurança, isto **não é** um despacho automático real de emergência — não existe nenhuma API pública que ligue de verdade aos bombeiros, e fingir que sim seria perigoso (alguém podia achar que já alertou a emergência e não ligar a sério). Em vez disso:
- **🚨 Ligar 112** — botão que abre logo o telefone a marcar o 112 (número de emergência europeu, cobre Portugal), a pessoa só toca em ligar. Real, sem depender de nenhuma API.
- **✉️ SMS** — escreves um número teu (um familiar, ou o número local dos bombeiros que já saibas) e o botão abre a app de SMS do telemóvel já preenchida com a tua localização atual — revês e envias tu mesmo, não é automático.
- **📧 Email real** — diferente do SMS, este é enviado de verdade pelo próprio servidor (não abre nada no teu telemóvel) para o endereço que escreveres, com a tua localização. Precisa de uma conta de email configurada no servidor (grátis):
  1. Numa conta Gmail (pode ser uma só para isto), ativa a verificação em 2 passos e cria uma **"Palavra-passe de aplicação"** em https://myaccount.google.com/apppasswords (a palavra-passe normal da conta não funciona aqui, tem de ser esta)
  2. No Railway/Render, define `EMAIL_USER` (o teu email Gmail) e `EMAIL_PASS` (a palavra-passe de aplicação de 16 letras)
  3. (Opcional) Se preferires usar outro serviço de email em vez do Gmail, define também `SMTP_HOST` e `SMTP_PORT`
  4. Sem essas variáveis, o botão mostra um aviso claro a pedir a configuração, em vez de travar

## 📖 Notícias abrem dentro da própria app — agora com Modo Leitura de verdade

Tocar numa notícia (📰) abre uma leitura dentro da própria app (com botão ← para voltar e 🔗 para abrir no navegador se preferires).

**Primeira versão** mostrava o site original num iframe — mas muitos sites bloqueiam deliberadamente aparecer dentro de outras apps (proteção contra "clickjacking", uma medida de segurança do próprio site). Como essa proteção é enviada pelo servidor do site (não dá para "contornar" no navegador), a solução foi mudar de abordagem: agora o **próprio servidor do ChatApp** vai buscar a notícia, extrai só o artigo — título, texto, imagens, sem menus/anúncios/rodapé — com o **Readability** (a mesma biblioteca por trás do Modo Leitura do Firefox), e limpa o resultado com o **DOMPurify** antes de mostrar (remove qualquer `<script>` ou código que possa vir escondido na página, por segurança). Isto funciona para qualquer site, independentemente da proteção anti-iframe dele.

Se a extração falhar nalguma notícia específica (ex.: página com formato muito atípico, ou o site bloquear pedidos automáticos), a app volta sozinha ao iframe de antes como reserva — e se mesmo esse não aparecer, fica sempre o botão 🔗 para abrir no navegador normal.

**Correção:** alguns sites (ex.: RTP) recusavam ou devolviam uma página vazia aos pedidos do servidor, por não se parecerem com um pedido de um navegador real — o pedido usa agora um User-Agent e cabeçalhos completos de um Chrome normal, em vez de se identificar como um robô genérico. Se ainda assim alguma fonte específica continuar a falhar sempre (dá para ver no log do Railway: "Erro no modo leitura (URL): ..."), diz-me qual e o motivo exato do log, que investigo mais a fundo — pode ser um site com proteção mais forte (Cloudflare) ou que só renderiza o conteúdo com JavaScript no lado do cliente, casos em que a extração no servidor tem limites reais.

## 🎨 Quadro branco partilhado com todos numa chamada de grupo

O quadro branco (🎨 na barra da chamada) já era sincronizado ao vivo entre quem estava na chamada — o que faltava era: quem abrisse o quadro a meio de uma chamada de grupo via um quadro **vazio**, mesmo que os outros já tivessem desenhado bastante. Agora o servidor guarda o histórico de traços de cada sala (só em memória, como um rascunho — não fica gravado para sempre) e, ao abrir o quadro, cada pessoa recebe automaticamente tudo o que já foi desenhado até ali, antes de continuar a ver os traços novos ao vivo. Testei com dois utilizadores: um desenha sozinho no grupo, o outro entra depois e abre o quadro — recebe exatamente o mesmo desenho.

## 🔤 Tradutor rápido (extra, dentro do 🌐 Idioma do Tradutor)

O modal 🌐 (Idioma do Tradutor) ganhou uma segunda secção, separada da escolha da língua das mensagens: um tradutor de texto livre, tipo Google Tradutor. De um lado escolhes Português ou Inglês, do outro qualquer um dos idiomas já suportados (Espanhol, Chinês, Hindi, Árabe, Francês, Russo, Alemão, Japonês, Italiano...). Escreves e a tradução aparece sozinha (com uma pequena pausa depois de parares de escrever), e o botão 🔄 troca os dois lados de uma vez (incluindo o texto já traduzido). Usa o mesmo `/api/translate` que já existia para traduzir mensagens — não precisa de configuração nem chave nova.

Duas adições a este tradutor rápido:
- **🎤 Gravar áudio**: em vez de escrever, dá para gravar a voz — a mesma transcrição em tempo real (Web Speech API) já usada nas mensagens de voz do chat é reaproveitada aqui, só que o texto reconhecido cai direto no campo de origem e traduz automaticamente assim que a gravação termina. Funciona bem no Chrome/Android; no Safari/iPhone o suporte é limitado (avisa se o navegador não tiver a API disponível, em vez de falhar silenciosamente).
- **📋 Copiar tradução**: copia o texto traduzido para a área de transferência com um toque, para colar noutro sítio (WhatsApp, e-mail, etc.).

## 🧭 Navegação GPS agora é para o mundo inteiro

A "Navegação GPS" (🧭 no cabeçalho) já existia — rota com voz, alternativas de rota, e um sistema completo de alertas em tempo real reportados por quem usa a app (🚓 Polícia, 💥 Acidente, 🚧 Obras, 🐌 Trânsito, ⚠️ Perigo, 📷 Radar — tudo já sincronizado ao vivo entre todos os utilizadores via socket, com confirmação/remoção comunitária, como no Waze). Só a pesquisa de endereços estava travada a Portugal e Espanha — removida essa restrição, a pesquisa e a rota (OSRM, que já cobria o mundo todo) funcionam agora em qualquer país.

**Importante ser honesto:** os alertas de trânsito/polícia/etc. só têm valor real onde houver gente da tua app a reportar — ao contrário do Waze (milhões de utilizadores), aqui os alertas dependem só da tua comunidade de usuários. A rota e a navegação por voz funcionam perfeitamente em qualquer lugar do mundo independentemente disso.

## Correção: grupos podiam desaparecer depois de um reinício

Encontrei a causa: cinco pontos do servidor (criar grupo, promover/despromover, silenciar, remover e desbanir membro) gravavam no MongoDB sem tratar erro. Se essa gravação falhasse por qualquer instabilidade passageira da base de dados, o **servidor inteiro caía** (o Node.js termina o processo por padrão quando uma escrita destas falha sem tratamento) — e o grupo, que já tinha sido criado na memória mas nunca chegou a salvar no banco de dados, desaparecia no reinício seguinte. Corrigido, junto com o mesmo problema em apagar mensagem e reagir a mensagem.

## Já estavam prontos (confirmado nesta revisão, não precisaram de trabalho novo)

- **Apagar grupos** — só quem criou o grupo pode apagá-lo (não basta ser administrador promovido); apaga também todo o histórico de mensagens desse grupo
- **IA analisa fotos e áudios** — quando envias uma foto ao 🤖 Assistente IA, ela descreve o que vê; quando envias um áudio, ela lê a transcrição automática captada durante a gravação

## 📢 Listas de transmissão

Novo botão 📢 no cabeçalho, com aba própria. Cria uma lista com vários contactos (ex.: "Família", "Clientes") e, quando envias uma mensagem para essa lista, cada pessoa recebe-a como uma conversa privada normal — tal como no WhatsApp, ninguém vê quem mais está na lista, nem vê as respostas dos outros; as respostas que cada pessoa der voltam só para ti, numa conversa 1-para-1 normal.

- Criar, editar (nome e membros) e apagar listas, a partir dos teus contactos já adicionados
- As tuas listas ficam guardadas no servidor associadas ao teu número — aparecem em qualquer sessão onde entres
- Tecnicamente não cria nenhuma sala nova: ao enviar, o cliente reaproveita o envio normal de mensagem 1-para-1 (incluindo a encriptação ponta-a-ponta quando o contacto a suporta) uma vez por cada membro da lista — por isso não é pensado para listas muito grandes, já que N destinatários geram N mensagens/notificações individuais

## 📺 TV em Direto (notícias) + 🎬 Filmes por género

Novo botão 📺 no cabeçalho, com aba própria e duas categorias:

- **📰 Notícias (ao vivo)** — Euronews em Português (🇵🇹), Euronews en Español (🇪🇸), France 24 (🇫🇷), TVS — São Tomé e Príncipe (🇸🇹, via site oficial `tvs.st`), Record News (🇧🇷), DW Español (🇩🇪) e El Doce — Córdoba, Argentina (🇦🇷). A maioria usa o endpoint público do YouTube que resolve sozinho "o que está em direto agora" naquele canal — não dependemos de um vídeo específico que muda a cada transmissão.
  - Chegámos a esta lista depois de testar várias emissoras públicas mais pequenas (TVS, TPA, RTC, TVM, RTTL, Record Europa, TVG, TV Aparecida, RTVE) — a maioria não transmite mesmo pelo sistema de Live 24h do YouTube (dá "vídeo não disponível"), ou está bloqueada por região. Os 6 que ficaram são os que se confirmou funcionarem de verdade.
  - Não incluí a **TDM (Macau)**, a **TV Girassol** nem a **TVOne** — não consegui confirmar um canal de YouTube fiável para nenhuma delas.
  - **Recusei adicionar** conteúdo infantil com direitos de autor válidos (PJ Masks, Miraculous, Blippi, Disney Channel, Disney Jr) que foi pedido a par destes canais — não há forma legal e gratuita de os disponibilizar, tal como já tinha explicado sobre a série "Mentalista".
- **🎬 Filmes (escolher e ver)** — em vez de um canal "ao vivo", é uma lista por género (😂 Comédia, 🚀 Ficção Científica, 🎭 Clássicos e Noir) com filmes de **domínio público** (direitos de autor já expirados), servidos pelo Internet Archive — o arquivo público oficial, com suporte nativo a incorporação (`archive.org/embed/<id>`).

**Porque é que filmes ficaram "escolher e ver" em vez de "canal ao vivo":** tentei primeiro canais de filmes/séries e jogos tipo FAST (FilmRise, ESTV) da mesma forma que as notícias, mas nenhum funcionou — a maioria desses canais "24h grátis" transmite através da app/site deles ou de plataformas como Pluto TV/Tubi, e não usa mesmo o sistema de Live do YouTube, só tem um canal de YouTube normal ao lado. Pensei em ir buscar diretamente aos streams da Pluto TV/Tubi, mas isso exigiria imitar a app deles com tokens que expiram e partem sempre que mudam algo do lado deles — uma gambiarra frágil que prefiro evitar. O Internet Archive resolve isto de forma limpa: é o arquivo de domínio público oficial, os filmes lá estão mesmo disponíveis para incorporação, sem token nem autenticação.

- Só coloquei conteúdo **gratuito e licenciado de verdade** — emissoras oficiais para as notícias, filmes de domínio público confirmado para o cinema — nunca sites ou canais piratas
- Comecei com as televisões públicas de Portugal e Espanha (RTP, RTVE) para as notícias, mas essas normalmente **bloqueiam a incorporação (embed)** da transmissão ao vivo fora do próprio site — por isso dava "vídeo não disponível". Troquei para a Euronews de cada língua, que mantém transmissão 24h pensada para ser incorporada, à semelhança da France 24.
- Por agora tirei a categoria de Jogos (a única opção gratuita que encontrei também não estava mesmo ao vivo no YouTube) — se quiseres, posso voltar a tentar com outra abordagem.
- **Importante ser honesto:** não consigo testar a transmissão/o vídeo em si a partir daqui (o YouTube e o Internet Archive estão bloqueados no ambiente onde desenvolvo) — confirmei os identificadores dos filmes por pesquisa, mas se algum não abrir, diz-me que troco por outro título de domínio público confirmado.

## 🍿 Onde Assistir (filmes e séries atuais)

Pediste para ver "qualquer filme ou série" dentro da app — isso não dá para fazer de forma legal e gratuita (seria preciso pagar licenças de streaming ou recorrer a pirataria, nenhuma das duas eu faço). Em vez disso, criei o botão 🍿 **Onde Assistir**: pesquisas o nome de um filme ou série e a app mostra em que serviços de streaming está disponível na tua região (Netflix, Prime Video, Disney+, HBO Max, etc.), com logotipos e um link para veres mais detalhes — o mesmo modelo do JustWatch. Nunca mostra o filme/série em si.

- Usa a API gratuita do **TMDB** (The Movie Database), cujos dados de disponibilidade de streaming são licenciados da JustWatch
- A região usada é a que escolheste no registo (país); separa entre "grátis", "grátis com anúncios" (ex.: Pluto TV, Plex, Tubi — quando o TMDB tiver essa informação), "incluído na subscrição", "alugar" e "comprar"

**Precisa de configuração** (grátis):
1. Cria uma conta em https://www.themoviedb.org/signup e pede uma chave de API em https://www.themoviedb.org/settings/api (escolhe "Developer", é gratuito e aprovação é imediata)
2. No Railway/Render, define a variável de ambiente `TMDB_API_KEY` com essa chave (usa a "API Key (v3 auth)", não o "Read Access Token")
3. Sem essa variável, o ecrã mostra um aviso claro a pedir a configuração, em vez de travar

## 🏦 Câmbio (conversor de moedas do mundo todo)

Novo botão 🏦 no cabeçalho: converte entre qualquer par de moedas, com destaque para as lusófonas — Euro (Portugal), Dólar (EUA), Real (Brasil), Kwanza (Angola), Escudo (Cabo Verde), Metical (Moçambique), Dobra (São Tomé e Príncipe), Pataca (Macau) — mais cerca de 150 outras moedas do mundo inteiro.

- Usa a **ExchangeRate-API** (endpoint de acesso livre, sem chave nem registo), com taxas atualizadas uma vez por dia
- Não precisa de nenhuma configuração — funciona logo, ao contrário de outras funcionalidades desta secção que pedem uma chave
- Também serviu como teste para confirmar que os deploys estavam mesmo a chegar ao Railway, depois do incidente deles que causou a confusão com os canais da TV em Direto

## 🎧 Música (Jamendo — faixas completas, 100% legal)

Pediste uma aba "tipo Spotify" — o Spotify em si não dá (é um serviço pago e fechado, não tem API pública para tocar faixas completas de graça), mas há uma alternativa legal e real: a **Jamendo**, uma plataforma de música de artistas independentes com licenças abertas (Creative Commons e afins). A diferença chave para o TMDB/"Onde Assistir": a própria Jamendo distribui o ficheiro áudio **completo** de cada faixa (não é um preview de 30 segundos), por isso a música toca mesmo dentro da app, com um leitor de áudio normal.

- Botão 🎧 no cabeçalho: pesquisa por artista, faixa ou género, ou mostra as faixas populares do momento quando a pesquisa está vazia
- Toca com um `<audio>` normal numa barra fixa no fundo do ecrã, com capa, título e artista
- Catálogo é só de artistas independentes/licenças abertas — não tem êxitos comerciais mainstream (isso continua a não dar para fazer de forma legal e gratuita)

**Precisa de configuração** (grátis):
1. Cria uma conta gratuita em https://developer.jamendo.com/v3.0 e regista uma aplicação para obteres um `client_id`
2. No Railway/Render, define a variável de ambiente `JAMENDO_CLIENT_ID` com esse valor
3. Sem essa variável, o ecrã mostra um aviso claro a pedir a configuração, em vez de travar

## Assistente de IA agora é só o Gemini (GitHub Models fechou de vez)

A GitHub retirou o **GitHub Models** por completo a 30 de julho de 2026 — não é uma instabilidade temporária, o serviço deixou de existir (playground, catálogo de modelos e API de inferência, tudo). O contacto "🤖 Assistente IA", que usava esse serviço, começou a falhar sempre (erro 410 "retirement brownout") e nenhum token novo resolvia, porque o problema não era a chave.

- Removi o contacto "🤖 Assistente IA" e o endpoint `/api/ai-chat` no servidor — código morto, já que o serviço por trás não existe mais
- O botão "📝 Resumir conversa" (que também usava o GitHub Models) passou a usar o Gemini
- Sobra só o contacto "✨ Gemini" como assistente de IA — já suportava tudo o mesmo (texto, fotos, vídeos, documentos), só precisa da `GEMINI_API_KEY` (ver secção "Como ativar o Assistente de IA" acima)

## ⋯ Menu "Mais funcionalidades" e 🎬 menu de Media (organizam o cabeçalho)

O cabeçalho já ia em ~25 ícones, difícil de navegar a deslizar. Criei dois botões que agrupam o resto em grelhas organizadas, sem alterar nenhuma funcionalidade em si — só a forma de lá chegar:

- **"⋯ Mais"**: 🧮 Calculadora, 🏦 Câmbio, 🧭 Navegação, 🔥 Incêndios, 🛰️ Espaço, 🚌 Transportes, 🚗 Conduzir e Ouvir, 🌦️ Meteorologia, 🏃 Atividades, 🎯 Roleta/Sorteio
- **"🎬" (TV, Notícias e Media)**: 📺 TV em Direto, 🍿 Onde Assistir, 📰 Notícias (mantém a bolinha vermelha de notícias novas), 🎧 Música, 😂 Vídeos engraçados
- **"📇" (Grupos, chamadas e contactos)**: 👥 Criar grupo, 📢 Lista de transmissão, 📞 Nova chamada, 🔍 Utilizadores cadastrados (procurar por username), 📋 Histórico de chamadas, 🗄️ Conversas arquivadas

Fica diretamente no cabeçalho o que sobrou: idioma do tradutor, música de fundo, admin (só para o admin), os três menus, estados, tema e personalizar/sair.

## 🌦️ Meteorologia (Open-Meteo)

Nova funcionalidade dentro do menu "⋯ Mais": pesquisas uma cidade ou localidade e vês o tempo atual (temperatura, sensação térmica, humidade, vento) e a previsão para os próximos dias, com hipótese de chuva.

- Usa a **Open-Meteo** (gratuita, sem chave nem registo) — primeiro converte o nome da localidade em coordenadas (geocoding), depois pede a previsão
- Não precisa de nenhuma configuração — funciona logo
- (Havia já um endpoint `/api/weather` antigo no servidor, à espera de coordenadas em vez do nome da cidade, mas nunca tinha sido ligado a nenhum ecrã — código morto que removi ao criar esta funcionalidade, para não ficarem dois a responder ao mesmo caminho.)

## ⏱️ Cronómetro "tempo passado na app"

Por cima da barra de pesquisa, mostra o tempo total (não só desta sessão) que já passaste com a app aberta e em primeiro plano — tipo "Tempo de Ecrã" do telemóvel.

- O tempo fica guardado na tua conta (campo `totalTimeSpentSec`), não no navegador — acompanha-te entre aparelhos
- Pausa sozinho quando a aba fica em segundo plano ou minimizada, para não contar tempo que não foi mesmo gasto a olhar para a app
- O relógio no ecrã atualiza-se ao vivo, a cada segundo; o valor só é mesmo gravado no servidor de 30 em 30 segundos (e ao sair/fechar a aba), para não sobrecarregar com pedidos constantes

## 🎂 Aniversários

Campo opcional de data de nascimento — no registo, ou depois no perfil (clica no teu avatar no canto superior esquerdo). Quando é o teu aniversário ou o de um contacto, aparece um aviso por cima da barra de pesquisa.

- Só compara mês e dia (não o ano) — funciona todos os anos sem precisares de atualizar nada
- É opcional; contas sem data de nascimento simplesmente não aparecem no aviso
- A data fica visível só para quem te tem como contacto

## 💬 Frase do dia

Uma frase inspiradora por cima da barra de pesquisa, diferente a cada dia.

- Usa a **ZenQuotes** (gratuita, sem chave) — a frase original vem em inglês e é traduzida para português com o mesmo serviço gratuito já usado no tradutor da app; se a tradução falhar, mostra o texto original em inglês em vez de nada
- Cache de 24h no servidor (é "do dia", igual para todos)
- Se a API estiver em baixo, a barra simplesmente não aparece — sem mensagens de erro feias

## 🎯 Roleta / Sorteio

Dentro do menu "⋯ Mais": adiciona várias opções (nomes, comidas, o que for) e gira uma roleta para escolher uma ao calhas — útil para decidir algo em grupo.

- Ferramenta 100% local, não precisa de nenhuma API nem configuração
- O resultado é sorteado (`Math.random()`) antes de a animação começar; a roda só gira até parar exatamente nessa opção — não é encenado ao contrário
- Mínimo de 2 opções para poder girar

## 📊 Enquetes em grupo

Botão 📊 na barra de escrever mensagens, visível só em conversas de grupo: pergunta + até 8 opções, e o grupo todo vota em tempo real.

- Um voto por pessoa — votar noutra opção troca o voto, votar na mesma opção outra vez retira-o
- Os votos atualizam ao vivo em todos os ecrãs abertos do grupo (sem precisar de recarregar)
- A enquete é guardada como uma mensagem normal (persiste no histórico da conversa, tal como qualquer outra mensagem)

## 🎮 Jogos (numa conversa 1-para-1): Jogo do Galo e Damas

Botão 🎮 na barra de escrever, visível em conversas 1-para-1 (Jogo do Galo, Damas ou UNO) e também em grupos (só UNO — ver secção própria mais abaixo). Ao tocar numa DM, escolhes entre 🎯 Jogo do Galo, ♟️ Damas ou 🃏 UNO. No Galo/Damas, quem começa o jogo é sempre X (🔴 nas damas); a outra pessoa da conversa é sempre O (⚪) — não é preciso convidar ninguém, o jogo já aparece pronto a jogar dentro da própria mensagem.

- Validação de turno e deteção de vitória feitas no servidor (não dá para fazer batota alterando o código no navegador)
- Atualiza ao vivo dos dois lados a cada jogada
- Ambos os jogos são guardados como mensagens normais e persistem no histórico

**Damas — regras simplificadas** (para não precisar de um motor de regras enorme dentro de uma mensagem de chat):
- A captura é **opcional** — não é obrigatório saltar mesmo que seja possível
- Cada turno permite **um único movimento**, mesmo que uma captura pudesse encadear noutra a seguir
- Peças normais só andam/capturam para a frente; ao chegar à última linha, tornam-se dama (👑) e passam a mover-se em qualquer direção
- Ganha quem deixar o adversário sem peças
- A última jogada fica destacada a **verde** no tabuleiro, para os dois lados verem logo o que o outro acabou de fazer

## Correção: mensagens e fotos apareciam duplicadas depois de reconectar

Bug real, obrigado por reportares: o servidor manda sempre o **histórico completo** de uma conversa sempre que se entra nela — não só ao abrir o chat, mas também sempre que o telemóvel/navegador reconecta (rede a cair, app em segundo plano, etc.), o que é frequente. O código juntava esse histórico ao que já lá estava em vez de o substituir, duplicando mensagens, fotos, enquetes e jogos a cada reconexão. Corrigido para substituir pelo histórico do servidor (que já é a verdade completa), em vez de acumular.
## ⋯ Menu "Mais desta conversa" (organiza o cabeçalho de cada chat)

O cabeçalho de dentro de uma conversa também já ia em 13+ ícones. Fica diretamente visível só o essencial — 📞 chamada de voz, 📹 videochamada — e tudo o resto passa a viver dentro de um botão único "⋯" ao lado das chamadas: Resumir (IA), Gerir grupo, Localização, Conferência, Sala VR, Pesquisar, Silenciar, Mensagens temporárias, Exportar, Agendar mensagem, Tradução automática, Arquivar e Bloquear/denunciar (os que só fazem sentido nalguns tipos de conversa continuam a aparecer só aí, exatamente como antes).

## 🃏 UNO (no mesmo botão 🎮, agora também em grupos)

O botão 🎮 passou a aparecer também em grupos (não só em conversas 1-para-1), mas Jogo do Galo e Damas continuam escondidos aí — são jogos de 2 pessoas fixas e não fazem sentido com N pessoas num grupo. O UNO é o primeiro jogo desta app pensado para várias pessoas: numa DM já começa automaticamente entre as duas pessoas da conversa; num grupo, quem toca em "Começar jogo" escolhe entre 1 e 5 contactos para jogar (2 a 6 jogadores no total) — os restantes membros do grupo continuam a ver a mensagem do jogo, mas só como espetadores.

Diferença importante em relação ao Galo/Damas: ali o tabuleiro é sempre público aos dois lados, por isso o próprio cliente podia gerar o estado inicial. No UNO cada jogador tem uma **mão de cartas privada**, por isso o baralho e a distribuição são sempre gerados no servidor, e a mão de cada pessoa só é enviada ao respetivo socket — nunca aos outros jogadores nem aos espetadores do grupo, incluindo depois de reconectar (o histórico da conversa é filtrado por pessoa antes de sair do servidor).

- Baralho completo (108 cartas: números 0-9, Bloqueio 🚫, Inverter 🔄, +2, Curinga 🌈 e +4)
- Toda a validação de jogada (é a tua vez, a carta está mesmo na tua mão, a cor/valor bate com o topo do descarte) é feita no servidor
- Ganha quem ficar sem cartas na mão

**Regras simplificadas** (pelas mesmas razões de simplicidade do Galo/Damas):
- Não há a obrigação clássica de "gritar UNO" com penalização por esquecimento
- Comprar carta passa sempre a vez a seguir — não deixa jogar de imediato a carta comprada mesmo que fosse válida
- O +4 não tem o desafio clássico de contestar se quem jogou tinha mesmo uma carta válida da cor anterior
- Com 2 jogadores, "Inverter" funciona como um Bloqueio (regra oficial do UNO); com 3+ jogadores inverte mesmo a ordem da roda

## @ Menções em grupos

Escrever `@` numa conversa de grupo abre uma lista de sugestões com os contactos conhecidos (filtra por qualquer palavra do nome, não só a primeira — útil para nomes compostos tipo "João Silva", já que dá para procurar por "Silva" também). Ao escolher um nome, ele entra no texto como `@Nome Completo`; ao enviar, quem foi mencionado recebe uma notificação push distinta ("Fulano mencionou-te em Grupo X"), mesmo que tenha silenciado esse grupo — tal como no WhatsApp, embora "não incomodar" continue sempre a ter prioridade. A mensagem mostra o `@Nome` destacado a azul para toda a gente, e com um fundo amarelo só para quem foi mencionado.

Não é preciso escrever exatamente pela lista de sugestões — escrever `@Nome` à mão (sem usar o autocompletar) funciona da mesma forma, desde que o nome bata certo com o de um contacto.

## Correção: escapes de HTML em falta (mensagens, pré-visualização da lista de conversas e chat da videochamada)

Ao construir o destaque de menções, reparei que o texto das mensagens era inserido diretamente na página sem qualquer tratamento — ou seja, uma mensagem contendo HTML/JavaScript (ex.: `<img src=x onerror="...">`) executava esse código no ecrã de quem a lesse, em vez de aparecer como texto. Confirmado como uma falha real e a sério (não só teórica) em três sítios: as mensagens em si, a pré-visualização da última mensagem na lista de conversas à esquerda, e o espelho do chat mostrado ao lado durante uma videochamada. Corrigido nos três — o texto das mensagens é sempre escapado antes de entrar na página, e o destaque de menções agora é aplicado por cima do texto já escapado, nunca do texto em bruto.

## ✨ Formatação de texto (`*negrito*`, `_itálico_`, `` `código` ``)

Nas mensagens de texto, `*texto*` vira **negrito**, `_texto_` vira _itálico_ e `` `texto` `` vira `código` (fonte monoespaçada com fundo). Aplica-se em qualquer conversa (1-para-1, grupo ou IA), sempre por cima do texto já escapado (ver correção acima) — nunca há risco de a própria formatação reabrir espaço para HTML injetado. Símbolos dentro de um trecho de código (` `a*b*c` `) não são interpretados como negrito/itálico, e um símbolo sozinho sem par (ex.: um "*" a meio de uma conta tipo "3 * 4") fica como texto normal em vez de tentar formatar. Não há suporte a formatação encadeada (ex.: negrito dentro de itálico).

## 🔒 Bloqueio por PIN

Um PIN de 4 dígitos, guardado só neste aparelho (não é uma senha da conta, não passa pelo servidor), pedido sempre que a app é aberta ou volta a ficar visível depois de ter estado em segundo plano (trocar de app, ecrã bloqueado, etc.). Ativa-se em "⋯ Mais funcionalidades" → "🔒 Bloqueio por PIN", com opções para criar, alterar (pede sempre o PIN atual primeiro) ou remover.

Escolhido PIN em vez de WebAuthn/Face ID a sério: o objetivo real desta funcionalidade é impedir que alguém que pegue no telemóvel destrancado veja as conversas de imediato — um PIN simples resolve isso com uma fração da complexidade que um cerimonial completo de credenciais por dispositivo exigiria. Por ser só local, guarda-se apenas o hash SHA-256 do PIN (nunca o PIN em texto simples), mas continua a ser uma barreira de conveniência, não segurança a sério: alguém com acesso à consola do navegador consegue contorná-la. Se esqueceres o PIN, a única forma de recuperar é terminar a sessão neste aparelho (o próprio ecrã de bloqueio tem essa opção) e voltar a entrar para definir um PIN novo.

## Correção: sessão restaurada podia rebentar com "Cannot read properties of undefined"

Ao testar o bloqueio por PIN num recarregamento de página (sessão restaurada automaticamente), encontrei um bug real e já existente: várias propriedades de `APP` (`statusFeed`, usada para saber se alguém tem estados ativos; `archivedChats`, usada para filtrar a lista de conversas) só eram atribuídas mais abaixo no código, mas a sessão era restaurada de forma síncrona logo ao carregar a página — antes de o script chegar lá. Corrigido: `statusFeed` passou a nascer já dentro do objeto `APP` inicial, e a restauração da sessão passou a ser adiada (`setTimeout`) para só correr depois de todo o resto do script já ter sido processado.

## 📐 Tamanho da fonte das mensagens

Em "🎨 Personalizar aparência" → "Tamanho do texto das mensagens", um controlo deslizante (12px a 22px) ajusta ao vivo o tamanho do texto dentro das bolhas de mensagem — útil em ecrãs pequenos ou para quem prefere letra maior. Guardado neste aparelho (`localStorage`), aplicado via uma variável CSS (`--font-size-msg`) já na primeira renderização da página, antes mesmo do login.

## 🎞️ GIFs e Stickers (Giphy)

Botão 🎞️ na barra de escrever (ao lado do 😊), com duas abas — 🎬 GIFs e ✨ Stickers — e uma pesquisa que também mostra os resultados em alta (trending) quando está vazia. Ao escolher um, envia-se como uma mensagem normal com o GIF/sticker animado, igual a uma foto.

Diferença em relação a fotos/vídeos enviados do telemóvel: um GIF/sticker já está hospedado para sempre no CDN da própria Giphy, por isso a mensagem guarda logo esse URL — não passa pelo Cloudinary/base64 usado para ficheiros enviados por ti.

**Precisa de configuração** (grátis):
1. Cria uma conta gratuita em https://developers.giphy.com/ e regista uma aplicação para obteres uma `API Key`
2. No Railway/Render, define a variável de ambiente `GIPHY_API_KEY` com esse valor
3. Sem essa variável, o botão continua visível mas o modal mostra um aviso claro a pedir a configuração, em vez de travar

## 🪄 Gerador de imagens por IA (Pollinations.ai)

Botão 🪄 na barra de escrever: descreves o que queres ver, a imagem é gerada e aparece numa pré-visualização com opção de "🔄 Gerar outra" (nova tentativa, mesma descrição) antes de decidir enviar para a conversa.

Ao contrário do DALL-E (OpenAI) ou do Stable Diffusion (Stability AI) — sugestões originais que exigiam uma chave paga — a **Pollinations.ai** gera a imagem de graça e sem chave nenhuma: o próprio URL da imagem já é o pedido de geração (como um CDN que "revela" a imagem ao ser aberta), por isso não precisa de nenhuma variável de ambiente nova nem configuração no Railway.

Com esta, ficam implementadas todas as 6 ideias trazidas numa única mensagem: @ Menções, Formatação de texto, Bloqueio por PIN, Gerador de imagens por IA, Tamanho da fonte e GIFs/Stickers — cada uma testada e enviada para produção antes de avançar para a seguinte.

## Ajustes: ícones da barra de escrever mais pequenos, e tradutor com vários idiomas dos dois lados

Dois ajustes pedidos depois de veres a app com as novas funcionalidades:

- **Ícones da barra de escrever mais pequenos**: com 😊🎞️🪄📎📊🎮🎤📨 todos juntos (alguns só aparecem em certos tipos de conversa), a barra estava a ficar demasiado larga em ecrãs de telemóvel e ficava com botões cortados fora do ecrã. Reduzidos de 42px para 34px e o espaçamento entre eles encurtado, para caberem todos sem cortar nada. Pelo caminho encontrei e corrigi também um bug de responsividade mais antigo: faltava `min-width: 0` no campo de escrever mensagens, que é o que realmente causava o corte (sem isso, o campo de texto recusava-se a encolher abaixo de um certo tamanho, mesmo com `flex: 1`, empurrando os últimos botões para fora do ecrã).
- **Tradutor rápido com vários idiomas dos dois lados**: antes, o lado esquerdo só tinha Português/Inglês; agora tem a mesma lista completa de 11 idiomas que já existia do lado direito, e o botão 🔄 troca os dois lados por completo para qualquer combinação (antes só trocava a sério quando o lado direito também era PT ou EN). O reconhecimento de voz (🎤) passou também a seguir o idioma escolhido do lado esquerdo em vez de assumir sempre Português ou Inglês.

## 📍 Partilha de localização mais segura (tempo limite + aviso sempre visível)

A partilha de localização em tempo real (📍) já funcionava em qualquer parte do mundo — usa o GPS diretamente do telemóvel, sem nenhuma restrição de país. O que faltava era proteção contra o uso perigoso desta funcionalidade: alguém ser seguido sem saber, ou esquecer-se de que ainda está a partilhar.

Duas mudanças:
- **Tempo limite obrigatório**: ao tocar em "Partilhar minha localização", escolhes sempre por quanto tempo (15 min, 1 hora ou 8 horas) — já não fica ligado indefinidamente. Passado esse tempo, a partilha para sozinha.
- **Aviso sempre visível**: enquanto a partilha está ativa, aparece uma barra bem visível na barra lateral (não só dentro do ecrã do mapa), com a hora em que termina e um botão para parar imediatamente — visível mesmo que mudes de conversa ou de ecrã, para nunca ficares a partilhar sem te aperceberes disso.

Continua também a parar automaticamente ao fechar o ecrã do mapa (proteção que já existia, mantida como camada extra).

## 📱 Limite de 2 dispositivos por conta

Cada conta só pode estar ligada em, no máximo, 2 dispositivos ao mesmo tempo. Um "dispositivo" é identificado por um id aleatório gerado uma única vez no navegador e guardado localmente (nunca sai do aparelho); ao tentar entrar num 3º dispositivo diferente, o login é recusado com uma mensagem clara a explicar o limite, em vez de simplesmente deixar entrar.

Em "⋯ Mais funcionalidades" → "📱 Dispositivos ligados" dá para ver os dispositivos atualmente ligados (com a etiqueta "(este dispositivo)" no que estás a usar) e remover um para libertar uma vaga para um novo — útil ao trocar de telemóvel. Remover um dispositivo não desliga imediatamente uma sessão já aberta nele (não há forma de "empurrar" um aviso para lá), só deixa de contar para o limite a partir do próximo login.

## 🔗 Associar novo dispositivo por código QR

Dentro de "Dispositivos ligados", o botão "🔗 Associar novo dispositivo" mostra um QR — tal como o WhatsApp Web. No dispositivo novo (ainda sem sessão), basta abrir a câmara normal do telemóvel e apontar: abre o ChatApp já com a sessão iniciada, sem escrever a senha nenhuma. O código expira em 60 segundos e só pode ser usado uma vez; conta sempre para o limite de 2 dispositivos, tal como um login normal, e recusa gerar um código novo se já estiveres no limite.

O QR é gerado inteiramente no nosso próprio servidor (com o pacote `qrcode`, adicionado a esta lista de dependências), nunca através de uma API externa de geração de QR — se fosse assim, o código de acesso de uso único ficaria visível a esse terceiro, que poderia usá-lo para entrar na conta antes de expirar.

**Nota de segurança encontrada, não relacionada com esta funcionalidade**: ao instalar a nova dependência, o `npm audit` acusou uma vulnerabilidade de severidade alta já existente no `nodemailer` (usado para o envio de emails), incluindo injeção de comandos SMTP. A correção automática (`npm audit fix --force`) instala uma versão com mudanças que quebram compatibilidade, por isso não a apliquei sem confirmar contigo — vale a pena atualizar o `nodemailer` numa tarefa à parte.

## 📷 Ler o código QR pela câmara, direto no ecrã de login

O botão "🔗 Associar por QR" no ecrã de **login** (só aí — não faz sentido em "Criar conta", para quem ainda não tem conta nenhuma) abre a câmara dentro da própria app e lê o código automaticamente, sem precisar de saíres para a câmara nativa do telemóvel.

Usa a API nativa `BarcodeDetector` do navegador (Chrome/Edge/Android) em vez de trazer uma biblioteca própria de leitura de QR — mais simples e sem risco de uma implementação caseira falhar a ler códigos válidos. Nos navegadores sem suporte (nomeadamente Safari/iPhone, à data desta funcionalidade), mostra logo um aviso claro em vez de ficar preso num ecrã de câmara que nunca deteta nada — nesses casos continua a dar para associar abrindo a câmara nativa do telemóvel e apontando para o QR mostrado no outro dispositivo (já funcionava assim antes desta funcionalidade).

## 🔗 Pré-visualização de links

Quando uma mensagem tem um URL, aparece por baixo um cartão com título, descrição e imagem — tal como WhatsApp/Telegram — lido dos meta tags Open Graph da própria página.

**Nota de segurança**: este tipo de funcionalidade (o servidor ir buscar um URL escolhido por quem escreve a mensagem) é um local clássico para uma vulnerabilidade de SSRF (*Server-Side Request Forgery*) — sem cuidado, alguém podia mandar, por exemplo, `http://localhost:27017` ou um IP da rede interna, e usar o teu próprio servidor como sonda para essa rede. Implementado com proteção: antes de qualquer pedido, o nome do URL é resolvido para IP, e recusa-se a continuar se esse IP for privado ou reservado (localhost, redes locais 10.x/172.16-31.x/192.168.x, e o endereço de metadados de nuvem 169.254.169.254) — nesses casos a mensagem continua a funcionar normalmente, só sem cartão de pré-visualização, sem revelar que foi bloqueado por segurança. Também só lê os primeiros ~100KB de cada página (o suficiente para o `<head>`) e tem um limite de 6 segundos por pedido, para não ficar preso em páginas lentas ou enormes.

## 🔎 Pesquisa global em todas as conversas

Novo botão 🔎 ao lado da pesquisa de conversas na barra lateral abre uma pesquisa que varre TODAS as conversas de uma vez (não só a que está aberta), mostrando o nome da conversa, um trecho do texto com o termo destacado, e a hora. Clicar num resultado abre essa conversa e faz scroll direto até à mensagem, com um flash a destacá-la (o mesmo efeito já usado para ir a uma mensagem fixada). Mensagens apagadas e mensagens cifradas ponta-a-ponta (que o servidor nunca vê em claro) são sempre excluídas da pesquisa. É tudo feito no browser, sem pedido novo ao servidor — o histórico de todas as conversas já fica todo carregado em memória ao entrar na app (necessário para as conversas abrirem instantaneamente), por isso a pesquisa é imediata.

## Correção de segurança: conversas privadas (1-para-1) podiam ser lidas/escritas por qualquer conta

Encontrado ao testar a pesquisa global: o id de uma conversa 1-para-1 é sempre calculado da mesma forma, a partir dos dois números de telefone (`dm_<telefoneA>_<telefoneB>`, ordenados). O servidor aceitava entrar em **qualquer** sala (`join_room`) e enviar mensagem para **qualquer** sala (`send_message`) só com base nesse id, sem confirmar que quem estava a fazer o pedido era mesmo um dos dois participantes. Na prática, isto significava que qualquer conta autenticada que soubesse (ou descobrisse, ex. pela pesquisa de utilizador) os números de telefone de duas outras pessoas conseguia calcular o id da conversa delas e:
- Ler todo o histórico dessa conversa privada (o servidor manda o histórico completo a quem entra na sala).
- Enviar mensagens para lá, fazendo-se passar por uma das duas pessoas.

Corrigido: `join_room` e `send_message` (e também `schedule_message`, para mensagens agendadas) agora validam, para qualquer sala `dm_...`, que quem está a fazer o pedido tem mesmo o número de telefone de um dos dois lados dessa conversa (recalculando o id a partir do telefone de quem envia + do telefone do destinatário indicado, e comparando com o id pedido) — se não bater certo, o pedido é simplesmente ignorado. Grupos continuam públicos de propósito (ver secção acima sobre grupos), essa validação só se aplica a conversas 1-para-1.

Nota: esta correção cobre a entrada na sala e o envio de mensagens novas, que eram os dois pontos onde uma conta não autorizada conseguia ler ou escrever numa conversa privada. Outras operações sobre mensagens já existentes (apagar, editar, reagir, votar numa enquete) continuam a confiar no id da mensagem/conversa vindo do pedido sem essa mesma verificação adicional — vale a pena um reforço semelhante aí também numa próxima iteração, embora o risco seja menor (normalmente exige também adivinhar o id da mensagem, que não é previsível como o da conversa).

**Correção a esta correção**: a validação original confiava num campo `toPhone` enviado pelo próprio cliente para confirmar quem era o destinatário — o que, na prática, significava que qualquer aparelho a correr uma versão da app anterior a esta proteção (ex.: um PWA instalado que ainda não tinha atualizado a cache) deixava de conseguir entrar nas próprias conversas privadas de todo, mesmo sendo o dono legítimo — sem histórico, sem mensagens novas, nem mesmo depois de atualizar a página, porque a app antiga continuava a repetir o mesmo pedido incompleto. Corrigido: a validação passou a confirmar diretamente com a lista de contactos já guardada na conta no servidor (quem é mesmo contacto de quem), sem depender de nada que o cliente tenha de enviar — funciona com qualquer versão da app, antiga ou nova, e continua a bloquear da mesma forma quem tentar adivinhar a conversa de outras duas pessoas sem nunca ter sido contacto de nenhuma delas.

## 🗂️ Pastas para organizar as conversas

Barra de "filtros" por baixo da pesquisa (tal como no WhatsApp): começa só com "Tudo", e o botão "+" abre um ecrã para criar pastas próprias (ex.: "Trabalho", "Família") e escolher, dentro de cada conversa (menu "⋯ Mais desta conversa" → "🗂️ Pastas"), em quais pastas ela entra — uma conversa pode estar em várias pastas ao mesmo tempo, ou em nenhuma. Clicar numa pasta na barra filtra a lista de conversas só às que estão lá dentro; "Tudo" volta a mostrar todas. É só uma organização pessoal (não é visível para mais ninguém) e fica guardada no servidor por conta, tal como as listas de transmissão, por isso sincroniza entre os teus dispositivos.

## 🔐 Código de segurança (verificar a encriptação ponta-a-ponta)

Tal como o "número de segurança" do WhatsApp/Signal: tocando no 🔒 ao lado do nome da conversa (ou em "⋯ Mais desta conversa" → "🔐 Código de segurança"), aparece um código de 60 dígitos calculado a partir das duas chaves públicas ECDH da conversa (a tua e a do contacto) — sempre o mesmo código dos dois lados, não importa quem o vê. Comparando esse código com o que a outra pessoa vê no aparelho dela (por chamada, mensagem noutro sítio, ou pessoalmente), confirma-se que a encriptação desta conversa é mesmo direta entre os dois, sem mais ninguém a intercetar as chaves pelo meio. Só aparece em conversas 1-para-1 onde as duas partes já têm a chave pública trocada (o mesmo critério do cadeado 🔒 que já existia). Cálculo inteiramente no cliente (SHA-256 sobre as duas chaves, ordenadas para dar sempre o mesmo resultado nos dois lados) — o servidor nunca vê nem participa nesta verificação.

## 👁️ Fotos "ver uma vez"

Ao enviar uma foto, aparece uma pré-visualização com a opção "👁️ Ver uma vez" — se marcada, quem recebe só vê um aviso "Toca para ver" em vez da foto; ao tocar, a foto abre (numa janela nova, tal como já acontecia ao abrir qualquer foto) e imediatamente desaparece, ficando só "👁️ Foto vista" no lugar. A pessoa que enviou continua a ver a sua própria foto normalmente (é o ficheiro dela, não faz sentido escondê-lo de quem o enviou), mas passa a ver que já "foi vista" assim que a outra pessoa a abrir.

**Aplicado a sério, não só na aparência**: assim que é aberta, o servidor apaga mesmo o ficheiro da mensagem guardada (tal como já fazia para mensagens apagadas) — não é só escondido no ecrã. Isso significa que mesmo entrando por um dispositivo novo ou recarregando a página depois, a foto já não está lá para ser recuperada. Só conta como "aberta" quando é mesmo quem recebeu a tocar (nunca a própria pessoa que enviou), e só a primeira vez.

## 📊 As minhas estatísticas

Em "👤 O meu perfil" → "📊 As minhas estatísticas": um resumo pessoal ao estilo "Wrapped" com mensagens enviadas/recebidas, fotos/vídeos/áudios/GIFs enviados, quantas fotos "ver uma vez" já mandaste, tempo total passado na app, número de contactos e grupos, o teu emoji mais usado, a hora do dia em que mais escreves, e qual é a tua conversa mais ativa. Tudo calculado no próprio dispositivo a partir do histórico que já estava carregado (o mesmo aproveitado pela pesquisa global) — sem pedir nada novo ao servidor.

## 🔒 Senhas mais fortes no cadastro

Reparámos que era possível criar uma conta com uma senha de apenas 4 caracteres, e sem nenhum aviso se essa senha fosse óbvia (`12345678`, `password`, `aaaaaaaa`, etc.). Corrigido: agora exige-se pelo menos 8 caracteres, e uma lista das senhas mais comuns/previsíveis do mundo é recusada logo no cadastro, com uma mensagem clara para escolher outra.

**Nota sobre o que NÃO foi feito, e porquê**: impedir que duas contas diferentes tenham a mesma senha entre si (algo que foi pedido) não é possível de fazer com segurança — para o servidor confirmar "esta senha já está a ser usada por outra pessoa" teria de comparar a tua senha com a de todas as outras contas, o que ou exige guardar as senhas de forma reversível (o oposto do que este projeto já faz bem, com `scrypt` + sal único por conta) ou cria um "oráculo" que um atacante podia usar para ir testando senhas até descobrir a de uma pessoa específica. A proteção real contra senhas fracas/previsíveis é a lista de bloqueio acima, que é a mesma abordagem recomendada pelo NIST (a autoridade norte-americana de normas de segurança) para este tipo de situação.

## 🗺️ Turismo (pontos de interesse pelo mundo)

Nova aba em "⋯ Mais funcionalidades" → "🗺️ Turismo": um mapa interativo (o mesmo Leaflet + OpenStreetMap já usado nas outras abas de mapa) onde dá para saltar diretamente para Valência, Madrid, Paris, Portugal, Alemanha, Holanda, ou uma vista do mundo todo, navegar livremente, ou tocar em qualquer ponto para ir até lá. Toca em "🔍 Procurar aqui" (ou aproxima-te o suficiente com o zoom) para veres os pontos de interesse dessa área — tocar num marcador abre a ficha desse ponto **sem sair da aba**, com um resumo/breve história do sítio, uma imagem quando existe, e um link para ler o artigo completo na Wikipédia.

**Categorias**: por baixo dos atalhos das cidades há uma segunda barra com "📍 Geral" (pontos de interesse em geral, da Wikipédia — o comportamento original), "🏖️ Praias", "🏛️ Museus", "🎭 Atrações" (miradouros, parques temáticos, zoos, aquários — o "o que fazer" da cidade) e "🌳 Parques/Praças". As categorias usam o Overpass API (gratuito, sem chave), que consulta diretamente as etiquetas reais do OpenStreetMap (ex. `natural=beach`, `tourism=museum`) — muito mais preciso para isto do que a pesquisa genérica da Wikipédia, que também costuma trazer resultados irrelevantes (ex. o nome do município em vez de uma atração real). Quando o próprio OpenStreetMap já liga o sítio a um artigo da Wikipédia, usamos esse título exato para ir buscar a descrição; quando não há essa ligação, a ficha mostra o nome real do local na mesma, só sem descrição.

**Duas formas de "como chegar"**: o botão "🧭 Como chegar (na app)" pede a tua localização e desenha a rota diretamente no mapa desta aba (reaproveitando o mesmo cálculo de rotas já usado na aba de Navegação) — nunca sais da aplicação. Como não temos (nem vamos manter) uma API própria de transporte público mundial, esta rota é sempre de **carro**; a app é honesta sobre essa limitação na mensagem que mostra. Ao lado, "🗺️ Abrir no Google Maps" continua disponível como alternativa para quem quiser direções de transporte público (autocarro/metro/comboio) ou mais detalhe — essa sim abre fora da app. Para pontos dentro de Portugal, aparece também um atalho "🚌 Transportes (PT)" que abre a aba de Transportes já existente na app (essa sim com estações reais de metro/comboio).

Nota técnica: a pesquisa de pontos usa sempre o centro do mapa com um raio de 10km (o limite máximo da própria API de pesquisa geográfica da Wikipédia) — por isso não faz sentido "procurar" numa vista de país inteiro ou do mundo todo (só encontraria o que estiver perto do centro exato do ecrã); nesses casos a app pede para te aproximares mais com o zoom em vez de mostrar um resultado sem sentido. Alemanha e Holanda funcionam como o Portugal (vista do país inteiro, sem procura automática) pelo mesmo motivo.

**Correção**: a ficha de um ponto (`modalTourismPoi`) não tinha z-index definido e ficava por baixo do ecrã de Turismo (que tem z-index 100) — abria, mas ficava escondida atrás do mapa, só visível depois de fechar a aba de Turismo. Corrigido com o mesmo z-index (200) já usado por outros modais que também abrem por cima de ecrãs de mapa/lista (ex.: `modalWatchProviders`, `modalBroadcastSend`).

**O mesmo bug encontrado e corrigido também na aba Estados**: o modal "🟢 Novo estado" (aberto ao tocar em "O meu estado" ou no ➕, dentro da aba Estados) tinha exatamente o mesmo problema — sem z-index próprio, ficava por baixo do ecrã de Estados e só aparecia depois de o fechar. Corrigido da mesma forma (z-index 200). Verificado também que os restantes ecrãs com um modal próprio (`modalBroadcastEdit`, dentro da aba de listas de transmissão) já tinham esta correção aplicada.

**⭐ Favoritos**: o botão ⭐ no cabeçalho da aba de Turismo abre a tua lista de favoritos, e dentro da ficha de qualquer ponto há um botão "⭐ Guardar" (passa a "★ Guardado") — guarda o sítio (nome, coordenadas, e o título da Wikipédia quando existe) numa lista pessoal, sincronizada por conta no servidor tal como as pastas de conversas. Tocar num favorito na lista fecha-a, centra o mapa lá, e reabre logo a ficha desse ponto.

**🌦️ Clima no mapa**: um pequeno indicador no canto do mapa mostra a temperatura e o tempo atual de onde quer que estejas a ver — reaproveita a mesma API de meteorologia já usada na aba "Meteorologia" (Open-Meteo, gratuita, sem chave), só que agora também aceita coordenadas diretas em vez de precisar do nome de uma cidade. Atualiza sempre que saltas para uma cidade ou tocas em "🔍 Procurar aqui", mesmo numa vista de país inteiro (onde a procura de pontos turísticos fica em pausa à espera que te aproximes, mas o clima continua a fazer sentido).

## 💰 Dividir despesas de viagem

Em qualquer conversa (grupo ou 1-para-1), o menu "⋮ Mais" tem agora um botão "💰 Despesas" que abre um mini-Splitwise: mostra quanto cada pessoa deve ou tem a receber, e permite adicionar uma nova despesa (descrição, valor, moeda, quem pagou, e por quem é dividida). Cada despesa aparece também como uma mensagem normal na conversa, com um resumo rápido ("Pago por X · dividido por N pessoas").

**Como funciona por baixo**: não há nenhuma tabela nova no servidor — cada despesa é só mais um campo opcional (`expense`) numa mensagem normal, tal como já acontece com as enquetes e os jogos, por isso viaja automaticamente pelo mesmo caminho (`send_message` / `receive_message` / histórico da conversa) sem precisar de guardar nada extra. O valor é convertido para euros no momento em que é registado, reaproveitando as mesmas taxas de câmbio já usadas na aba "Câmbio".

**Simplificação assumida**: como os grupos nesta app são "abertos" (qualquer conta cadastrada vê o grupo, sem uma lista fixa de membros a consultar), não há como perguntar ao servidor "quem está neste grupo". Por isso, quem pagou e quem participa numa despesa é identificado pelo **nome** de quem já enviou mensagens nessa conversa (não pelo número de telefone) — funciona bem no uso normal, mas duas pessoas com o mesmo nome de perfil na mesma conversa seriam tratadas como uma só.

## 🙈 Privacidade — esconder estado online e confirmação de leitura

Em "O meu perfil" há agora uma secção de Privacidade com duas opções independentes: "Esconder o meu estado online dos contactos" (os outros passam a ver-te sempre como offline, mesmo estando ligado) e "Não enviar confirmação de leitura" (as mensagens que enviares a outras pessoas nunca mostram o ✓✓ azul, mesmo depois de as teres lido).

**Simplificação assumida (ao contrário do WhatsApp)**: aqui a proteção é só num sentido — ligar qualquer uma destas opções não te tira a ti a visão do estado online ou das confirmações de leitura dos teus contactos, só esconde a tua própria informação deles. É mais simples de perceber (não há o efeito secundário de "se escondes o teu, também deixas de ver o dos outros") à custa de ser menos rigoroso que o WhatsApp nesse aspeto.

## 📌 Várias mensagens fixadas por conversa

Cada conversa (1-para-1 ou grupo) já deixava fixar uma mensagem; agora dá para fixar até 10 ao mesmo tempo. Com só uma fixada, a barra no topo da conversa continua igual (mostra quem escreveu e o texto, toca para saltar até lá, ✖️ para desafixar). Com duas ou mais, a barra passa a mostrar "N mensagens fixadas — toca para ver todas", abrindo uma lista onde é possível saltar para qualquer uma delas ou desafixá-las individualmente.

**Nota técnica**: o limite de 10 é aplicado no servidor (não só na aparência) — ao tentar fixar mais do que isso, aparece um aviso a pedir para desafixar alguma primeiro. Mantida também compatibilidade com o formato antigo do ficheiro `pins.json` (uma mensagem só, não um array), para não perder o que já estava fixado em conversas antigas.

## ♟️ Damas e Jogo do Galo também em grupos

Estes dois jogos são sempre de 2 jogadores fixos (não fazem sentido com N pessoas), por isso até agora só estavam disponíveis em conversas 1-para-1. Dentro de um grupo, ao escolher "Jogo do Galo" ou "Damas" no menu 🎮, aparece um seletor para escolheres com qual dos teus contactos queres jogar — tal como já acontecia com o UNO. Só vocês os dois jogam; o resto do grupo vê o tabuleiro a atualizar-se ao vivo, com um aviso "(só a ver)" e sem conseguir tocar nas peças.

## Correção: email de aviso de incêndio às vezes ficava "a enviar" para sempre

Se a rede do servidor bloqueasse a ligação SMTP (comum em vários serviços de alojamento, como proteção contra spam) ou o Gmail demorasse a responder, o envio ficava pendurado indefinidamente — sem erro, sem sucesso, só "A enviar email..." parado. Corrigido em dois sítios: o servidor agora define um limite de 12 segundos para a ligação SMTP (em vez de esperar sem limite), e o próprio pedido feito pelo telemóvel/computador desiste ao fim de 15 segundos e mostra um aviso claro a pedir para tentar de novo, em vez de ficar preso no ecrã.

## Correção: pesquisa por categoria em Turismo às vezes falhava com "Não foi possível procurar agora"

A instância pública do Overpass API (usada nas categorias Praias/Museus/Atrações/Parques) tem limites de utilização apertados e por vezes fica lenta ou sobrecarregada. Agora cada pedido tem um limite de 12 segundos (em vez de poder ficar preso sem limite) e, se a instância principal falhar ou estiver a recusar pedidos, tenta automaticamente um espelho público alternativo antes de desistir — a pesquisa só mostra erro se as duas falharem.

## 🎉 Eventos (RSVP) e ⏳ enquetes com prazo

Ao lado do botão de enquete (📊) numa conversa em grupo há agora um botão 🎉 "Criar evento" — é um atalho que abre a mesma criação de enquete já existente, só com as opções já prontas ("✅ Vou" / "❌ Não vou" / "🤔 Talvez") e o campo principal a pedir o nome do evento em vez de uma pergunta qualquer. Não é uma funcionalidade nova por baixo — é literalmente a mesma enquete de sempre, só com um atalho para o caso de uso "quem vai à festa?".

Todas as enquetes (incluindo estes eventos) podem agora ter um prazo: ao criar, escolhe-se quanto tempo até a votação encerrar sozinha (1h/6h/24h/3 dias/7 dias, ou nunca, como antes). Passado esse prazo, a enquete mostra "🔒 Votação encerrada" e deixa de aceitar votos — validado também no servidor (não só escondendo o botão no ecrã), para não dar para votar depois de encerrada só porque alguém edita o código no navegador.

## 📸 Ler valor de um recibo por foto (nas despesas de viagem)

Ao criar uma despesa, há agora um botão opcional "📸 Ler valor de um recibo" — tira/escolhe uma foto do recibo e o valor é lido automaticamente para o campo "Valor" (usando OCR no próprio telemóvel/computador, com a biblioteca gratuita Tesseract.js, carregada só quando este botão é mesmo usado, para não pesar no carregamento normal da app). É sempre só uma sugestão: o campo continua editável antes de guardar, e se não for possível identificar um valor claro no recibo aparece um aviso a pedir para preencher à mão.

**Como o valor é escolhido**: o texto lido do recibo é procurado por números com vírgula/ponto decimal (ex.: "14,50"); se alguma linha tiver uma palavra como "total", usa-se o maior valor dessas linhas — senão, usa-se o maior valor encontrado em todo o recibo (o total costuma ser o maior número, maior do que qualquer item individual).

## Nota: partilha de localização ao vivo já existia

Ao propor novas ideias, sugeri "partilhar localização ao vivo" sem verificar primeiro se já existia — e já existia (aba de Navegação → "📡 Partilhar minha localização", com duração limitada de 15 min/1h/8h e aviso persistente com botão para parar a qualquer momento). Não foi duplicada nem alterada.

## Correção: o toque de chamada não parava quando quem ligava desistia

Uma chamada 1-para-1 que ainda só está a tocar (o ecrã de "Aceitar/Recusar", antes de ser atendida) nunca marcava a chamada como "ativa" internamente — isso só acontecia depois de aceitar. Se quem ligou desistisse antes disso (o limite de 35 segundos sem resposta), o aviso de chamada perdida chegava e o ecrã de "a receber chamada" fechava corretamente, mas a função que também para o toque nunca chegava a correr, por causa de uma verificação que assumia (incorretamente) que só uma chamada já "ativa" precisava de ser parada — o toque ficava a repetir para sempre, mesmo sem nenhuma chamada visível no ecrã. Corrigido: o toque para sempre que a chamada é encerrada de qualquer forma, mesmo que ainda estivesse só a tocar.

**Investigação mais a fundo — encontrada e corrigida a causa real de "um lado não consegue ligar"**: em vez de só ler o código, testei uma chamada 1-para-1 real de ponta a ponta (com câmara/microfone simulados, mas sinalização e ligação genuínas) — sozinha, uma chamada normal funciona perfeitamente dos dois lados. O problema aparece quando a conta de quem recebe está aberta em 2 aparelhos ao mesmo tempo (esta app permite até 2, ver "Dispositivos ligados"): a chamada toca nos dois, mas se a pessoa atender só num, o OUTRO aparelho nunca ficava a saber — continuava a tocar para sempre (o mesmo sintoma do toque sem fim, mas por um motivo diferente do que já tinha sido corrigido acima) e, se a pessoa também tocasse em "Aceitar" aí por engano (parecia continuar a chamar), esse segundo aparelho tentava responder à mesma chamada já respondida — reproduzi isto e apanhei o erro exato do navegador: `Failed to execute 'setRemoteDescription' ... Called in wrong state: stable`. Esse segundo aparelho ficava preso em "Conectando..." para sempre, sem nunca ligar — exatamente o "um lado não consegue ligar" relatado.

**Corrigido**: agora, assim que a chamada é atendida ou recusada num aparelho, o servidor avisa os outros aparelhos da mesma conta para pararem de tocar e fecharem o ecrã de chamada a receber, em vez de deixarem a pessoa tentar responder outra vez a uma chamada já resolvida. Também protegido do lado de quem liga contra receber uma segunda resposta inválida à mesma chamada, caso alguma mensagem chegue fora de ordem.

## 🛒 Lista de Compras

Nova aba pessoal (menu "⋯ Mais funcionalidades") para preparar as compras: adicionar artigos com quantidade, registar o preço encontrado em várias lojas por artigo (para comparar) e marcar o que já foi apanhado no carrinho. A app destaca automaticamente o preço mais barato de cada artigo (✅) e mostra sempre o total estimado da lista, somando o preço mais barato de cada artigo pela quantidade.

**"Finalizar" em vez de reset automático por mês**: em vez de reiniciar a lista sozinha numa data fixa (nem toda a gente faz compras no mesmo dia do mês), há um botão "✅ Finalizar e gerar PDF" — arquiva a lista atual no histórico (com a data e o total) e limpa-a para uma nova, dando o mesmo efeito de "fechar o mês" mas quando tu decidires. O histórico (📜, no cabeçalho da aba) guarda as últimas 30 listas finalizadas, cada uma com o botão para voltar a descarregar o PDF dessa lista específica.

**PDF gerado no próprio telemóvel/computador**: usa a biblioteca gratuita jsPDF (carregada só quando o botão "Finalizar" ou "PDF" do histórico é mesmo usado pela primeira vez, para não pesar no carregamento normal da app) — o ficheiro é montado e descarregado localmente, sem passar pelo servidor.

**Categorias/corredores**: cada artigo tem uma categoria (Frutas e Legumes, Padaria, Laticínios, Carnes/Peixe, Congelados, Mercearia, Bebidas, Limpeza, Higiene, Outros) escolhida ao adicionar. A lista agrupa automaticamente por categoria, sempre pela mesma ordem sugerida de corredores do supermercado — só aparecem secções que já têm algum artigo.

**Editar artigo**: o botão ✏️ em cada artigo abre uma edição rápida (nome, quantidade, categoria) sem precisar de apagar e recriar — os preços já registados e o estado de "comprado" mantêm-se.

**Partilhar lista numa conversa**: o botão 📤 no cabeçalho envia um resumo da lista atual (artigo, quantidade, e o preço mais barato encontrado) como mensagem para um contacto ou grupo — aparece na conversa como uma mensagem normal, com o total no fim. É um instantâneo do momento em que é partilhada (como as despesas de viagem), não fica ligada à tua lista pessoal depois de enviada.

**Editar preços, também no histórico**: cada preço registado (✏️ ao lado do valor) pode ser corrigido sem apagar e voltar a adicionar. E isto funciona também dentro de uma lista **já finalizada** — tocar numa entrada do histórico expande-a e mostra os artigos com os preços registados nessa altura, para corrigir com o valor real do recibo, por exemplo. Corrigir um preço aí recalcula logo o total dessa lista arquivada (sem afetar a lista ativa nem outras entradas do histórico), e o botão "📄 PDF" gera o ficheiro já com os valores corrigidos.

**Quantidade ou peso/volume**: ao adicionar (ou editar) um artigo, há agora um seletor de unidade ao lado da quantidade — "un" (unidades, sempre número inteiro) ou kg/g/L/ml (aceitam casas decimais, ex.: "1,5 kg" de carne). O total continua a ser preço mais barato × quantidade, por isso um preço "por kg" multiplicado por "1,5" dá logo o subtotal certo. A unidade aparece em todo o lado onde o artigo é mostrado — lista ativa, histórico, PDF e listas partilhadas numa conversa.

## 🖼️ Galeria de mídia por conversa

No menu "⋮ Mais" de qualquer conversa há agora um botão "🖼️ Galeria" que junta todas as fotos e vídeos já trocados ali num só sítio, em grelha — sem ter de percorrer a conversa mensagem a mensagem à procura de uma foto antiga. Tocar numa miniatura abre-a em tamanho grande, com setas para navegar para a foto/vídeo anterior ou seguinte sem fechar e reabrir.

**O que fica de fora, de propósito**: mensagens apagadas, ficheiros que não sejam foto/vídeo (documentos, áudios), e — o mais importante — mensagens "ver uma vez" nunca aparecem aqui, mesmo antes de serem abertas. Mostrá-las numa galeria para reler mais tarde ia contra o próprio objetivo dessa funcionalidade (só se veem uma vez, e depois desaparecem mesmo).

## 🔔 Lembretes pessoais

Nova aba pessoal (menu "⋯ Mais funcionalidades") para lembretes do tipo "lembra-me disto às 18h" — diferente das mensagens agendadas (que são para enviar a outra pessoa numa conversa), isto é só para ti. Escreve o que queres que te lembre, escolhe a data/hora (ou usa um atalho: daqui a 1h/3h, esta noite às 20h, ou amanhã de manhã às 9h) e é tudo.

**Funciona mesmo com a app fechada**: reaproveita a mesma notificação push já usada para mensagens novas — não é preciso estar com a app aberta no telemóvel para receber o aviso à hora marcada (desde que as notificações push já estejam ativadas). Se estiveres com a app aberta nesse momento, aparece também um aviso instantâneo, sem esperar por nenhuma notificação do sistema.

## 🔁 Despesas fixas mensais

Dentro do menu de "💰 Despesas" de qualquer conversa há agora um botão "🔁 Fixas" para criar despesas que se repetem todos os meses sozinhas — renda, Netflix, ginásio, etc. — sem teres de as lançar à mão. Define a descrição, o valor, a moeda, quem paga, entre quem se divide e em que dia do mês, e a partir daí o próprio servidor lança uma despesa a sério nessa conversa nesse dia, exatamente como se alguém a tivesse criado manualmente.

**Se o dia escolhido não existir nesse mês** (ex.: dia 31 em fevereiro ou abril), a despesa é lançada no último dia real desse mês, para nunca "saltar" um mês inteiro. E se em algum mês já foi lançada, não volta a ser lançada de novo nesse mesmo mês.


