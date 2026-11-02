import 'dotenv/config';
export const demo = process.env.DEMO_MODE === 'true';
export const production = process.env.NODE_ENV === 'production';
if (demo && production) throw new Error('DEMO_MODE não pode ser usado em produção.');
export const config = {
 port: Number(process.env.PORT || 3000), url: process.env.APP_URL || 'http://127.0.0.1:5173',
 database: process.env.DATABASE_URL, supabase: process.env.SUPABASE_URL, anon: process.env.SUPABASE_ANON_KEY,
 graph: process.env.META_GRAPH_VERSION || '', encryption: process.env.ENCRYPTION_KEY || '',
 asaasKey:process.env.ASAAS_API_KEY, asaasWebhookToken:process.env.ASAAS_WEBHOOK_TOKEN, asaasEnvironment:process.env.ASAAS_ENVIRONMENT||'sandbox',
 resend: process.env.RESEND_API_KEY, from: process.env.RESEND_FROM,
 evolution: process.env.EVOLUTION_URL?.replace(/\/$/, ''), evolutionKey: process.env.EVOLUTION_API_KEY,
 evolutionInstance: process.env.EVOLUTION_INSTANCE,
};
export const asaasTokenConfigured=()=>/^[^\s]{32,255}$/.test(config.asaasWebhookToken||'');
export function assertConfigured() {
 if(!['sandbox','production'].includes(config.asaasEnvironment))throw new Error('ASAAS_ENVIRONMENT deve ser sandbox ou production.');
 if (demo) return;
 for (const [name,value] of Object.entries({DATABASE_URL:config.database,SUPABASE_URL:config.supabase,SUPABASE_ANON_KEY:config.anon,ENCRYPTION_KEY:config.encryption,META_GRAPH_VERSION:config.graph})) {
  if (!value) throw new Error(`Configure ${name} no ambiente. Para experimentar localmente: npm run demo`);
 }
 if (!/^[a-f0-9]{64}$/i.test(config.encryption)) throw new Error('ENCRYPTION_KEY deve conter 64 caracteres hexadecimais.');
 if (!/^v\d+\.\d+$/.test(config.graph)) throw new Error('Versão Graph API inválida.');
 if (production && !config.url.startsWith('https://')) throw new Error('APP_URL precisa de HTTPS.');
}
