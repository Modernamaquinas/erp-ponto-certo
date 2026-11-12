import { useState } from 'react';
import { supabase, ou } from '../lib/supabase.js';
import { moeda, data, documento, telefone } from '../lib/formato.js';
import { usePerfil, podeFinanceiro, navegar } from '../lib/contexto.js';
import { STATUS_ORC } from './Orcamentos.jsx';
import { Pagina, Campo, Tabela, Detalhes, Aviso, Etiqueta, useConsulta, useAvisar } from '../componentes/ui.jsx';
import { situacaoTitulo } from './Receber.jsx';
import EditarCadastro, { validarDoc, validarCep } from '../componentes/EditarCadastro.jsx';

export default function ClienteDetalhe({ id }) {
  const fin = podeFinanceiro(usePerfil());
  const avisar = useAvisar();
  const [edicao, setEdicao] = useState(null);
  const [editandoCadastro, setEditandoCadastro] = useState(false);

  const cli = useConsulta(async () => ({ dados: ou(await supabase.from('clientes').select('*, cidades(nome, uf)').eq('id', id).single()).data }), [id]);
  const vendas = useConsulta(async () => ({ dados: ou(await supabase.from('vendas').select('id, data, total, situacao')
    .eq('cliente_id', id).eq('situacao', 'finalizada').order('data', { ascending: false }).limit(15)).data }), [id]);
  // consignados e reservas do cliente (os em aberto primeiro)
  const consig = useConsulta(async () => ({ dados: ou(await supabase.from('orcamentos').select('id, data, tipo, status, total, validade, venda_id')
    .eq('cliente_id', id).in('tipo', ['consignado', 'reserva']).order('data', { ascending: false }).limit(30)).data }), [id]);
  const titulos = useConsulta(async () => (fin ? { dados: ou(await supabase.from('contas_receber').select('*')
    .eq('cliente_id', id).eq('status', 'aberto').order('vencimento')).data } : { dados: [] }), [id, fin]);

  if (cli.erro) return <Pagina titulo="Cliente"><Aviso tipo="erro">{cli.erro}</Aviso></Pagina>;
  const c = cli.dados;
  if (!c) return <Pagina titulo="Cliente"><p>Carregando…</p></Pagina>;
  const totalAberto = (titulos.dados || []).reduce((s, t) => s + Number(t.saldo), 0);

  async function salvar(e) {
    e.preventDefault();
    try {
      ou(await supabase.from('clientes').update({
        email_cobranca: edicao.email_cobranca || null,
        celular_cobranca: edicao.celular_cobranca.replace(/\D/g, '') || null,
        cobranca_ativa: edicao.cobranca_ativa,
        obs_cobranca: edicao.obs_cobranca || null,
      }).eq('id', id));
      avisar('Dados de cobrança salvos.');
      setEdicao(null);
      cli.recarregar();
    } catch (erro) {
      avisar(erro.message, 'erro');
    }
  }

  return (
    <Pagina titulo={c.nome} subtitulo={`Cliente ${c.id}${c.nome_fantasia ? ` · ${c.nome_fantasia}` : ''}`}
      acoes={<a className="btn btn-sec" href="#/clientes">‹ Voltar</a>}>
      <div className="duas-colunas">
        <section className="painel-caixa">
          <h2>Cadastro</h2>
          <Detalhes itens={[
            ['CPF/CNPJ', documento(c.cpf_cnpj)], ['RG/IE', c.rg_ie], ['Celular', telefone(c.celular)], ['Telefone', telefone(c.telefone)],
            ['E-mail', c.email], ['Contato', c.contato],
            ['Endereço', [c.endereco, c.numero, c.complemento].filter(Boolean).join(', ')], ['Bairro', c.bairro],
            ['Cidade', c.cidades && `${c.cidades.nome}/${c.cidades.uf}`], ['CEP', c.cep],
            ['Nascimento', data(c.data_nascimento)], ['Limite de crédito', c.limite_credito && moeda(c.limite_credito)],
            ['Cliente desde', data(c.criado_em)], ['Última compra', data(c.ultima_compra)],
            ['Situação', <span key="s">{c.ativo ? <Etiqueta tipo="ok">Ativo</Etiqueta> : <Etiqueta>Inativo</Etiqueta>} {c.bloqueado && <Etiqueta tipo="erro">Venda bloqueada</Etiqueta>}</span>],
            ['Observações', c.observacoes],
          ]} />
          {fin && <button type="button" className="btn btn-pri" onClick={() => setEditandoCadastro(true)}>Editar cadastro</button>}
          {editandoCadastro && <EditarCadastro titulo={`Editar cliente ${c.id}`} tabela="clientes" id={c.id} valores={{ ...c, _cidade: c.cidades }}
            aoFechar={() => setEditandoCadastro(false)} aoSalvar={() => { setEditandoCadastro(false); cli.recarregar(); }}
            campos={[
              { campo: 'nome', rotulo: 'Nome / razão social', largo: true, obrigatorio: true, max: 120 },
              { campo: 'nome_fantasia', rotulo: 'Nome fantasia', largo: true, max: 120 },
              { campo: 'tipo_pessoa', rotulo: 'Tipo', tipo: 'select', opcoes: [['F', 'Física'], ['J', 'Jurídica']] },
              { campo: 'cpf_cnpj', rotulo: 'CPF/CNPJ', tipo: 'digitos', max: 18, validar: validarDoc },
              { campo: 'rg_ie', rotulo: 'RG / Inscrição estadual', max: 20 },
              { campo: 'data_nascimento', rotulo: 'Nascimento', tipo: 'data' },
              { campo: 'celular', rotulo: 'Celular', tipo: 'digitos', max: 15 },
              { campo: 'telefone', rotulo: 'Telefone', tipo: 'digitos', max: 15 },
              { campo: 'email', rotulo: 'E-mail', largo: true, maiusculo: false, max: 120 },
              { campo: 'contato', rotulo: 'Contato', max: 60 },
              { campo: 'cep', rotulo: 'CEP', tipo: 'digitos', max: 9, validar: validarCep },
              { campo: 'endereco', rotulo: 'Endereço', largo: true, max: 120 },
              { campo: 'numero', rotulo: 'Número', max: 10 },
              { campo: 'complemento', rotulo: 'Complemento', max: 60 },
              { campo: 'bairro', rotulo: 'Bairro', max: 60 },
              { campo: 'cidade_id', rotulo: 'Cidade', tipo: 'cidade' },
              { campo: 'limite_credito', rotulo: 'Limite de crédito (R$)', tipo: 'decimal' },
              { campo: 'observacoes', rotulo: 'Observações', tipo: 'area', largo: true, maiusculo: false, max: 2000 },
              { campo: 'bloqueado', rotulo: 'Bloquear vendas a prazo (crediário)', tipo: 'check' },
              { campo: 'ativo', rotulo: 'Cliente ativo', tipo: 'check' },
            ]} />}
        </section>

        {fin && (
          <section className="painel-caixa">
            <h2>Cobrança</h2>
            {!edicao ? (
              <>
                <Detalhes itens={[
                  ['Cobrança automática', c.cobranca_ativa ? 'Ativa' : 'Desativada (fica fora do fechamento em lote)'],
                  ['Celular p/ cobrança', telefone(c.celular_cobranca) || (c.celular ? `${telefone(c.celular)} (do cadastro)` : '—')],
                  ['E-mail p/ cobrança', c.email_cobranca || (c.email ? `${c.email} (do cadastro)` : '—')],
                  ['Cliente no Asaas', c.asaas_customer_id || 'Ainda não criado'],
                  ['Observação', c.obs_cobranca],
                ]} />
                {!c.cpf_cnpj && <Aviso tipo="alerta">Sem CPF/CNPJ: o Asaas não aceita gerar cobrança. Cadastre no DirectControl.</Aviso>}
                <button type="button" className="btn btn-sec" onClick={() => setEdicao({
                  email_cobranca: c.email_cobranca || '', celular_cobranca: c.celular_cobranca || '', cobranca_ativa: c.cobranca_ativa, obs_cobranca: c.obs_cobranca || '' })}>
                  Editar dados de cobrança
                </button>
              </>
            ) : (
              <form className="form-grade" onSubmit={salvar}>
                <Campo rotulo="Celular p/ cobrança (com DDD)"><input inputMode="tel" value={edicao.celular_cobranca} onChange={(e) => setEdicao({ ...edicao, celular_cobranca: e.target.value })} /></Campo>
                <Campo rotulo="E-mail p/ cobrança"><input type="email" value={edicao.email_cobranca} onChange={(e) => setEdicao({ ...edicao, email_cobranca: e.target.value })} /></Campo>
                <Campo rotulo="Observação" largo><input value={edicao.obs_cobranca} onChange={(e) => setEdicao({ ...edicao, obs_cobranca: e.target.value })} /></Campo>
                <label className="check"><input type="checkbox" checked={edicao.cobranca_ativa} onChange={(e) => setEdicao({ ...edicao, cobranca_ativa: e.target.checked })} /> Incluir no fechamento do crediário</label>
                <div className="form-acoes">
                  <button type="button" className="btn btn-sec" onClick={() => setEdicao(null)}>Cancelar</button>
                  <button type="submit" className="btn btn-pri">Salvar</button>
                </div>
              </form>
            )}
          </section>
        )}
      </div>

      {fin && (
        <section className="painel-caixa">
          <div className="grafico-topo">
            <h2>Crediário em aberto: {moeda(totalAberto)}</h2>
            <a className="btn btn-sec btn-peq" href={`#/receber?cliente=${id}&situacao=todos`}>Ver todos os títulos</a>
          </div>
          <Tabela linhas={titulos.dados} carregando={titulos.carregando} vazio="Nenhum título em aberto."
            colunas={[
              { titulo: 'Vencimento', render: (t) => data(t.vencimento) },
              { titulo: 'Histórico', render: (t) => t.historico || t.documento },
              { titulo: 'Saldo', alinhar: 'dir', render: (t) => moeda(t.saldo) },
              { titulo: 'Situação', render: (t) => <span className="etiquetas">{situacaoTitulo(t)}{t.cobranca_id && <Etiqueta tipo="marca">Asaas</Etiqueta>}</span> },
            ]} />
        </section>
      )}

      {consig.dados?.length > 0 && (
        <section className="painel-caixa">
          <div className="grafico-topo">
            <h2>Consignados e reservas{(() => { const ab = consig.dados.filter((o) => ['consignado', 'reservado'].includes(o.status)); return ab.length ? `: ${ab.length} em aberto (${moeda(ab.reduce((s, o) => s + Number(o.total), 0))})` : ''; })()}</h2>
          </div>
          <Tabela linhas={[...consig.dados].sort((a, b) => Number(['consignado', 'reservado'].includes(b.status)) - Number(['consignado', 'reservado'].includes(a.status)))}
            aoClicar={(o) => navegar(['consignado', 'reservado'].includes(o.status) ? `/pdv?orcamento=${o.id}` : `/orcamentos`)}
            colunas={[
              { titulo: 'Nº', campo: 'id', classe: 'cod' },
              { titulo: 'Tipo', render: (o) => (o.tipo === 'consignado' ? 'Consignado' : 'Reserva') },
              { titulo: 'Data', render: (o) => data(o.data) },
              { titulo: 'Acerto até', render: (o) => (o.validade ? <span className={['consignado', 'reservado'].includes(o.status) && o.validade < new Date().toISOString().slice(0, 10) ? 'texto-erro' : ''}>{data(o.validade)}</span> : '') },
              { titulo: 'Total', alinhar: 'dir', render: (o) => moeda(o.total) },
              { titulo: 'Situação', render: (o) => <Etiqueta tipo={STATUS_ORC[o.status]?.[0]}>{STATUS_ORC[o.status]?.[1]}{o.venda_id ? ` · venda ${o.venda_id}` : ''}</Etiqueta> },
            ]} />
          <p className="texto-fraco">Clique num consignado em aberto para fazer o acerto no PDV.</p>
        </section>
      )}

      <section className="painel-caixa">
        <div className="grafico-topo">
          <h2>Últimas compras</h2>
          <a className="btn btn-sec btn-peq" href={`#/vendas?cliente=${id}`}>Ver todas</a>
        </div>
        <Tabela linhas={vendas.dados} carregando={vendas.carregando} vazio="Nenhuma compra registrada."
          colunas={[
            { titulo: 'Venda', campo: 'id', classe: 'cod' },
            { titulo: 'Data', render: (v) => data(v.data) },
            { titulo: 'Total', alinhar: 'dir', render: (v) => moeda(v.total) },
          ]} />
      </section>
    </Pagina>
  );
}
