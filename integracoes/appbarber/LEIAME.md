# Integração AppBarber → Gestão Barber IA

A AppBarber só aceita chamadas do **IP fixo cadastrado** com eles. Por isso esta sincronização roda num
**computador da barbearia**, ligado na internet desse IP.

## O que ela traz
A cada execução, o programa faz **1 chamada** à AppBarber (histórico de atendimentos *realizados* dos últimos 31 dias).
Depois envia ao Gestão Barber IA, por profissional e por dia:

| AppBarber | Gestão Barber IA |
|---|---|
| total dos itens da comanda do profissional (serviços + produtos de salão/barbearia, valor final do caixa, sem gorjeta e sem consumo de geladeira/bar) | Faturamento (igual ao "Total realizado/vendido" da AppBarber) |
| serviços da comanda | Serviços realizados |
| produtos de salão/barbearia da comanda (quantidade) | Venda de produtos |
| clientes diferentes atendidos no dia | Clientes atendidos |
| maior comanda do profissional no dia | Maior comanda do mês |
| horas de atendimento (início e fim de cada serviço da comanda; horários sobrepostos contam uma vez) | Taxa de ocupação (o app divide pelas horas da agenda definidas em Configurações) |

Cada comanda é lida **uma única vez** (1 chamada) e guardada em `comandas.json`. Só são lidas as comandas do **mês atual**
(nos 3 primeiros dias do mês, também as do mês anterior, para o fechamento). **Só contam comandas finalizadas**
(pagas, ou de um dia que já passou), como no Dashboard da AppBarber: não há valor provisório do agendamento. Comanda aberta
ou ainda não lida entra quando for finalizada e lida. Comanda ainda não paga é relida a cada 20 minutos. Os meses anteriores
não são reenviados.

**Maior comanda:** comandas de plano mensal (venda do plano ou atendimento pago pelo plano) não contam. A sincronização
reconhece pelo nome dos itens (plano, assinatura, clube, mensalidade) e pelos dados de pagamento. Se algum plano tiver
outro nome, informe os códigos no `config.json`: `"planos_codigos": ["123", "456"]`. O `testar.bat` mostra as comandas
reconhecidas como plano no mês. No fim da instalação, a **carga inicial** lê de uma vez as
comandas do mês atual (do dia 1º até hoje), no ritmo máximo da AppBarber (1.000 chamadas por
hora: cerca de 35 minutos para 550 comandas). Os números vão sendo atualizados no app
durante a carga. Para rodar de novo: `node sincronizar.mjs --carga` na pasta.

Planos e checklist ficam fora da AppBarber nesta versão. O profissional pode
lançar esses números ele mesmo (Configurações › Indicadores e metas › "Profissional lança os próprios números").
Reenviar o mesmo dia **substitui** o valor anterior, então nada é contado em dobro.

> A AppBarber cobra cada chamada feita com sucesso (5.000 chamadas = R$ 100, ou seja, R$ 0,02 cada).
> A sincronização roda a cada 10 minutos, só no horário de funcionamento definido no app
> (Configurações › Indicadores e metas › Regra da taxa de ocupação: abertura e fechamento). Fora dele, nada é cobrado.
> Com 10 horas por dia, são 60 chamadas por dia, cerca de 1.800 por mês (≈ R$ 36).

## Instalação (Windows)
1. Instale o **Node.js** (versão LTS) em https://nodejs.org.
2. Clique com o botão direito no botão Iniciar e abra o **Terminal** (ou o **Windows PowerShell**).
3. Cole o comando abaixo e aperte Enter. Ele baixa o programa para `C:\GestaoBarberIA\appbarber` e abre o instalador.

```powershell
$d="C:\GestaoBarberIA\appbarber"; New-Item -ItemType Directory -Force $d | Out-Null; foreach($f in "sincronizar.mjs","instalar.bat","sincronizar.bat","testar.bat"){ Invoke-WebRequest "https://gest-o-a-vista.vercel.app/integracoes/appbarber/$f" -OutFile "$d\$f" -UseBasicParsing }; Start-Process "$d\instalar.bat"
```

4. O instalador pede, um de cada vez:
   - a chave da API da AppBarber;
   - o código do estabelecimento;
   - a chave `gbia_...`, que fica no app em **Configurações › Integração & API**.
5. Ele busca os números na AppBarber e mostra o total de cada profissional, **sem enviar nada**.
6. Se os números estiverem certos, digite **S** e aperte Enter.
7. A sincronização passa a rodar sozinha a cada 10 minutos, no horário de abertura e fechamento definido no app.
   Mudou o horário no app? O sincronizador segue o novo horário sozinho.

Para trocar uma chave depois, dê dois cliques em `C:\GestaoBarberIA\appbarber\instalar.bat`.
Se o nome de algum profissional na AppBarber for diferente do cadastro no Gestão, ajuste `nomes` no `config.json`,
no formato `"Nome na AppBarber": "Nome no Gestão"`.

O resultado de cada execução fica em `sincronizacao.log`, na mesma pasta.

## Problemas comuns
- **AppBarber respondeu 401/403:** a chave está errada, ou o computador não está no IP liberado pela AppBarber.
- **"profissionais sem cadastro igual":** ajuste em `nomes` no `config.json`.
- **Gestão respondeu 402:** a integração por API é dos planos pagos, com a assinatura em dia.

**Segurança:** o `config.json` guarda as chaves. Não envie esse arquivo por WhatsApp ou e-mail.

## Consumo de geladeira e bar não conta
Bebidas, comidas e doces finalizados na comanda do profissional (cerveja, refrigerante, água, café, chiclete…)
**não entram** no faturamento nem na venda de produtos dele. Só contam os produtos de salão/barbearia (pomada,
shampoo, óleo…). O programa usa a **categoria** de cada produto no catálogo da AppBarber (1 chamada por dia):
uma categoria em que a maioria dos produtos tem nome de bebida ou comida é tratada como consumo.

O `testar.bat` mostra como cada categoria foi classificada. Para corrigir, use no `config.json`:
`"categorias_salao": ["código"]` (sempre conta) ou `"categorias_consumo": ["código"]` (nunca conta).
