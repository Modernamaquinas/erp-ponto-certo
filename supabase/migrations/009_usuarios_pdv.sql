-- Cadastro único de usuários: o número de cadastro (4 dígitos) do operador libera o PDV, e o mesmo cadastro pode
-- (opcionalmente) ter login no ERP (perfis/auth.users). Roda também no PGlite (sem FK para auth.users).
alter table operadores add column user_id uuid unique;
comment on column operadores.codigo is 'Número do cadastro do usuário (4 dígitos): chave de liberação do PDV';
