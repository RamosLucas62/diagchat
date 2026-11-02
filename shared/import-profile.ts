import {z} from 'zod';
const aliases=z.array(z.string().trim().min(1).max(160)).max(30);
export const bindingSchema=z.object({parameter:z.string().regex(/^\d+$/),label:z.string().max(100).default(''),source:z.enum(['auto','column','fixed','sheet_datetime']).default('auto'),aliases:aliases.default([]),value:z.string().max(1024).default(''),transform:z.enum(['text','first_name','date','time','datetime','join']).default('text'),separator:z.string().max(10).default(', '),sheetYear:z.number().int().min(2020).max(2100).nullable().optional()});
const layout=z.object({headerRow:z.number().int().min(1).max(500).optional(),phoneColumn:z.string().max(160).optional()});
export const importProfileSchema=z.object({
 mode:z.enum(['fixed','form','column']).default('fixed'),fixedTemplate:z.string().max(550).default(''),
 phoneAliases:aliases.default(['Telefone','Celular','WhatsApp','Fone','Contato']),nameAliases:aliases.default(['Nome','Nome completo','Paciente','Nome do paciente','Cliente']),
 headerRow:z.number().int().min(0).max(500).default(0),layouts:z.record(z.string().max(200),layout).default({}),
 routingAliases:aliases.default([]),routes:z.array(z.object({value:z.string().trim().min(1).max(200),template:z.string().min(1).max(550)})).max(100).default([]),
 templates:z.array(z.object({key:z.string().min(1).max(550),signature:z.string().max(64).optional(),bindings:z.array(bindingSchema).max(30)})).max(100).default([]),
 schedule:z.object({source:z.enum(['immediate','sheet','column']).default('immediate'),aliases:aliases.default([]),year:z.number().int().min(2020).max(2100).nullable().default(null),time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default('09:00'),daysBefore:z.number().int().min(0).max(365).default(0),past:z.enum(['review','now']).default('review')}).default({source:'immediate',aliases:[],year:null,time:'09:00',daysBefore:0,past:'review'}),
 duplicates:z.enum(['exact','group']).default('exact'),groupKeys:z.array(z.object({label:z.string().min(1).max(100),aliases})).max(10).default([]),
}).superRefine((p,ctx)=>{
 const keys=p.templates.map(t=>t.key);if(new Set(keys).size!==keys.length)ctx.addIssue({code:'custom',message:'Há templates repetidos no perfil.'});
 for(const t of p.templates)if(new Set(t.bindings.map(b=>b.parameter)).size!==t.bindings.length)ctx.addIssue({code:'custom',message:'Há variáveis repetidas no template.'});
 if(p.mode==='column'&&(!p.routingAliases.length||!p.routes.length))ctx.addIssue({code:'custom',message:'Defina a coluna e as regras de escolha do template.'});
 const values=p.routes.map(r=>r.value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase());if(new Set(values).size!==values.length)ctx.addIssue({code:'custom',message:'Há valores repetidos nas regras de template.'});
 if(p.schedule.source==='column'&&!p.schedule.aliases.length)ctx.addIssue({code:'custom',message:'Defina a coluna da data de disparo.'});
 if(p.duplicates==='group'&&p.groupKeys.some(k=>!k.aliases.length))ctx.addIssue({code:'custom',message:'Defina as colunas dos identificadores de compromisso.'});
 if(p.duplicates==='group'&&!p.groupKeys.length)ctx.addIssue({code:'custom',message:'Defina as colunas que identificam o mesmo compromisso.'});
});
export type ImportProfile=z.infer<typeof importProfileSchema>;
export type ImportBinding=z.infer<typeof bindingSchema>;
export const defaultImportProfile=():ImportProfile=>importProfileSchema.parse({});
export type ImportIssue={sheet:string;row:number;message:string};
export type ImportSummary={id:string;file_name:string;status:'ready'|'review'|'submitted';requested_at:string|null;created_at:string;client_id:string;client_name?:string;issues:ImportIssue[];summary:{rows:number;messages:number;duplicates:number;groups:number;sheets:number;segments:{sheet:string;template:string;scheduledAt:string;messages:number}[]};campaign_ids:string[]};
