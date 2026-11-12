/* Atualizações do sistema (aba Atualizações).
   A cada mudança publicada, acrescente uma entrada NO TOPO da lista, com a data e o que mudou,
   escrito para o dono da empresa (sem termos técnicos). Tipos: novo, melhoria, correcao. */
window.GB_UPDATES = [
  { id: '2026-11-13-chegada', date: '2026-11-13', title: 'Horário de chegada marcado pela gestão', items: [
    ['melhoria', 'Tarefas como Horário de chegada só podem ser marcadas pelo dono, pelo gestor ou pelo líder (nunca pelo próprio profissional). Um toque já marca, aprovada, sem foto.'],
    ['melhoria', 'O dono escolhe isso em cada tarefa do checklist: "Só o dono, o gestor ou o líder marcam".'],
  ] },
  { id: '2026-11-13-checklist-botoes', date: '2026-11-13', title: 'Botões − e + no Checklist Agenda Cheia', items: [
    ['melhoria', 'Cada tarefa do checklist voltou a ter os botões − e + com as bolinhas de cada unidade. O + abre a prova da próxima unidade; o − tira a última que ainda não foi aprovada. Tarefas de uma vez só têm o botão Marcar como feito.'],
  ] },
  { id: '2026-11-12-fisc-lider', date: '2026-11-12', title: 'Fiscalização para o líder', items: [
    ['novo', 'Em Adicionar profissional › Acessos extras do líder, o dono pode liberar a Fiscalização para o líder: ele vê a página e registra ocorrências da equipe (nunca as próprias). Apagar continua só com o dono.'],
  ] },
  { id: '2026-11-12-maior-comanda', date: '2026-11-12', title: 'Maior comanda com foto', items: [
    ['novo', 'Em Lançamentos, cada profissional registra a maior comanda do mês. A foto da comanda é obrigatória e o valor só vale se for maior que a atual dele.'],
    ['melhoria', 'O destaque Maior comanda vai para quem tiver a maior: se outro profissional registrar uma maior, ele passa a ser o destaque. O dono e a gestão veem a foto e podem apagar um registro errado.'],
  ] },
  { id: '2026-11-12-tv-leve', date: '2026-11-12', title: 'Tela da loja leve no navegador da TV', items: [
    ['melhoria', 'Aberta direto no navegador da Smart TV, a Tela da loja entra sozinha no modo leve: tira os efeitos pesados (desfoque, sombras animadas, reflexo e névoa) e mantém o movimento, para não travar.'],
    ['melhoria', 'Também liga se perceber a animação lenta. Para forçar: adicione ?leve=1 (ligar) ou ?leve=0 (desligar) ao endereço.'],
  ] },
  { id: '2026-11-12-planos', date: '2026-11-12', title: 'Registro de planos mensais vendidos', items: [
    ['novo', 'O dono cadastra os planos da empresa em Configurações › Indicadores e metas › Planos mensais da empresa.'],
    ['novo', 'Cada profissional registra em Lançamentos os planos que fechou: nome e sobrenome do cliente, WhatsApp válido e qual plano. O indicador Planos mensais conta esses registros.'],
    ['melhoria', 'Os dados do cliente só aparecem para o dono, a gestão e o próprio profissional.'],
  ] },
  { id: '2026-11-12-ausencia', date: '2026-11-12', title: 'Dias de ausência com − e +', items: [
    ['melhoria', 'Em Lançamentos, os dias de ausência (férias, atestado) agora mudam só pelos botões − e +, um dia por vez, sem digitar.'],
    ['melhoria', 'O indicador Agendamentos saiu de Lançamentos, das metas e dos totais da empresa por enquanto.'],
  ] },
  { id: '2026-11-12-foguete', date: '2026-11-12', title: 'Foguete na meta da loja', items: [
    ['melhoria', 'Um foguete com rastro de fogo conduz a ponta da barra de progresso da meta da loja, no Início e na Tela da loja.'],
  ] },
  { id: '2026-11-12-tv-palco', date: '2026-11-12', title: 'Tela da loja: palco do pódio e prêmio da meta', items: [
    ['novo', 'Na TV, o pódio ganhou um palco com holofotes, halo de luz no 1º lugar, névoa e piso espelhado, e ficou bem maior.'],
    ['novo', 'O prêmio da meta da loja aparece no topo da TV (foto, nome e barra de progresso) e ganhou uma tela própria no rodízio, com a foto em tela cheia.'],
    ['melhoria', 'Ranking mais estreito para destacar o pódio, e os botões de som e tela cheia somem sozinhos depois de alguns segundos.'],
  ] },
  { id: '2026-11-12-premio', date: '2026-11-12', title: 'Prêmio da meta da loja no Início', items: [
    ['novo', 'Cadastre a foto, o nome e a descrição do prêmio da meta (ex.: 5 dias na praia) em Performance da empresa › Editar metas. Ele aparece em destaque no Início de toda a equipe, com a foto grande e a barra de quanto falta.'],
  ] },
  { id: '2026-11-12-tv-cartoes', date: '2026-11-12', title: 'Alertas e Guardiões ocupando a TV inteira', items: [
    ['melhoria', 'Na Tela da loja, as telas "Quanto falta para subir de posição" e "Os guardiões do mês" agora usam toda a tela da TV: cartões maiores e letras ampliadas para leitura de longe.'],
  ] },
  { id: '2026-11-12-guardioes', date: '2026-11-12', title: 'Os guardiões do mês com luzes animadas', items: [
    ['melhoria', 'Na Tela da loja, a tela "Quem está puxando cada resultado" ganhou cartões dourados com brilho pulsando, reflexo e luz dourada animada atrás das fotos, fotos maiores e valores em destaque.'],
  ] },
  { id: '2026-11-12-tv-cheia', date: '2026-11-12', title: 'Tela da loja ocupando a TV inteira', items: [
    ['melhoria', 'Em computador ou TV, a tela do pódio usa toda a largura e altura: o pódio cresce até a altura da tela e o ranking ocupa o resto, com letras maiores (e se ajusta sozinho quando há muitos profissionais).'],
  ] },
  { id: '2026-11-12-tv-nitida', date: '2026-11-12', title: 'Tela da loja nítida em qualquer TV', items: [
    ['melhoria', 'A Tela da loja agora é desenhada na resolução real da TV (Full HD ou 4K): textos, fotos e pódio ficam nítidos, com as animações rodando.'],
  ] },
  { id: '2026-11-11-horarios', date: '2026-11-11', title: 'Horário de funcionamento e dos profissionais', items: [
    ['novo', 'Em Configurações › Indicadores e metas › Horário de funcionamento e taxa de ocupação, dá para cadastrar um horário próprio para cada profissional (entrada, saída, almoço e dias no mês). A taxa de ocupação de cada um passa a usar o horário dele.'],
    ['melhoria', 'Enquanto o horário não for cadastrado, o Início mostra o lembrete em Primeiros passos e em Pendências, com o botão que leva direto ao lugar certo.'],
  ] },
  { id: '2026-11-11-cores-logo', date: '2026-11-11', title: 'O app nas cores da sua marca', items: [
    ['novo', 'Com o logo da empresa enviado, o app inteiro passa a usar as cores dele: botões, destaques, menu e fechamento, para toda a equipe.'],
    ['melhoria', 'Para voltar às cores padrão, desmarque "Usar as cores do meu logo no app" em Configurações › Empresa.'],
  ] },
  { id: '2026-11-11-tv-dono', date: '2026-11-11', title: 'Tela da loja só para o dono', items: [
    ['melhoria', 'A Tela da loja (TV) saiu do menu e do topo do app dos profissionais. Continua disponível para o dono.'],
  ] },
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
