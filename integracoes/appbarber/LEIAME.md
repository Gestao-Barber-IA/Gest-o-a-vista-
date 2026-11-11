# Integração AppBarber → Gestão Barber IA

A AppBarber só aceita chamadas do **IP fixo cadastrado** com eles. Por isso esta sincronização roda num
**computador da barbearia**, ligado na internet desse IP.

## O que ela traz
A cada execução, o programa faz **1 chamada** à AppBarber (histórico de atendimentos *realizados* dos últimos 31 dias).
Depois envia ao Gestão Barber IA, por profissional e por dia:

| AppBarber | Gestão Barber IA |
|---|---|
| soma dos valores dos serviços realizados | Faturamento |
| quantidade de serviços realizados | Serviços realizados |
| clientes diferentes atendidos no dia | Clientes atendidos |
| maior comanda do profissional no dia | Maior comanda do mês |

Os outros indicadores ficam fora da AppBarber nesta versão: produtos, planos, ocupação e checklist. O profissional pode
lançar esses números ele mesmo (Configurações › Indicadores e metas › "Profissional lança os próprios números").
Reenviar o mesmo dia **substitui** o valor anterior, então nada é contado em dobro.

> A AppBarber cobra cada chamada feita com sucesso. Com o agendamento abaixo, de hora em hora das 8h às 22h,
> são cerca de 15 chamadas por dia.

## Instalação (Windows)
1. Instale o **Node.js** (versão LTS) em https://nodejs.org.
2. Copie esta pasta para o computador, por exemplo em `C:\GestaoBarberIA\appbarber`.
3. Copie `config.exemplo.json` para **`config.json`** e preencha:
   - `appbarber_api_key`: a chave da API enviada pela AppBarber;
   - `codigo_estabelecimento`: o código do estabelecimento na AppBarber;
   - `gestao_api_key`: a chave `gbia_...`, que fica no Gestão Barber IA em **Integração & API**;
   - `nomes`: preencha só se o nome de algum profissional na AppBarber for diferente do cadastro no Gestão.
     Use o formato `"Nome na AppBarber": "Nome no Gestão"`.
4. Dê dois cliques em **`testar.bat`**. Ele mostra o total de cada profissional **sem enviar nada**.
5. Se os números estiverem certos, dê dois cliques em **`instalar-agendamento.bat`**. Ele agenda a sincronização a
   cada 1 hora, das 8h às 22h.

O resultado de cada execução fica em `sincronizacao.log`, na mesma pasta.

## Problemas comuns
- **AppBarber respondeu 401/403:** a chave está errada, ou o computador não está no IP liberado pela AppBarber.
- **"profissionais sem cadastro igual":** ajuste em `nomes` no `config.json`.
- **Gestão respondeu 402:** a integração por API é dos planos pagos, com a assinatura em dia.

**Segurança:** o `config.json` guarda as chaves. Não envie esse arquivo por WhatsApp ou e-mail.
