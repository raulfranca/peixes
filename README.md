# Contracorrente

Um cardume de peixes cinzas gira em círculo, todos para o mesmo lado. Um deles fica azul, vira e passa a nadar contra a corrente. Esse peixe é você.

A estética vem da abertura de *The Chosen*: peixes chapados e sem cor nadando juntos, até que um deles muda de cor e de direção. Na série, outros seguem o primeiro até serem treze contra o cardume.

## Como se joga

1. **Abertura.** O cardume aparece girando no sentido horário. Um peixe acende em azul, desacelera, dá a volta e passa a nadar no sentido anti-horário. Você dá seu nome a ele.
2. **Dar nome.** Toque em qualquer ponto do cardume. O peixe cinza mais próximo é selecionado e desacelera. Dê a ele o nome de alguém da sua vida.
3. **Visitar.** Toque num peixe que já tem nome e depois em **Visitar**. Seu peixe azul sai da órbita, cruza o anel, alcança o peixe e dá um toquinho. O peixe cinza acende em azul por um instante e volta ao cinza, e a barra dele enche.
4. **A corrente.** Com o tempo, a barra esvazia sozinha. Uma barra cheia leva **7 dias** para zerar.
5. **Mudar de lado.** Quando a barra chega a 100%, o peixe fica azul de vez, vira e passa a nadar contra a corrente com você. O número no centro do anel conta quantos já viraram.

### Números

| Regra | Valor |
| --- | --- |
| Cada visita | +30% da barra |
| A corrente esvazia | 100% em 7 dias (≈14% por dia) |
| Visitas que contam | 1 por pessoa por dia (pode desligar em Ajustes) |

Com uma visita por dia, alguém muda de lado no 6º dia. Visitando a cada dois dias, a barra quase não sai do lugar. O jogo recompensa a constância, não a intensidade.

### Detalhes de interface

- O nome de cada pessoa nada junto com o peixe, com uma barrinha azul embaixo. O peixe ganha um leve tom azul conforme a barra enche.
- O botão de lista (ou o número no centro) abre **Sua rede**, agrupada em *Para visitar hoje*, *Visitados hoje* e *Contra a corrente*.
- Quando uma ficha sobe, o anel encolhe e sobe junto para continuar visível.
- Ao abrir o app, ele avisa se alguém está há 3 dias ou mais sem visita.
- Som suave no toque e um acorde na conversão (pode desligar). Vibração no celular.
- **Modo demonstração** (em Ajustes): 1 dia vira 1 minuto, num aquário separado dos dados reais. Bom para ver a mecânica inteira em poucos minutos.
- **Exportar / Importar**: os dados ficam só no aparelho (localStorage). Exporte um arquivo para ter um backup.

## Rodar

Não há build nem dependências. Sirva a pasta com qualquer servidor estático:

```sh
python3 -m http.server 8000
# abra http://localhost:8000
```

É um PWA: no celular, use "Adicionar à tela inicial" para instalar. O service worker (`sw.js`) guarda os arquivos para abrir sem internet.

### Publicar no GitHub Pages

Em *Settings → Pages* do repositório, escolha a branch e a pasta raiz (`/`). O app funciona a partir de qualquer subcaminho.

## Arquivos

| Arquivo | O que tem |
| --- | --- |
| `index.html` | Estrutura da página e HUD |
| `style.css` | Visual: tokens de cor, tipografia, fichas |
| `app.js` | Cardume (canvas), movimento, regras do jogo, interface |
| `sw.js` | Cache para uso offline |
| `manifest.webmanifest`, `icons/` | Instalação como app |

As regras ficam no topo de `app.js` (`TOUCH_GAIN`, `WEEK`, `N_FISH` etc.).
