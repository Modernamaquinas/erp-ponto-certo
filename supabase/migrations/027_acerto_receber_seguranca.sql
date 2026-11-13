-- 027 — receber_acerto roda como o usuário logado: rel_exigir('fin') + RLS de contas_receber/recebimentos/caixa (admin/financeiro).
revoke execute on function receber_acerto(jsonb) from public, anon;
grant execute on function receber_acerto(jsonb) to authenticated;
