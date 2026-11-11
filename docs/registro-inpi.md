# Registro do software no INPI

O registro de programa de computador no INPI é a prova oficial de que o sistema é seu. Ele vale por 50 anos, no Brasil e nos países que assinaram a Convenção de Berna, e é o que permite processar quem copiar.

## O que você precisa
- CPF ou CNPJ do titular (de preferência a empresa que vende o sistema).
- Cadastro no e-INPI: https://www.gov.br/inpi (Programa de Computador).
- A taxa (GRU) do pedido de registro de programa de computador. O valor muda; para pessoa física, MEI, ME e EPP há desconto.

## Passo a passo
1. Crie o login no e-INPI e emita a GRU de "Pedido de registro de programa de computador".
2. Pague a GRU.
3. Gere o **resumo digital (hash SHA-512)** do código. O código não é enviado ao INPI, só o hash, que prova que aquele código existia naquela data.
   - Baixe o código do GitHub (botão "Code" › "Download ZIP") da versão atual.
   - Gere o hash do arquivo ZIP. No Windows (PowerShell): `Get-FileHash .\arquivo.zip -Algorithm SHA512`.
   - **Guarde o ZIP original num lugar seguro e não altere nada nele**: é ele que prova a autoria se um dia houver disputa.
4. No e-INPI, preencha o formulário de registro de programa de computador:
   - Título: "Gestão Barber IA" (faça outro pedido para "Gestão Salão IA" se quiser registrar a marca do produto separadamente).
   - Data de criação (publicação): a data do primeiro uso.
   - Linguagem: JavaScript, HTML, CSS e SQL.
   - Campo de aplicação e tipo de programa: gestão empresarial / aplicativo web.
   - Autor(es) e titular.
   - O hash SHA-512 do passo 3.
5. Envie. O certificado costuma sair em poucos dias úteis.

## Também vale registrar a marca
O registro de software protege o código. Os nomes **Gestão Barber IA** e **Gestão Salão IA** e os logos são protegidos pelo **registro de marca**, que é outro pedido no INPI (Marcas, classe 42: software como serviço). Com a marca registrada, ninguém pode usar nomes parecidos.

## Depois do registro
- Preencha a razão social, o CNPJ e o foro nos campos marcados nos Termos de Uso (`termos.html`).
- A cada versão grande do sistema, guarde um novo ZIP com a data. Não é preciso registrar de novo a cada mudança.

Este guia é informativo. Para dúvidas de propriedade intelectual, vale consultar um advogado ou agente da propriedade industrial.
