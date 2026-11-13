# Homologação no Netlify

Use o projeto Netlify conectado ao repositório `faturamento1023/uhp-notifica-`. A configuração da branch `codex/backend-notificacoes` serve a API por Netlify Functions e inclui uma página simples para consultar o estado da conexão. A entrega do frontend substitui essa página pelas telas integradas e usa chamadas relativas a `/api/v1`.

## Configurar o Deploy Preview do PR nº 1

1. No Supabase UHP Notifica, defina a senha do usuário técnico `uhp_notifica_backend`, que já foi criado no banco hospedado pelo procedimento em [Instalação no Supabase](SUPABASE.md). A migração inicial já está aplicada no projeto hospedado.
2. No Netlify, configure `UHP_DATABASE_URL` como segredo para o contexto de Deploy Preview do PR nº 1 ou da branch `codex/backend-notificacoes`. O valor é a URL do pooler do Supabase com o usuário técnico, sem parâmetros. Copie o host no painel de conexão do Supabase. Se a validação TLS exigir o certificado raiz do projeto, configure também `UHP_DB_CA_PEM` com o PEM completo. Essas variáveis ficam no ambiente da função.
3. Gere um novo Deploy Preview para o PR nº 1. O arquivo `netlify.toml` define a pasta pública e a pasta das funções. A branch usa Node.js 24.
4. Abra `/api/v1/health` no endereço do Deploy Preview. O retorno `200` com `status: "ok"` confirma a conexão com o esquema. `provisioned: false` indica que ainda falta cadastrar a primeira unidade. `503` indica que o banco não pôde ser consultado. `GET /api/v1/session` sem sessão deve retornar `401`.
5. Com a conexão verificada, cadastre uma unidade fictícia e as três contas de teste com `backend/admin.mjs`. Mantenha senhas e token do QR Code no ambiente de homologação. Teste cadastro com foto, login, encaminhamento, parecer, evidências e encerramento antes de usar as telas com a equipe.

O limite por arquivo de evidência no Deploy Preview é de **4 MiB** para que a codificação em Base64 caiba no limite de 6 MB do Netlify. A foto da notificação continua limitada a **2 MiB**. A função usa o IP fornecido pelo Netlify e mantém o cookie seguro na mesma origem.

- [Deploy Previews](https://docs.netlify.com/deploy/deploy-types/deploy-previews/)
- [Variáveis de ambiente para Functions](https://docs.netlify.com/build/functions/environment-variables/)
- [Limites das Functions](https://docs.netlify.com/build/functions/configuration/)

## Rodar o teste HTTP

Execute `node scripts/check-preview.mjs URL_DO_PREVIEW` para verificar a conexão e a exigência de sessão. Para testar o fluxo completo, configure `UHP_TEST_INTAKE_TOKEN` e os pares `UHP_TEST_COORD_EMAIL` / `UHP_TEST_COORD_PASSWORD`, `UHP_TEST_SAFETY_EMAIL` / `UHP_TEST_SAFETY_PASSWORD` e `UHP_TEST_CCIH_EMAIL` / `UHP_TEST_CCIH_PASSWORD` em um ambiente privado. Execute o mesmo comando com `--full`. Use somente uma unidade fictícia e contas terminadas em `@example.test`. Cada execução completa grava uma notificação fictícia para conferência.
