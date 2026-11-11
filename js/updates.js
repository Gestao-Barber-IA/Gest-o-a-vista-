/* Atualizações do sistema (aba Atualizações).
   A cada mudança publicada, acrescente uma entrada NO TOPO da lista, com a data e o que mudou,
   escrito para o dono da empresa (sem termos técnicos). Tipos: novo, melhoria, correcao. */
window.GB_UPDATES = [
  { id: '2026-11-11-editar-excluir', date: '2026-11-11', title: 'Editar nome e excluir profissional', items: [
    ['novo', 'Em Adicionar profissional, o dono pode mudar o nome de cada profissional (útil para ficar igual ao do sistema de agenda).'],
    ['novo', 'Botão Excluir, com confirmação: apaga o profissional e todo o histórico dele. Para só tirar do ranking e guardar o histórico, continue usando Desativar.'],
  ] },
  { id: '2026-11-11-sem-fidelizacao', date: '2026-11-11', title: 'Taxa de fidelização retirada por enquanto', items: [
    ['melhoria', 'A Taxa de fidelização saiu dos indicadores, do ranking, das metas e dos lançamentos. Os pesos dos outros indicadores foram redistribuídos sozinhos.'],
  ] },
  { id: '2026-11-11-avisos', date: '2026-11-11', title: 'Avisos e alterações para a equipe', items: [
    ['novo', 'Nova tela Avisos e alterações no menu de todos. Quando o dono muda algo que afeta a equipe, o aviso aparece sozinho, com a data.'],
    ['melhoria', 'Entram: pesos e % de cada indicador, metas, comissões e prêmios, checklist, POPs, regra de ocupação, autolançamento e mudanças de acesso. Avisos pessoais (acesso, metas individuais, comissão) só aparecem para a própria pessoa.'],
    ['melhoria', 'O profissional vê no menu quantos avisos novos tem.'],
  ] },
  { id: '2026-11-11-autolancamento', date: '2026-11-11', title: 'Profissional lança os próprios números', items: [
    ['novo', 'Para quem usa sistema sem integração: em Configurações › Indicadores e metas, marque os indicadores que cada profissional pode lançar sozinho.'],
    ['melhoria', 'O profissional vê Lançamentos no menu e preenche só os próprios números, só nos indicadores liberados. Campos da integração continuam travados.'],
  ] },
  { id: '2026-11-11-prioridades', date: '2026-11-11', title: 'Pesos dos indicadores mais fáceis', items: [
    ['melhoria', 'Em Configurações › Indicadores e metas, escolha a prioridade de cada indicador (Essencial, Importante, Complementar ou Não usar) e o sistema calcula os pesos sozinho.'],
    ['novo', 'Modelos prontos conforme o objetivo: Faturar mais, Agenda cheia, Fidelizar clientes e Equilibrado.'],
    ['melhoria', 'Cada indicador mostra quanto vale na nota geral (ex.: "vale 24% da nota"). O ajuste fino por número continua disponível.'],
  ] },
  { id: '2026-11-11-marca-cliente', date: '2026-11-11', title: 'O sistema com a cara da sua empresa', items: [
    ['melhoria', 'Com o logo enviado, o menu mostra o logo e o nome da sua empresa (o nome do sistema fica pequeno, em cima).'],
    ['melhoria', 'O fechamento do mês abre com o logo da sua empresa; a marca do sistema aparece só de forma discreta.'],
    ['melhoria', 'Os cards dos profissionais levam o nome da sua empresa no rodapé.'],
    ['melhoria', 'O fechamento do mês ganha as cores da identidade visual do seu logo: fundo, títulos, brilhos e detalhes.'],
  ] },
  { id: '2026-11-11-aprovacao', date: '2026-11-11', title: 'Cadastro com aprovação', items: [
    ['melhoria', 'Novas empresas passam por uma análise da nossa equipe antes do primeiro acesso. O teste grátis de 7 dias começa a contar na aprovação.'],
  ] },
  { id: '2026-11-10-protecao', date: '2026-11-10', title: 'Proteção do sistema', items: [
    ['melhoria', 'A Tela da loja e o fechamento mostram discretamente o nome da empresa licenciada.'],
    ['melhoria', 'Mais proteção contra cópia do sistema. Campos de digitação e botões de copiar continuam funcionando normalmente.'],
  ] },
  { id: '2026-11-10-rotina', date: '2026-11-10', title: 'Checklist Líder e Recepção', items: [
    ['novo', 'Nova tela Checklist Líder e Recepção, em Gestão de pessoas: tarefas com horário para o líder de barbeiros e para a recepção marcarem ao longo do dia.'],
    ['novo', 'Só o dono e quem tem acesso de Gestor criam e mudam as tarefas: horário, dias da semana e se a tarefa exige foto e descrição para ser confirmada.'],
    ['novo', 'Tarefa que passou do horário sem ser marcada aparece como Atrasada. Escolha outro dia para ver o histórico com horários, quem fez e as fotos.'],
  ] },
  { id: '2026-11-10-penalidade', date: '2026-11-10', title: 'Penalidade e folga remunerada', items: [
    ['melhoria', 'Na Fiscalização, a gravidade Suspensão passou a se chamar Penalidade.'],
    ['novo', 'Penalidade: a comissão do profissional cai 10 pontos % na quinta, sexta e sábado seguintes ao registro, com o desconto calculado sozinho em Comissões e prêmios.'],
    ['novo', 'Folga remunerada: quem tiver a maior taxa de ocupação do mês, com faturamento acima de R$ 13.500, ganha 1 dia de folga pago pela sua média diária de ganho no mês.'],
  ] },
  { id: '2026-11-10-fiscalizacao', date: '2026-11-10', title: 'Fiscalização (controle disciplinar)', items: [
    ['novo', 'Nova aba Fiscalização, em Gestor: registre atrasos, faltas e problemas de atendimento, higiene ou uniforme, com gravidade, data e relato do líder.'],
    ['novo', 'A gravidade é sugerida sozinha: a mesma falta nos últimos 30 dias vira Reincidência.'],
    ['novo', 'Busca, filtros por profissional, tipo, gravidade e mês, resumo de quem tem mais registros e planilha para baixar.'],
  ] },
  { id: '2026-11-10-menu', date: '2026-11-10', title: 'Menu mais organizado', items: [
    ['melhoria', 'Os conjuntos do menu (Apresentações, Gestão de pessoas, Gestor, Sistema e Conta) agora minimizam: toque no nome do conjunto para esconder ou mostrar as abas. O app lembra como você deixou.'],
  ] },
  { id: '2026-11-10-comissoes', date: '2026-11-10', title: 'Comissões, sonhos, feedback pronto e unidades', items: [
    ['novo', 'Comissões e prêmios: defina as regras (% do faturamento, planos, produtos, prêmios por colocação, MVP, Destaque e meta) e o sistema calcula o valor de cada profissional no mês, com planilha.'],
    ['novo', 'Sonhos: cada profissional conta o sonho dele e vê em quantos meses chega lá, guardando parte da comissão.'],
    ['novo', 'Feedback do mês pronto na performance de cada profissional, para copiar ou enviar no WhatsApp.'],
    ['novo', 'Unidades: quem tem mais de uma loja vê o ranking de cada unidade ou o geral, no Início e na Tela da loja, e compara as unidades em Performance da empresa.'],
    ['novo', 'Importar planilha (CSV) exportada do seu sistema de agenda, em Configurações › Integração & API.'],
    ['melhoria', 'Saíram do menu os itens "em breve" que já existem em outras telas (Metas, Tarefas e Cockpit).'],
  ] },
  { id: '2026-11-10-feedback', date: '2026-11-10', title: 'Atualizações, sugestões e reporte de erros', items: [
    ['novo', 'Aba Atualizações: tudo o que muda no sistema fica registrado aqui, com a data.'],
    ['novo', 'Aba Sugestões de melhorias: sugira melhorias, veja as ideias de outros donos e vote nas que mais fazem sentido para você.'],
    ['novo', 'Aba Reportar erro: conte o que aconteceu (com print, se quiser) e acompanhe a resposta da nossa equipe.'],
  ] },
  { id: '2026-11-10-fechamento', date: '2026-11-10', title: 'Fechamento do mês com músicas em todas as telas', items: [
    ['novo', 'Música própria para as telas "É hora do pódio", "Líderes do mês" e "Parabéns ao pódio".'],
    ['novo', 'A colocação do pódio aparece no ápice da música (o momento em que ela explode).'],
    ['melhoria', '"É hora do pódio" entra letra por letra, mais devagar.'],
    ['melhoria', 'Abertura mais fluida e mais leve, inclusive espelhando o notebook na TV.'],
    ['melhoria', 'As músicas carregam antes de começar, e a abertura espera a música ficar pronta.'],
    ['correcao', 'Os cards dos profissionais aparecem inteiros na tela (duas colunas no notebook e na TV), sem barras de rolagem.'],
    ['correcao', 'No celular, a palavra FECHAMENTO cabe na tela e o título não fica mais borrado no iPhone.'],
  ] },
  { id: '2026-11-09-ajuda', date: '2026-11-09', title: 'Tutoriais e primeiros passos', items: [
    ['novo', 'Botão "Como usar esta tela" no topo de cada tela, com o passo a passo e dicas.'],
    ['novo', 'Central de ajuda com tutoriais de todas as telas e busca.'],
    ['novo', 'Início do dono: Primeiros passos para a conta nova e Pendências do dia (aprovações, provas do checklist, lançamentos, fechamento e aniversários).'],
    ['melhoria', 'Menu com "Gestão Barber IA" / "Gestão Salão IA" e "Performance da empresa" sempre numa linha.'],
  ] },
  { id: '2026-11-09-dados', date: '2026-11-09', title: 'Seus dados mais leves e seguros', items: [
    ['novo', 'Cópia dos seus dados em Configurações › Empresa: arquivo completo e planilha dos lançamentos.'],
    ['melhoria', 'Fotos da equipe e logo guardados à parte: o app abre mais rápido, principalmente no 4G.'],
    ['melhoria', 'Política de privacidade atualizada.'],
  ] },
  { id: '2026-11-09-cards', date: '2026-11-09', title: 'Cards para os stories', items: [
    ['novo', 'Card do mês de cada profissional, card do MVP ou do Destaque do mês e card de parabéns, em Relatórios mensais.'],
    ['novo', 'Card de aniversário dos profissionais, com foto e o logo da empresa.'],
    ['melhoria', 'No Gestão Salão IA, o card do MVP é rosé gold.'],
  ] },
  { id: '2026-11-09-fechamento', date: '2026-11-09', title: 'Fechamento do mês renovado', items: [
    ['novo', 'Abertura animada "É hora do FECHAMENTO" no ritmo da música.'],
    ['novo', 'Revelação dos 3 primeiros colocados, do 3º ao 1º, com música própria para cada colocação.'],
    ['novo', 'Tela Líderes do mês, com o 1º de cada indicador.'],
    ['novo', 'Envie suas músicas (MP3 ou até vídeo MP4) e recorte o trecho, à mão ou no automático.'],
  ] },
  { id: '2026-11-09-performance', date: '2026-11-09', title: 'Performance, relatórios e temas', items: [
    ['novo', 'Performance da empresa: ritmo diário, faturamento mês a mês, metas da empresa com card de conquista e relatório em PDF.'],
    ['novo', 'Relatórios mensais: painel do mês em formato de infográfico, guardado por mês e em PDF.'],
    ['novo', 'Aba Temas: temas da temporada (Copa, aniversário da empresa…) e formatos do escudo do pódio.'],
    ['novo', 'Indicador Maior comanda do mês (destaque, não pontua).'],
    ['melhoria', 'Tela da loja se ajusta a qualquer TV ou computador, sem cortes.'],
    ['melhoria', 'Venda de produtos passa a contar a quantidade vendida.'],
  ] },
];
