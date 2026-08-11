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

## Assistente de IA mais resistente a instabilidades

O GitHub Models é uma infraestrutura gratuita partilhada, e às vezes fica temporariamente sobrecarregada ou atinge o limite de pedidos — não é um problema da nossa app. Agora, quando isso acontece, o servidor tenta automaticamente até 3 vezes antes de desistir, e se mesmo assim continuar indisponível, mostra uma mensagem clara a explicar que é uma instabilidade temporária do serviço gratuito, sugerindo tentar de novo dentro de um ou dois minutos.

## 👤 Foto de perfil

Toca no teu avatar no canto superior esquerdo (ou "O meu perfil" no menu ⋮) para escolher uma foto. É redimensionada automaticamente antes de enviar, e aparece para ti e para os teus contactos em todo o lado — cabeçalho, lista de conversas, conversa aberta. Se tiveres o Cloudinary configurado, a foto vai para lá; senão, fica guardada como as outras imagens da app.


Novo botão na barra da chamada de vídeo — troca entre a câmara da frente e a de trás em tempo real (a outra pessoa também vê a mudança). Funciona em telemóveis com mais do que uma câmara. Em computadores com uma única câmara, mostra um aviso claro em vez de falhar silenciosamente.

## Sobre a partilha de ecrã em todos os dispositivos

Isto não depende de nós — é uma limitação de cada navegador:
- **Android (Chrome/Firefox)**: funciona
- **Computador (Windows/Mac/Linux, qualquer navegador atual)**: funciona
- **iPhone/iPad (Safari, e por extensão todos os navegadores no iOS, que são obrigados a usar o motor do Safari)**: a Apple **nunca implementou esta função no iOS** — nenhuma app feita para navegador consegue contornar isto, só apps nativas da App Store o conseguem fazer (usando uma API diferente do sistema operativo, não do navegador). Se o iPhone tentar partilhar o ecrã, a app já deteta isso e avisa com uma mensagem clara em vez de falhar sem explicação.

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

**Notificações push** — ao entrares na app, é pedida autorização para notificações; se aceitares, passas a receber um aviso mesmo com a app fechada quando alguém te manda uma mensagem 1-para-1 (grupos ainda não têm notificação push nesta versão). As chaves necessárias (VAPID) são geradas automaticamente pelo servidor na primeira vez que arranca — não precisas de configurar nada.

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

## Já estavam prontos (confirmado nesta revisão, não precisaram de trabalho novo)

- **Apagar grupos** — só quem criou o grupo pode apagá-lo (não basta ser administrador promovido); apaga também todo o histórico de mensagens desse grupo
- **IA analisa fotos e áudios** — quando envias uma foto ao 🤖 Assistente IA, ela descreve o que vê; quando envias um áudio, ela lê a transcrição automática captada durante a gravação






