# Formulário de cadastro no anúncio do Instagram (Meta)

O formulário instantâneo abre **dentro do Instagram**, já preenchido com os dados da pessoa. Ela confirma, envia e, no final, vai para o quiz da página de vendas.

## 1. Criar a campanha
1. Abra o **Gerenciador de Anúncios** (business.facebook.com/adsmanager) → **Criar**.
2. Objetivo: **Cadastros** → Continuar.
3. No **conjunto de anúncios**, em *Local da conversão*, escolha **Formulários instantâneos**.
4. Público: Brasil (ou a sua cidade/região), 25 a 55 anos, interesses como *barbearia*, *salão de beleza*, *empreendedorismo*, *gestão de negócios*. Posicionamentos: **Instagram** (Feed, Stories e Reels).

## 2. Criar o formulário (no anúncio, em *Formulário instantâneo* → **Criar formulário**)
**Tipo de formulário:** *Mais volume* (mais cadastros) ou *Maior intenção* (pede para a pessoa revisar os dados antes de enviar; menos cadastros, de mais qualidade). Para começar, **Maior intenção**.

**Introdução**
- Imagem: o logo (Gestão Barber IA ou Gestão Salão IA) ou um print do pódio.
- Título: **Sua equipe batendo meta todo mês**
- Descrição: *Ranking em tempo real, metas e checklist com prova. Cadastre-se e descubra o plano ideal para a sua equipe.*

**Perguntas** → *Informações de contato* (vêm preenchidas pelo Instagram):
- **Nome**
- **Sobrenome**
- **Número de telefone**
- **E-mail**

(Opcional) *Pergunta de múltipla escolha*: **Qual é o seu negócio?** Barbearia · Salão de beleza · Esmalteria · Clínica de estética.

**Política de privacidade**
- Texto do link: **Política de privacidade**
- Link: `https://gest-o-a-vista.vercel.app/privacidade.html`
- Aviso personalizado (marque *Adicionar aviso personalizado*): *Autorizo o contato por WhatsApp, telefone ou e-mail sobre o sistema.* com a caixa de seleção obrigatória.

**Tela de conclusão**
- Título: **Pronto! Agora descubra o seu plano ideal**
- Descrição: *Responda 2 perguntas rápidas e veja como o sistema funciona na sua equipe.*
- Chamada para ação: **Visualizar site**
- Texto do botão: **Ver meu plano ideal**
- Link do site: `https://gest-o-a-vista.vercel.app/oferta/?cadastro=ok&utm_source=instagram&utm_medium=formulario`

> O `?cadastro=ok` faz a página pular o cadastro (a pessoa já preencheu no Instagram) e ir direto para o quiz.
> Para anúncios de um público só, acrescente o tipo: `&tipo=barbearia`, `&tipo=salao`, `&tipo=esmalteria` ou `&tipo=estetica` (o quiz já começa na pergunta do tamanho da equipe).

## 3. Onde ficam os contatos
- **Meta Business Suite → Todas as ferramentas → Central de Cadastros**: lista com nome, sobrenome, telefone e e-mail, com opção de **baixar planilha** e marcar a situação de cada um.
- Para ser avisado de cada novo cadastro: Central de Cadastros → *Configurações* → notificações por e-mail.
- Os formulários do Meta guardam os cadastros por 90 dias: baixe a planilha com frequência.

## 4. Cadastros feitos direto na página
Quem entra pelo link da bio, stories ou WhatsApp (sem o formulário do Instagram) preenche o cadastro na própria página antes do quiz. Esses contatos ficam no app em **Painel do SaaS → Interessados**, com botão de WhatsApp, situação (Novo, Contatado, Virou cliente, Descartado) e opção de baixar a planilha.

## 5. Links prontos
| Uso | Link |
|---|---|
| Bio do Instagram | `https://gest-o-a-vista.vercel.app/oferta/?utm_source=instagram&utm_medium=bio` |
| Stories | `https://gest-o-a-vista.vercel.app/oferta/?utm_source=instagram&utm_medium=stories` |
| Tela final do formulário | `https://gest-o-a-vista.vercel.app/oferta/?cadastro=ok&utm_source=instagram&utm_medium=formulario` |

O `utm_source` e o `utm_medium` aparecem na coluna *Origem* da lista de Interessados, para você saber de onde veio cada contato.
