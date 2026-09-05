# ChatApp em Tempo Real

Chat com mensagens instantâneas e chamadas de voz/vídeo (WebRTC), usando
Express + Socket.IO.

## Rodar localmente

```bash
npm install
npm start
```

Acesse `http://localhost:3000`.

## Testes automatizados

```bash
npm install
npm test
```

Corre toda a suite de testes de ponta a ponta (Playwright + Chromium, já incluído — não precisa de mais nada instalado). Um único comando faz tudo o que antes era manual:

1. Gera de novo todas as fixtures GTFS de mentira (`tests/mocks/build_mock_*.js`), sempre com horários "daqui a alguns minutos" — nunca fixtures antigas com horas já passadas.
2. Arranca todos os mock servers das fontes externas (GTFS, CKAN, APIs de preços/eventos) em portas fixas, para os testes nunca dependerem da rede real nem dos sites originais estarem no ar.
3. Arranca o `server.js` principal com as variáveis de ambiente já todas apontadas para esses mocks.
4. Corre todos os ficheiros `tests/e2e/test_*.js` (cada um abre um browser Chromium de verdade e usa a app como uma pessoa usaria), em paralelo (`--concurrency=N`, por omissão 6).
5. No final, mostra um resumo — quantos ficheiros passaram, quantos tiveram alguma falha, quantos rebentaram com uma exceção — e o código de saída reflete isso (útil para gates de CI no futuro).

O output completo de cada teste fica em `tests/output/logs/<ficheiro>.log` (não commitado); o terminal só mostra o resumo, para não inundar com milhares de linhas.

**Quatro notas sobre como isto está organizado:**
- Há três "lotes", cada um com o `server.js` reiniciado com variáveis de ambiente diferentes (o resto do ambiente mantém-se igual entre eles): o lote "geral" (a maioria dos testes), o lote "comboios em trânsito (CP)" (a CP tem dois conjuntos de dados de mentira diferentes para a mesma variável `CP_GTFS_URL` — partidas próximas fixas vs. viagens "em trânsito agora" — e como o servidor só lê essa variável uma vez e guarda o resultado em cache, é preciso reiniciar só para trocá-la) e o lote "email" (2FA por email e redefinição de senha, com `EMAIL_USER`/`EMAIL_PASS`/`SMTP_HOST`/`SMTP_PORT` só ligados aqui — os testes do "fallback sem servidor de email configurado" precisam mesmo dessas variáveis ausentes no lote geral, por isso não podem partilhar ambiente com os testes de email a sério).
- Todos os feeds GTFS de mentira (incluindo o de Guimarães, que antes usava um excerto real da GUIMABUS) usam dados **sintéticos** com uma partida "daqui a 5 minutos" gerada a cada corrida — um excerto de horário real tem partidas fixas do dia e fica sem nenhuma a certas horas (ex.: de madrugada), o que tornava os testes de "próxima partida" instáveis consoante a hora do dia em que a suite corresse.
- O runner apaga os ficheiros de persistência local (`pins.json`, `blocked.json`, etc. — os mesmos usados quando `MONGO_URI` não está definida) antes de cada corrida. Alguns testes usam o mesmo ID fixo para uma conversa/mensagem em todas as execuções; sem esta limpeza, esse estado ficava a acumular-se de corrida para corrida e alguns testes passavam a falhar por causa de dados residuais, não de um bug.
- Os testes de 2FA/redefinição de senha por email correm o código real de envio de email (`nodemailer`) contra um servidor SMTP falso local (`tests/mocks/fake_smtp.js`, sem AUTH/TLS, com um inspetor HTTP na porta 2526 para o teste ir buscar o último email "enviado" e extrair o código de verificação) — em vez de simular esse envio, exercitam o caminho real do servidor de ponta a ponta.

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
- **Painel de administrador (⚙️)** — visível apenas para o administrador, lista todos os usuários cadastrados (nome, telemóvel, país, email). Por padrão, o **primeiro usuário a se cadastrar** no servidor vira administrador automaticamente. Para escolher um telemóvel específico como admin, defina a variável de ambiente `ADMIN_PHONE` no Railway/Render (Settings → Variables) com o número exato usado no cadastro. Cada conta (menos a do próprio admin) tem um botão "🗑️ Apagar" — pensado para quando alguém esqueceu a senha e não tem forma de a recuperar (ainda não existe uma redefinição de senha a sério): apagar a conta liberta o telemóvel/nome de utilizador para essa pessoa se voltar a registar do zero. É permanente e não pede a senha da conta (só confirma que quem pede é mesmo o administrador) — as mensagens que essa pessoa já tinha enviado continuam nas conversas de quem as recebeu, tal como acontece quando alguém apaga a própria conta.
- **Contatos reais, com online/offline (🟢/⚪)** — todo usuário cadastrado no servidor aparece automaticamente na lista de conversas de todo mundo (não é preciso adicionar manualmente), com uma bolinha indicando se está ligado agora. As mensagens ficam salvas mesmo enviadas para quem está offline.
- **Grupos visíveis a todos** — qualquer grupo criado (botão 👥) aparece automaticamente para **todos os usuários cadastrados**, sem precisar de convite — funciona como um canal público. É guardado no servidor (`groups.json`), sobrevive a reinícios (mas não a redeploys — ver aviso abaixo).
- **Assistente de IA real (GitHub Models)** — a resposta automática do 🤖 Assistente IA deixou de ser um robô de palavras-chave e passou a usar a API gratuita da GitHub Models (a mesma infraestrutura do Copilot Chat). **Precisa de configuração** — ver secção abaixo.
- **Correção de chamadas/câmera no iPhone** — o Safari/iOS bloqueia por padrão a reprodução automática de áudio e vídeo que não seja resultado direto de um toque do usuário. Como isso acontecia bem depois do clique (só depois da negociação da chamada terminar), a chamada conectava mas ficava muda e com o vídeo preto no iPhone — parecia que "não funcionava". Agora, se isso acontecer, aparece um aviso "🔊 Toque para ativar o áudio e o vídeo" na tela da chamada — um toque resolve. Também adicionámos `webkit-playsinline` (compatibilidade com iOS mais antigo) e um aviso claro para quando o iPhone não suporta a transmissão de vídeo compartilhado em tempo real (limitação do Safari, não do app — nesse caso o vídeo compartilhado ainda toca localmente).
- **Localização em tempo real (📍, no cabeçalho da conversa)** — usa o GPS do próprio dispositivo (funciona em qualquer telemóvel ou computador) e mostra num mapa (OpenStreetMap, gratuito, sem chave) a posição de quem estiver a partilhar na conversa, com o **trajeto (rota)** desenhado no mapa e uma estimativa do **meio de transporte** (a pé, bicicleta/trânsito, veículo) calculada pela velocidade entre os pontos. Não fica gravado no servidor — é só "ao vivo", como a localização em tempo real do WhatsApp.

### Sobre o visual "estilo WhatsApp"

As cores do app (fundo escuro, verde de destaque, bolhas de mensagem) já foram desenhadas a partir da paleta oficial do WhatsApp Web no modo escuro — não foi preciso mudar a estrutura para isso. As funcionalidades extra (tradutor, quadro branco em tempo real, chat ao lado da videochamada, música partilhada na chamada, localização com trajeto, assistente de IA real, admin, transportes em tempo real) já vão além do que o WhatsApp oferece.

## Transportes em tempo real (🚌, no cabeçalho)

Cinco separadores (os quatro primeiros num mapa Leaflet + OpenStreetMap, gratuito, sem chave; o "Preços" é só uma pesquisa por texto, sem mapa):
- **🚌 Autocarros** — posição ao vivo de cada autocarro da Carris Metropolitana (Área Metropolitana de Lisboa), via API oficial gratuita e sem chave. Tem um alternador "Lisboa (ao vivo)" / "Guimarães (horários)" / "Porto" / "Madrid (EMT)" / "Valência (EMT)" — Guimarães mostra horários programados da GUIMABUS (via GTFS aberto); Porto mostra Metro do Porto (horários, via GTFS) e STCP (chegadas em tempo real); Madrid e Valência mostram horários programados das respetivas EMT (via GTFS aberto, ver secções próprias abaixo). Só Lisboa (Carris) e a STCP têm posição/chegada ao vivo — o resto é horário programado.
- **✈️ Aviões** — tráfego aéreo ao vivo sobre Portugal e Espanha, via OpenSky Network (gratuita, sem chave, uso razoável). Tem uma **caixa de filtro por companhia** — escreve o código ICAO (ex.: `RYR`) **ou o nome da companhia** (ex.: `Ryanair`, `TAP`, `easyJet`) e só ficam visíveis no mapa os voos dessa companhia; o filtro é aplicado no browser sobre os dados já recebidos, não gasta cota extra da OpenSky. Os nomes reconhecidos são traduzidos para o código ICAO por um pequeno dicionário no cliente (as companhias mais comuns na Europa); um nome não reconhecido é tratado como código literal, tal como antes. Nota: a OpenSky não devolve o aeroporto de origem/destino de cada voo ao vivo (só posição, altitude e velocidade) — só existe essa informação para voos já terminados, via outro endpoint, com uma cota muito mais restrita.
- **🚇 Metro/Comboio** — mostra a localização das estações de Metro de Lisboa e das estações de comboio, mas **sem posição ao vivo** dos veículos (nem o Metro de Lisboa nem a CP/Renfe/SNCF têm uma API gratuita e sem registo para posição ao vivo). Tem uma **barra de pesquisa de horários do Metro de Lisboa** e uma **barra de pesquisa de horários da CP** (ambas partidas programadas, não ao vivo — ver secções abaixo), um **estado do serviço do Metro de Lisboa** (linha Azul/Amarela/Vermelha/Verde — normal, perturbada, etc.), um interruptor **"🚆 Ver comboios de Portugal (CP/Fertagus) e Espanha (Renfe) em trânsito (estimado)"** — ver secção própria abaixo — e um alternador **"🇵🇹 Portugal" / "🇪🇸 Madrid" / "🇪🇸 Valência" / "🇪🇸 Espanha (Renfe)" / "🇫🇷 França (Transilien)"** que troca para uma pesquisa de estações de Metro/Metro Ligero/Cercanías de Madrid, do Metrovalencia, da Renfe (Cercanías/Rodalies + AVE/longa distância, à escala nacional), ou da SNCF Transilien (Paris/Île-de-França) — ver secções próprias abaixo.
- **🎫 Preços (Europa)** — pesquisa de preços por cidade/estação/aeroporto de origem+destino e data (ao contrário dos outros separadores, isto não é rastreamento ao vivo nem horário programado, é pesquisa de tarifas — ver secção abaixo). Tem um alternador **"🚆🚌 Comboio/Autocarro"** (Tictactrip) / **"✈️ Voos"** (Ignav) / **"🧭 Planeador"** (compara as duas fontes lado a lado) dentro da própria aba.
- **🚲 Bicicletas (GIRA)** — posição das estações de bicicletas partilhadas da GIRA (Lisboa), com bicicletas/docas disponíveis por estação — ver secção própria abaixo, incluindo por que só a GIRA entra (pediram também Lime e Bolt).

