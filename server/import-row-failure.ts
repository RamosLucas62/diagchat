import type {ImportFailureCode} from '../shared/import-profile.js';
// Only explicitly typed row errors are non-blocking. Configuration ambiguity remains reviewable.
export class ImportRowFailure extends Error {
 constructor(public code:ImportFailureCode,message:string){super(message);}
}
export function requiredClock(value:string,parameter:string,parse:(value:string)=>string|null){
 if(!value.trim())throw new ImportRowFailure('TIME_MISSING',`Horário ausente para {{${parameter}}}.`);
 const time=parse(value);if(!time)throw new ImportRowFailure('TIME_INVALID',`Horário inválido para {{${parameter}}}.`);
 return time;
}
