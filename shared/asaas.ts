import {z} from 'zod';
const percent=z.number().finite().min(0).max(100);
export const fiscalSchema=z.object({
 municipalServiceCode:z.string().trim().min(1).max(100),municipalServiceName:z.string().trim().min(1).max(200),
 serviceDescription:z.string().trim().min(1).max(1000),observations:z.string().max(1000).default(''),
 taxes:z.object({retainIss:z.boolean(),iss:percent,cofins:percent,csll:percent,inss:percent,ir:percent,pis:percent}),
});
const draftFiscal=fiscalSchema.extend({municipalServiceCode:z.string().trim().max(100),municipalServiceName:z.string().trim().max(200),serviceDescription:z.string().trim().max(1000)});
export const asaasSettingsSchema=z.object({enabled:z.boolean(),fiscal:draftFiscal}).superRefine((s,ctx)=>{if(s.enabled){const result=fiscalSchema.safeParse(s.fiscal);if(!result.success)for(const issue of result.error.issues)ctx.addIssue({code:'custom',path:['fiscal',...issue.path],message:issue.message});}});
export const emptyFiscal={municipalServiceCode:'',municipalServiceName:'',serviceDescription:'Serviços DiagChat',observations:'',taxes:{retainIss:false,iss:0,cofins:0,csll:0,inss:0,ir:0,pis:0}};
export type Fiscal=z.infer<typeof fiscalSchema>;
