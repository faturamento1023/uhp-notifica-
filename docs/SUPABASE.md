# Instalação do UHP Notifica no Supabase

O servidor Node.js usa PostgreSQL no Supabase. Os HTMLs continuam chamando `/api/v1`. Login, sessão, filas, regras de transição e autorização de leitura das fotos e evidências continuam na API do UHP Notifica. O banco mantém registros, histórico, contas da aplicação e anexos privados.

## Preparar o projeto

1. Identifique o projeto Supabase destinado ao UHP Notifica. Em homologação, use um projeto de teste com dados fictícios.
2. Aplique a migração em `supabase/migrations/` pelo mecanismo de migrações do Supabase, com a conta de administração. A migração cria o esquema privado `uhp_notifica` e o papel de acesso `uhp_notifica_app`. As tabelas têm RLS e os papéis da Data API não têm permissão sobre o esquema. Mantenha o esquema fora da lista de esquemas expostos.
3. Crie um usuário técnico PostgreSQL exclusivo para o servidor, com uma senha forte definida no ambiente de administração. Use uma sessão segura e guarde a senha em um cofre. Exemplo de configuração do papel, com a senha omitida:

```sql
CREATE ROLE uhp_notifica_backend LOGIN INHERIT;
GRANT uhp_notifica_app TO uhp_notifica_backend;
ALTER ROLE uhp_notifica_backend SET search_path = uhp_notifica, pg_catalog;
```

Defina a senha do papel pela administração PostgreSQL. Em uma sessão interativa de `psql`, use `\password uhp_notifica_backend`. Valide a conexão com esse usuário e confirme `current_user`, `current_schema()` e a leitura de `uhp_notifica.units`. Execute os advisors do projeto após a migração.

## Configurar o servidor

| Variável | Valor |
| --- | --- |
| `UHP_DATABASE_URL` | URL PostgreSQL do papel técnico, sem parâmetros de URL. Use conexão direta ou o pooler em modo sessão na porta 5432. No pooler, o usuário tem a forma `uhp_notifica_backend.<project-ref>`. A credencial fica apenas no servidor. |
| `UHP_DB_CA_FILE` | Caminho do certificado raiz do projeto quando necessário. A conexão exige TLS com validação do certificado. |
| `UHP_ORIGIN` | Origem HTTPS onde serão servidos o frontend e a API. |
| `UHP_PORT` | Porta local do servidor Node.js. |
| `UHP_FRONTEND_DIR` | Diretório de distribuição do frontend, quando integrado. |

Use o [painel de conexão do Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres) para obter o endereço e o certificado. Execute `npm ci --omit=dev` e `npm start` no servidor. A aplicação escuta em loopback e deve ficar atrás do proxy HTTPS institucional.

## Verificar e provisionar contas

- Execute `npm ci` e `npm test` para testar a migração e o fluxo em PostgreSQL local, sem credenciais do projeto.
- Cadastre a unidade e os perfis com os comandos em [Contrato da API](API.md#execução-em-desenvolvimento). Agende `node backend/admin.mjs prune-expired` para limpar sessões e limites expirados.
- Faça a homologação usando duas unidades de teste e contas com perfis diferentes. Verifique acesso à notificação, foto, evidências e encerramento.
- As fotos e evidências ficam no esquema privado como `bytea` e são servidas pela API após checagem de unidade e vínculo. Planeje backup, restauração, retenção e análise de anexos antes de receber dados reais.

A migração cria o esquema novo. Uma eventual transferência de dados do SQLite anterior exige inventário e validação próprios. Os HTMLs de protótipo guardam registros de teste no navegador ou em arquivos JSON.