### Estado do serviço do Metro de Lisboa — como funciona
A API oficial do Metro de Lisboa (`api.metrolisboa.pt`) bloqueia ligações vindas de servidores na nuvem — confirmámos isto tanto em desenvolvimento como já publicado no Railway, mesmo com credenciais corretas (a ligação chega a estabelecer-se mas é rejeitada a meio, de forma consistente, sugerindo um bloqueio deliberado a tráfego de datacenters). Por isso, usamos antes a API pública e gratuita da [UnderLX](https://perturbacoes.pt) — um projeto da comunidade dedicado precisamente a acompanhar as perturbações do Metro de Lisboa (juntando fontes oficiais com relatos de utilizadores). **Não precisa de registo nem de chave.** Se a UnderLX alguma vez ficar indisponível, a secção mostra um erro amigável — o resto da app não é afetado. A Renfe (Espanha) não disponibiliza nada de aberto/gratuito, nem ao vivo nem horários.

### Horários do Metro de Lisboa — como funciona
A API oficial do Metro de Lisboa está bloqueada para tráfego de datacenter (ver secção do estado do serviço acima), por isso os **horários** seguem o mesmo caminho que resolveu a CP: o próprio Metro de Lisboa publica um feed GTFS "Google Transit" no seu site público, em `https://www.metrolisboa.pt/google_transit/googleTransit.zip` — não é a API bloqueada, é um ficheiro estático para qualquer app de trajetos (Google Maps, etc.) usar. Usa o mesmo motor GTFS partilhado com a CP, Guimarães e o Porto (cache de 24h em memória), servindo pesquisa de estações e próximas partidas através de `/api/transport/metro-lisboa/stops` e `/api/transport/metro-lisboa/departures`.

- **`METRO_LISBOA_GTFS_URL`** (opcional) — se definida, substitui o valor por omissão.

Tal como a CP, não foi possível confirmar esta URL a partir do ambiente de desenvolvimento (a rede aqui bloqueia praticamente todos os domínios `.pt`), por isso a confirmação real só é possível já em produção. Se a fonte falhar, a pesquisa mostra um erro amigável — o resto da app não é afetado.

### Horários da CP (Comboios de Portugal) — como funciona
A CP não publica posição ao vivo dos comboios, mas publica os **horários programados** em formato aberto GTFS (o mesmo formato usado por transportes públicos em todo o mundo). O servidor descarrega esse ficheiro (um `.zip` com várias tabelas CSV), guarda-o em memória durante 24 horas, e serve pesquisa de estações e próximas partidas através de `/api/trains/stations` e `/api/trains/departures`.

A fonte "oficial" original (dados.gov.pt → transporlis.pt) está abandonada há mais de um ano — confirmámos que já devolvia um ficheiro GTFS vazio (só cabeçalhos, sem dados) em abril de 2024. Em vez disso, o valor por omissão aponta para `https://publico.cp.pt/gtfs/gtfs.zip`, um feed GTFS da própria CP que confirmámos estar mesmo a funcionar (dados reais de partidas testados na app).

- **`CP_GTFS_URL`** (opcional) — se definida, substitui o valor por omissão. Útil se a URL da CP alguma vez mudar.
- **`MOBILITY_DB_REFRESH_TOKEN`** (opcional, último recurso) — token de atualização da tua conta em [mobilitydatabase.org](https://mobilitydatabase.org), usado só se quiseres experimentar essa fonte alternativa em vez do valor por omissão (feed `mdb-1037`, configurável via `MOBILITY_DB_FEED_ID`) — mas nota que, à data de escrita, essa cópia estava vazia.

Se a fonte escolhida falhar, a pesquisa de comboios mostra um erro amigável — o resto da app continua a funcionar normalmente (autocarros e aviões não são afetados).

**Fertagus (comboio Lisboa ↔ Península de Setúbal)** entra pela mesma pesquisa: é uma operadora diferente da CP (Roma-Areeiro/Sete Rios/Campolide ↔ Pragal/Coina/Setúbal), com o seu próprio feed GTFS no mesmo portal `transporlis.pt`. Cada resultado da pesquisa mostra a operadora entre parêntesis (ex.: "Roma-Areeiro (Fertagus)"), e as partidas de cada uma vêm sempre do feed certo — nunca se misturam os horários dos dois operadores. Configurável por **`FERTAGUS_GTFS_URL`** (opcional), com o mesmo fallback via Mobility Database (`MOBILITY_DB_REFRESH_TOKEN` + feed `mdb-1034`, configurável via `FERTAGUS_MOBILITY_DB_FEED_ID`) usado para a CP — importante aqui porque a Mobility Database indicava, à data de escrita, que este feed tinha mudado de URL recentemente, por isso o valor por omissão pode ficar desatualizado mais cedo que o da CP. Se a Fertagus falhar, a pesquisa continua a mostrar as estações da CP normalmente (e vice-versa) — as duas fontes são independentes.

**Limitação conhecida:** o GTFS representa horários depois da meia-noite como "25:10" (para a 01:10 do dia seguinte); esta versão trata isso como texto simples, por isso partidas mesmo à volta da meia-noite podem não aparecer pela ordem certa nessa janela específica. Não afeta o resto do dia. Esta limitação aplica-se a qualquer feed GTFS usado pela app, incluindo o de Guimarães abaixo.

### Comboios da CP e Fertagus "em trânsito" — posição ESTIMADA, não GPS ao vivo
Nem a CP nem a Fertagus publicam posição ao vivo dos comboios (ver acima) — mas o horário GTFS já nos diz exatamente a que horas cada comboio passa por cada estação. Com o interruptor "🚆 Ver comboios da CP e Fertagus em trânsito", o servidor calcula uma **posição estimada** para cada viagem atualmente a decorrer nos dois operadores: interpola linearmente entre as duas paragens do horário que envolvem a hora atual (ou mostra a paragem exata, se o comboio estiver parado nela dentro da janela chegada→partida).

**Isto não é GPS real** — assume que a viagem está a decorrer exatamente conforme o horário, sem atrasos nem paragens não planeadas. Cada comboio no mapa tem um ícone (🚂) com popup identificando a operadora ("posição estimada pelo horário — não é GPS ao vivo") e um link **"🔎 Ver detalhes deste comboio"**. Ao selecionar um comboio (só um de cada vez, para não sobrepor rotas quando há vários em trânsito): aparece a linha tracejada da rota completa dessa viagem, um marcador por paragem (🟢 origem, 🔸 intermédia, 🔴 destino) com a hora do horário, e um painel com o itinerário completo — paragens já passadas riscadas (✅), a atual a negrito (🚂), as seguintes normais. Atualiza a cada 30 segundos enquanto o interruptor estiver ligado (cálculo local, sem custo de pedidos a nenhuma API externa). Endpoint: `/api/trains/positions-estimated`.

**Correção importante (fuso horário):** um utilizador reparou que os horários mostrados não batiam certo com a hora real do telemóvel (cerca de 1h de diferença). A causa: o servidor comparava os horários do GTFS (sempre hora local de Portugal) com `new Date()` interpretado no fuso horário do próprio processo — que em produção (Railway) corre em UTC, não em hora de Portugal. Como Portugal está em UTC+1 no horário de verão (WEST), isso desalinhava sistematicamente todos os cálculos "o que está a acontecer agora": partidas próximas do Metro de Lisboa/CP/Guimarães/Porto, e a posição estimada dos comboios em trânsito. Corrigido: agora há uma função (`nowInLisbon()`) que converte explicitamente para a hora de Lisboa antes de qualquer comparação, em vez de confiar no fuso horário do servidor — corrige isto para todos os feeds GTFS da app de uma só vez, não só para a CP/Fertagus.

**Margem de incerteza (em vez de atrasos inventados):** o utilizador perguntou se conseguíamos estimar atrasos de 5 a 10 minutos. Não há nenhuma fonte GTFS-RT (tempo real) gratuita para nenhum dos operadores desta app (CP, Fertagus, Madrid, Valência, Renfe) — inventar um número de atraso seria desonesto, já que não temos forma nenhuma de o saber. Em vez disso, ao selecionar um comboio, o mapa desenha também uma **linha vermelha translúcida** entre a posição "a horas" (assumindo que a viagem decorre exatamente conforme o horário) e a posição mais atrás que o comboio poderia realmente estar se estivesse atrasado até 10 minutos (nunca mais à frente — um comboio não chega adiantado). O painel de detalhes explica isto por texto também. Configurável no código via `TRAIN_DELAY_UNCERTAINTY_MIN` (server.js) — por omissão 10 minutos, um valor plausível para viagens regionais/intercidades sem ser alarmista.

### Autocarros de Guimarães (GUIMABUS) — como funciona
Ao contrário da CP, este feed GTFS está mesmo a funcionar: dados publicados no nó regional de dados abertos do Minho ([Minho Access Point](https://minhoaccesspoint.eu)), encontrados através do portal [MAP da Ubiwhere](https://map.mobility.ubiwhere.com/dataset/operador-de-sptp-de-guimaraes). Usa o mesmo motor GTFS partilhado com a CP (cache de 24h em memória). Configurável por **`GUIMARAES_GTFS_URL`** (opcional — por omissão já aponta para o ficheiro correto). Se a fonte alguma vez ficar indisponível, mostra um erro amigável nessa secção; o resto da app não é afetado.

### Porto (Metro do Porto + STCP) — como funciona
A pesquisa de paragem/estação no Porto junta dois feeds GTFS diferentes, ambos publicados no portal de dados abertos da Câmara do Porto ([opendata.porto.digital](https://opendata.porto.digital)): um para o **Metro do Porto**, outro para a **STCP**. Configuráveis por **`METRO_PORTO_GTFS_URL`** e **`STCP_GTFS_URL`** (opcionais — já apontam por omissão para os ficheiros corretos).

- **Metro do Porto** — só tem horários programados (sem posição ao vivo pública conhecida), tal como Guimarães.
- **STCP** — o GTFS serve só para pesquisar a paragem por nome; as chegadas mostradas vêm da própria API pública e sem autenticação do site da STCP (`stcp.pt/api/.../realtime`), a mesma que o site deles usa — por isso são chegadas **em tempo real**, não horário fixo.

Se alguma das fontes falhar, mostra um erro amigável só nessa parte da pesquisa — o resto da app não é afetado.

### Madrid (EMT + Metro + Metro Ligero + Cercanías) — como funciona
Primeira expansão para Espanha, a pedido do utilizador (que também pediu Valência e Renfe nacional — ainda por fazer, em incrementos separados). Todas as fontes são feeds GTFS oficiais publicados pelo **CRTM** (Consorcio Regional de Transportes de Madrid) no seu portal ArcGIS Online, em URLs de download direto (sem registo nem chave) no formato `crtm.maps.arcgis.com/sharing/rest/content/items/<id>/data` — confirmámos cada um destes por pesquisa, e usámo-los em vez das páginas de destino `datos.madrid.es`/`nap.transportes.gob.es` que tínhamos recebido inicialmente, porque essas são páginas de apresentação, não o ficheiro em si.

- **🚌 EMT Madrid** (autocarros) — entra como mais uma opção no alternador de Autocarros ("📍 Madrid (EMT)"), com a mesma barra de pesquisa e o mesmo modal de partidas já usados para Guimarães. Configurável por **`EMT_MADRID_GTFS_URL`** (opcional).
- **🚇 Metro de Madrid**, **🚈 Metro Ligero** e **🚆 Cercanías** — juntam-se numa única pesquisa dentro do novo alternador "🇪🇸 Madrid" da aba Metro/Comboio: cada resultado mostra a rede entre parêntesis (ex.: "Chamartín (Cercanías)") e as partidas de cada rede vêm sempre do feed certo, tal como acontece com CP/Fertagus. Configuráveis por **`METRO_MADRID_GTFS_URL`**, **`METRO_LIGERO_MADRID_GTFS_URL`** e **`CERCANIAS_MADRID_GTFS_URL`** (todas opcionais). Só há horários programados — nenhuma destas três redes publica posição ao vivo gratuita e sem registo.

**Fuso horário:** Espanha usa `Europe/Madrid`, que não coincide sempre com `Europe/Lisbon` (Portugal fica 1h atrás durante quase todo o ano, incluindo no horário de verão). Para evitar reintroduzir exatamente o mesmo bug corrigido acima para a CP/Fertagus, a função `nowInLisbon()` foi generalizada para `nowInTimeZone(timeZone)`, e os horários de Madrid usam sempre `Europe/Madrid` explicitamente — nunca o fuso da CP/Fertagus nem o do servidor.

Se alguma das quatro fontes falhar, mostra um erro amigável só nessa parte — as restantes (incluindo Portugal) não são afetadas.

### Valência (EMT + Metrovalencia) — como funciona
Segunda expansão para Espanha (falta ainda a Renfe nacional, em incremento separado). A **EMT Valência** (autocarros) usa o feed GTFS pedido inicialmente, publicado no portal de dados abertos da própria câmara ([opendata.vlci.valencia.es](https://opendata.vlci.valencia.es)) — confirmámos que é uma fonte oficial e direta, por isso foi usada tal como recebida.

O **Metrovalencia** (metro + tram, operado pela FGV — Ferrocarrils de la Generalitat Valenciana) é diferente: a fonte pedida inicialmente (`transitpdf.com/uran/improved-gtfs-metro-de-valencia-esp.zip`) confirmámos por pesquisa ser uma cópia de terceiros, não a fonte oficial (o nome "improved" já é uma pista). Em vez disso, usámos a fonte real da própria FGV, encontrada no mesmo padrão de URL estática já usado para o Metro de Lisboa e para a CP: `metrovalencia.es/google_transit_feed/google_transit.zip`.

- **🚌 EMT Valência** — mais uma opção no alternador de Autocarros ("📍 Valência (EMT)"), reaproveitando a mesma barra de pesquisa e modal de partidas de Guimarães/Madrid. Configurável por **`EMT_VALENCIA_GTFS_URL`** (opcional).
- **🚇 Metrovalencia** — nova opção "🇪🇸 Valência" no alternador da aba Metro/Comboio (ao lado de Portugal e Madrid). Configurável por **`METRO_VALENCIA_GTFS_URL`** (opcional). Só horários programados — sem posição ao vivo pública conhecida.

Valência usa o mesmo fuso `Europe/Madrid` que Madrid (não tem fuso próprio em Espanha), por isso reaproveita a mesma passagem por `nowInTimeZone('Europe/Madrid')` sem qualquer alteração adicional.

**Problema confirmado em produção:** o site oficial (`metrovalencia.es`) recusa-se a ligar a partir do Railway — nem HTTP nem HTTPS chegam sequer a estabelecer ligação ("fetch failed", um erro de rede, não um erro HTTP normal), provavelmente por bloquear tráfego de datacenter, o mesmo problema já visto no Metro de Lisboa. Em vez do site oficial, há agora o mesmo fallback via Mobility Database já usado para a CP/Fertagus: com **`MOBILITY_DB_REFRESH_TOKEN`** configurado (ver secção da CP acima), o Metrovalencia passa a vir da cópia da Mobility Database (feed `mdb-1054`, configurável via `METRO_VALENCIA_MOBILITY_DB_FEED_ID`) em vez do URL direto.

Se alguma das duas fontes falhar, mostra um erro amigável só nessa parte — as restantes (Portugal, Madrid) não são afetadas.

### Renfe (nacional — Cercanías/Rodalies + AVE/longa distância) — como funciona
Terceira e última das expansões para Espanha pedidas pelo utilizador. Ao contrário de Madrid e Valência (redes de uma cidade), a Renfe é nacional — por isso entra como mais uma opção **"🇪🇸 Espanha (Renfe)"** no mesmo alternador da aba Metro/Comboio, em vez de ser uma "cidade" própria, e junta as duas fontes na mesma pesquisa (cada resultado mostra a rede entre parêntesis).

As duas fontes vêm do próprio portal de dados abertos da Renfe ([data.renfe.com](https://data.renfe.com)), que é CKAN — a mesma plataforma já usada pela GIRA. Tal como na GIRA, o servidor não aponta direto para um link de recurso (um UUID que muda sempre que o dataset é republicado); em vez disso, pergunta primeiro ao `package_show` do dataset qual é o recurso atual, e só depois descarrega esse ficheiro. Isto foi necessário aqui porque o URL do dataset "AVE/Longa Distância" pedido inicialmente estava desatualizado — confirmámos por pesquisa o slug correto de cada dataset.

- **🚆 Cercanías/Rodalies** — comboios suburbanos/regionais em toda a Espanha (dataset `horarios-cercanias`).
- **🚄 AVE/Larga Distância** — alta velocidade e longa/média distância entre cidades (dataset `horarios-de-alta-velocidad-larga-distancia-y-media-distancia`).

Configuráveis por **`RENFE_CKAN_BASE`**, **`RENFE_CERCANIAS_DATASET_ID`** e **`RENFE_AVE_DATASET_ID`** (todos opcionais — os valores por omissão já apontam para os datasets certos). Só há horários programados — a Renfe não publica posição ao vivo gratuita e sem registo. Usa `Europe/Madrid`, tal como Madrid e Valência.

Se alguma das duas fontes falhar, mostra um erro amigável só nessa parte — as restantes (incluindo Portugal, Madrid e Valência) não são afetadas.

A Renfe (Cercanías + AVE) entrou também no mapa de **"comboios em trânsito (estimado)"** — ver secção própria acima — juntamente com a CP e a Fertagus. É a mesma limitação de sempre: sem GTFS-RT gratuito, é só uma posição estimada pelo horário, nunca GPS ao vivo. Como Espanha usa CET/CEST (uma hora à frente de Portugal), a hora "agora" usada para calcular a posição da Renfe é sempre `Europe/Madrid`, nunca a hora de Lisboa.

### França (SNCF Transilien — Paris/Île-de-França) — como funciona
Pedido do utilizador, com uma ressalva importante: o feed **nacional** da SNCF (TER + Intercités + TGV, o país inteiro, janela rolante de ~150 dias) é enorme — dezenas/centenas de MB comprimido, potencialmente mais de 1GB depois de descomprimido/parseado em memória — pesado demais só para uma funcionalidade secundária de horários no meio de uma app de chat, e arriscado para uma instância pequena (ex.: o tier gratuito do Railway).

Em vez disso, entra como mais uma opção **"🇫🇷 França (Transilien)"** no mesmo alternador da aba Metro/Comboio, apontando por omissão para a **Transilien** (comboios suburbanos de Paris/Île-de-França — ~342 estações, 28 linhas), um recorte muito mais leve do mesmo país, à semelhança do que a Fertagus já é para a área de Lisboa. Configurável por **`FRANCE_GTFS_URL`** (opcional) se preferires apontar para outra rede — por exemplo, um TER regional específico do [transport.data.gouv.fr](https://transport.data.gouv.fr) — o motor GTFS é o mesmo para qualquer feed válido, só muda o URL.

Só há horários programados (sem posição ao vivo pública conhecida, e sem entrar no mapa de "comboios em trânsito" — essa parte ficou só para Portugal/Espanha, que já tinham o suporte pedido). Usa `Europe/Paris` (mesmo fuso que Espanha). Se a fonte falhar, mostra um erro amigável só nessa parte — as restantes redes não são afetadas.

### Preços de comboio/autocarro na Europa (Tictactrip) — como funciona
Ao contrário do rastreamento ao vivo (OpenSky, acima) ou dos horários programados (GTFS), preços por rota+data são dados comerciais — não existe nenhuma API verdadeiramente aberta e sem registo para isto. Usa-se a [Tictactrip](https://developers.tictactrip.eu), que junta mais de 250 transportadoras de comboio e autocarro por toda a Europa (Flixbus, OUIGO, etc.) — **não tem voos**, só comboio/autocarro (para voos, ver a secção Ignav abaixo).

- Escreve a cidade/estação de origem e destino nas caixas de pesquisa (tem de escolher uma opção da lista — não aceita texto livre) e uma data de partida, depois toca em "Pesquisar preços". A **data de volta é opcional** — se a preencheres, os resultados de ida e de volta aparecem juntos na lista, identificados com ➡️/⬅️. Cada resultado mostra preço, transportadora(s), horário e a pegada de CO₂ da viagem.
- Precisa de **`TICTACTRIP_API_TOKEN`**. Ao contrário de outras APIs desta app, o registo **não é self-service instantâneo** — envia um email para `dev@tictactrip.eu` a pedir um token de acesso. Sem esta variável definida, a secção mostra um aviso a pedir configuração, em vez de falhar.
- A lista de cidades/estações (`stopClusters`) só é atualizada pela Tictactrip de 1 em 1 ou 2 em 2 meses — por isso o servidor guarda-a em cache 7 dias e faz a pesquisa por nome em memória, como a própria documentação deles recomenda (evita pedir isto em tempo real a cada pesquisa).
- Os resultados de cada rota+data ficam em cache 10 minutos, para poupar a cota.

### Preços de voos (Ignav) — como funciona
A Amadeus (o GDS "oficial" usado por agências de viagens) **encerrou o programa Self-Service gratuito a 17 de julho de 2026** — confirmámos isto ao vivo, o registo passou a exigir um contrato "Enterprise" que não é self-service. A [Ignav](https://ignav.com) posiciona-se especificamente como alternativa self-serve para quem ficou sem essa opção (tem inclusive um guia de migração a partir da Amadeus). **Nunca processa pagamento nenhum aqui** — só devolve preços e, ao pedires, um link de reserva direto para a companhia aérea/OTA, onde tu (ou o utilizador) completas a compra.

- O modo Voos tem 3 secções, com um seletor no topo para trocar entre elas ("🔍 Pesquisar" / "🔔 Alertas" / "📊 Estatísticas") — mostra sempre só uma de cada vez, para não ficar tudo empilhado a ocupar o ecrã todo.
- **🔍 Pesquisar** — escolhe a origem e o destino num seletor (dropdown) com as 19 cidades já conhecidas da app (as mesmas dos "voos baratos" mais Lisboa/Porto/Faro — não é texto livre, evita erros de digitação no código IATA) e uma data, depois toca em "Pesquisar voos". A **data de volta é opcional** — se a preencheres, cada resultado mostra o preço combinado de ida+volta com os dois troços (a Ignav usa um endpoint diferente para ida e volta, `/fares/round-trip` em vez de `/fares/one-way`). Cada resultado tem um botão "🔗 Ver opções de reserva" que abre o link da companhia numa nova aba.
- Precisa de **`IGNAV_API_KEY`**. Regista-te em [ignav.com](https://ignav.com) — self-service, sem cartão de crédito, com 1000 pedidos grátis (depois $2/1000). Sem esta variável definida, a secção mostra um aviso a pedir configuração, em vez de falhar.
- Os resultados de cada rota+data ficam em cache 10 minutos, para poupar a cota gratuita.
- **💸 Voos baratos (Europa + São Tomé)** — só precisa da origem e da data (sem destino). A Ignav não tem um endpoint "qualquer destino", por isso o servidor pesquisa uma lista fixa de 16 destinos (grandes cidades europeias — Valência, Madrid, Barcelona, Londres, Paris, Roma, Milão, Amesterdão, Bruxelas, Berlim, Munique, Zurique, Viena, Atenas, Dublin — mais São Tomé, ligação relevante a partir de Portugal fora da Europa) uma a uma e mostra o mais barato de cada, ordenado por preço — **cada pesquisa gasta ~16 pedidos da cota gratuita**. Tocar num destino da lista preenche o campo e faz logo a pesquisa completa dessa rota.
- **🔔 Alertas de preço** — define uma rota+data+preço-alvo (ex.: "LIS→OPO abaixo de 60€") e recebe uma notificação push quando aparecer um voo a esse preço ou mais barato. Verificado a cada 12h (a cota gratuita da Ignav não aguenta mais frequência com vários alertas ativos); ao disparar, o alerta é removido — cria outro se quiseres continuar a vigiar essa rota. Máximo de 5 alertas ativos por pessoa. Os alertas ficam guardados num ficheiro local no servidor (`price-alerts.json`), tal como lembretes e mensagens agendadas.
- **📊 Estatísticas de pesquisa / dashboard** (secção própria) — cada pesquisa de voo (Ignav) feita com sessão iniciada fica registada (rota, data, preço mais barato encontrado, distância e CO₂ estimados); mostra o total de pesquisas, a rota mais pesquisada, o preço mais baixo que já viste, a distância total pesquisada (com uma comparação divertida a "% da volta ao mundo", 40 075 km) e o CO₂ estimado somado. **Importante ser honesto sobre os limites disto:** é baseado no que pesquisaste, não no que efetivamente viajaste (a app não sabe se compraste o bilhete) — a distância/CO₂ usam a mesma estimativa por linha reta do Planeador, e só contam pesquisas feitas depois desta funcionalidade existir (pesquisas antigas não tinham esses campos guardados). Só cobre voos (Ignav) — a pesquisa de comboio/autocarro (Tictactrip) usa identificadores internos da Tictactrip em vez de códigos legíveis, por isso não entra nas estatísticas por agora. Guardado em `travel-history.json`, últimas 100 pesquisas por pessoa.
- **🎤 Comando por voz** — no modo Voos, o botão "Comando por voz" usa a Web Speech API nativa do browser (grátis, sem chave — mas só funciona em browsers com suporte, ex.: Chrome/Edge, não no Firefox) para ouvir um pedido em português (ex.: *"quero ir para Madrid amanhã"*) e preenche sozinho o destino (reconhece um pequeno dicionário de cidades — as mesmas dos "voos baratos" mais Lisboa/Porto/Faro) e a data (entende "hoje", "amanhã", "depois de amanhã", dias da semana — "próxima segunda", etc. — e "dia N"), correndo a pesquisa logo de seguida. Se a origem estiver vazia assume Lisboa (LIS); se já tiveres escrito uma origem, não a substitui. Se não reconhecer a cidade, mostra um aviso a pedir para escreveres à mão.

Se o token não estiver configurado ou a pesquisa falhar, mostra um erro amigável — o resto da app não é afetado.

### Planeador de viagens multimodal ("🧭 Planeador") — como funciona e as suas limitações
Terceiro modo dentro da aba "🎫 Preços", que compara lado a lado as fontes já existentes para a mesma rota+data: voo (Ignav), comboio/autocarro europeu (Tictactrip) e, só entre Lisboa/Porto/Faro, um comboio direto real via o GTFS da CP (usa o mesmo motor GTFS da pesquisa de horários — encontra viagens onde a mesma `trip_id` passa pelas duas estações, com hora de partida antes da de chegada).

**Importante ser honesto sobre o que isto NÃO faz:** não é um planeador porta-a-porta a sério. Cada opção mostrada é uma viagem de **um modo só** — não juntamos pernas de fontes diferentes numa única viagem combinada (ex.: "voo até à cidade + metro até ao centro" com horários e preços encadeados), porque não temos dados fiáveis de ligação porta-a-porta entre o aeroporto e a rede de transporte local de cada cidade, e inventar essa ligação daria informação errada. Construir isso a sério exigiria um motor de planeamento de viagens dedicado (ex.: OpenTripPlanner), fora do âmbito disto.

- Mostra até 3 opções (uma por fonte disponível para a rota), cada uma com preço, duração, número de escalas e pegada de CO₂ estimada — e uma recomendação da melhor opção geral (média igual entre preço, duração e CO₂ normalizados; a opção mais barata desempata).
- **CO₂**: quando a Tictactrip devolve o dado real por troço, é isso que se mostra. Nos restantes casos (voo via Ignav, ou o comboio direto da CP — nenhum dos dois fornece isto), é uma **estimativa aproximada** a partir da distância em linha reta (~115 g/passageiro-km para avião, ~35 g/passageiro-km para comboio — ordem de grandeza usada por várias calculadoras públicas, não uma pegada certificada).
- O comboio direto da CP não tem preço disponível via GTFS (só horário) — a secção diz isso claramente em vez de inventar um valor.
- Quando o avião é a opção recomendada, e o destino tem uma ligação de transporte público conhecida e estável a partir do aeroporto (ex.: Metro Vermelho no Aeroporto de Lisboa, RER B no Charles de Gaulle), aparece como uma **nota informativa estática** — não é uma viagem calculada com horários/preços reais, só um facto conhecido e útil.
- Cada perna só aparece se a fonte correspondente estiver configurada (`IGNAV_API_KEY`, `TICTACTRIP_API_TOKEN`) e tiver dados para essa rota — se nenhuma tiver, mostra um aviso a sugerir outra rota.

## 🔎 Mapa (no menu "Mais") — pesquisar um sítio qualquer e ver

Pedido do utilizador: um mapa "solto", separado do Turismo e da Navegação, só para escrever um sítio (morada, cidade, monumento) e vê-lo — sem ficar limitado a pontos turísticos por categoria (Turismo) nem obrigado a traçar uma rota (Navegação).

- Reaproveita a mesma pesquisa/geocodificação já usada pela Navegação (`/api/nav/geocode`, Nominatim/OpenStreetMap — gratuito, sem chave) — sem nenhum endpoint novo no servidor.
- Ao escolher um resultado, o mapa centra e mostra um marcador com um popup com o nome do sítio, um link **"🗺️ Google Maps"** e um botão **"🧭 Como chegar"** que fecha o Mapa e abre a Navegação já com esse destino escolhido (reaproveita `selectNavResult`, sem duplicar a lógica de geocodificação/rota).
- Sem posição ao vivo nem lista de categorias — é intencionalmente o ecrã mais simples dos três (Turismo, Navegação, Mapa), cada um com um objetivo diferente.

## Eventos culturais (🎭, no menu "Mais")

Investigámos várias fontes possíveis para outras ideias pendentes (estacionamento/mobilidade urbana, bicicletas/trotinetes partilhadas, marketplace de bilhetes, alertas de incidentes) e nenhuma tinha uma API pública e genuína sem exigir scraping ou engenharia reversa — por isso, para já, avançámos só com a que era claramente viável: a **Agenda Cultural de Lisboa**.

- Fonte: `https://www.agendalx.pt/wp-json/agendalx/v1/events` — API oficial, aberta e **gratuita da Câmara Municipal de Lisboa**, sem chave nem registo.
- **Só cobre eventos em Lisboa** — não encontrámos equivalente confirmado para o Porto ou outras cidades.
- O servidor guarda a resposta em cache 1 hora (`cachedFetch`); a API não parece ter parâmetros confirmados de pesquisa/paginação, por isso o filtro por nome ou categoria é feito no cliente, sobre a lista completa já recebida.
- Cada evento mostra título, subtítulo, descrição (a API devolve isto como uma lista de parágrafos, não uma string única — o servidor junta tudo e limpa o HTML antes de mostrar), datas, horário, local, categorias em etiquetas e um link "Ver mais" (o link direto vem da própria API, no campo `link`).
- **`AGENDALX_EVENTS_URL`** (opcional) — se definida, substitui o valor por omissão.
- O pedido inclui um User-Agent de browser real (tal como já fazemos para a RTP e outros sites .pt) — sem isso, o primeiro deploy em produção mostrou "Não foi possível obter os eventos agora", confirmando que o site recusa pedidos que pareçam vir de um robô/servidor.
- Tal como a CP e o Metro de Lisboa, não foi possível confirmar a forma exata da resposta a partir deste ambiente de desenvolvimento (a rede aqui bloqueia praticamente todos os domínios `.pt`) — por isso o formato inicial (inferido de documentação pública) estava errado em alguns detalhes: `categories_name_list` vem como objeto (não lista), `subtitle` e `description` vêm como lista de strings (não string nem `{rendered}`), e o `venue` não inclui morada. Foi tudo corrigido depois de o utilizador partilhar os logs reais de produção. A app continua tolerante a formatos inesperados: um campo estranho num evento é ignorado sem derrubar os restantes, e uma falha na fonte mostra um erro amigável sem afetar o resto da app.

### Bicicletas partilhadas (🚲, aba Transportes) — GIRA, e por que não Lime/Bolt
Pediram para juntar GIRA + Lime + Bolt num só ecrã de bicicletas/trotinetes. Só a **GIRA** entra:

- **GIRA** (Lisboa) é o sistema municipal, gerido pela EMEL/Câmara de Lisboa, com dados publicados no portal de dados abertos oficial deles (`dados.emel.pt`, uma plataforma CKAN — o mesmo tipo de portal já usado por outros municípios nesta app, ex. Porto). Primeiro pergunta-se ao `package_show` do CKAN quais os recursos do dataset "girastations", depois descarrega-se o recurso certo (evita apontar direto a um URL de recurso, que é um UUID que muda se o dataset for republicado).
- **Lime e Bolt ficam de fora.** São empresas privadas que, tal como o próprio pedido já assumia ("API não oficial"), não têm uma API pública documentada em Lisboa — só endpoints internos das respetivas apps, sem autorização para uso externo. Seguimos aqui o mesmo critério já aplicado a outras fontes nesta app (rejeitámos a API não-oficial da CP, o LetsFG, etc., pela mesma razão): não fazemos scraping/engenharia reversa de serviços privados sem uma API aberta genuína. Há ainda instabilidade regulatória em Lisboa quanto às trotinetes partilhadas (licenças a terminar, referendo proposto), o que tornaria qualquer integração desse tipo pouco fiável mesmo que existisse.
- **`GIRA_CKAN_BASE`** (opcional, por omissão `https://dados.emel.pt`) e **`GIRA_DATASET_ID`** (opcional, por omissão `girastations`) — configuráveis se algum dia mudar.
- Tal como as outras fontes `.pt` desta app, não foi possível confirmar os nomes exatos dos campos (latitude/longitude/bicicletas disponíveis/docas livres) a partir deste ambiente — o servidor tenta várias hipóteses comuns e ignora silenciosamente uma estação com dados que não reconhece, em vez de derrubar a lista inteira. Se a lista aparecer vazia ou com números estranhos em produção, um print dos logs do Railway (à procura de "Erro GIRA") ajuda a acertar os nomes certos, tal como aconteceu com os Eventos.
- Atualiza a cada 60 segundos enquanto o separador estiver aberto — mais espaçado do que os autocarros/aviões, por ser um portal de dados abertos municipal, não uma API desenhada para pedidos frequentes.

## Novidades nas mensagens

- **Responder a uma mensagem (↩️)** — toca no ícone por baixo de qualquer mensagem para responder a ela; aparece uma citação da mensagem original.
- **Apagar mensagem (🗑️)** — apaga para todos (só nas tuas próprias mensagens); fica um aviso "Mensagem apagada" no lugar.
- **Reações (😀)** — reage com 👍❤️😂😮😢🙏, aparecem como selos por baixo da mensagem.
- **"a escrever..."** — aparece no subtítulo da conversa quando a outra pessoa está a digitar.
- **Confirmação de leitura (✓/✓✓)** — ✓ cinzento quando enviada, ✓✓ azul quando a outra pessoa abre a conversa e lê.

### Ainda por vir
Posição ao vivo *real* (GPS) de comboios/metro — continua sem solução gratuita e fiável disponível; em alternativa, já há uma posição **estimada** pelo horário GTFS da CP (ver secção de Transportes); foto de perfil.

Também ficaram de fora, por não termos encontrado uma API pública genuína (só scraping, engenharia reversa ou acesso B2B/vendas): estacionamento e mobilidade urbana (parquímetros/lugares livres), bicicletas e trotinetes partilhadas, marketplace de bilhetes de eventos e alertas de incidentes de trânsito em tempo real. Se um dia surgir uma fonte aberta e legítima para alguma destas, vale a pena reconsiderar.

## Correção: chamadas que ligavam mas não davam para falar

Encontrei duas causas distintas para isto:

1. **TURN sobrecarregado.** O app usa um serviço gratuito e partilhado (openrelay) para ajudar duas pessoas a ligarem-se quando ambas estão atrás de router/NAT normal — é o caso mais comum. Esse serviço gratuito é usado por muita gente ao mesmo tempo e pode ficar lento ou recusar ligações em picos de utilização, o que faz a chamada "ligar" na sinalização (por isso o cronómetro arranca) mas o áudio/vídeo nunca chega a fluir de verdade.

   **Correção aplicada:** o app deteta quando isto acontece (ligação que cai, nunca chega a "connected" de verdade, ou conecta mas o vídeo remoto fica preso sem nenhuma imagem) e agora tenta mesmo recuperar sozinho — antes disto a tentativa automática (`restartIce()`) não tinha qualquer efeito real, porque nunca havia um novo pedido de ligação a ser enviado à outra pessoa; a ligação simplesmente ficava presa em "Conectado"/"A tentar reconectar..." para sempre. Corrigido tanto nas chamadas 1-para-1 como em grupo: agora envia mesmo um novo pedido de reconexão pela sinalização, e só quem ligou originalmente é que tenta (evita as duas pessoas tentarem ao mesmo tempo). Ao fim de 3 tentativas sem sucesso, mostra uma falha clara em vez de continuar a tentar para sempre.

   **Estado "Ligação instável" também ficava preso sem tentar nada:** o ecrã já avisava "⚠️ Ligação instável — a tentar recuperar..." assim que a ligação entrava em estado `disconnected`, mas essa recuperação só era mesmo acionada no estado seguinte (`failed`) — e muitas redes/navegadores demoram muito tempo (ou nunca chegam) a fazer essa transição, ficando "a tentar recuperar" sem nunca tentar nada de verdade. Agora, se a ligação continuar `disconnected` por mais de ~5 segundos (tempo suficiente para se resolver sozinha, como é comum), a mesma recuperação real é acionada automaticamente, sem esperar pelo estado `failed`.

   Além disso, se quiseres uma solução bem mais fiável e ainda gratuita (até 1TB/mês), podes ligar o TURN da Cloudflare:
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

## 🔒 Grupos privados (só por convite, com link/QR)

Por padrão, um grupo continua **aberto** — visível automaticamente a todos os utilizadores cadastrados, sem precisar de convidar ninguém (comportamento original, sem alterações). Agora, ao criar um grupo, há uma opção "🔒 Grupo privado" que inverte isto: o grupo fica **fechado**, só visível a quem já é membro (quem o criou, mais quem entrar por convite) — tal como um grupo normal do WhatsApp.

- Em "Gerir grupo" (só para administradores), aparece um link de convite + um QR code (gerado no nosso próprio servidor, nunca por um serviço externo — mesma ideia já usada no pareamento de dispositivo por QR). Quem abrir o link ou ler o QR entra automaticamente no grupo, mesmo que já tenha sessão iniciada noutra conversa da app.
- Um administrador pode gerar um **novo link a qualquer momento** — isso invalida logo o anterior, útil se o link tiver sido partilhado com quem não devia.
- Quem é removido (🚫) de um grupo privado perde o acesso imediatamente — o grupo desaparece da lista de conversas dele ao vivo, e teria de ser convidado de novo para voltar a entrar.
- A gestão de cargos/silenciar/remover num grupo privado passa a listar os membros reais do grupo (incluindo quem entrou por convite e não é teu contacto), em vez da lista de contactos usada nos grupos abertos.
- **Limitação conhecida**: só quem já é administrador pode ver/gerar o link de convite — não há (ainda) forma de um membro comum partilhar o convite diretamente pela app.

## 🌐 Comunidades (ligar vários grupos + canal de anúncios)

Uma comunidade junta vários grupos já existentes debaixo de um mesmo nome (ex.: "Bairro X" a ligar o grupo da rua, o da escola e o do condomínio) — acessível em "Grupos, chamadas e contactos" → "🌐 Comunidades".

- Ao criar uma comunidade, é gerado automaticamente um **canal de anúncios** (📢) — um grupo normal como outro qualquer na lista de conversas, mas onde **só administradores da comunidade podem publicar**; qualquer outra pessoa que tente escrever lá recebe um aviso claro e a mensagem nunca chega a mais ninguém (o servidor rejeita-a, tal como já acontecia com "silenciado num grupo").
- Só quem é administrador de um grupo **e** administrador da comunidade é que consegue ligá-lo a essa comunidade — assim ninguém arrasta o grupo de outra pessoa para uma comunidade sem o dono concordar. Um grupo só pode pertencer a uma comunidade de cada vez.
- Os administradores da comunidade podem promover/despromover outros administradores (o criador nunca pode ser removido) — os admins do canal de anúncios são automaticamente mantidos em sincronia com os admins da comunidade.
- Apagar uma comunidade (só quem a criou) apaga o canal de anúncios junto, mas os grupos que lá estavam ligados continuam a existir normalmente, só perdem a ligação.
- Tal como os grupos abertos, as comunidades são sempre públicas — visíveis a todos os utilizadores cadastrados, sem precisar de convite.

## 🖥️ Interface em vários idiomas (PT/EN/ES)

Além da tradução automática de **mensagens** (que já existia — ver "A língua que eu falo" no perfil), a própria **interface** da aplicação (botões, menus, ecrã de login) agora pode ser mostrada em português, inglês ou espanhol.

- Muda-se num de dois sítios: os 3 botões de bandeira no próprio **ecrã de login** (funciona mesmo antes de entrar/criar conta), ou "Idioma da interface" no **modal de perfil** (já autenticado).
- É uma preferência só deste aparelho (guardada no `localStorage`, tal como o idioma do tradutor rápido), não uma definição da conta sincronizada entre dispositivos — troca de aparelho volta a mostrar português por omissão.
- **Cobertura deliberadamente reduzida** (a app tem milhares de strings específicas de cada funcionalidade — traduzir tudo não seria realista numa sessão): está coberto o ecrã de login/registo/verificação/recuperação de senha, o modal de perfil, os três menus em grelha de funcionalidades ("Mais funcionalidades", "TV/Media", "Grupos/contactos/chamadas"), e as palavras de ação genéricas que se repetem em dezenas de modais por toda a app (Cancelar, Fechar, Guardar, Criar, Enviar, Apagar, Confirmar, etc. — traduzidas automaticamente onde quer que apareçam, sem precisar anotar cada modal um a um). Os textos explicativos específicos de cada funcionalidade (ex.: as instruções dentro de Transportes, Turismo, etc.) continuam em português.

## 🏆 Conquistas/gamificação

Um pequeno sistema de badges por marcos de uso, visível em "📊 As minhas estatísticas" (secção "🏆 Conquistas").

- Ao contrário das estatísticas normais (que são recalculadas a partir do histórico local de mensagens), os badges são **desbloqueados e guardados no servidor**, por isso continuam lá mesmo depois de reinstalar a app ou trocar de aparelho.
- Marcos cobertos: primeira mensagem enviada, 100 mensagens, primeiro grupo criado, primeira comunidade criada, primeira chamada atendida (chamadas perdidas/recusadas não contam), 10 chamadas atendidas, primeira despesa dividida registada, primeiro jogo iniciado (Galo/Damas/UNO), 50 fotos enviadas, uma mensagem enviada entre a meia-noite e as 5h ("Coruja"), e uma sequência de 7 dias seguidos a falar.
- Existe também um meta-badge, "🏅 Colecionador", que se desbloqueia sozinho ao atingir 5 badges normais.
- Ao desbloquear um badge novo aparece um aviso (toast) no ecrã, e o badge fica a cores na grelha (os ainda por desbloquear aparecem esbatidos/a cinzento).

## 🚨 SOS/Emergência

Um botão em "Mais funcionalidades" → "🚨 SOS" que envia a localização atual + um alerta a uma lista de até 10 "contactos de confiança".

- Os contactos de confiança só podem ser escolhidos de entre os teus contactos reais (validado também no servidor, não só na interface).
- Ao disparar o alerta: tenta obter a localização (mas envia o alerta na mesma, sem coordenadas, se o GPS estiver desligado/for recusado), e entrega-o como uma **mensagem normal** na tua conversa 1-para-1 com cada contacto de confiança — mesmo que essa pessoa nunca tenha aberto essa conversa contigo antes (torna-se teu contacto automaticamente, tal como ao receber a primeira mensagem de alguém novo).
- Quem recebe vê um banner vermelho no ecrã na hora (se estiver online), com um link "Ver no mapa", além da mensagem ficar guardada na conversa com um estilo visual distinto (fundo vermelho, 🚨).
- O alerta ignora de propósito "silenciado"/"não incomodar" — é pensado para nunca passar despercebido.

## 📆 Calendário partilhado de grupo

Em "⋯ Mais desta conversa" → "📆 Calendário" (só aparece em grupos, não em conversas 1-para-1). Qualquer membro pode marcar um evento (título, data, descrição opcional); no dia do evento, é postado automaticamente um lembrete como mensagem normal na conversa, em nome de quem o criou. Só quem criou o evento (ou um administrador do grupo) o pode apagar. Diferente do atalho "🎉 Criar evento (RSVP)" já existente (que é uma sondagem pontual "vou/não vou"), este é uma lista de eventos com data que fica visível de forma persistente, não uma mensagem isolada no meio da conversa.

**Limitação conhecida**: não envia notificação push a toda a gente no dia do evento (um grupo aberto pode ter todos os utilizadores cadastrados como "membros" implícitos, e um push em massa por cada evento seria demasiado intrusivo) — quem tiver o grupo aberto vê o lembrete ao vivo; os outros veem-no na próxima vez que abrirem a conversa.

## 📝 Notas colaborativas em tempo real

Em "⋯ Mais desta conversa" → "📝 Notas partilhadas" (grupos e conversas 1-para-1). Um bloco de texto único por conversa que todos podem ler e editar — as alterações de qualquer pessoa aparecem ao vivo para o resto de quem tiver o mesmo modal aberto.

- **Sem CRDT/operational-transform** — é "quem escreveu por último ganha" (a mesma simplicidade já aceite noutras funcionalidades desta app). Duas pessoas a escrever ao mesmo tempo sem nunca parar podem perder uma à outra o que escreveram — é um bloco de notas simples, não um editor tipo Google Docs.
- Para não saltar o cursor de quem está mesmo a meio de escrever: uma atualização que chega enquanto o teu campo está focado fica pendente e só é aplicada quando saíres do campo (ou reabrires o modal).

## 🎙️ Salas de áudio ao vivo (tipo Clubhouse/Spaces)

Em "⋯ Mais desta conversa" → "🎙️ Sala de áudio" (só em grupos). Construída em cima da chamada de grupo em malha (WebRTC) já existente — é uma chamada normal, só de voz, com um papel a mais:

- Quem entra primeiro na sala é o **anfitrião** e já pode falar. Quem entra a seguir começa **ouvinte** (silenciado).
- Um ouvinte que queira falar clica em "🖐️ Pedir para falar" — o anfitrião vê o pedido e pode "✅ Aprovar" ou recusar. Sem nenhuma re-negociação WebRTC: a pessoa já está ligada à chamada desde que entrou, só o microfone (a faixa de áudio) é que estava desativado — aprovar é só ativá-lo, tal como o botão de silenciar normal.
- O anfitrião também pode voltar a silenciar quem estiver a falar a qualquer momento ("🔇 Silenciar"). O servidor confirma sempre que quem pede para aprovar/silenciar é mesmo o anfitrião atual da sala — mais ninguém consegue aprovar-se a si próprio ou silenciar outra pessoa.
- Se o anfitrião sair a meio, o participante que está na sala há mais tempo é promovido automaticamente a anfitrião, para a sala continuar a funcionar.
- **Limitação conhecida (redução de âmbito deliberada)**: uma vez aprovado para falar, só se volta a ficar ouvinte manualmente ("🔇 Silenciar-me outra vez") — não há um estado intermédio de "silenciado temporariamente mas ainda com o lugar de orador". Isto simplifica bastante a implementação (nenhuma troca de faixas de áudio a meio da chamada) ao preço de ser um pouco menos flexível do que um Clubhouse/Spaces "a sério".

## 🎨 Filtros de vídeo ao vivo em chamadas

Um botão "🎨" na barra de ações de qualquer videochamada (1-para-1 ou de grupo) — diferente do "🤳 Tirar self" (que só aplica um filtro a uma FOTO parada), este aplica-se ao vídeo AO VIVO da própria chamada e é visto também por quem está do outro lado, não só localmente.

- Reaproveita a mesma lista de filtros do "Tirar self" (P&B, Sépia, Vívido, Frio, Quente, etc.). Cada frame do vídeo é desenhado num `<canvas>` escondido com o filtro CSS aplicado (`ctx.filter` aceita a mesma sintaxe), e a faixa capturada desse canvas substitui a que está a ser enviada — mesmo mecanismo já usado por "Compartilhar vídeo/tela" (`getActiveSenders`), por isso funciona automaticamente tanto numa chamada 1-para-1 como numa chamada de grupo inteira.
- Quem entra numa chamada de grupo DEPOIS de um filtro já estar ativo recebe-o logo desde o primeiro frame, sem ninguém precisar de o reaplicar.
- Escolher "Normal" para o filtro devolve a faixa crua da câmara e para o processamento por canvas (poupa CPU/bateria quando não há filtro nenhum ativo).

## ♞🔤 Mais jogos: Xadrez e Forca

Juntam-se ao Jogo do Galo/Damas/UNO já existentes no seletor de jogos (🎮), dentro de qualquer conversa 1-para-1 ou grupo.

- **Xadrez — versão simplificada**: movimentos de cada peça validados normalmente (incluindo o bloqueio de peças a meio do caminho para torre/bispo/dama, e o salto do cavalo por cima de outras peças), com promoção automática do peão a dama ao chegar à última fila. **Sem deteção de xeque/xeque-mate, sem roque e sem "en passant"** — o jogo só termina quando um rei é mesmo CAPTURADO, não só ameaçado. Esta redução de âmbito evita todo o código de "verificar se um movimento deixaria o próprio rei em xeque", que tornaria a implementação bem mais complexa.
- **Forca — cooperativa**: as duas pessoas da conversa tentam adivinhar juntas a mesma palavra secreta, sugerindo letras a qualquer momento (não há turnos — é cooperativo, não competitivo). A palavra é escolhida pelo **servidor** de uma pequena lista de palavras comuns em português — nunca chega ao cliente em claro antes do fim do jogo, só a versão mascarada (ex.: "_ A N A N A"), para nenhum dos dois lados poder "ver" a resposta a espreitar no código da página. 6 letras erradas acabam o jogo em derrota (a palavra é revelada só nesse momento).
- **Limitação partilhada com o UNO**: tal como o UNO, o Xadrez e a Forca em conversas 1-para-1 só funcionam entre pessoas que já sejam contactos reais uma da outra dos dois lados (o caminho de criação do jogo no servidor não trata do "torna-se contacto automaticamente" que as mensagens normais já fazem) — normalmente resolve-se sozinho assim que já falaram uma vez.

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


## 📲 Instalar como app (PWA)

O ChatApp agora pode ser **instalado no ecrã inicial** do telemóvel ou computador, como uma app nativa:
- **Android (Chrome)**: menu (⋮) → "Instalar aplicação" ou "Adicionar ao ecrã principal"
- **iPhone (Safari)**: botão de partilha → "Adicionar ao ecrã principal"
- **Computador (Chrome/Edge)**: ícone de instalação na barra de endereço

Depois de instalado, abre como uma janela própria (sem a barra do navegador) e já tem ícone. Tecnicamente: `manifest.json` (nome, ícones em 192px/512px, cor de tema, modo `standalone`) + `sw.js` (service worker — regista o "shell" da app em cache para funcionar melhor offline, e é ele que mostra as notificações push mesmo com a app fechada) + as meta tags do iOS (`apple-mobile-web-app-capable`, `apple-touch-icon`) para o Safari tratar isto como app instalável também.

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

## ↪️ Encaminhar mensagens

Um novo botão "↪️" junto às outras ações de uma mensagem (Responder, Reagir, Traduzir, Fixar) abre um seletor com todas as tuas conversas 1-para-1 e grupos — escolhe uma ou várias, e a mensagem é reenviada para lá tal como se a tivesses escrito de novo, com uma etiqueta "↪️ Encaminhada" a identificá-la.

- Não pede nada ao servidor para "ir buscar" a mensagem — reaproveita o conteúdo já carregado no teu ecrã (incluindo o texto já desencriptado, se vier de uma conversa 1-para-1 com E2EE), e volta a encriptar de novo para quem tiver chave pública, exatamente como já faz o envio para uma lista de transmissão
- Funciona para texto e para fotos/vídeos/áudios/documentos; **não está disponível** para enquetes, jogos, despesas, listas de compras partilhadas ou fotos "ver uma vez" — são conteúdos com estado próprio (votos, jogadas, ou já vistos/desaparecidos) que não fazem sentido copiados para outra conversa
- A mensagem original nunca é alterada — só a cópia enviada é que fica marcada como encaminhada

## 📺 TV em Direto (notícias)

Botão 📺 no cabeçalho, com aba própria: **📰 Notícias (ao vivo)** — Euronews em Português (🇵🇹), Euronews en Español (🇪🇸), France 24 (🇫🇷), TVS — São Tomé e Príncipe (🇸🇹, via site oficial `tvs.st`), Record News (🇧🇷), DW Español (🇩🇪) e El Doce — Córdoba, Argentina (🇦🇷). A maioria usa o endpoint público do YouTube que resolve sozinho "o que está em direto agora" naquele canal — não dependemos de um vídeo específico que muda a cada transmissão.

- Chegámos a esta lista depois de testar várias emissoras públicas mais pequenas (TVS, TPA, RTC, TVM, RTTL, Record Europa, TVG, TV Aparecida, RTVE) — a maioria não transmite mesmo pelo sistema de Live 24h do YouTube (dá "vídeo não disponível"), ou está bloqueada por região. Os 6 que ficaram são os que se confirmou funcionarem de verdade.
- Não incluí a **TDM (Macau)**, a **TV Girassol** nem a **TVOne** — não consegui confirmar um canal de YouTube fiável para nenhuma delas.
- **Recusei adicionar** conteúdo infantil com direitos de autor válidos (PJ Masks, Miraculous, Blippi, Disney Channel, Disney Jr) que foi pedido a par destes canais — não há forma legal e gratuita de os disponibilizar, tal como já tinha explicado sobre a série "Mentalista".
- Só coloquei conteúdo **gratuito e licenciado de verdade** — emissoras oficiais, nunca sites ou canais piratas.
- Comecei com as televisões públicas de Portugal e Espanha (RTP, RTVE), mas essas normalmente **bloqueiam a incorporação (embed)** da transmissão ao vivo fora do próprio site — por isso dava "vídeo não disponível". Troquei para a Euronews de cada língua, que mantém transmissão 24h pensada para ser incorporada, à semelhança da France 24.

**Removida a categoria "🎬 Filmes"** (lista por género com filmes de domínio público do Internet Archive) — a pedido, foi tirada por completo desta aba; a app continua a poder partilhar um filme/vídeo local dentro de uma chamada (botão 🎬 na barra da chamada), que é uma funcionalidade diferente e não foi afetada.

**Sobre canais aparecerem "offline" só nalguns aparelhos**: um canal de notícias em direto é um `<iframe>` do YouTube carregado diretamente no teu próprio navegador — a app não guarda nem processa o vídeo, é o YouTube a decidir se mostra o embed. Se funciona nalgum aparelho e não noutro, a causa está quase sempre do lado desse aparelho/rede, não no código da app: bloqueadores de anúncios/privacidade (uBlock, Brave Shields, "Bloquear rastreadores" no navegador) costumam bloquear especificamente `youtube.com/embed`; redes de escolas/empresas/alguns operadores móveis bloqueiam o YouTube por completo; e o Modo de navegação anónima/privada de alguns navegadores bloqueia cookies de terceiros, dos quais o embed às vezes depende. Vale a pena confirmar isso comparando o mesmo link `https://www.youtube.com/embed/live_stream?channel=...` diretamente numa aba nova nesse aparelho — se também falhar aí fora da app, confirma que é mesmo o aparelho/rede, não a app.

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

### 🙈 Esconder resultados até votar

Ao criar uma enquete, há uma opção "🙈 Esconder resultados até eu votar". Com ela ativada, ninguém vê percentagens, contagens de votos ou quem votou em quê antes de votar também — em vez disso só aparece "🙈 Os resultados aparecem depois de votares". Assim que a pessoa vota, os resultados completos ficam visíveis para ela imediatamente.

- **Aplicado no servidor, não só escondido na tela**: quem ainda não votou nunca recebe os votos reais nem sequer no histórico da conversa — não dá para ver os resultados abrindo as ferramentas de developer do navegador
- Quem criou a enquete também não vê os resultados enquanto não votar (a criação em si não conta como voto)
- Quando a votação encerra (se tiver prazo definido), os resultados deixam de ficar escondidos — esconder já não faz sentido depois de a votação acabar
- **Limitação conhecida**: se ainda não votaste quando a enquete expira, os resultados só ficam visíveis a partir da próxima vez que abrires essa conversa (não aparecem sozinhos em tempo real só por a contagem do tempo chegar a zero)

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

## 📄 Exportar uma conversa para PDF

Ao lado do "Exportar" já existente (que gera um `.txt` simples), há agora "📄 Exportar PDF" — a mesma transcrição da conversa, mas como um PDF paginado automaticamente (gerado com o jsPDF, carregado sob demanda, mesma biblioteca já usada na lista de compras), com o nome da conversa e a data de exportação no topo.

- Mensagens apagadas aparecem como "(mensagem apagada)"; fotos, vídeos e documentos aparecem como "(anexo: nome-do-ficheiro)" — **não ficam embutidos como imagem no PDF**, só o texto da conversa é exportado, tal como já acontecia no `.txt`
- Funciona também nas conversas 1-para-1 com encriptação ponta-a-ponta (exporta o texto já desencriptado neste aparelho)

## 📅 Mensagens agendadas (com repetição)

Em "⋯" → "Agendar", escreve-se (ou anexa-se foto/vídeo/áudio) uma mensagem e escolhe-se quando enviá-la — com atalhos rápidos ("+1 hora", "Amanhã 9h", etc.) ou uma data/hora à escolha. "📋 Ver agendadas" mostra tudo o que ainda está por enviar, com opção de cancelar.

Além do envio único já existente, há agora "🔁 Repetir": Diariamente, Semanalmente ou Mensalmente (sempre à mesma hora e, nos dois últimos casos, no mesmo dia da semana/mês da primeira vez). Uma mensagem recorrente nunca desaparece da lista depois de enviada — fica lá com o próximo horário já calculado, até a cancelares (o que também para todas as ocorrências futuras, não só a seguinte).

- **Se o servidor estiver em baixo à hora certa**, a mensagem recorrente é enviada assim que voltar (tal como já acontecia com uma mensagem de envio único) — mas nunca em "catch-up": se ficaram várias ocorrências por enviar durante esse tempo, só a mais recente é enviada, as anteriores são simplesmente saltadas, para nunca receberes uma rajada de mensagens atrasadas de uma só vez
- Funciona em grupos e em conversas 1-para-1, com ou sem anexo

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

### Bloquear uma conversa específica (em vez da app inteira)

No menu "⋯" de uma conversa, "🔒 Bloquear" esconde só ESSA conversa da lista principal — reaproveita o mesmo PIN já criado acima (não faz sentido ter dois PINs diferentes neste aparelho). As conversas bloqueadas somem da lista e ficam resumidas numa única linha "Conversas bloqueadas · N", que pede o PIN de novo (mesmo já com a app destrancada) antes de as mostrar — útil para mostrares o telemóvel a alguém por um instante sem revelar essas conversas específicas.

- Reforçado no lado do cliente para não ser só cosmético: abrir uma conversa bloqueada por qualquer atalho (ex.: um resultado da pesquisa global) pede o PIN em vez de a mostrar direto, e a própria pesquisa global não encontra mensagens dentro de conversas ainda bloqueadas
- Voltar de segundo plano (trocar de app, ecrã bloqueado) esconde as conversas bloqueadas de novo, tal como o resto da app volta a pedir o PIN
- Precisa de já teres um PIN criado — sem PIN, o botão avisa em vez de bloquear a conversa sem forma de a voltar a abrir
- Remover o PIN por completo desbloqueia automaticamente qualquer conversa que ainda estivesse bloqueada, para nunca ficarem presas sem forma de as veres

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

### 📄 Pesquisa dentro do conteúdo de anexos (PDF/.txt)

A pesquisa global agora também encontra termos que só existem **dentro** de um PDF ou ficheiro `.txt` enviado no chat, não só no nome do ficheiro. Ao enviar um destes anexos, o texto é extraído localmente no browser (biblioteca pdf.js, carregada só quando é mesmo preciso, tal como o gerador de PDF da lista de compras) e guardado junto da mensagem, para poder ser pesquisado mais tarde sem ter de reabrir o ficheiro. Um resultado que só bateu certo no conteúdo do anexo (e não no texto da própria mensagem) aparece com uma etiqueta "📎 nome-do-ficheiro:" antes do trecho encontrado, para ficar claro de onde veio.

- Funciona para **PDF** e **.txt** — Word/`.docx` ainda não têm extração de texto (precisava de outra biblioteca só para isso), continuam pesquisáveis só pelo nome do ficheiro, como já era antes
- Só o texto do documento é guardado (até um limite generoso de carateres, e até 30 páginas por PDF) — nunca o ficheiro inteiro outra vez
- Fotos "ver uma vez" nunca geram texto pesquisável, mesmo que fossem na prática uma imagem de um documento

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

## ✏️ Editar a foto antes de enviar (ou antes de publicar um estado)

Na pré-visualização da foto — seja antes de enviar numa conversa, seja ao escolher a foto de um novo "🟢 Estado" — um botão "✏️ Editar" abre o mesmo pequeno editor, tudo feito no browser, com um `<canvas>`:

- **✂️ Cortar**: arrasta na imagem para escolher a área, depois "Aplicar corte"
- **✏️ Desenhar**: traço livre, com cor e espessura à escolha
- **🔤 Texto**: toca onde queres escrever — aparece um campo de texto normal nesse ponto (não uma caixa de diálogo do sistema), dá para reler/corrigir antes de confirmar com Enter, ou cancelar com Esc/tocando fora
- **😀 Emoji**: escolhe um emoji e toca para o colar na imagem

"↩️ Desfazer" volta atrás um passo de cada vez (incluindo cortes, repondo também o tamanho anterior do canvas); "🔄 Repor original" descarta tudo e volta à foto tal como foi escolhida. Ao gravar, a imagem editada substitui a original no que vai ser enviado — o resto do fluxo (pré-visualização, "ver uma vez", upload) não nota diferença nenhuma entre uma foto editada e uma que não foi.

**Limitação conhecida**: depois de confirmado, o texto fica "cozido" na imagem — não dá para o voltar a mover ou reescrever (só desfazer e tentar de novo).

**Correção**: a primeira versão usava um `prompt()` do navegador para o texto, que em alguns telemóveis competia pelo foco com o toque no canvas e nunca chegava a aparecer — trocado por um campo de texto normal, dentro da própria página. De caminho, corrigido também: o ecrã do editor não tinha scroll, por isso em ecrãs pequenos os botões "Cancelar"/"Guardar" podiam ficar fora da vista sem forma de lá chegar; e a tecla Esc para cancelar o texto estava a propagar-se e a fechar o editor inteiro (e a própria conversa), em vez de só cancelar o que se estava a escrever.

A foto de um estado já pode estar num link do Cloudinary (por já ter sido carregada ao ser escolhida, antes de sequer abrires o editor) em vez de só existir neste aparelho — ao gravar a edição, volta a subir a versão editada para o Cloudinary da mesma forma, para o estado publicado não ficar preso à foto de antes de editar.

**Correção**: nem todo o Cloudinary está configurado para responder com os cabeçalhos de partilha entre origens (CORS) que o editor pedia sempre que a foto já estava num link remoto — quando não estavam, o carregamento da imagem falhava por completo (o ecrã ficava com um retângulo preto enorme, sem a foto, escondendo os botões "Cancelar"/"Guardar" e dando a sensação de estar preso no editor). Corrigido para tentar carregar sempre sem exigir isso à partida — a foto aparece e continua a dar para desenhar/escrever/colar emojis por cima na mesma; só cortar, desfazer e gravar é que precisam mesmo de conseguir ler os pixéis de volta, e nesse caso (raro, e só quando a foto vem de um servidor sem essa configuração) aparece um aviso claro a explicar porquê em vez de travar, sem nunca impedir sair pelo "Cancelar". Também nunca mais fica um retângulo enorme de uma sessão anterior à espera de uma imagem nova — o canvas começa sempre pequeno até a foto carregar, e há um limite de tempo para desistir e avisar, caso o carregamento fique preso de vez.

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

**Simplificação assumida**: como os grupos nesta app são "abertos" (qualquer conta cadastrada vê o grupo, sem uma lista fixa de membros a consultar), não há como perguntar ao servidor "quem está neste grupo". Por isso, quem pagou e quem participa numa despesa é identificado pelo **nome** de quem já enviou mensagens nessa conversa (não pelo número de telefone) — funciona bem no uso normal, mas duas pessoas com o mesmo nome de perfil na mesma conversa seriam tratadas como uma só. O valor guardado é sempre o nome real da pessoa (nunca o "Você" que aparece só como etiqueta para o próprio utilizador) — isto viaja dentro da despesa para a outra pessoa ver, ao contrário do campo de topo da mensagem, que já troca "Você" pelo nome real antes de enviar.

### 💳 Acertar contas (MB WAY / Pix)

Depois de registadas as despesas, a caixa de saldos mostra também **"Como acertar contas"**: em vez de listar quem deve/tem a receber pessoa a pessoa (o que pode dar voltas desnecessárias — "A deve a B" e "B deve a A" ao mesmo tempo), simplifica tudo no menor número de transferências possível (algoritmo guloso: o maior credor recebe do maior devedor até um dos dois ficar a zero, repete) e mostra diretamente "X paga Y,YY€ a Z". Cada transferência tem um botão "Ver" que abre como pagar:

- **💙 MB WAY** — mostra o número de telefone de quem tem de receber (Portugal paga por número, não há registo/API pública para gerar um link de pagamento pronto a abrir, ao contrário do Pix).
- **💠 Pix** — se a pessoa tiver uma **chave Pix** guardada no perfil ("O meu perfil" → 💠 Chave Pix, opcional), gera um código **"Pix Copia e Cola"** verdadeiro (formato BR Code/EMV QRCPS, a especificação pública do Banco Central), com o valor já convertido de EUR para BRL pelas mesmas taxas de câmbio da app — é só copiar e colar na app do banco. O código inclui um checksum CRC16/CCITT-FALSE calculado aqui mesmo (sem nenhuma API externa nem credenciais — é puro cálculo determinístico).

O telefone/chave Pix de quem tem de receber é resolvido pelo nome: numa conversa 1-para-1 já se sabe quem é a outra pessoa; num grupo, procura-se uma mensagem já enviada por alguém com esse nome (toda a mensagem carrega o telefone de quem a enviou) e só depois se pergunta ao servidor os dados públicos dessa conta — os mesmos campos que já se veem ao pesquisar por nome de utilizador, não é uma exposição nova.

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

Nova aba pessoal (menu "⋯ Mais funcionalidades") para lembretes do tipo "lembra-me disto às 18h" — diferente das mensagens agendadas (que são para enviar a outra pessoa numa conversa), isto é só para ti. Escreve o que queres que te lembre, escolhe a data/hora (ou usa um atalho: daqui a 1h/3h, esta noite às 20h, amanhã de manhã às 9h, ou o seletor "⏰ Ou escolhe só uma hora" para marcar qualquer hora do dia sem mexer na data — assume hoje, ou amanhã se essa hora já tiver passado) e é tudo.

**Funciona mesmo com a app fechada**: reaproveita a mesma notificação push já usada para mensagens novas — não é preciso estar com a app aberta no telemóvel para receber o aviso à hora marcada (desde que as notificações push já estejam ativadas). Se estiveres com a app aberta nesse momento, aparece também um aviso instantâneo, sem esperar por nenhuma notificação do sistema.

## 🔁 Despesas fixas mensais

Dentro do menu de "💰 Despesas" de qualquer conversa há agora um botão "🔁 Fixas" para criar despesas que se repetem todos os meses sozinhas — renda, Netflix, ginásio, etc. — sem teres de as lançar à mão. Define a descrição, o valor, a moeda, quem paga, entre quem se divide e em que dia do mês, e a partir daí o próprio servidor lança uma despesa a sério nessa conversa nesse dia, exatamente como se alguém a tivesse criado manualmente.

**Se o dia escolhido não existir nesse mês** (ex.: dia 31 em fevereiro ou abril), a despesa é lançada no último dia real desse mês, para nunca "saltar" um mês inteiro. E se em algum mês já foi lançada, não volta a ser lançada de novo nesse mesmo mês.

## 📊 Estatísticas do grupo

A versão "de grupo" de "📊 As minhas estatísticas": no menu "⋯ Mais desta conversa" de qualquer **grupo** há agora um botão "📊 Estatísticas" com um ranking de quem mais fala (e quantas fotos/vídeos cada pessoa partilhou), além do total de mensagens/fotos/vídeos/áudios do grupo todo, o emoji mais usado e a hora do dia mais movimentada.

Tal como as estatísticas pessoais, é tudo calculado a partir do histórico já carregado no aparelho — não pede nada novo ao servidor. Só aparece para grupos (não faz sentido num "ranking" de uma conversa 1-para-1).

## 🔑 Redefinir senha (esqueci a senha)

No ecrã de entrada há agora "Esqueceste a senha?": indicas o teu telemóvel, recebes um código de 6 dígitos por email (a mesma infraestrutura de email do 2FA/incêndios) e escolhes uma senha nova sem perderes a conta nem o histórico. O código expira em 10 minutos, é de uso único, e é invalidado ao fim de 5 tentativas erradas.

Redefinir a senha encerra logo todas as sessões ativas dessa conta em qualquer dispositivo (por segurança — se alguém tinha acesso indevido, perde-o já), com um aviso claro em vez de parecer só uma falha de rede.

**Precisa de um email guardado na conta e do servidor de email configurado** (variáveis `EMAIL_USER`/`EMAIL_PASS`, ver secção de incêndios acima) — sem isso, dá um erro claro a explicar que não há como enviar o código, e a alternativa continua a ser pedir a um administrador para apagar a conta (ver abaixo) e registares-te de novo.

## 🔐 Verificação em duas etapas

No perfil (👤 O meu perfil → "🔐 Segurança") há agora um campo de email (podes definir/corrigir o teu a qualquer momento, não só no registo) e um interruptor "Verificação em duas etapas". Quando ativado, entrar num **dispositivo novo** passa a pedir, além da senha, um código de 6 dígitos enviado para esse email — os dispositivos onde já tens sessão iniciada continuam a entrar normalmente, sem código nenhum.

**Degrada-se sozinho em vez de bloquear alguém**: só é possível ativar com um email já definido, e mesmo com a opção ativada, se o envio de email não estiver configurado no servidor (variáveis `EMAIL_USER`/`EMAIL_PASS`, ver secção de incêndios acima) ou falhar por qualquer razão, o login segue em frente sem pedir código — nunca fica ninguém trancado fora da própria conta por falta de configuração de email. O código expira em 10 minutos, é de uso único, e é invalidado ao fim de 5 tentativas erradas (basta voltar a tentar entrar para receber um novo).

## 🗑️ Apagar conta e 📥 exportar os meus dados

Também no perfil, em "⚠️ Zona de perigo": um botão "📥 Exportar os meus dados" descarrega um ficheiro `.json` com tudo o que a tua conta guarda — perfil, contactos, dispositivos ligados, lembretes, lista de compras, favoritos de turismo, histórico de chamadas, mensagens agendadas e as mensagens que dizem respeito a ti (as que enviaste, e as de conversas 1-para-1 em que participas). **Mensagens de conversas 1-para-1 são encriptadas ponta-a-ponta** — o servidor nunca viu o texto, por isso o que sai no export é o mesmo conteúdo cifrado que ele guarda, não o texto legível (o teu aparelho é que o decifra ao mostrá-lo). O conteúdo de anexos (fotos/áudio) fica de fora para o ficheiro não ficar enorme, só o nome/tipo de cada um.

"🗑️ Apagar conta" pede a tua senha outra vez (para não bastar alguém pegar num aparelho destrancado) e é permanente — apaga a conta, o perfil e todos os dados pessoais acima. Tal como no WhatsApp, mensagens que já enviaste continuam nas conversas de quem as recebeu (apagar a tua conta não reescreve o histórico de outras pessoas). Se tiveres outro dispositivo com sessão iniciada na mesma conta, é desligado automaticamente com um aviso.

### 📤 Restaurar a partir de um ficheiro

Ao lado do botão de exportar há agora "📤 Restaurar a partir de um ficheiro" — usa o próprio `.json` já exportado para trazer dados de volta a uma conta (o cenário real: reinstalaste a app, trocaste de aparelho, ou apagaste a conta sem querer e recriaste-a). Propositadamente **não restaura tudo o que está no ficheiro**:

- **Traz de volta**: idioma preferido, aniversário, chave Pix, contactos (readiciona quem ainda tem conta), lembretes e favoritos de turismo (juntam-se aos já existentes, sem apagar nada — por id), e a lista de compras (só se ainda não houver nenhuma, para não misturar duas listas de origens diferentes de forma confusa).
- **Fica de fora, sempre**: nome, telefone, nome de utilizador e senha (identificam a própria conta — restaurá-los por cima de uma conta já com sessão iniciada não faz sentido e podia confundir-se com roubo de identidade); mensagens (já vivem no servidor associadas à conversa real entre as duas contas, e nunca são apagadas quando uma conta é apagada — "restaurá-las" só duplicaria histórico ou criaria mensagens fantasma sem correspondência do outro lado); dispositivos ligados e histórico de chamadas (específicos do aparelho/momento); mensagens agendadas (podiam disparar tarde de mais, com uma hora já passada há muito tempo).

## 🚫 Bloquear/desbloquear e denunciar

No menu "⋯" de uma conversa 1-para-1, "🚫 Bloquear" impede essa pessoa de te escrever ou ligar — ao contrário do WhatsApp, sem aviso explícito de "fostes bloqueado" para a outra pessoa. "⚠️ Denunciar" pede o motivo e bloqueia automaticamente.

- **📇 → "🚫 Contas bloqueadas"** mostra todas as contas que já bloqueaste, com o nome (quando ainda é um contacto reconhecido) ou o número, e um botão para desbloquear ali mesmo — não precisas de voltar a abrir a conversa com a pessoa só para a desbloquear
- O botão no menu "⋯" já reflete o estado atual (passa a dizer "Desbloquear" em vez de "Bloquear" para quem já está bloqueado), e reabre o mesmo modal com a opção certa

**Limitação conhecida**: como as conversas de grupo aqui são "abertas" (ver "Como funcionam os grupos" acima) e uma conversa 1-para-1 só existe enquanto ambas as contas existem, depois de apagares a conta a conversa contigo pode deixar de aparecer na lista de conversas de quem falava contigo (mesmo sem o histórico dessa pessoa ser apagado por baixo) — é um efeito secundário aceite do modelo simples de apagar a conta, não um passo extra que faltou fazer.

## 📅 Chamada agendada

No menu "⋯ Mais desta conversa" há agora um botão "📅 Chamada agendada" para marcar uma chamada de voz ou vídeo para mais tarde, nessa conversa. Na hora marcada, as duas partes recebem um aviso — por notificação push (se a app estiver fechada) e, se estiverem ligadas nesse momento, também um ecrã com um botão "📞 Iniciar chamada".

**Não liga sozinha, de propósito**: ligar de verdade precisa de pedir câmara/microfone a partir de um toque genuíno da pessoa (é assim que os navegadores protegem contra chamadas automáticas silenciosas) — por isso a "chamada agendada" é só um lembrete bem posicionado para as duas pessoas, e o botão "Iniciar chamada" usa exatamente o mesmo fluxo de ligar de sempre.

## 🗂️ Canais/tópicos dentro de um grupo

Grupos grandes ganham uma barra de "tópicos" por cima das mensagens: "🗂️ Tudo" (vista normal, como sempre foi), um chip por cada tópico já usado, e "➕ Novo tópico" para criar um. Ao escolher um tópico específico, só se veem as mensagens marcadas com ele (e a mensagem seguinte que escreveres já sai marcada com esse tópico); em "Tudo" vê-se a conversa inteira, com uma pequena etiqueta 🗂️ a identificar de que tópico é cada mensagem marcada.

**Não é uma conversa/sala à parte**: é só uma etiqueta nas mensagens do próprio grupo (guardada como qualquer outro campo da mensagem), derivada do histórico já carregado — por isso funciona sem nenhuma alteração no servidor, e todas as outras funcionalidades do grupo (chamadas, enquetes, despesas, etc.) continuam a valer para o grupo inteiro, não por tópico.

## 📌 Fixar conversa no topo

No menu "⋯ Mais desta conversa" há agora um botão "📌 Fixar" para destacar qualquer conversa ou grupo sempre no topo da lista, independente das pastas — a conversa ganha uma etiqueta 📌 e sobe acima de todas as outras (as fixadas mantêm-se ordenadas entre si pela ordem em que foram fixadas). Até 5 conversas fixadas por conta, tal como no WhatsApp.

## 📈 Gráfico de despesas ao longo do tempo

Dentro de "💰 Despesas" há agora um botão "📈 Gráfico" com um gráfico de barras simples do total gasto por mês (em euros), juntando despesas avulsas e as lançadas automaticamente pelas despesas fixas recorrentes.

**Só entram despesas com data**: a partir de agora, cada despesa criada guarda o momento exato em que foi criada (`createdAt`) — despesas criadas antes desta funcionalidade existir não têm essa data (só tinham a hora do dia, não o dia em si) e por isso não entram no gráfico; continuam a aparecer normalmente na lista/balanços de sempre.

## 😀 Biblioteca de emojis

O seletor de emojis (😊 junto ao campo de mensagem, e o mesmo dentro do chat da chamada) passou de uma lista fixa de 30 para uma biblioteca organizada em categorias — Sorrisos, Pessoas, Animais, Comida, Atividades, Viagens, Objetos, Símbolos e Bandeiras — com um separador por cima para trocar de categoria, e uma aba "🕐 Recentes" com os últimos emojis usados (guardados só neste aparelho).

Continua sem precisar de nenhuma biblioteca externa nem CDN — são só carateres unicode normais, tal como antes, só que muito mais completos e organizados.

## 📊 Resumo diário automático da conversa (IA)

Em "Gerir grupo" há agora um interruptor "🗒️ Resumo diário automático (IA, às 22h de Lisboa)", só visível/alterável por administradores do grupo. Quando ligado, o servidor gera uma vez por dia (às 22h, hora de Lisboa) um resumo em português das mensagens de texto novas desde o último resumo, usando o Gemini, e publica-o como uma mensagem normal assinada "📊 Resumo diário (IA)" — visível para todo o grupo.

**Regras para não incomodar ninguém à toa**: só é gerado um resumo se houver pelo menos 5 mensagens de texto novas (mensagens apagadas ou ficheiros/anexos não contam) desde o resumo anterior — dias parados não geram resumo nenhum. Se a chamada ao Gemini falhar por qualquer razão (sem chave de API configurada, serviço em baixo, etc.), essa vez é simplesmente saltada sem marcar nada como feito, e tenta-se de novo no dia seguinte.

**Limitação conhecida**: o disparo real só acontece às 22h no relógio do servidor, o que não é praticável testar de forma automatizada e determinística (o mesmo problema já aceite noutras funcionalidades desta app que dependem da hora do dia) — os testes automatizados cobrem o interruptor em si (só admins o podem ligar/desligar, e o estado fica sincronizado para todos os membros do grupo), não o disparo agendado.

## 📴 Modo offline com fila de mensagens

Quando o telemóvel/browser perde a ligação (rede em baixo, avião, socket a tentar reconectar), aparece um aviso "📴 Sem ligação" no topo da lista de conversas, e qualquer mensagem que escrevas continua a aparecer normalmente na conversa — só que marcada com um relógio 🕓 em vez do "✓" habitual — em vez de se perder ou de parecer enviada sem ter saído do aparelho. As mensagens ficam guardadas (memória e `localStorage`, por conta) e são enviadas a sério, pela ordem em que foram escritas, assim que a ligação volta — o relógio 🕓 passa então a "✓" como qualquer mensagem normal.

**Sobrevive a fechar a app**: se recarregares a página (ou reabrires a app) ainda sem ligação, as mensagens por enviar continuam visíveis como pendentes — não é preciso manter a aba aberta à espera da rede voltar.

**Só se aplica a conversas e grupos** — o assistente Gemini precisa sempre de uma ligação ativa para responder (é uma chamada direta à API), por isso continua a mostrar o erro normal se tentares usá-lo offline, sem entrar nesta fila.

## 📄 Exportar resumo de despesas em PDF

Em "💰 Despesas" há agora um botão "📄 PDF" que gera um PDF com a lista completa de despesas dessa conversa (descrição, valor e quem pagou/com quem foi dividida), os saldos de cada pessoa (quem deve/tem a receber) e a secção "Como acertar contas" já simplificada — a mesma informação do modal, só que num ficheiro para guardar ou partilhar fora da app. Reaproveita o mesmo gerador de PDF (jsPDF, carregado sob demanda) já usado para exportar a conversa inteira e a lista de compras.

## 🔐 Entrar com Face ID/Touch ID (WebAuthn)

Em "👤 O meu perfil → 🔐 Segurança" há agora uma secção "Face ID/Touch ID" (só aparece em navegadores com suporte a WebAuthn) com um botão "➕ Ativar neste dispositivo" — usa a impressão digital, Face ID ou o PIN/padrão de desbloqueio do próprio aparelho para criar uma "passkey", sem precisar de nenhuma app ou serviço externo. No ecrã de login aparece então um botão "🔓 Entrar com Face ID/Touch ID": ao tocar, o próprio aparelho pede a biometria e entra-se **sem escrever telefone nem senha** — é "usernameless", o navegador/autenticador é que escolhe sozinho qual passkey usar de entre as guardadas para este site, e o servidor descobre de quem é a conta a partir da própria credencial (nunca precisa de perguntar o telefone primeiro). Cada dispositivo tem de ser ativado separadamente (a passkey fica guardada só nesse aparelho, nunca no servidor) e pode ser removida a qualquer momento na mesma secção do perfil.

**Implementação**: usa a Web Authentication API nativa do navegador no cliente (sem nenhuma biblioteca externa) e a biblioteca `@simplewebauthn/server` no servidor para gerar/verificar os desafios criptográficos — a mesma verificação que haveria de qualquer forma de implementar à mão (assinaturas, contador anti-clonagem, etc.), só que já testada e mantida. Continua a existir a senha normal como alternativa em qualquer dispositivo — o Face ID/Touch ID é só um atalho opcional, nunca obrigatório.

## 📍 Amigos por perto

Em "📇 Grupos, chamadas e contactos → 📍 Amigos por perto" há um interruptor "Ativar neste dispositivo" — um radar de proximidade opt-in que mostra quais dos teus **contactos** (nunca estranhos) estão fisicamente perto de ti agora, dentro de um raio de 5 km.

**Feito para nunca revelar mais do que devia**:
- **Reciprocidade obrigatória**: só aparece alguém que também tenha "Amigos por perto" ativado NESTE momento — se desativares, deixas de aparecer para os outros tal como eles deixam de aparecer para ti.
- **Contacto mútuo**: as duas contas têm de já se ter uma à outra nos contactos (normalmente basta terem trocado uma mensagem) — nunca aparece alguém que só te tenha adicionado a ti sem tu o teres feito de volta.
- **Só a distância aproximada**: a lista mostra "📍 350 m" ou "📍 2.1 km", nunca coordenadas nem um mapa com a posição exata de outra pessoa — o cálculo da distância é feito inteiramente no servidor, que nunca envia as coordenadas de ninguém para o cliente de outra pessoa.
- **Expira sozinho**: uma localização com mais de 15 minutos deixa de contar como "por perto", mesmo que a pessoa se tenha esquecido de desativar (ex.: fechou a aba sem desligar primeiro).

## 🔑 Registar como administrador (janela própria, senha separada)

Antes, o **primeiro** utilizador a registar-se no servidor era sempre o único administrador, sem nenhuma outra forma de se tornar admin. Agora há um link discreto "🔑 Área do administrador" no ecrã de login (junto a "Esqueceste a senha?"), que abre uma **janela própria e separada** do formulário normal de "Criar conta" — nunca mistura os dois, para o registo normal continuar simples e sem nenhum campo de administrador à vista. Essa janela pede um campo extra "🔑 Senha de administrador" (diferente da senha da própria conta).

- **Precisa da variável `ADMIN_SIGNUP_SECRET`** configurada no servidor — sem isso, marcar a caixa e tentar registar dá sempre erro ("O registo de administrador não está configurado neste servidor"), nunca deixa passar silenciosamente.
- **Senha errada recusa o registo por completo** — a conta nem chega a ser criada (não é só "criada mas sem admin"), para nunca ficar ninguém confuso a pensar que é administrador sem ser.
- Continua a valer a regra antiga (primeiro utilizador registado = admin) como retrocompatibilidade, e a variável `ADMIN_PHONE` (se definida) continua a fixar um único telefone como admin — este novo caminho soma-se aos dois, não os substitui.

O painel do administrador (⚙️ no topo, "Utilizadores cadastrados") já existia e lista todas as contas registadas (nome, telefone, país, email, com um botão para apagar); a lista mostrava-se corretamente, mas em ecrã de telemóvel a tabela larga ficava cortada — era preciso arrastar para o lado para ver o email inteiro ou o botão de apagar, sem isso ser óbvio. Passou a mostrar um cartão por utilizador (empilhados, nunca lado a lado), por isso nada fica escondido fora do ecrã. Cada cartão mostra agora também um ponto verde/cinzento (🟢 online agora / offline), e o topo do painel resume "N cadastrado(s) · M online agora" — vê-se de imediato quem está ligado à app neste momento, não só quem já se registou alguma vez.

## ✅ Confirmação de email no registo (recusa emails falsos)

O email passou a ser **obrigatório** ao criar conta (antes era opcional), e — quando o servidor tem envio de email configurado (`EMAIL_USER`/`EMAIL_PASS`, a mesma configuração já usada pela verificação em duas etapas e "esqueci a senha") — a conta só é criada a sério depois de confirmado um código de 6 dígitos enviado para esse endereço. Um email inventado, com erro de escrita, ou que não é da própria pessoa nunca recebe o código, e a conta correspondente nunca chega a existir de verdade (não fica "meio-criada" nem ocupa o número de telefone/nome de utilizador para sempre).

- **Passo extra depois de "Criar conta"**: em vez de entrar logo, aparece um ecrã "Enviámos um código de confirmação para `xx***@dominio.com`" — a mesma pessoa insere o código e só aí entra na app pela primeira vez.
- **Código errado nunca deixa passar**, e ao fim de 5 tentativas erradas ou 15 minutos sem confirmar, é preciso registar-se de novo (pede um código novo).
- **Aplica-se aos dois caminhos de registo** — o formulário normal e a "Área do administrador" — já que ambos passam pelo mesmo `/api/register`.
- **Sem `EMAIL_USER`/`EMAIL_PASS` configurados no servidor**, este passo não acontece (não há como mandar nada) — o registo segue em frente diretamente, como acontecia antes. Ou seja, para "só aceitar emails verdadeiros" funcionar a sério em produção, o servidor de email tem mesmo de estar configurado.
## 📱 Validação de telemóvel no registo (Numverify)

Além do email, o número de telemóvel passa por uma validação através do **Numverify** (apilayer.net) — confirma se o número tem um formato e prefixo de operadora reais atribuídos (país, operadora, se é móvel ou fixo). Números claramente inventados ou impossíveis são recusados logo no registo, com uma mensagem clara.

- **Precisa da variável `NUMVERIFY_API_KEY`** configurada no servidor (plano gratuito do Numverify: 100 pedidos/mês) — sem ela, este passo é simplesmente saltado, tal como acontece com o email sem servidor configurado.
- **Diferença importante em relação ao email**: isto confirma que o NÚMERO existe e está atribuído — não confirma que a PESSOA que se está a registar é a dona dele (não manda nenhum SMS com código). Uma confirmação "a sério" por SMS exigiria um serviço pago (Twilio, Vonage, etc., com custo por mensagem) — não implementado, mas dá para adicionar depois seguindo o mesmo padrão usado para o email, se um dia quiseres.
- **Nunca bloqueia por causa de um problema do próprio Numverify** (rede em baixo, timeout, quota mensal gratuita esgotada) — só recusa o registo quando a resposta diz mesmo `"válido": false`; qualquer outro caso (incluindo não estar configurado) deixa o registo seguir em frente normalmente, para nunca impedir alguém de se registar de boa fé por um problema alheio.

