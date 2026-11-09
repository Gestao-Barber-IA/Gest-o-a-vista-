# Gestão Barber IA e Gestão Salão IA

Sistema de gestão de performance da equipe para barbearias (**Gestão Barber IA**) e salões de beleza e esmalterias (**Gestão Salão IA**): ranking ao vivo, pódio, Destaque e MVP do mês, metas, checklist, POPs, fechamento do mês com revelação do pódio e cards para os stories.

## Como abrir

É um app web estático, sem etapa de build: abra o `index.html` por um servidor (ex.: `python3 -m http.server`) ou publique a pasta (hoje: Vercel, gest-o-a-vista.vercel.app).

- Modo apresentação com dados fictícios: `?demo=barber` ou `?demo=salao`
- Página de vendas com quiz e planos: `/oferta` (`/vendas` redireciona para ela)

## O que já funciona

**Dono e equipe**
- Cadastro da empresa (gestor), convite de profissionais por link e aprovação; níveis de acesso Profissional, Líder e Gestor; organograma
- Início com pódio, ranking em tempo real, avisos de ultrapassagem e título do período; para o gestor, **Primeiros passos** (conta nova) e **Pendências** (aprovações, provas do checklist, lançamentos do mês, fechamento e aniversários da semana)
- Performance da empresa (ritmo diário, metas da empresa com card de conquista, evolução e relatório em PDF) e Performance da equipe (detalhado por profissional, comparativos, pontos fortes e a melhorar)
- Lançamentos manuais (total do mês ou por dia) e integração por API; campos da integração ficam travados
- Checklist Agenda Cheia com prova por foto, conferência da gestão, pontos no ranking e lembrete diário; fotos apagadas após 7 dias
- POPs · Guia do Sucesso com passo a passo em fotos

**Apresentações**
- Tela da loja para a TV, que se ajusta a qualquer tela
- Fechamento do mês: abertura animada com música, revelação do 3º ao 1º com música própria por colocação, Líderes do mês e Parabéns ao pódio, também no celular da equipe
- Relatórios mensais: painel do mês (infográfico e PDF), card de cada profissional, card do MVP/Destaque (rosé gold no Gestão Salão IA), card de parabéns e card de aniversário, prontos para os stories
- Temas da temporada (Copa, aniversário da empresa etc.) e formatos do escudo do pódio
- Modo apresentação para vender o sistema, com slides, roteiro (`docs/roteiro-apresentacao.md`) e a marca do cliente

**Dados**
- Fotos dos profissionais e logo no armazenamento do Supabase (pasta pública `fotos`, com nome de arquivo aleatório); fotos antigas, guardadas dentro do cadastro, são levadas para lá automaticamente quando o gestor entra
- **Cópia dos seus dados** em Configurações › Empresa: arquivo completo (JSON) e planilha dos lançamentos (CSV), sem senhas nem chave da API

## Testes

```
node --test tests/*.test.js
```

Cobrem as regras de pontuação, Destaque, MVP, desempate, ranking e níveis (`tests/regras.test.js`). Rodam também no GitHub a cada PR (`.github/workflows/testes.yml`).

## Regras de pontuação

- Indicadores: Faturamento (22), Checklist POP (15), Taxa de ocupação (10), Ticket médio (10), Serviços (9), Clientes (6), Planos mensais (10), Fidelização (10), Venda de produtos (8). Pesos editáveis.
- Só contam indicadores com dados no período.
- Nota por indicador: 1º = 100, último = 0, proporcional ao valor. Pontuação geral = média ponderada.
- **Destaque**: 1º lugar em pelo menos metade dos indicadores (arredonda para cima). **MVP**: metade + 1. Nunca os dois ao mesmo tempo.
- Empate no 1º lugar conta para todos. Desempate do título: mais lideranças e, depois, maior pontuação.
- Quem tem o título fica em 1º no ranking; os demais seguem pela pontuação.

## Níveis de carreira

Carreira = média das pontuações mensais do barbeiro. Bronze abaixo de 70, Prata a partir de 70, Ouro a partir de 85, Diamante a partir de 95.

## Nuvem (Supabase)

Com `js/config.js` preenchido, o app usa o Supabase: login de verdade, confirmação de e-mail, **recuperação de senha por e-mail**, convites entre aparelhos, dados na nuvem e ranking ao vivo em todos os aparelhos. Sem configuração, continua no modo de demonstração local.

Passo a passo: [`supabase/LEIAME.md`](supabase/LEIAME.md).

- `supabase/schema.sql`: tabelas, regras de acesso (cada barbearia só vê os próprios dados; só o gestor altera), cadastro por convite e aprovação, pastas do Storage (`provas`, `pops`, `musicas`, `fotos`)
- `supabase/functions/lancamentos`: API que recebe os resultados de outro sistema
- `supabase/email/`: e-mails em português com a marca
- `js/cloud.js`: ligação do app com o Supabase

## Assinatura (SaaS)

- Teste grátis de 7 dias, só com lançamento manual; a integração por API é dos planos pagos
- Planos por número de barbeiros (Essencial até 4, Profissional até 10, Premium ilimitado), com preços editáveis no Painel do SaaS
- Cobrança mensal pelo Asaas (PIX, boleto ou cartão): `supabase/functions/assinatura` e `supabase/functions/asaas-webhook`
- Sem pagamento, o acesso é bloqueado no servidor (regras do banco), e os dados continuam guardados
- Painel do dono do SaaS: barbearias, situação, receita mensal, teste extra, cortesia e bloqueio
- `termos.html` e `privacidade.html`, com aceite no cadastro
