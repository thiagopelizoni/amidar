# AMIDAR 2600

Tributo jogável ao Amidar do Atari 2600 (Konami, versão da Parker Brothers de 1982), recriado em JavaScript puro para rodar no navegador, sem dependências e sem build. A grade e a paleta foram extraídas pixel a pixel de um screenshot do cartucho original (medição de runs em Python): campo preto, trilhos vermelho-rosado `#B74A62` com linhas horizontais duplas (aceso, apagado, aceso) e degraus listrados por linha de varredura, tinta azul `#3C8FCF` entrelaçada ao vermelho nos trechos percorridos, boxes preenchidos com listras azuis, gorila branco de olhos azuis e guerreiros verde-menta `#5ECC9B`. A moldura é a mesma sala de estar do PAC-MAN 2600: TV de tubo, painel de madeira do VCS (agora com as chaves COR/P&B, DIFICULDADE e RESET funcionando), faixa arco-íris de cartucho e o botão vermelho do joystick CX40 no toque.

## Como jogar

Abra o `index.html` diretamente no navegador (duplo clique funciona; não há módulos ES nem fetch, então `file://` é suficiente). Se preferir servir por HTTP, qualquer servidor estático resolve, por exemplo `python3 -m http.server` na raiz do projeto. A versão single-file fica em `dist/amidar-2600.html`.

Controles: setas ou WASD movem o gorila enquanto estiverem pressionadas, como um joystick de verdade (soltou, ele para); Espaço, Z, X ou Shift fazem os inimigos pularem; Enter inicia e pausa; P pausa; M liga/desliga o som; F alterna o flicker dos inimigos entre desligado, suave e autêntico (multiplexado, como o TIA fazia); C vira a chave COR/P&B; L vira a chave de dificuldade. Gamepads e adaptadores de joystick Atari funcionam pelo Gamepad API (direcional ou analógico move, A/B pula, Start inicia). No toque, use o d-pad (dá para deslizar o dedo entre as setas sem soltar) e o botão vermelho PULO, ou arraste o dedo sobre a tela; um toque rápido na tela durante o jogo também pula.

## Regras, fiéis ao manual do cartucho

Percorra os trilhos para pintá-los. Trechos horizontais valem de 1 ponto (o mais curto) a 6 pontos (o mais longo), os verticais valem 1, e fechar o contorno inteiro de um box o preenche e rende 50 pontos. Fechar os quatro boxes de canto transforma os inimigos em galinhas por alguns segundos, com um alarme perto do fim; cada galinha apanhada vale 100 pontos. São três gorilas, sem vida extra, e quatro pulos por gorila: durante o pulo os inimigos viram sombras suspensas e o gorila passa por baixo. A pintura permanece quando um gorila é pego. As rodadas ímpares são gorila contra guerreiros; as pares, rolo de pintura contra porcos, com as mesmas regras. As rodadas 1 e 2 têm cinco inimigos e da 3 em diante seis, cada vez mais rápidos. Os patrulheiros seguem o "movimento Amidar" (descem um degrau, andam até a primeira esquina que leve adiante no sentido vertical e repetem) e o Tracer só ronda a borda externa, no sentido anti-horário, um pouco mais rápido que o gorila. A chave de dificuldade em expert começa na rodada 3. O recorde fica salvo no `localStorage`.

## Estrutura

- `index.html` — casca da página: marquise, TV, chaves do console, d-pad e botão de pulo táteis, manual do jogador.
- `css/style.css` — tema único de sala escura de 1982: bezel de CRT, vinheta, efeito de ligar o tubo, woodgrain, chaves de alavanca e faixa arco-íris de cartucho.
- `js/config.js` — grade medida do original (32 colunas, 6 linhas, 5 faixas de degraus, 29 boxes), paleta amostrada e tuning de velocidades, tempos e pontuação.
- `js/sprites.js` — bitmaps 8×8 de gorila, rolo, guerreiro, porco e galinha, e fonte 4×5 usada em HUD e telas.
- `js/audio.js` — síntese WebAudio com ondas quadradas e ruído em degraus, evocando o TIA; como no cartucho, sem música, só passos, bipes e alarmes.
- `js/input.js` — modelo de joystick segurado: teclado, d-pad tátil, swipe e gamepad, com a direção mais recente vencendo.
- `js/game.js` — grafo de trilhos com movimento contínuo e parada em junções, pintura progressiva por segmento, IA dos patrulheiros e do Tracer, pulos, galinhas e renderização alinhada ao pixel do dispositivo.
- `tools/build-artifact.js` — gera `dist/amidar-2600.html`, versão single-file com CSS e JS embutidos.
- `tools/test.js` — testes headless em Node.

## Sem input lag

A entrada é lida no mesmo quadro em que o navegador a entrega: o loop usa passo variável com subpassos de no máximo 1/60 s (sem acumulador que atrase a aplicação do comando), o contexto 2D é criado com `desynchronized: true` e o áudio com `latencyHint: 'interactive'`. Curvas têm duas tolerâncias: apertar uma direção perpendicular até 4 pixels depois de passar pela junção faz o gorila voltar a ela e virar na hora, e apertar parado perto de uma junção (até 12 pixels) o leva até ela. A tela é desenhada na resolução física do dispositivo, com cada pixel do quadro de 160×192 do 2600 alinhado ao pixel real e scanlines por linha lógica, o que mantém a imagem nítida e sem moiré em qualquer tamanho.

## Testes

O script `tools/test.js` roda em Node sem navegador: valida a grade (simetria das faixas, 29 boxes, 4 cantos, conectividade de todas as junções, pontuação de 1 a 6), roda 12.000 quadros do modo atração conferindo que os inimigos nunca saem dos trilhos nem travam e que o Tracer nunca deixa a borda, e depois joga com entradas reais de teclado: resposta no primeiro quadro, contorno de um box guiado pelas setas (+50 e preenchimento), pulo, morte, galinhas, fim de rodada, game over e chave de dificuldade. Execute com `node tools/test.js`.
