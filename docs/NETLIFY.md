# Homologação no Netlify

O Netlify publica os arquivos de `netlify/public` a partir do GitHub. O `netlify.toml` encaminha `/api/v1/*` para a função `uhp-api` no Supabase, mantendo a origem do site para as telas e o cookie de sessão. A função usa `SUPABASE_DB_URL`, fornecida pelo próprio Supabase, e executa as consultas sob o papel `uhp_notifica_app` dentro de cada transação. O Netlify dispensa `UHP_DATABASE_URL`.

## Deploy Preview

- [Página de homologação](https://deploy-preview-1--uhp-notifica.netlify.app)
- [Verificação da API](https://deploy-preview-1--uhp-notifica.netlify.app/api/v1/health)
- [PR nº 1](https://github.com/faturamento1023/uhp-notifica-/pull/1)

O limite é de **4 MiB** por evidência e **2 MiB** para a foto inicial. As telas integradas devem usar rotas relativas e enviar o token de entrada apenas no cabeçalho `X-Intake-Token`.

## Atualizar a API

A origem da função está em `supabase/functions/uhp-api/index.mjs`, com dependências de `backend/` e import map local. Faça o deploy da função no projeto UHP Notifica, incluindo esses arquivos. O gateway está configurado com `verify_jwt: false` porque a API usa sessão própria e token de registro. As origens aceitas para escrita são o domínio do projeto Netlify e o Deploy Preview nº 1.

## Rodar o teste HTTP

Execute `node scripts/check-preview.mjs URL_DO_PREVIEW` para verificar a conexão e a exigência de sessão. Para rodar o fluxo completo, configure `UHP_TEST_INTAKE_TOKEN` e os pares `UHP_TEST_COORD_EMAIL` / `UHP_TEST_COORD_PASSWORD`, `UHP_TEST_SAFETY_EMAIL` / `UHP_TEST_SAFETY_PASSWORD` e `UHP_TEST_CCIH_EMAIL` / `UHP_TEST_CCIH_PASSWORD` em ambiente privado. Execute com `--full`, em uma unidade fictícia e com contas terminadas em `@example.test`. O teste cria uma notificação fictícia e encerra as sessões que abriu.

A página publicada no preview mostra o status da API. A interface final, o QR Code e as contas da unidade dependem da retomada do frontend e da homologação com a equipe.
