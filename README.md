# Último Horizonte

Jogo de exploração espacial no navegador (Three.js). A Terra foi destruída pelo Érebo; você e a Frota da Diáspora procuram um planeta habitável — a Nova Terra.

## Como jogar

- Windows: dê dois cliques em `JOGAR.bat` (precisa do [Node.js](https://nodejs.org); sem ele, tenta com Python).
- Ou: `node server.js` e abra http://localhost:8080

Não precisa instalar nada além disso: o Three.js já está em `lib/`.

## Estrutura

- `index.html`, `css/` — interface
- `js/main.js` — laço principal, voo, HUD, câmera
- `js/galaxy.js`, `js/system.js` — galáxia e sistemas estelares
- `js/terrain.js` — superfície dos planetas (pouso e caminhada)
- `js/flightfx.js` — sombra da nave no chão, poeira dos motores e plasma da reentrada
- `js/audio.js` — trilha procedural (três peças que se revezam), ambiência e efeitos
- `js/fleet.js`, `js/story.js`, `js/missions.js` — frota, história e missões
- `js/map.js` — mapa galáctico e catálogo de exoplanetas
- `musica/` — coloque aqui uma trilha própria (veja `LEIA-ME.txt`)
