import { useState } from 'react';
import { supabase, ou } from '../lib/supabase.js';
import { moeda, data, documento, telefone, filtrarBusca } from '../lib/formato.js';
import { usePerfil, podeFinanceiro } from '../lib/contexto.js';
import { Pagina, Filtros, Campo, Tabela, Modal, Detalhes, Etiqueta, useConsulta, useAtrasado } from '../componentes/ui.jsx';

export default function Fornecedores() {
  const [termo, setTermo] = useState('');
  const [inativos, setInativos] = useState(false);
  const [aberto, setAberto] = useState(null);
  const busca = useAtrasado(termo);
  const lista = useConsulta(async () => {
    let q = supabase.from('fornecedores').select('*, cidades(nome, uf)');
    if (!inativos) q = q.eq('ativo', true);
    return { dados: ou(await filtrarBusca(q, busca).order('nome').limit(500)).data };
  }, [busca, inativos]);

  return (
    <Pagina titulo="Fornecedores">
      <Filtros>
        <Campo rotulo="Buscar (nome, fantasia, CNPJ)" largo><input type="search" value={termo} onChange={(e) => setTermo(e.target.value)} /></Campo>
        <label className="check"><input type="checkbox" checked={inativos} onChange={(e) => setInativos(e.target.checked)} /> Mostrar inativos</label>
      </Filtros>
      <Tabela carregando={lista.carregando} erro={lista.erro} linhas={lista.dados} aoClicar={setAberto}
        colunas={[
          { titulo: 'Código', campo: 'id', classe: 'cod' },
          { titulo: 'Nome', render: (f) => <>{f.nome}{!f.ativo && <> <Etiqueta>Inativo</Etiqueta></>}</> },
          { titulo: 'Fantasia', campo: 'fantasia' },
          { titulo: 'CNPJ/CPF', render: (f) => documento(f.cpf_cnpj) },
          { titulo: 'Telefone', render: (f) => telefone(f.telefone || f.celular) },
          { titulo: 'Cidade', render: (f) => (f.cidades ? `${f.cidades.nome}/${f.cidades.uf}` : '') },
        ]} />
      {aberto && <DetalheFornecedor f={aberto} aoFechar={() => setAberto(null)} />}
    </Pagina>
  );
}

function DetalheFornecedor({ f, aoFechar }) {
  const fin = podeFinanceiro(usePerfil());
  const notas = useConsulta(async () => ({ dados: ou(await supabase.from('compras').select('id, numero_nota, data_emissao, valor_total')
    .eq('fornecedor_id', f.id).order('data_emissao', { ascending: false }).limit(10)).data }), [f.id]);
  const abertas = useConsulta(async () => (fin ? { dados: ou(await supabase.from('contas_pagar').select('saldo')
    .eq('fornecedor_id', f.id).eq('status', 'aberto').eq('conferir_baixa_legado', false)).data } : { dados: [] }), [f.id, fin]);
  const aPagar = (abertas.dados || []).reduce((s, c) => s + Number(c.saldo), 0);

  return (
    <Modal aberto largo titulo={f.nome} aoFechar={aoFechar}>
      <Detalhes itens={[
        ['Código', f.id], ['Fantasia', f.fantasia], ['CNPJ/CPF', documento(f.cpf_cnpj)], ['IE', f.ie],
        ['Telefone', telefone(f.telefone)], ['Celular', telefone(f.celular)], ['E-mail', f.email], ['Contato', f.contato],
        ['Endereço', [f.endereco, f.numero, f.complemento, f.bairro].filter(Boolean).join(', ')],
        ['Cidade', f.cidades && `${f.cidades.nome}/${f.cidades.uf}`], ['CEP', f.cep], ['Observações', f.observacoes],
        ...(fin ? [['A pagar em aberto', moeda(aPagar)]] : []),
      ]} />
      <h3>Últimas notas de compra</h3>
      <Tabela linhas={notas.dados} carregando={notas.carregando} vazio="Nenhuma nota."
        colunas={[
          { titulo: 'NF', campo: 'numero_nota' },
          { titulo: 'Emissão', render: (n) => data(n.data_emissao) },
          { titulo: 'Total', alinhar: 'dir', render: (n) => moeda(n.valor_total) },
        ]} />
    </Modal>
  );
}
