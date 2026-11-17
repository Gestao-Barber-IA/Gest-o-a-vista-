/* Atualizações do sistema (aba Atualizações).
   A cada mudança publicada, acrescente uma entrada NO TOPO da lista, com a data e o que mudou,
   escrito para o dono da empresa (sem termos técnicos). Tipos: novo, melhoria, correcao. */
window.GB_UPDATES = [
  { id: '2026-11-17-checklist-performance', date: '2026-11-17', title: 'Checklist: card Checklist de performance', items: [
    ['melhoria', 'O card das tarefas agora se chama Checklist de performance e fica logo abaixo da Disponibilidade comercial. O card do topo (POP — Agenda Lotada) saiu da página.'],
  ] },
  { id: '2026-11-17-amarelo-texto', date: '2026-11-17', title: 'Texto do cartão amarelo', items: [
    ['melhoria', 'Disponibilidade alterada (amarelo) agora diz: Alteração não comunicada para reorganização da agenda e dos clientes.'],
  ] },
  { id: '2026-11-17-creditos-ab', date: '2026-11-17', title: 'Contador de créditos da API AppBarber', items: [
    ['novo', 'Em Integração, o cartão Créditos da API AppBarber: o sistema conta as consultas que faz (cada uma gasta 1 crédito) e mostra o saldo estimado, a média por dia e quantos dias ainda dura. Registre ali cada recarga.'],
    ['novo', 'Aviso no sininho e na tela quando o saldo estimado fica abaixo de 15% ou dura menos de 5 dias, e quando a AppBarber avisa que o saldo acabou.'],
  ] },
  { id: '2026-11-17-economia-creditos', date: '2026-11-17', title: 'Menos consultas à AppBarber (economia de créditos)', items: [
    ['melhoria', 'Cada consulta à API da AppBarber gasta crédito. A sincronização dos números passou a rodar a cada 15 minutos e o lembrete dos clientes confere a agenda a cada 15 minutos, só no horário de funcionamento.'],
    ['melhoria', 'Comandas ainda abertas (cliente não pagou) são relidas a cada 45 minutos, e não mais a cada 20. 10 minutos depois do fechamento, a sincronização roda uma última vez e relê todas as que ficaram abertas, para o dia terminar com tudo atualizado.'],
    ['novo', 'Em Configurações › Horário de funcionamento, marque os dias em que a barbearia fecha (ex.: domingo): nesses dias não há consulta à AppBarber nem lembrete no WhatsApp.'],
  ] },
  { id: '2026-11-17-wa-principal', date: '2026-11-17', title: 'Lembrete dos clientes pelo WhatsApp principal', items: [
    ['novo', 'No cartão Lembrete de agendamento para os clientes, escolha o número que envia: o 2º chip ou o WhatsApp principal da barbearia. No principal, o cliente reconhece o número e as respostas caem direto na recepção.'],
    ['melhoria', 'Proteções no número principal: textos sorteados entre várias versões, de 40 a 90 segundos entre envios, até 20 por hora e 150 por dia, sem links e pausa automática se 3 envios seguidos falharem. O 2º chip continua de reserva: é só trocar no cartão.'],
  ] },
  { id: '2026-11-17-wa-dois-numeros', date: '2026-11-17', title: 'Um número para a equipe e outro para os clientes', items: [
    ['melhoria', 'Os lembretes no WhatsApp podem sair por dois chips: um só para a equipe (checklist) e outro só para os clientes (lembrete de agendamento). Se um número tiver problema, o outro continua funcionando.'],
  ] },
  { id: '2026-11-17-wa-clientes', date: '2026-11-17', title: 'Lembrete de agendamento para os clientes no WhatsApp', items: [
    ['novo', 'Em Integração, o cartão Lembrete de agendamento para os clientes: o servidor confere a agenda da AppBarber a cada 15 minutos e manda um WhatsApp para o cliente antes do horário (por padrão, 1 hora antes).'],
    ['melhoria', 'Horários seguidos do mesmo cliente viram uma mensagem só, e quem agendou em cima da hora recebe o lembrete 20 minutos antes. O dono escolhe a antecedência, o texto e uma resposta automática para quem responder ao lembrete.'],
  ] },
  { id: '2026-11-17-wa-lembretes', date: '2026-11-17', title: 'Lembretes do checklist no WhatsApp', items: [
    ['novo', 'Em Integração, o cartão Lembretes automáticos no WhatsApp: no horário escolhido (ex.: 13h), quem está trabalhando hoje e fez menos que o mínimo de pontos do Checklist Agenda Cheia recebe uma mensagem no WhatsApp.'],
    ['melhoria', 'O dono escolhe o horário, o mínimo de pontos e o texto da mensagem, e vê se o envio está funcionando. Uma mensagem por pessoa por dia, com intervalo entre os envios.'],
  ] },
  { id: '2026-11-17-fisc-audio', date: '2026-11-17', title: 'Fiscalização por áudio', items: [
    ['novo', 'Na Fiscalização, o botão Registrar por áudio: o dono, o gestor ou o líder fala o que aconteceu e o sistema preenche o registro sozinho, com o profissional, o tipo de falta, a data (hoje, ontem, sábado, dia 12) e o relato. A gravidade segue a sugestão de sempre.'],
    ['melhoria', 'Nada é salvo sem conferência: o formulário abre preenchido e avisa quando não entendeu o nome ou o tipo. Usa o reconhecimento de voz do próprio celular, sem custo; o áudio não fica guardado, só o texto.'],
  ] },
  { id: '2026-11-17-fisc-relatorio', date: '2026-11-17', title: 'Relatório mensal da Fiscalização', items: [
    ['novo', 'Nova aba Relatório do mês na Fiscalização: total de registros e comparação com o mês anterior, por gravidade, por tipo, vermelhos e amarelos da Disponibilidade por dia da semana, e o resumo de cada profissional.'],
    ['novo', 'Sugestões de atitudes por regras claras: plano de ação para penalidade ou reincidência, conversa e revisão da agenda para 2 ou mais vermelhos, treinamento quando a mesma falta aparece em 3 ou mais profissionais, e reconhecimento para quem fechou o mês sem registros.'],
    ['novo', 'No dia 1º de cada mês, aviso no sininho e na tela de que o relatório do mês anterior está pronto, para o dono, o gestor e os líderes com acesso à Fiscalização. Dá para imprimir, salvar em PDF e mandar o resumo de cada um pelo WhatsApp.'],
  ] },
  { id: '2026-11-17-checklist-ordem', date: '2026-11-17', title: 'Checklist: nova ordem das tarefas', items: [
    ['melhoria', 'O card Registro do dia agora se chama Posicionamento estratégico nas redes sociais e fica logo abaixo da Disponibilidade comercial.'],
    ['melhoria', 'Ordem das tarefas seguindo o dia, da mais fácil para a mais difícil: Pró Atividade, 5 Stories, 10 Convites no Instagram, 3 Publicações com o cliente, 3 Retornos agendados, 3 Avaliações no Google e 5 Abordagens.'],
  ] },
  { id: '2026-11-17-fisc-cores', date: '2026-11-17', title: 'Fiscalização com a cor do botão', items: [
    ['melhoria', 'Registros que vêm da Disponibilidade comercial aparecem na cor do botão: vermelho para compromisso comercial não atendido e amarelo para disponibilidade alterada. O relato também usa os nomes novos.'],
  ] },
  { id: '2026-11-16-ranking-justo', date: '2026-11-16', title: 'Ranking mais justo', items: [
    ['melhoria', 'Nota de cada indicador proporcional ao líder: o 1º tira 100 e quem fez 70% do resultado dele tira 70. Antes, o último levava 0 mesmo quando estava perto.'],
    ['melhoria', 'Retenção de clientes antigos e Fidelização de clientes novos: quem ainda tem poucos clientes fica de fora do indicador, sem nota zero. A nota geral usa os outros pesos.'],
    ['novo', 'Mínimo de dias para disputar posição: metade dos dias de quem mais trabalhou no período, no máximo 5. Antes disso, a pessoa aparece como Entrando no ranking, com os números dela, sem mexer na nota dos outros.'],
  ] },
  { id: '2026-11-16-checklist-dia', date: '2026-11-16', title: 'Checklist: níveis pela média por dia trabalhado', items: [
    ['melhoria', 'Os níveis e a garantia do Checklist Agenda Cheia agora usam a média de pontos por dia trabalhado, e não o total do mês. Quem trabalha 22 ou 28 dias concorre de igual para igual. Dia trabalhado é o dia com atendimento na agenda (AppBarber) ou com registro no checklist; quem trabalhou e não fez o checklist tem o dia contado com zero.'],
    ['melhoria', 'Novas faixas (por dia, de 24 pts possíveis): Elite 20,5 · Ouro 16 · Prata 14,5 · Bronze 12,5 · Em desenvolvimento 11. As garantias continuam as mesmas.'],
    ['melhoria', 'No ranking, o indicador Checklist Agenda Cheia passa a ser a média de pontos por dia trabalhado.'],
    ['novo', 'Tarefas: 5 Stories (3 nos horários estratégicos 8h30, 12h e 17h30) vale 3 pts; 5 Abordagens vale 4 pts; Avaliações no Google passa a 3 por dia; nova tarefa 3 Retornos agendados (print da agenda com o próximo horário do cliente), 3 pts; Pró Atividade ganhou exemplos.'],
    ['novo', 'Compromisso comercial não atendido (vermelho) agora desconta 3 pts do dia, além de ficar sem o bônus. O dia nunca fica negativo. O dono muda o valor em Editar estrutura do checklist.'],
    ['melhoria', 'Regras do programa: a garantia é apurada por mês fechado (do dia 1º ao último dia), pela comissão dos atendimentos do período, e não pela data de pagamento.'],
    ['melhoria', 'Stories Estratégico entrou dentro dos 5 Stories. Os dias anteriores continuam com os pontos que já tinham.'],
  ] },
  { id: '2026-11-16-retencao', date: '2026-11-16', title: 'Retenção de clientes antigos e fidelização de clientes novos', items: [
    ['novo', 'Dois novos indicadores: Retenção de clientes antigos (dos clientes que já frequentavam a casa, quantos voltaram com o mesmo profissional em até 45 dias) e Fidelização de clientes novos (dos clientes na primeira visita, quantos voltaram com o mesmo profissional em até 45 dias).'],
    ['melhoria', 'Os números vêm da sincronização AppBarber. Os indicadores chegam desligados: ligue em Configurações › Indicadores e metas.'],
    ['melhoria', 'Planos mensais: cliente novo que fecha plano conta como fidelizado; assinante que volta todo mês fica fora das duas taxas.'],
  ] },
  { id: '2026-11-16-contratos', date: '2026-11-16', title: 'Nova aba Contratos', items: [
    ['novo', 'Depois da assinatura dos termos e regras, o documento fica guardado na aba Contratos: o texto como estava no dia, nome completo, CNPJ, data e a assinatura. Dá para imprimir ou salvar em PDF.'],
    ['melhoria', 'O dono vê o contrato de todos; cada profissional, gestor e líder vê só o seu.'],
    ['melhoria', 'No cartão de termos, o botão Ver como o profissional vê mostra a tela de aceite sem salvar nada. Na demonstração, Ver como profissional já abre a tela de termos.'],
  ] },
  { id: '2026-11-16-termos', date: '2026-11-16', title: 'Termos e regras com assinatura', items: [
    ['novo', 'Em Configurações › Empresa › Termos e regras da barbearia, o dono publica as regras. Ao entrar, cada profissional, gestor e líder lê, marca o aceite, escreve o nome completo e o CNPJ e assina com o dedo; só então o sistema libera.'],
    ['novo', 'O dono vê quem já assinou (com nome, data e a assinatura) e quem falta. Publicar uma nova versão pede o aceite de todos de novo.'],
  ] },
  { id: '2026-11-16-nota', date: '2026-11-16', title: 'Como seus pontos são calculados', items: [
    ['novo', 'No topo de Minha performance, o profissional vê até quantos pontos (de 100) vale cada indicador, conforme os pesos definidos pelo dono.'],
  ] },
  { id: '2026-11-16-ganho', date: '2026-11-16', title: 'Ganho do mês em Minha performance', items: [
    ['novo', 'Em Minha performance, o profissional vê quanto ganhou no mês: comissão, planos e produtos, prêmios do ranking, bônus registrados e descontos de penalidade.'],
    ['melhoria', 'Só o próprio profissional, o dono, o gestor e o líder com o novo acesso extra "Ver o ganho da equipe" veem esse valor. Os colegas não.'],
  ] },
  { id: '2026-11-15-tipos-bonus', date: '2026-11-15', title: 'Tipos de bônus da empresa', items: [
    ['novo', 'Na aba Bônus, a nova aba Tipos de bônus da empresa: o dono cadastra os bônus que a casa oferece (nome, o que ganha e como ganhar) e toda a equipe consulta.'],
    ['melhoria', 'O dono muda os tipos de bônus quando quiser (por exemplo, todo mês). Cada alteração aparece para a equipe em Avisos e alterações.'],
    ['melhoria', 'Ao registrar um bônus, dá para escolher um bônus da empresa e o formulário já vem preenchido. Só o dono, o gestor e o líder autorizado registram bônus; o profissional só acompanha os dele.'],
  ] },
  { id: '2026-11-15-comanda-disp', date: '2026-11-15', title: 'Maior comanda e Disponibilidade comercial', items: [
    ['melhoria', 'A comanda feita no dia em que o profissional teve Disponibilidade alterada ou Compromisso comercial não atendido não conta para o destaque Maior comanda (pódio, Tela da loja e fechamento).'],
    ['melhoria', 'No perfil do profissional, esse valor aparece em vermelho, com o aviso de que não conta no pódio e o valor que está valendo.'],
  ] },
  { id: '2026-11-15-disp-comercial', date: '2026-11-15', title: 'Disponibilidade comercial', items: [
    ['melhoria', 'O cartão Horário de chegada passa a se chamar Disponibilidade comercial, com 3 situações: Disponibilidade confirmada, Disponibilidade alterada e Compromisso comercial não atendido. As regras de pontos e de Fiscalização continuam as mesmas.'],
  ] },
  { id: '2026-11-15-chegada-regras', date: '2026-11-15', title: 'Horário de chegada: novas regras na Fiscalização', items: [
    ['melhoria', 'O Horário de chegada fica no topo do Registro do dia. O profissional vê as regras: no horário participa dos bônus; após o horário não participa; atrasado fica registrado na Fiscalização.'],
    ['melhoria', 'Amarelo (após o horário combinado): registra na Fiscalização (tipo Atraso), sem somar para advertência.'],
    ['melhoria', 'Vermelho (atrasado), no mês: 1º atraso advertência, 2º reincidência, do 3º em diante penalidade.'],
  ] },
  { id: '2026-11-15-combo-extra', date: '2026-11-15', title: 'Serviços extras: opção Combo com extra', items: [
    ['novo', 'Em Indicadores e metas › Serviços extras, cada serviço agora tem 3 opções: Tradicional, Extra ou Combo com extra.'],
    ['novo', 'Combo com extra (ex.: Corte Tradicional & Sobrancelha): cada combo conta 1 serviço extra; no valor, conta só a diferença entre o preço do combo e o do serviço tradicional dele (o sistema sugere e o dono pode trocar).'],
  ] },
  { id: '2026-11-15-precos', date: '2026-11-15', title: 'Nova aba Tabela de Preços e Planos', items: [
    ['novo', 'Aba Tabela de Preços e Planos no menu principal, no mesmo formato dos POPs: o dono cria tabelas (ex.: Serviços, Planos mensais) e anexa as imagens; toda a equipe consulta e amplia com um toque.'],
  ] },
  { id: '2026-11-14-extras', date: '2026-11-14', title: 'Novo indicador: Serviços extras', items: [
    ['novo', 'Serviços extras conta os serviços além dos tradicionais (ex.: sobrancelha, pigmentação). Em Indicadores e metas › Serviços extras, o dono marca quais serviços são tradicionais: o resto conta como extra.'],
    ['novo', 'Dá para escolher se conta a quantidade ou o valor em R$. O indicador chega desligado: ligue na chave quando quiser usar.'],
    ['melhoria', 'A sincronização AppBarber passa a enviar os serviços de cada comanda pelo nome. Sem integração, o total do mês é lançado em Lançamentos.'],
  ] },
  { id: '2026-11-14-bonus', date: '2026-11-14', title: 'Nova aba Bônus', items: [
    ['novo', 'Aba Bônus no menu principal: o dono, a gestão e o líder autorizado registram bônus financeiro (com atalho da roleta de R$ 10 a R$ 50 ao vender 3 produtos) ou outro tipo de bônus (ex.: 2 ingressos VIP no cinema), sempre com a referência de por que o profissional ganhou.'],
    ['novo', 'Cada profissional vê só os próprios bônus, com o total do mês e do ano. A liderança vê os de toda a equipe.'],
    ['melhoria', 'Novo acesso extra do líder em Adicionar profissional: Bônus.'],
  ] },
  { id: '2026-11-14-check-adj', date: '2026-11-14', title: 'Pontos do checklist trazidos do sistema anterior', items: [
    ['melhoria', 'Os pontos do Checklist Agenda Cheia que vieram do sistema anterior foram somados aos pontos de novembro de cada profissional. No checklist, aparecem no dia 1º como "trazidos do sistema anterior".'],
  ] },
  { id: '2026-11-14-comanda-plano', date: '2026-11-14', title: 'Maior comanda sem planos mensais', items: [
    ['melhoria', 'Comandas de plano mensal (venda do plano ou atendimento pago pelo plano) não contam mais como maior comanda do mês. A sincronização AppBarber reconhece pelo nome (plano, assinatura, clube, mensalidade) e pelos dados de pagamento.'],
    ['melhoria', 'A maior comanda só conta depois que o pagamento da comanda for finalizado na AppBarber.'],
    ['melhoria', 'A venda de planos mensais não conta mais como produto vendido (nem em quantidade, nem em valor). Continua no faturamento.'],
  ] },
  { id: '2026-11-13-so-finalizadas', date: '2026-11-13', title: 'AppBarber: só comandas finalizadas', items: [
    ['melhoria', 'A sincronização com a AppBarber passa a contar só as comandas finalizadas, com o valor real cobrado, igual ao Dashboard Profissional da AppBarber. Sem valor provisório do agendamento.'],
    ['melhoria', 'Atendimento com comanda ainda aberta entra no ranking assim que a comanda for paga (a sincronização confere as comandas abertas a cada 20 minutos).'],
  ] },
  { id: '2026-11-13-qtd-valor', date: '2026-11-13', title: 'Serviços e produtos por quantidade ou por valor', items: [
    ['novo', 'Em Configurações › Indicadores e metas, o dono escolhe se Serviços realizados e Venda de produtos contam a quantidade ou o valor em R$ (Valor em serviços, Valor em produtos vendidos).'],
    ['melhoria', 'A sincronização AppBarber já envia os dois. O valor em produtos não inclui o consumo de geladeira ou bar. Em Lançamentos aparece o campo do modo escolhido.'],
  ] },
  { id: '2026-11-13-indicadores', date: '2026-11-13', title: 'Ligar, desligar e criar indicadores', items: [
    ['novo', 'Em Configurações › Indicadores e metas, cada indicador tem uma chave para ativar ou desativar. Salva na hora: o indicador desativado sai da nota, das metas e de Lançamentos, e os números já lançados ficam guardados.'],
    ['novo', 'Indicadores personalizados: crie indicadores só da sua empresa (ex.: Avaliações no Google), com tipo (quantidade ou R$), meta do mês e prioridade. Eles entram na nota, no ranking, nas metas e em Lançamentos.'],
  ] },
  { id: '2026-11-13-chegada-3', date: '2026-11-13', title: 'Horário de chegada com 3 botões e penalidade automática', items: [
    ['novo', 'O Horário de chegada fica no topo do Checklist Agenda Cheia, sem prova, com 3 botões: Chegou no horário combinado (verde, ganha os pontos), Chegou após o horário combinado (amarelo, sem bônus) e Chegou atrasado (vermelho, sem bônus).'],
    ['novo', 'O vermelho gera sozinho um registro na Fiscalização (tipo falta): no mês, a 1ª vez é ocorrência, a 2ª reincidência e da 3ª em diante penalidade.'],
    ['novo', 'Nova aba Penalidades na Fiscalização, com os profissionais que levaram penalidade. O dono, o gestor e os líderes com acesso à Fiscalização recebem o aviso no sino.'],
  ] },
  { id: '2026-11-13-tutorial-api', date: '2026-11-13', title: 'Passo a passo da integração', items: [
    ['novo', 'Em Configurações › Integração & API, um passo a passo para cada caso: quem usa a AppBarber, quem usa outro sistema e quem não tem integração.'],
    ['novo', 'Guia técnico pronto para mandar ao suporte do seu sistema, com a sua chave, o endereço, os campos e os códigos dos profissionais. Dá para copiar ou enviar por WhatsApp.'],
  ] },
  { id: '2026-11-13-sync-nuvem', date: '2026-11-13', title: 'Sincronização AppBarber pela nuvem, 24 horas', items: [
    ['novo', 'Em Integração & API, o dono coloca o código do estabelecimento e a chave da API da AppBarber. O servidor do sistema busca os atendimentos e as comandas a cada 10 minutos, 24 horas por dia.'],
    ['melhoria', 'Não precisa mais deixar computador ligado na barbearia. O cartão mostra se está funcionando e a hora da última sincronização.'],
  ] },
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
