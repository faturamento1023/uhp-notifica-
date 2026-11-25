# Frontend integrado · UHP Notifica

As telas em `netlify/public/` usam o contrato de `docs/API.md` do backend (PR nº 1). São arquivos estáticos, sem build. O Netlify publica essa pasta conforme `netlify.toml`; no servidor Node local, configure `UHP_FRONTEND_DIR=netlify/public` no mesmo domínio da API:

- `/` — entrada do QR Code com `#entrada=TOKEN_DA_UNIDADE`, escolha entre não conformidade e incidente/evento adverso, foto opcional, revisão e protocolo emitido pelo servidor.
- `/painel.html` — login institucional, fila e tratativas conforme o perfil da conta.

O token do QR Code deve ser gerado e guardado pela unidade conforme `docs/API.md`; não o inclua em código, imagens, commits ou testes. O formulário não oferece acesso ao painel. A tela do painel não usa dados ou perfis simulados e não guarda sessão ou ocorrências no armazenamento local do navegador. Fotos e evidências são consultadas pela API com a sessão da conta, dentro do vínculo autorizado pelo servidor.

## Verificação antes da publicação

Com um projeto de homologação configurado, use apenas dados fictícios para percorrer os dois formulários, uma foto opcional e as filas em outra sessão. Encaminhe às duas áreas, reprove e reenvie um parecer, registre ação e evidência por área, solicite complemento e confirme o bloqueio do encerramento até validar todas as tratativas. Teste a fila, foto e evidências com contas sem vínculo.

Esta entrega implementa as telas e chamadas de rede. A conexão hospedada ao Supabase, o endereço HTTPS institucional, as contas e o QR Code da unidade ainda precisam ser configurados e homologados antes de aceitar dados reais.
