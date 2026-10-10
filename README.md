# NEXTPING

Painel de teste de conexão voltado para jogadores, criado com React, Vite, Tailwind CSS, Chart.js, Express e WebSockets.

## Executar localmente

Requer Node.js 20.19+ ou 22.12+.

```bash
npm install
npm run dev
```

O Vite abre a interface em `http://localhost:5173` e encaminha o WebSocket `/test` para o servidor Express em `http://localhost:3001`. Para verificar se o servidor está ativo, acesse `http://localhost:3001/health`.

`npm run build` valida os tipos e gera a interface de produção em `dist/`. Em produção, configure um proxy reverso para encaminhar `/test` ao processo Node.js.

## O que o protótipo mede

- Latência de ida e volta, jitter médio entre amostras e respostas ausentes no WebSocket.
- Vazão de upload e download entre o navegador e o nó de teste configurado.
- Histórico das amostras de latência durante a execução.
- Uma nota educativa de 0 a 100 e a classificação individual dos indicadores: bom, atenção ou ruim.
- Histórico local dos últimos 50 testes, comparação com a medição anterior e opção para apagar os dados salvos.

As classificações usam limites gerais: ping até 50 ms e jitter até 10 ms são bons; download a partir de 25 Mbps e upload a partir de 5 Mbps são boas referências; ping sem resposta deve ser zero. A faixa seguinte é classificada como atenção e valores além dela como ruins. A nota geral é a média dos indicadores classificados como bom (100 pontos), atenção (50) ou ruim (0).

O histórico fica no armazenamento local do navegador e não é enviado ao servidor. Ele pode ser apagado pela aba **Histórico**.

Em desenvolvimento, o nó de teste roda em `localhost`. Portanto, essas medições **não representam a velocidade da internet, o ping até os servidores de um jogo nem a qualidade da rede do provedor**. Para obter resultados de internet, a interface e o servidor precisam ser implantados em um nó remoto com localização e capacidade conhecidas. O perfil de jogo selecionado é informativo nesta versão e não altera o destino do teste.

## Fora do escopo desta primeira versão

Os testes reais de bufferbloat, tráfego UDP sustentado/WebRTC, perda de pacotes UDP, ping até datacenters específicos, traceroute e diagnóstico automático de Wi-Fi exigem infraestrutura e permissões que um navegador não consegue fornecer sozinho. Eles não são simulados nem apresentados como resultados medidos neste protótipo. A nota e as classificações desta versão são educativas e baseadas somente nas medições do nó local.
