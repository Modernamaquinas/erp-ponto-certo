-- 025 — painel_caixa_mes só é chamada pela API (service role), na rotina agendada e no botão "Enviar agora" (admin/financeiro).
revoke execute on function painel_caixa_mes(text) from public, anon, authenticated;
