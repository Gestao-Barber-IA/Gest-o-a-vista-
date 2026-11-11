# Integração AppBarber → Gestão Barber IA

A AppBarber só aceita chamadas do **IP fixo cadastrado** com eles. Por isso esta sincronização roda num
**computador da barbearia**, ligado na internet desse IP.

## O que ela traz
A cada execução, o programa faz **1 chamada** à AppBarber (histórico de atendimentos *realizados* dos últimos 31 dias).
Depois envia ao Gestão Barber IA, por profissional e por dia:

| AppBarber | Gestão Barber IA |
|---|---|
| total dos itens da comanda do profissional (serviços + produtos, valor final do caixa, sem gorjeta) | Faturamento (igual ao "Total realizado/vendido" da AppBarber) |
| serviços da comanda | Serviços realizados |
| produtos da comanda (quantidade) | Venda de produtos |
| clientes diferentes atendidos no dia | Clientes atendidos |
| maior comanda do profissional no dia | Maior comanda do mês |

Cada comanda é lida **uma única vez** (1 chamada) e guardada em `comandas.json`. Enquanto a comanda não é lida, vale o
valor do agendamento. Comanda ainda não paga é relida no máximo 1 vez por hora. No fim da instalação, a **carga inicial** lê todas as
comandas dos últimos 31 dias de uma vez, começando pelo mês atual, no ritmo máximo da AppBarber (1.000 chamadas por
hora: cerca de 1h30 para 1.500 comandas; o mês atual fica pronto bem antes). Os números vão sendo atualizados no app
durante a carga. Para rodar de novo: `node sincronizar.mjs --carga` na pasta.

Planos, ocupação e checklist ficam fora da AppBarber nesta versão. O profissional pode
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
