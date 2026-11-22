import {describe,it,expect,vi} from 'vitest';
import {createContractDefinitionOperation,createContractDefinitionRepository,validateContractDefinition,type ContractDefinition} from './contract-definition-supabase';
const id='11111111-1111-4111-8111-111111111111';
const definition:ContractDefinition={name:'A',starts_on:'2026-06-01',ends_on:'2027-05-31',groups:[{id,name:'AHU',building:'A',asset_type:'AHU',major_frequency:2,minor_frequency:4}],targets:[{group_id:id,month_start:'2027-05-01',cleaning_kind:'major',target:0}]};
describe('contract definition boundary',()=>{
 it('strips database metadata before resaving a loaded definition',async()=>{
  const scope={contract_id:id,jobsite_id:'S1'};
  const rpc=vi.fn().mockResolvedValueOnce({data:{
   contract:{id,jobsite_id:'S1',version:1,name:'A',starts_on:definition.starts_on,ends_on:definition.ends_on},
   groups:[{...definition.groups[0],...scope}],targets:[{...definition.targets[0],...scope,id:'db-target-id'}],
  }}).mockResolvedValueOnce({data:{id,site_id:'S1',version:2,replayed:false}});
  const repo=createContractDefinitionRepository({rpc});
  const state=await repo.read(id,'S1');
  await repo.save(id,'S1',state.version,crypto.randomUUID(),state.definition);
  expect(rpc.mock.calls[1][1].p_definition).toEqual(definition);
 });
 it('rejects a foreign-site contract list response',async()=>{
  const rpc=vi.fn().mockResolvedValue({data:[{id,site_id:'S2',name:'foreign',starts_on:definition.starts_on,ends_on:definition.ends_on}]});
  await expect(createContractDefinitionRepository({rpc}).list('S1')).rejects.toThrow();
 });
 it('accepts cross-year explicit zero target',()=>expect(()=>validateContractDefinition(definition)).not.toThrow());
 it('rejects foreign group, duplicate target and fractional quantities',()=>{for(const targets of [[{...definition.targets[0],group_id:'other'}],[...definition.targets,...definition.targets],[{...definition.targets[0],target:1.5}]])expect(()=>validateContractDefinition({...definition,targets})).toThrow();});
 it('reuses request after lost response without adopting caller changes',async()=>{const save=vi.fn().mockRejectedValueOnce(Error('lost')).mockResolvedValue(1);const read=vi.fn().mockResolvedValue({version:1});const repo={save,read};const d=structuredClone(definition);const op=createContractDefinitionOperation(repo,id,'S1',0,d);await expect(op.run()).rejects.toThrow();d.name='mutated';await op.run();expect(save.mock.calls[0]).toEqual(save.mock.calls[1]);expect(save.mock.calls[1][4].name).toBe('A');});
 it('retries only read after server acknowledgement',async()=>{const save=vi.fn().mockResolvedValue(1),read=vi.fn().mockRejectedValueOnce(Error('read lost')).mockResolvedValue({version:1});const op=createContractDefinitionOperation({save,read},id,'S1',0,definition);await expect(op.run()).rejects.toThrow();await op.run();expect(save).toHaveBeenCalledTimes(1);expect(read).toHaveBeenCalledTimes(2);});
 it('scope change after save prevents follow-up read',async()=>{let current=true;const save=vi.fn().mockImplementation(async()=>{current=false;return 1;}),read=vi.fn();const op=createContractDefinitionOperation({save,read},id,'S1',0,definition,()=>{if(!current)throw Error('scope changed');});await expect(op.run()).rejects.toThrow('scope changed');expect(read).not.toHaveBeenCalled();});
});
