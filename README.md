# Gestão Barber IA

Painel de performance da equipe da barbearia: ranking em tempo real, pódio, destaques por indicador, título de Destaque/MVP do período e lançamento de resultados.

## Como abrir

É um app web estático: basta abrir o `index.html` por um servidor (ex.: `python3 -m http.server`) ou publicar a pasta no GitHub Pages, Netlify ou Vercel.

Acesso de demonstração: `gestor@demo.com` ou `barbeiro@demo.com`, senha `demo123`.

## O que já funciona

- Abertura com frases motivacionais aleatórias
- Login, criação da conta da barbearia (gestor) e cadastro de barbeiro por **link de convite** (WhatsApp, e-mail ou copiar); o gestor aprova antes do acesso
- Início: atalhos, pódio, ranking em tempo real, destaques por indicador, título do período e classificação geral
- Minha performance / perfil de cada barbeiro, com comparação ao período anterior
- Time e ranking por mês: destaques, classificação em cartões, nível de carreira, metas (forte / precisa melhorar), gráficos e radares de competência
- Lançamento do total do mês por barbeiro, com salvamento automático; campos que vêm da integração ficam travados
- Metas mensais da equipe com ajuste individual
- Integração & API: chave da API, formato dos dados e teste de importação em JSON
- Pesos dos indicadores, dados da empresa, meu cadastro, central de ajuda e modo apresentação (TV)
- Filtro de período: semana, mês e trimestre

## Regras de pontuação

- Indicadores: Faturamento (22), Checklist POP (15), Taxa de ocupação (10), Ticket médio (10), Serviços (9), Clientes (6), Planos mensais (10), Fidelização (10), Venda de produtos (8). Pesos editáveis.
- Só contam indicadores com dados no período.
- Nota por indicador: 1º = 100, último = 0, proporcional ao valor. Pontuação geral = média ponderada.
- **Destaque**: 1º lugar em pelo menos metade dos indicadores (arredonda para cima). **MVP**: metade + 1. Nunca os dois ao mesmo tempo.
- Empate no 1º lugar conta para todos. Desempate do título: mais lideranças e, depois, maior pontuação.
- Quem tem o título fica em 1º no ranking; os demais seguem pela pontuação.

## Níveis de carreira

Carreira = média das pontuações mensais do barbeiro. Bronze abaixo de 70, Prata a partir de 70, Ouro a partir de 85, Diamante a partir de 95.

## Próximo passo

Hoje os dados ficam salvos no navegador do aparelho. Para vários aparelhos, convites reais, login com Google/Apple/Microsoft e a API recebendo dados de outro sistema, o app precisa ser ligado a um servidor (sugestão: Supabase). A camada `DB` em `js/data.js` foi separada para essa troca.
