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
**Authentication → Email Templates**. Para cada modelo, troque o **Subject** e cole o HTML do arquivo:

| Modelo | Assunto | Arquivo |
|---|---|---|
| Confirm signup | Confirme seu e-mail no Gestão Barber IA | `supabase/email/confirmar-cadastro.html` |
| Reset Password | Crie sua nova senha do Gestão Barber IA | `supabase/email/redefinir-senha.html` |
| Change Email Address | Confirme seu novo e-mail | `supabase/email/trocar-email.html` |

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
