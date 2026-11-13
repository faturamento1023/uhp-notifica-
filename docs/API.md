# Contrato da API do UHP Notifica

O backend usa Node.js 24.14+ e PostgreSQL no Supabase. O frontend e a API usam a mesma origem. As rotas da API começam com `/api/v1`. A documentação e os protótipos do repositório usam dados fictícios.

## Entrada por QR Code

O QR Code aponta para a página de registro, por exemplo `https://notifica.example.test/#entrada=TOKEN_DA_UNIDADE`. O token no fragmento identifica a unidade e autoriza somente a criação. A tela lê o fragmento e envia o valor no cabeçalho `X-Intake-Token`. O token é rotativo e deve circular entre os profissionais da unidade. A tela não oferece consulta por protocolo.

Envie `POST /notifications` com `Content-Type: application/json`.

```json
{
  "requestId": "8a1e68ce-6c5e-4cf8-a82c-3ba68791e631",
  "kind": "incident",
  "occurredOn": "2026-11-13",
  "sector": "Internação",
  "period": "Manhã",
  "subject": "Queda do paciente",
  "harm": "Nenhum (incidente sem dano)",
  "description": "Descrição fictícia.",
  "entries": [
    ["Fatores contribuintes", "Fatores da comunicação"],
    ["Idade no momento da ocorrência", "45 anos"]
  ]
}
```

| Campo | Regra |
| --- | --- |
| `requestId` | UUID gerado com `crypto.randomUUID()` no frontend. Em caso de falha de rede, repetir o mesmo ID e conteúdo para obter o mesmo protocolo. Gerar novo ID ao confirmar um envio novo. |
| `kind` | `nonconformity` ou `incident`. |
| `occurredOn` | Data no formato `AAAA-MM-DD`. |
| `sector` | Obrigatório para não conformidade e opcional para incidente. Envie o setor digitado quando for escolhido **Outro**. |
| `period` | `Manhã`, `Tarde`, `Noite` ou `Madrugada`. |
| `description` | Relato obrigatório, até 5.000 caracteres. |
| `subject`, `harm` | Obrigatórios em incidentes. Os graus são `Nenhum (incidente sem dano)`, `Leve`, `Moderado`, `Grave` e `Óbito em decorrência do evento adverso`. |
| `photo` | Opcional em ambos os tipos. Objeto `{ name, mime, contentBase64 }` para uma foto JPEG ou PNG de até 2 MiB. Envie apenas o conteúdo Base64, sem o prefixo da URL de dados. O registro e a foto são gravados juntos. |
| `entries` | Até 30 pares `[rótulo, valor]` para categorias selecionadas e campos complementares dos protótipos. Rótulo de até 160 caracteres e valor de até 5.000. Envie apenas campos preenchidos. |

O servidor retorna `201` com `{ "id": "uuid", "protocol": "UHP-2026-8A1E68CE6C5E4CF8" }`. Uma repetição idêntica retorna `200` com o mesmo registro. Uma repetição com conteúdo diferente, inclusive se a foto mudar, retorna `409`.

## Sessão e filas

| Método e rota | Acesso | Entrada e retorno |
| --- | --- | --- |
| `POST /session` | Usuários cadastrados | `{ email, password }`. Retorna `{ id, unitId, email, name, role }` e cookie de sessão. |
| `GET /session` | Autenticado | Retorna a conta atual. |
| `DELETE /session` | Autenticado | Encerra a sessão e retorna `204`. |
| `GET /notifications?offset=0` | Autenticado | `{ items, nextOffset }`, 30 por página. A Coordenação vê a unidade. As áreas veem apenas casos atribuídos à conta. |
| `GET /notifications/{id}` | Autenticado e vinculado | Dados do caso, tratativas acessíveis e histórico. |
| `GET /notifications/{id}/photo` | Autenticado e vinculado | Imagem JPEG ou PNG, com `Cache-Control: no-store`. Retorna `404` se a notificação estiver fora do escopo ou não houver foto. |
| `GET /notifications/{id}/pdf` | Coordenação | Gera um PDF A4 da notificação para entrega ao setor, com as marcas UHP Notifica e Prefeitura/Secretaria da Saúde, protocolo, dados da ocorrência, foto anexada quando houver e campo de ciência. Retorna `application/pdf` com `Content-Disposition: inline` e `Cache-Control: no-store`, para abrir no visualizador do navegador e imprimir. Exige sessão e vínculo com a unidade; perfis das áreas recebem `403`. |
| `GET /assignees` | Coordenação | `{ items: [{ id, name, role }] }` com profissionais ativos da unidade. |

Os perfis são `coordination`, `patient_safety` e `ccih`. O navegador envia o cookie automaticamente na mesma origem. Em desenvolvimento, o servidor usa `http://127.0.0.1:3000`. Em homologação, use o Deploy Preview HTTPS do Netlify, que encaminha as chamadas ao Supabase. A API exige o cabeçalho `Origin` correspondente à aplicação em operações de escrita.

Cada item da fila contém `id`, `protocol`, `status`, `createdAt`, `kind`, `sector`, `occurredOn`, `subject`, `harm` e `assignments`. O detalhe inclui também `period`, `description`, `entries`, `closure`, `closedAt`, `closedBy` e `history`, além de `photo` (`null` ou `{ name, mime, size }`). Use a rota de foto com a sessão atual para visualizar a imagem. O histórico traz `id`, `assignmentId`, `actorId`, `event`, `detail` e `createdAt`.

## Tratativa, parecer e encerramento

