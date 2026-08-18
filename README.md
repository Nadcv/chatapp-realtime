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



### Como ativar o Assistente de IA (GitHub Models)

1. Cria um Personal Access Token em https://github.com/settings/tokens (não precisa marcar nenhum scope especial para uso básico dos modelos).
2. No Railway/Render, vai a Settings → Variables e adiciona `GITHUB_TOKEN` com o valor do token.
3. (Opcional) Define `GITHUB_MODEL` para escolher outro modelo — o padrão é `openai/gpt-4o-mini`. Lista de modelos disponíveis: https://github.com/marketplace/models
4. Sem o `GITHUB_TOKEN` configurado, o chat da IA continua a funcionar mas mostra um aviso a pedir a configuração, em vez de travar.

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

- **📰 Notícias (ao vivo)** — Euronews em Português (🇵🇹), Euronews en Español (🇪🇸), France 24 (🇫🇷), via YouTube. Cada canal usa o endpoint público do YouTube que resolve sozinho "o que está em direto agora" naquele canal — não dependemos de um vídeo específico que muda a cada transmissão.
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



