// Shared, deterministic vocabulary. Ambiguous placeholders are never guessed by position.
export const words=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const vocabulary={
 name:/\b(nome|name|paciente|patient|pessoa|cliente|beneficiario)\b/,
 date:/\b(data|date|dia|agendamento|appointment)\b/,
 time:/\b(hora|horario|horas|time)\b/,
 procedure:/\b(procedimento|procedimentos|exame|exames|procedure|procedures|especialidade|especialidades|servico|servicos)\b/,
 location:/\b(local|endereco|address|location|unidade|clinica|hospital|estabelecimento)\b/,
 provider:/\b(prestador|profissional|medico|medica|doutor|doutora|doctor|provider|responsavel)\b/,
 instructions:/\b(orientacao|orientacoes|instrucao|instrucoes|preparo|preparos|observacao|observacoes)\b/,
};
export type Semantic=keyof typeof vocabulary;
export const semanticLabels:Record<Semantic,string>={name:'Nome da pessoa',date:'Data do atendimento',time:'Horário',procedure:'Procedimento',location:'Local',provider:'Prestador',instructions:'Orientações'};
export function columnSemantic(header:string):Semantic|null{
 const s=words(header);if(/\b(cpf|email|telefone|celular|phone|whatsapp|pedido|protocolo|codigo|valor|nascimento|birth|emissao|cadastro)\b/.test(s))return null;
 // A provider's name and a unit's name must not be confused with the recipient.
 for(const key of ['time','date','provider','location','procedure','instructions','name'] as Semantic[])if(vocabulary[key].test(s))return key;
 return null;
}
export function templateSemantic(body:string,parameter:string,label=''):Semantic|null{
 if(label.trim())return columnSemantic(label);
 const marker='{{'+parameter+'}}',index=body.indexOf(marker);if(index<0)return null;
 const before=body.slice(0,index).replace(/\bdr\./gi,'doutor ').replace(/\bdra\./gi,'doutora ').split(/\{\{\d+\}\}|[\n.!?;]/).pop()||'';
 const s=words(before);if(/(?:\b(agendad[oa]s?|marcad[oa]s?|previst[oa]s?|confirmad[oa]s?)\b.*\bpara|\bno dia)\s*$/.test(s))return 'date';if(/\b(as|horario de)\s*$/.test(s))return 'time';const matches=Object.entries(vocabulary).flatMap(([key,rx])=>{const match=rx.exec(s);return match?[{key:key as Semantic,index:match.index}]:[];});
 if(matches.length)return matches.sort((a,b)=>b.index-a.index)[0].key;
 if(/\b(ola|oi|hello|dear|prezado|prezada|bom dia|boa tarde|boa noite)\s*$/.test(s))return 'name';
 // Support placeholders before a label, e.g. {{2}} (data do atendimento).
 const after=body.slice(index+marker.length).match(/^\s*\(([^)]{1,60})\)/)?.[1];
 return after?columnSemantic(after):null;
}
export function automaticTemplate(t:{name:string;language:string;parameters:string[]}){
 return {key:`${t.name}:${t.language}`,bindings:t.parameters.map(parameter=>({parameter,label:'',source:'auto' as const,aliases:[],value:'',transform:'text' as const,separator:', '}))};
}
