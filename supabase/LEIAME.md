# Ligando o Gestão Barber IA ao Supabase

Siga na ordem. Leva uns 15 minutos.

## 1. Criar o projeto
1. Entre em https://supabase.com e crie uma conta (pode usar o Google).
2. **New project** → nome `gestao-barber-ia` → crie uma senha forte para o banco (guarde, mas não precisa me passar) → região **South America (São Paulo)** → **Create**.

## 2. Criar as tabelas
1. No menu do projeto: **SQL Editor** → **New query**.
2. Copie todo o conteúdo de `supabase/schema.sql`, cole e clique em **Run**.
3. Deve aparecer "Success. No rows returned".

## 3. Pegar o endereço e a chave pública
**Project Settings → API**:
- **Project URL** (ex.: `https://abcdefgh.supabase.co`)
- **anon public** (uma chave longa que começa com `eyJ`)

A chave **anon** é pública: ela vai dentro do app e pode ser enviada no chat.
**Nunca envie a chave `service_role`.**

## 4. Endereço do app e links dos e-mails
**Authentication → URL Configuration**:
- **Site URL**: o endereço onde o app ficar publicado (ex.: `https://gestao-barber-ia.vercel.app`)
- **Redirect URLs**: adicione o mesmo endereço com `/**` no fim (ex.: `https://gestao-barber-ia.vercel.app/**`)

## 5. E-mails em português
Antes, configure um serviço de e-mail próprio (SMTP, veja abaixo): sem ele o Supabase não deixa editar os modelos.

**Authentication → Email Templates**. Para cada modelo, troque o **Subject** e cole o HTML do arquivo:

| Modelo | Assunto | Arquivo |
|---|---|---|
| Confirm signup | Confirme seu e-mail no Gestão Barber IA | `supabase/email/confirmar-cadastro.html` |
| Reset Password | Crie sua nova senha do Gestão Barber IA | `supabase/email/redefinir-senha.html` |
| Change Email Address | Confirme seu novo e-mail no Gestão Barber IA | `supabase/email/trocar-email.html` |
| Invite user | Você foi convidado para o Gestão Barber IA | `supabase/email/convidar-usuario.html` |

> O plano grátis do Supabase envia poucos e-mails por hora. Para uso diário com a equipe, configure um serviço de e-mail próprio em **Project Settings → Authentication → SMTP Settings** (ex.: Resend ou Brevo, ambos com plano grátis).

## 6. (Opcional) Entrar com Google, Apple ou Microsoft
**Authentication → Providers** → ative o que quiser e siga as instruções da própria tela (cada um pede um cadastro no Google Cloud, Apple Developer ou Azure). Microsoft aparece como **Azure**.

## 7. (Opcional) API para receber dados de outro sistema
Publique a função `supabase/functions/lancamentos` com a ferramenta do Supabase:
```
npx supabase login
npx supabase link --project-ref SEU_PROJECT_REF
npx supabase functions deploy lancamentos --no-verify-jwt
```
O endereço fica `https://SEU_PROJECT_REF.supabase.co/functions/v1/lancamentos`, e a chave aparece no app em **Integração & API**.

## 8. Ligar o app
Preencha `js/config.js` com o endereço e a chave anon (ou envie para o Claude fazer isso). Com o arquivo preenchido, o app deixa o modo de demonstração e passa a usar a nuvem.

## 9. Assinatura (SaaS) com Asaas
O `schema.sql` já inclui planos, teste grátis de 7 dias, bloqueio e o painel do dono do SaaS.

1. Crie a conta no Asaas (comece pelo **sandbox**, ambiente de testes: https://sandbox.asaas.com).
2. Em **Integrações → Chaves de API**, gere a chave.
3. No Supabase: **Edge Functions → Secrets** e crie:
   - `ASAAS_API_KEY` = a chave do Asaas
   - `ASAAS_ENV` = `sandbox` (troque para `production` quando for cobrar de verdade)
   - `ASAAS_WEBHOOK_TOKEN` = uma senha qualquer, longa, criada por você
4. Publique as funções `assinatura` e `asaas-webhook` (e `lancamentos`).
5. No Asaas: **Integrações → Webhooks → Adicionar**:
   - URL: `https://SEU_PROJECT_REF.supabase.co/functions/v1/asaas-webhook`
   - Token de autenticação: o mesmo `ASAAS_WEBHOOK_TOKEN`
   - Eventos: cobranças (PAYMENT_*) e assinaturas (SUBSCRIPTION_*)
6. Dono do SaaS: rode no SQL Editor, com o seu e-mail:
   ```sql
   insert into platform_admins (user_id) select id from auth.users where email = 'SEU_EMAIL' on conflict do nothing;
   update companies set sub_status = 'courtesy', paid_until = '2099-12-31'
   where id = (select company_id from profiles where email = 'SEU_EMAIL' limit 1);
   ```
   Depois, o menu do app mostra **Painel do SaaS**.
