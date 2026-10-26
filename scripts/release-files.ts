import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
export const root=join(import.meta.dir,'..');
export async function releaseFiles(){
 const child=Bun.spawn(['git','ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,stdout:'pipe',stderr:'pipe'});
 const files=[...new Set((await new Response(child.stdout).text()).split('\0').filter(Boolean))].sort();
 if(await child.exited)throw new Error('Run release checks inside the Git source checkout.');
 return files;
}
export async function validateReleaseFiles(files:string[]){
 const errors:string[]=[];
 for(const file of files){
  if(/^(data|node_modules|\.venv[^/]*|dist|coverage)\//.test(file)||file.startsWith('previews/')&&file!=='previews/index.html'||/(^|\/)(\.env(?:\..*)?|auth\.json|.*\.(?:sqlite.*|pem|key|pyc|log))$/.test(file)){errors.push(`${file}: local or sensitive artifact`);continue;}
  const stat=await lstat(join(root,file));if(stat.isSymbolicLink()){errors.push(`${file}: source symlink`);continue;}
  if(stat.size>5_000_000){errors.push(`${file}: oversized source artifact`);continue;}
  const text=await readFile(join(root,file),'utf8');
  if(/(?:sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{24,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|AKIA[A-Z0-9]{16}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/.test(text))errors.push(`${file}: credential pattern (value withheld)`);
  if(/\/(?:home|Users)\/(?!runner\b|user\b)[^/\s'\"]+\//.test(text))errors.push(`${file}: machine-specific home path`);
 }
 if(errors.length)throw new Error(errors.join('\n'));
}