Todas as escritas desta tabela usam `POST` com JSON. Datas usam `AAAA-MM-DD`.

| Rota | Quem pode operar | Corpo e efeito |
| --- | --- | --- |
| `/notifications/{id}/assignments` | Coordenação | `{ area, assigneeId, opinionDue, actionsDue }`. Encaminha uma área por chamada. Retorna `201` com a tratativa em `draft`. |
| `/assignments/{id}/reassign` | Coordenação | `{ assigneeId, opinionDue, actionsDue, reason }`. Atualiza responsável e prazos antes da validação, com histórico. |
| `/assignments/{id}/draft` | Responsável da área | `{ body }`. Salva ou limpa o rascunho em `draft` ou `revision`. |
| `/assignments/{id}/submit` | Responsável da área | `{ body }` ou `{}` para usar o rascunho. Cria versão do parecer e muda para `pending_approval`. |
| `/assignments/{id}/decision` | Coordenação | `{ version, decision, reason }`. `approved` libera `actions`. `rejected` exige justificativa e devolve para `revision`. |
| `/assignments/{id}/actions` | Responsável da área | `{ description, performedOn }`. Cria ação em `actions` ou `complement`. Retorna `201` com `id`, `description`, `performedOn`, `createdBy` e `createdAt`. |
| `/actions/{id}/evidence` | Responsável da área | `{ name, mime, contentBase64 }`. PDF, PNG ou JPEG de até 5 MiB no servidor Node.js e de até 4 MiB na API hospedada no Supabase. Retorna `201` com `id`, `name`, `mime`, `size` e `createdAt`. Limite por tratativa de 30 arquivos e 30 MiB. |
| `/assignments/{id}/submit-actions` | Responsável da área | `{}`. Envia para `pending_validation` quando cada ação registrada tem evidência. |
| `/assignments/{id}/validate` | Coordenação | `{ submissionId, decision, reason }`. Use o `id` do último evento `actions_submitted` daquela tratativa. `validated` valida. `complement` exige justificativa e devolve para complemento. |
| `/notifications/{id}/close` | Coordenação | `{ conclusion }`. Fecha o caso após validar todas as tratativas. Retorna o detalhe atualizado. |

A resposta padrão de atualização da tratativa contém `id`, `notificationId`, `area`, `assigneeId`, `opinionDue`, `actionsDue`, `status` e `overdue: { opinion, actions }`. No detalhe, a tratativa inclui `draft` (visível ao responsável), `opinions` e `actions`. Cada parecer inclui `version`, `body`, `submittedBy`, `submittedAt`, `decision`, `reason`, `decidedBy` e `decidedAt`. Cada ação tem a lista `evidence`.

O estado do caso é `received`, `in_progress` ou `closed`. O atraso é calculado em dias no horário de Brasília e aparece junto à etapa pendente. A data limite pode ser atualizada pela Coordenação. O indicador de atraso não impede o envio.

Use `GET /evidence/{id}` para baixar a evidência com sessão e vínculo. O servidor devolve o arquivo como anexo. Renderize os textos registrados como texto puro.

## Erros

Formato `{ error: { code, message } }`. `400` indica campo inválido, `401` falta de sessão ou credenciais inválidas, `403` perfil ou origem sem permissão, `404` registro indisponível para a conta, `409` etapa incompatível, versão desatualizada ou duplicidade, `413` corpo grande demais, `415` tipo de conteúdo incompatível e `429` excesso de tentativas.

## Execução em desenvolvimento

Configure a conexão conforme [Instalação no Supabase](SUPABASE.md). Para rodar apenas os testes, basta Node.js e npm. A suíte usa PostgreSQL local em memória.

```bash
npm ci
npm test
node backend/admin.mjs unit "Unidade de teste"
node backend/admin.mjs user UUID_DA_UNIDADE coordenacao@example.test coordination "Coordenação"
node backend/admin.mjs user UUID_DA_UNIDADE seguranca@example.test patient_safety "Segurança do Paciente"
node backend/admin.mjs user UUID_DA_UNIDADE ccih@example.test ccih "CCIH"
npm start
```

Os comandos `user` leem a senha da entrada padrão, com mínimo de 14 caracteres. Em terminal interativo, forneça a senha pela entrada padrão sem eco e encerre a leitura com EOF. Guarde o token retornado por `unit` no ambiente da unidade. `rotate-intake UUID_DA_UNIDADE` troca o token e invalida o QR Code anterior. `disable-user UUID_DA_CONTA` bloqueia a conta e encerra as sessões.

A aplicação escuta somente no loopback. Use `UHP_PORT` para alterar a porta, `UHP_DATABASE_URL` para o banco, `UHP_ORIGIN` para a origem e `UHP_FRONTEND_DIR` para a pasta de frontend compilado. Sirva somente o diretório de distribuição nessa opção. Scripts do frontend devem estar em arquivos próprios.

## Antes do uso assistencial

Defina a origem HTTPS institucional. Se optar pelo servidor Node.js independente, instale um proxy HTTPS na mesma máquina. Configure backup e teste a restauração do banco, que contém as fotos e evidências. Mantenha a conexão exclusiva do servidor e restrinja o acesso operacional ao banco. Defina retenção, acesso ao QR Code, controle de volume no proxy, tratamento de anexos no ambiente institucional e responsáveis pelo provisionamento de contas. Nesta versão, a limitação de tentativas usa o endereço da conexão direta, sem confiar em cabeçalhos enviados pelo cliente. Atrás de um único proxy, o limite por endereço é compartilhado. A integração das telas e a homologação com a unidade precedem o uso de dados reais.
