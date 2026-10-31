export type Client={id:string;name:string;email:string;photo_url:string;waba_id:string;phone_id:string;group_id:string;throughput:number;plan_name:string;monthly_limit:number;current_limit:number;monthly_fee:number;overage_mode:'block'|'charge';overage_rate:number;cost_rate:number;due_day:number;active:boolean;verify_token:string;used:number;reserved:number};
export type Campaign={id:string;client_id:string;client_name:string;name:string;template_name:string;status:string;scheduled_at:string;created_at:string;total:number;sent:number;delivered:number;read:number;failed:number;uncertain:number};
export type Metrics={clients:number;sent:number;reserved:number;quota:number;revenue:number;cost:number;profit:number;average:number;delivered:number;read:number;failed:number;uncertain:number;daily:{date:string;sent:number}[]};
export type Invoice={id:string;client_name:string;period:string;total:number;overage_count:number;due_date:string;status:string;email_status:string;last_error?:string};
export type Template={name:string;language:string;body:string;parameters:string[];supported:boolean};
export type ImportRow={sheet:string;row:number;phone:string;name:string;fields:Record<string,string>};
export type Sheet={name:string;headerRow:number;phoneColumn:string;columns:string[];rows:ImportRow[];invalid:number;duplicates:number;warnings:string[];sample:string[][]};
export type Settings={url:string;webhookPattern:string;integrations:{name:string;description:string;configured:boolean}[];notifications:{id:string;kind:string;status:string;last_error:string}[]};
